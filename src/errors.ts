/**
 * Mỗi kiểu hỏng nói ra một câu khác nhau, và KHÔNG kiểu nào trả về dữ liệu rỗng.
 *
 * Đây là luật N3 của dự án ("hỏng thì đóng, không mở") áp vào lớp MCP. Trả mảng
 * rỗng khi gọi API thất bại là kiểu hỏng tệ nhất có thể xảy ra ở đây: Claude sẽ
 * đọc mảng rỗng rồi báo cáo "hôm qua không ai thiếu check-in", trong khi sự thật
 * là KHÔNG HỎI ĐƯỢC. Một câu trả lời sai tự tin còn tệ hơn một lỗi đỏ.
 */

export type ErrorKind =
  | 'config'
  | 'input'
  | 'auth'
  | 'scope'
  | 'permission'
  | 'not_built'
  | 'rate_limited'
  | 'network'
  | 'server'
  | 'bad_response';

export class FuelControlError extends Error {
  readonly kind: ErrorKind;
  readonly status?: number;
  readonly apiCode?: string;

  constructor(kind: ErrorKind, message: string, opts: { status?: number; apiCode?: string } = {}) {
    super(message);
    this.name = 'FuelControlError';
    this.kind = kind;
    this.status = opts.status;
    this.apiCode = opts.apiCode;
  }
}

/** Thân lỗi chuẩn của FuelControl API: {"error": "CODE", "message": "..."} */
interface ApiErrorBody {
  error?: string;
  message?: string;
}

/**
 * Dịch một phản hồi lỗi của API sang câu nói người vận hành làm được gì tiếp.
 *
 * Các mã API_KEY_* lấy đúng từ internal/apikeys/gate.go — đừng đoán lại, và nếu
 * backend đổi mã thì sửa ở đây cho khớp.
 */
export function mapApiError(status: number, body: ApiErrorBody | null, path: string): FuelControlError {
  const code = body?.error ?? '';
  const detail = body?.message ? ` (${body.message})` : '';

  if (status === 401) {
    switch (code) {
      case 'API_KEY_EXPIRED':
        return new FuelControlError(
          'auth',
          'API key đã hết hạn. Vào fleet.seudambite.com → tab "API key" → cấp key mới, ' +
            'rồi thay FUELCONTROL_API_KEY trong .env.',
          { status, apiCode: code },
        );
      case 'API_KEY_INVALID':
        return new FuelControlError(
          'auth',
          'API key không tồn tại hoặc đã bị thu hồi. Cấp key mới ở tab "API key".',
          { status, apiCode: code },
        );
      case 'API_KEY_MALFORMED':
        return new FuelControlError(
          'auth',
          'FUELCONTROL_API_KEY sai định dạng — key thật có dạng fc_xxxxxxxx_... ' +
            'Kiểm xem lúc chép có bị mất ký tự hay dính khoảng trắng không.',
          { status, apiCode: code },
        );
      case 'API_KEY_OWNER_INACTIVE':
        return new FuelControlError(
          'auth',
          'Tài khoản chủ của key này đã bị khoá. Key đi theo chủ, nên phải cấp key mới ' +
            'từ một tài khoản còn hoạt động và có quyền reports.read.',
          { status, apiCode: code },
        );
      default:
        return new FuelControlError('auth', `Xác thực thất bại${detail}`, { status, apiCode: code });
    }
  }

  if (status === 403) {
    if (code === 'API_KEY_SCOPE') {
      return new FuelControlError(
        'scope',
        'Key này thiếu quyền "read". Cấp lại key và tick ô read.' + detail,
        { status, apiCode: code },
      );
    }
    if (code === 'API_KEY_FORBIDDEN_PATH') {
      return new FuelControlError(
        'scope',
        `Đường dẫn ${path} nằm trong danh sách API key không bao giờ đi qua được. ` +
          'Đây là lỗi của MCP, không phải của key — báo lại để sửa.',
        { status, apiCode: code },
      );
    }
    return new FuelControlError(
      'permission',
      'Tài khoản chủ của key thiếu quyền reports.read. Vào tab Phân quyền cấp quyền đó cho ' +
        'vai trò của tài khoản này (mặc định: accountant, ceo).' + detail,
      { status, apiCode: code },
    );
  }

  if (status === 404) {
    // Ca này gần như luôn có đúng một nguyên nhân, nên nói thẳng nguyên nhân đó
    // thay vì để người đọc đi dò: hai endpoint báo cáo thuộc Giai đoạn A.
    return new FuelControlError(
      'not_built',
      `API trả 404 cho ${path}. Nhiều khả năng Giai đoạn A của PLAN.md chưa được build ` +
        'hoặc chưa deploy — hai endpoint /api/reports/* phải tồn tại trước khi MCP hỏi được gì. ' +
        'Kiểm bằng: npm run check',
      { status, apiCode: code },
    );
  }

  if (status === 429) {
    return new FuelControlError('rate_limited', 'API đang chặn vì gọi quá dày. Chờ một lát rồi hỏi lại.', {
      status,
      apiCode: code,
    });
  }

  if (status >= 500) {
    return new FuelControlError(
      'server',
      `Máy chủ FuelControl lỗi (HTTP ${status})${detail}. Số liệu KHÔNG lấy được — đừng coi đây là ` +
        '"không có dữ liệu". Xem log: ssh my-vps-prod "docker logs --tail 50 fuelcontrol-api".',
      { status, apiCode: code },
    );
  }

  return new FuelControlError('server', `API trả HTTP ${status}${detail}`, { status, apiCode: code });
}

/** Lỗi tầng mạng: hết giờ chờ, mất mạng, DNS trượt, bị từ chối kết nối. */
export function mapNetworkError(err: unknown, baseUrl: string, timeoutMs: number): FuelControlError {
  const name = err instanceof Error ? err.name : '';
  const msg = err instanceof Error ? err.message : String(err);

  if (name === 'TimeoutError' || name === 'AbortError' || /timeout/i.test(msg)) {
    return new FuelControlError(
      'network',
      `Quá ${timeoutMs}ms không thấy ${baseUrl} trả lời. Mạng chậm hoặc API đang kẹt — ` +
        'số liệu KHÔNG lấy được, không phải "không có dữ liệu".',
    );
  }
  return new FuelControlError(
    'network',
    `Không kết nối được tới ${baseUrl} (${msg}). Kiểm mạng, rồi kiểm địa chỉ trong ` +
      'FUELCONTROL_BASE_URL. Số liệu KHÔNG lấy được.',
  );
}
