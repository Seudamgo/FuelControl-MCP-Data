#!/usr/bin/env node
/**
 * `npm run check` — kiểm cấu hình TRƯỚC khi đi gỡ lỗi trong Claude Desktop.
 *
 * Chạy dưới Claude Desktop thì mọi lỗi đều hiện ra giống nhau ("server không
 * chạy"), nên tồn tại một đường chạy tay trả lời tách bạch bốn câu: key có đọc
 * được không, key là ai, chủ key có quyền reports.read không, và hai endpoint
 * của Giai đoạn A đã tồn tại chưa.
 *
 * Đây KHÔNG phải một tool MCP. PLAN.md §B2 chốt đúng ba tool, và một cửa chẩn
 * đoán thì thuộc về người vận hành, không thuộc về agent.
 */
import { FuelControlClient } from './client.js';
import { loadConfig, loadDotEnv } from './config.js';
import { FuelControlError } from './errors.js';
import { bangkokYesterday } from './dates.js';
import { meSchema, parseResponse } from './schemas.js';

const out = (s: string) => process.stdout.write(s + '\n');

async function main(): Promise<number> {
  loadDotEnv();

  let client: FuelControlClient;
  let baseUrl: string;
  try {
    const cfg = loadConfig();
    baseUrl = cfg.baseUrl;
    client = new FuelControlClient(cfg);
    out(`✅ Cấu hình đọc được · API ${cfg.baseUrl} · chờ tối đa ${cfg.timeoutMs}ms`);
  } catch (err) {
    out(`❌ Cấu hình: ${err instanceof FuelControlError ? err.message : String(err)}`);
    return 1;
  }

  let permissions: string[] = [];
  try {
    const me = parseResponse(meSchema, await client.get('me'), '/api/me');
    permissions = me.permissions;
    out(`✅ Key sống · chủ key: ${me.user.email} · vai trò: ${me.roles.join(', ') || '(không có)'}`);
  } catch (err) {
    out(`❌ Key: ${err instanceof FuelControlError ? err.message : String(err)}`);
    return 1;
  }

  if (permissions.includes('reports.read')) {
    out('✅ Chủ key có quyền reports.read');
  } else {
    out('⚠️  Chủ key KHÔNG có quyền reports.read — hai tool báo cáo sẽ bị từ chối.');
    out('    Cấp quyền đó cho vai trò của tài khoản này ở tab Phân quyền (migration 0067 gán sẵn cho accountant, ceo).');
  }

  const date = bangkokYesterday();
  let ok = 0;
  for (const [label, call] of [
    ['/api/reports/handover-daily', () => client.get('handoverDaily', { date })],
    ['/api/reports/fuel-vs-booking', () => client.get('fuelVsBooking', { from: date, to: date })],
  ] as const) {
    try {
      await call();
      out(`✅ ${label} trả lời được`);
      ok += 1;
    } catch (err) {
      const fe = err instanceof FuelControlError ? err : null;
      out(`❌ ${label}: ${fe ? fe.message : String(err)}`);
    }
  }

  if (ok < 2) {
    out('');
    out(`→ Hai endpoint trên thuộc Giai đoạn A của PLAN.md, repo fuelcontrol-backend.`);
    out(`  Chưa build/deploy xong thì MCP dựng xong vẫn chưa hỏi được gì (${baseUrl}).`);
    return 1;
  }
  out('');
  out('Xong — MCP dùng được.');
  return 0;
}

main().then(
  (code) => process.exit(code),
  (err) => {
    out(`❌ ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  },
);
