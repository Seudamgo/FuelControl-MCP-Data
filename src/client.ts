import type { Config } from './config.js';
import { FuelControlError, mapApiError, mapNetworkError } from './errors.js';
import { RateLimiter } from './rateLimit.js';

/**
 * Danh sách đường dẫn MCP được phép gọi. KHÔNG có đường nào để agent tự đặt path.
 *
 * Đây là bản sao phía client của luật scope=read ở server (skill §5). Server đã
 * chặn rồi, nhưng chặn ở đây có hai cái lợi mà chặn ở server không có: lỗi hiện
 * ra ngay tại chỗ với câu nói người đọc hiểu, và một cú gọi sai không bao giờ
 * rời khỏi máy này mang theo API key.
 */
export const ENDPOINTS = {
  handoverDaily: '/api/reports/handover-daily',
  fuelVsBooking: '/api/reports/fuel-vs-booking',
  me: '/api/me',
} as const;

export type EndpointKey = keyof typeof ENDPOINTS;

/** Trần dung lượng một phản hồi. Số liệu một ngày nằm ở hàng chục KB. */
const MAX_BYTES = 8 * 1024 * 1024;

export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

export class FuelControlClient {
  private readonly limiter: RateLimiter;

  constructor(
    private readonly cfg: Config,
    private readonly fetchImpl: FetchLike = ((i, n) => fetch(i, n)) as FetchLike,
    now: () => number = Date.now,
  ) {
    this.limiter = new RateLimiter(cfg.ratePerMinute, cfg.rateBurst, now);
  }

  /**
   * Gọi GET tới một endpoint trong danh sách trên.
   *
   * Method đóng cứng là GET, không nhận tham số: máy chủ MCP này CHỈ ĐỌC theo
   * thiết kế (PLAN.md §7 Q6). Muốn thêm tool ghi thì phải sửa đúng chỗ này, và
   * đó là chủ đích — một quyết định như vậy phải để lại vết trong lịch sử git.
   */
  async get<T>(endpoint: EndpointKey, query: Record<string, string> = {}): Promise<T> {
    const path = ENDPOINTS[endpoint];

    const verdict = this.limiter.take();
    if (!verdict.allowed) {
      throw new FuelControlError(
        'rate_limited',
        `Đang gọi API quá dày — chờ ${Math.ceil((verdict.retryAfterMs ?? 0) / 1000)} giây rồi hỏi lại. ` +
          'Phanh này ở phía MCP, để một vòng lặp hỏng không nện vào API đang phục vụ người thật.',
      );
    }

    const url = new URL(this.cfg.baseUrl + path);
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined && v !== '') url.searchParams.set(k, v);
    }

    let res: Response;
    try {
      res = await this.fetchImpl(url.toString(), {
        method: 'GET',
        headers: {
          'X-API-Key': this.cfg.apiKey,
          Accept: 'application/json',
          'User-Agent': 'fuelcontrol-mcp/0.1',
        },
        // Không đi theo chuyển hướng. fetch chỉ tự gỡ vài header chuẩn khi đổi
        // host, còn X-API-Key là header riêng nên nó sẽ được gửi tiếp sang đích
        // mới — một cú 302 là đủ để chuỗi bí mật rời khỏi tay mình.
        redirect: 'manual',
        signal: AbortSignal.timeout(this.cfg.timeoutMs),
      });
    } catch (err) {
      throw mapNetworkError(err, this.cfg.baseUrl, this.cfg.timeoutMs);
    }

    if (res.status >= 300 && res.status < 400) {
      throw new FuelControlError(
        'network',
        `${path} trả chuyển hướng ${res.status} — MCP cố ý không đi theo, vì API key sẽ bị gửi ` +
          'sang địa chỉ mới. Kiểm lại FUELCONTROL_BASE_URL (thiếu/thừa "www", http thay vì https).',
        { status: res.status },
      );
    }

    const body = await this.readCapped(res, path);

    if (!res.ok) {
      throw mapApiError(res.status, safeParse(body), path);
    }

    const parsed = safeParse(body);
    if (parsed === null) {
      // Gần như luôn là đã đi lạc vào trang HTML của frontend chứ không phải API.
      throw new FuelControlError(
        'bad_response',
        `${path} trả về thứ không phải JSON. Nhiều khả năng FUELCONTROL_BASE_URL đang trỏ vào ` +
          'trang web thay vì API, hoặc có một proxy chen giữa.',
        { status: res.status },
      );
    }
    return parsed as T;
  }

  /** Đọc thân phản hồi nhưng dừng lại khi vượt trần, thay vì nuốt hết vào RAM. */
  private async readCapped(res: Response, path: string): Promise<string> {
    const declared = Number(res.headers.get('content-length') ?? '');
    if (Number.isFinite(declared) && declared > MAX_BYTES) {
      throw new FuelControlError(
        'bad_response',
        `${path} trả về ${declared} byte, vượt trần ${MAX_BYTES}. Hỏi khoảng ngày ngắn hơn.`,
      );
    }
    const text = await res.text();
    if (text.length > MAX_BYTES) {
      throw new FuelControlError(
        'bad_response',
        `${path} trả về quá ${MAX_BYTES} byte. Hỏi khoảng ngày ngắn hơn.`,
      );
    }
    return text;
  }
}

function safeParse(text: string): Record<string, unknown> | null {
  try {
    const v = JSON.parse(text);
    return typeof v === 'object' && v !== null ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}
