import { FuelControlError } from './errors.js';
import { validateBaseUrl } from './networkPolicy.js';

/**
 * Cấu hình cho transport HTTP.
 *
 * Khác Config của bản stdio ở ĐÚNG MỘT điểm, và đó là điểm quan trọng nhất của
 * cả thiết kế: KHÔNG có apiKey. Máy chủ này không giữ chìa khoá nào — chìa khoá
 * đi cùng từng request và được chuyển tiếp nguyên vẹn (xem src/credential.ts).
 *
 * Tách hẳn kiểu ra thay vì cho apiKey thành tuỳ chọn: một trường có thể rỗng là
 * một trường sẽ có người điền vào, và điền vào đây là dựng lại đúng cái hộp chìa
 * khoá dùng chung mà thiết kế này tồn tại để tránh.
 */
export interface ServerConfig {
  baseUrl: string;
  timeoutMs: number;
  ratePerMinute: number;
  rateBurst: number;
  port: number;
  /** Trần dung lượng thân request. Một lời gọi tool JSON-RPC nằm ở hàng trăm byte. */
  maxBodyBytes: number;
}

function intFromEnv(
  env: NodeJS.ProcessEnv,
  name: string,
  fallback: number,
  min: number,
  max: number,
): number {
  const raw = env[name];
  if (raw === undefined || raw.trim() === '') return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < min || n > max) {
    throw new FuelControlError(
      'config',
      `${name}="${raw}" không hợp lệ — phải là số nguyên trong khoảng ${min}..${max}`,
    );
  }
  return n;
}

export function loadServerConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  if ((env.FUELCONTROL_API_KEY ?? '').trim() !== '') {
    // Chết ngay còn hơn chạy được. Một key nằm trong môi trường của tiến trình
    // HTTP là dấu hiệu ai đó đang định cho cả máy chủ dùng chung một danh tính —
    // và nếu để nó chạy thì mọi truy vấn mang tên người ảo, thu hồi quyền một
    // người phải đổi key của tất cả.
    throw new FuelControlError(
      'config',
      'FUELCONTROL_API_KEY không được đặt ở chế độ HTTP. Chìa khoá đi theo từng ' +
        'request qua header X-API-Key, máy chủ không giữ key nào.',
    );
  }

  const allowInsecureLocal =
    (env.FUELCONTROL_ALLOW_INSECURE_LOCAL ?? '').trim().toLowerCase() === 'true';
  const verdict = validateBaseUrl(env.FUELCONTROL_BASE_URL ?? '', { allowInsecureLocal });
  if (!verdict.ok) {
    throw new FuelControlError('config', `FUELCONTROL_BASE_URL không dùng được: ${verdict.reason}`);
  }

  return {
    baseUrl: verdict.normalized!,
    timeoutMs: intFromEnv(env, 'FUELCONTROL_TIMEOUT_MS', 15_000, 1_000, 120_000),
    ratePerMinute: intFromEnv(env, 'FUELCONTROL_RATE_LIMIT_PER_MIN', 30, 1, 600),
    rateBurst: intFromEnv(env, 'FUELCONTROL_RATE_BURST', 10, 1, 100),
    port: intFromEnv(env, 'MCP_PORT', 3001, 1, 65_535),
    maxBodyBytes: intFromEnv(env, 'MCP_MAX_BODY_BYTES', 256 * 1024, 1_024, 4 * 1024 * 1024),
  };
}
