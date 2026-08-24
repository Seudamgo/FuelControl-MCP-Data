import { validateBaseUrl } from './networkPolicy.js';
import { FuelControlError } from './errors.js';

export interface Config {
  baseUrl: string;
  apiKey: string;
  timeoutMs: number;
  ratePerMinute: number;
  rateBurst: number;
}

/**
 * Nạp .env nếu có, im lặng bỏ qua nếu không.
 *
 * Không thêm thư viện dotenv: Node 20.6+ đã có sẵn loadEnvFile. Khi chạy dưới
 * Claude Desktop thì biến môi trường tới từ khối "env" trong tệp cấu hình chứ
 * không qua .env, nên thiếu tệp là chuyện bình thường, không phải lỗi.
 */
export function loadDotEnv(path = '.env'): void {
  try {
    process.loadEnvFile(path);
  } catch {
    /* không có .env — đúng như mong đợi khi chạy dưới Claude Desktop */
  }
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

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const apiKey = (env.FUELCONTROL_API_KEY ?? '').trim();
  if (!apiKey) {
    throw new FuelControlError(
      'config',
      'Thiếu FUELCONTROL_API_KEY. Cấp key ở fleet.seudambite.com → tab "API key" ' +
        '(chủ key phải có quyền reports.read, scope chỉ tick "read"), rồi điền vào .env. ' +
        'Xem .env.example.',
    );
  }

  const allowInsecureLocal = (env.FUELCONTROL_ALLOW_INSECURE_LOCAL ?? '').trim().toLowerCase() === 'true';
  const verdict = validateBaseUrl(env.FUELCONTROL_BASE_URL ?? '', { allowInsecureLocal });
  if (!verdict.ok) {
    throw new FuelControlError('config', `FUELCONTROL_BASE_URL không dùng được: ${verdict.reason}`);
  }

  return {
    baseUrl: verdict.normalized!,
    apiKey,
    timeoutMs: intFromEnv(env, 'FUELCONTROL_TIMEOUT_MS', 15_000, 1_000, 120_000),
    ratePerMinute: intFromEnv(env, 'FUELCONTROL_RATE_LIMIT_PER_MIN', 30, 1, 600),
    rateBurst: intFromEnv(env, 'FUELCONTROL_RATE_BURST', 10, 1, 100),
  };
}
