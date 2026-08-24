#!/usr/bin/env node
import { createHttpServer } from './http.js';
import { loadDotEnv } from './config.js';
import { FuelControlError } from './errors.js';
import { loadServerConfig } from './serverConfig.js';

/**
 * Điểm khởi động bản HTTP — dùng khi chạy trong container sau nginx.
 *
 * Khác src/index.ts (bản stdio) ở hai chỗ:
 *
 *   1. Không giữ chìa khoá nào. Chìa khoá đi theo từng request.
 *   2. Được phép console.log. Ở bản stdio stdout LÀ đường truyền JSON-RPC nên
 *      mọi thứ phải đi stderr; ở đây stdout là nhật ký container, đúng chỗ.
 *      Dù vậy vẫn ghi ra stderr cho đồng nhất — đọc log một dịch vụ mà phải nhớ
 *      dòng nào ở luồng nào là một thứ thừa để nhớ.
 */
async function main(): Promise<void> {
  loadDotEnv();

  let cfg;
  try {
    cfg = loadServerConfig();
  } catch (err) {
    const msg = err instanceof FuelControlError ? err.message : String(err);
    process.stderr.write(`[fuelcontrol-mcp] KHONG KHOI DONG DUOC: ${msg}\n`);
    process.exit(1);
    return;
  }

  const server = createHttpServer(cfg);

  // Đóng cửa tử tế khi Docker gửi tín hiệu dừng: cắt ngang giữa một cú gọi thì
  // client nhận một kết nối đứt, không phải một lỗi đọc được.
  for (const sig of ['SIGTERM', 'SIGINT'] as const) {
    process.on(sig, () => {
      process.stderr.write(`[fuelcontrol-mcp] nhan ${sig}, dong cua\n`);
      server.close(() => process.exit(0));
      // Chốt chặn: một kết nối treo không được giữ container sống mãi.
      setTimeout(() => process.exit(0), 10_000).unref();
    });
  }

  server.listen(cfg.port, () => {
    process.stderr.write(
      `[fuelcontrol-mcp] HTTP :${cfg.port} · API ${cfg.baseUrl} · khong giu chia khoa nao\n`,
    );
  });
}

void main();
