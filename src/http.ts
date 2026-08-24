import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';

import { FuelControlClient, type FetchLike } from './client.js';
import { clientIpFrom } from './clientIp.js';
import { readCredential } from './credential.js';
import { FuelControlError } from './errors.js';
import { RateLimiterRegistry } from './rateLimit.js';
import type { ServerConfig } from './serverConfig.js';
import { ALLOWED_TOOLS } from './toolPolicy.js';
import { registerTools } from './tools/index.js';

/**
 * Transport Streamable HTTP — thứ biến máy chủ MCP này thành một ĐƯỜNG LINK.
 *
 * # KHÔNG GIỮ PHIÊN, và đó là một quyết định an ninh
 *
 * SDK cho phép giữ phiên: client mở một lần, nhận session id, rồi dùng lại. Ở
 * đây KHÔNG. Mỗi request dựng một McpServer và một transport mới, gắn với đúng
 * chìa khoá của request đó.
 *
 * Lý do: chìa khoá thu hồi được. Giữ phiên nghĩa là một phiên mở từ trước vẫn
 * chạy tiếp bằng danh tính cũ cho tới khi phiên đóng — thu hồi key ở giao diện
 * mà cửa vẫn mở. Không giữ phiên thì lần gọi kế tiếp đã bị API từ chối.
 *
 * Đánh đổi: không có thông báo do server chủ động đẩy. Ba tool ở đây đều chỉ đọc
 * và trả lời ngay, nên không mất gì.
 *
 * # Đường ra vào
 *
 *   POST /mcp      lời gọi JSON-RPC — đường duy nhất làm việc
 *   GET  /health   kiểm tra sống, KHÔNG cần chìa khoá, KHÔNG lộ gì
 *
 * Mọi đường khác trả 404.
 */

/** Nhịp gọi tính theo TIỀN TỐ chìa khoá, không theo chuỗi bí mật. */
function bucketKeyFor(prefix: string, remote: string): string {
  // Key sai khuôn thì không có tiền tố — đếm theo địa chỉ để một chuỗi rác lặp
  // lại vẫn bị phanh. Không có nhánh này thì mọi key bịa dùng chung một gáo.
  return prefix || `ip:${remote}`;
}

export interface HttpDeps {
  fetchImpl?: FetchLike;
  now?: () => number;
  log?: (line: string) => void;
  /**
   * Bộ đăng ký tool. Chỉ test mới truyền vào.
   *
   * Có để bài test dựng được cảnh "người sau thêm một tool ghi rồi quên tệp
   * policy" và chạy nó qua ĐÚNG đường HTTP thật. Không có đường tiêm này thì
   * assertOnlyAllowedTools chỉ kiểm được như một hàm rời — gỡ hẳn lời gọi ra
   * khỏi handle() mà bài test vẫn xanh, tức là chốt không canh gì cả.
   */
  registerToolsImpl?: typeof registerTools;
}

export function createHttpServer(cfg: ServerConfig, deps: HttpDeps = {}): Server {
  const now = deps.now ?? Date.now;
  const log = deps.log ?? ((l: string) => void process.stderr.write(l));
  const limiters = new RateLimiterRegistry(cfg.ratePerMinute, cfg.rateBurst, now);

  return createServer((req, res) => {
    handle(req, res, cfg, limiters, deps, log).catch((err: unknown) => {
      // Chốt cuối: một lời hứa vỡ không bắt được sẽ giết cả tiến trình, tức là
      // một request hỏng làm máy chủ sập cho mọi người.
      log(line({ event: 'unhandled', error: String(err) }));
      if (!res.headersSent) sendJson(res, 500, { error: 'internal_error' });
      else res.end();
    });
  });
}

async function handle(
  req: IncomingMessage,
  res: ServerResponse,
  cfg: ServerConfig,
  limiters: RateLimiterRegistry,
  deps: HttpDeps,
  log: (l: string) => void,
): Promise<void> {
  const url = req.url ?? '/';
  const path = url.split('?')[0] ?? '/';
  const started = Date.now();

  if (req.method === 'GET' && path === '/health') {
    // Không nói gì về cấu hình, số người dùng, hay phiên bản API phía sau: một
    // trang kiểm-tra-sống mở công khai mà kể chuyện là trang do thám miễn phí.
    sendJson(res, 200, { status: 'ok' });
    return;
  }
  if (path !== '/mcp') {
    sendJson(res, 404, { error: 'not_found' });
    return;
  }
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    sendJson(res, 405, { error: 'method_not_allowed' });
    return;
  }

  const remote = clientIpFrom(req.socket.remoteAddress, req.headers);

  let credential;
  try {
    credential = readCredential(req.headers);
  } catch (err) {
    const msg = err instanceof FuelControlError ? err.message : 'unauthorized';
    res.setHeader('WWW-Authenticate', 'Bearer realm="fuelcontrol-mcp"');
    log(line({ event: 'auth_missing', remote, ms: Date.now() - started }));
    sendJson(res, 401, { error: 'unauthorized', message: msg });
    return;
  }

  const verdict = limiters.take(bucketKeyFor(credential.prefix, remote));
  if (!verdict.allowed) {
    const retryS = Math.ceil((verdict.retryAfterMs ?? 1000) / 1000);
    res.setHeader('Retry-After', String(retryS));
    log(line({ event: 'rate_limited', key: credential.prefix, remote, retryAfterS: retryS }));
    sendJson(res, 429, { error: 'rate_limited', retryAfterSeconds: retryS });
    return;
  }

  let body: unknown;
  try {
    body = await readBody(req, cfg.maxBodyBytes);
  } catch (err) {
    const tooBig = err instanceof FuelControlError && err.kind === 'input';
    log(line({ event: 'bad_body', key: credential.prefix, error: String(err) }));
    sendJson(res, tooBig ? 413 : 400, { error: tooBig ? 'payload_too_large' : 'bad_request' });
    return;
  }

  // Client MỚI cho mỗi request, mang đúng chìa khoá của người gọi. Dùng lại một
  // client giữa các request là dùng lại danh tính của người trước.
  const client = new FuelControlClient(
    {
      baseUrl: cfg.baseUrl,
      apiKey: credential.raw,
      timeoutMs: cfg.timeoutMs,
      // Phanh đã tính ở tầng HTTP theo từng chìa khoá. Để client phanh lần nữa
      // là phanh hai lớp trên cùng một cú gọi, và con số "chờ bao lâu" người
      // dùng nhận được sẽ không khớp với thứ vừa chặn họ.
      ratePerMinute: 600,
      rateBurst: 100,
    },
    deps.fetchImpl,
    deps.now,
  );

  const server = new McpServer(
    { name: 'fuelcontrol-mcp-data', version: '0.1.0' },
    { instructions: INSTRUCTIONS },
  );
  (deps.registerToolsImpl ?? registerTools)(server, client);
  assertOnlyAllowedTools(server);

  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  res.on('close', () => {
    void transport.close();
    void server.close();
  });

  await server.connect(transport);
  await transport.handleRequest(req, res, body);

  log(
    line({
      event: 'mcp_call',
      key: credential.prefix,
      method: methodOf(body),
      tool: toolOf(body),
      status: res.statusCode,
      ms: Date.now() - started,
    }),
  );
}

const INSTRUCTIONS =
  'Máy chủ chỉ-đọc cho FuelControl (đội xe và tàu của resort ở Koh Kood, Thái Lan). ' +
  'Mọi mốc ngày theo giờ Bangkok. Tiền tính bằng ฿ baht Thái. ' +
  'Không có tool nào ghi được vào hệ thống.';

/**
 * Chốt cuối của danh sách tool (skill §5).
 *
 * registerTools() nằm ở tệp khác và người sau sẽ thêm tool vào đó. Tên tool mới
 * không có trong ALLOWED_TOOLS thì máy chủ CHẾT NGAY, thay vì lặng lẽ công bố
 * một cửa mới ra Internet.
 */
export function assertOnlyAllowedTools(server: McpServer): void {
  const reg = (server as unknown as { _registeredTools?: Record<string, unknown> })._registeredTools;
  const stray = Object.keys(reg ?? {}).filter(
    (t) => !(ALLOWED_TOOLS as readonly string[]).includes(t),
  );
  if (stray.length > 0) {
    throw new Error(
      `Tool chưa nằm trong danh sách cho phép: ${stray.join(', ')}. ` +
        'Thêm vào src/toolPolicy.ts một cách có chủ đích, đừng sửa dòng này.',
    );
  }
}

export function readBody(req: IncomingMessage, maxBytes: number): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > maxBytes) {
        // Thôi GIỮ, nhưng vẫn đọc nốt rồi vứt đi.
        //
        // Bản đầu gọi req.destroy() ở đây và bài test bắt được: socket chết
        // trước khi kịp gửi 413, nên người gọi nhận "đứt kết nối" — một lỗi
        // không nói gì về nguyên nhân, đúng kiểu buộc người ta đi dò.
        //
        // removeAllListeners + resume làm Node xả phần còn lại vào hư không:
        // không chunk nào được giữ nữa nên bộ nhớ đứng yên, mà request vẫn kết
        // thúc tử tế để phản hồi 413 đi tới nơi.
        chunks.length = 0;
        req.removeAllListeners('data');
        req.resume();
        reject(new FuelControlError('input', `Thân request vượt ${maxBytes} byte`));
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (raw.trim() === '') return resolve(undefined);
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new FuelControlError('bad_response', 'Thân request không phải JSON'));
      }
    });
    req.on('error', reject);
  });
}

function methodOf(body: unknown): string | undefined {
  if (body && typeof body === 'object' && 'method' in body) {
    const m = (body as { method?: unknown }).method;
    return typeof m === 'string' ? m : undefined;
  }
  return undefined;
}

/** Tên tool, để nhật ký nói được ai hỏi cái gì. Tham số KHÔNG ghi ở đây. */
function toolOf(body: unknown): string | undefined {
  if (!body || typeof body !== 'object') return undefined;
  const params = (body as { params?: unknown }).params;
  if (!params || typeof params !== 'object') return undefined;
  const name = (params as { name?: unknown }).name;
  return typeof name === 'string' ? name : undefined;
}

function line(fields: Record<string, unknown>): string {
  return (
    JSON.stringify({ ts: new Date().toISOString(), source: 'fuelcontrol-mcp-http', ...fields }) + '\n'
  );
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(payload),
    // Không cho trình duyệt hay proxy giữ lại phản hồi mang dữ liệu vận hành.
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(payload);
}
