import { describe, it, expect } from 'vitest';
import { loadServerConfig } from '../src/serverConfig.js';
import { ALLOWED_TOOLS, isToolAllowed } from '../src/toolPolicy.js';
import { readCredential } from '../src/credential.js';

describe('Cấu hình chế độ HTTP', () => {
  const base = { FUELCONTROL_BASE_URL: 'https://fleet.example.com' } as NodeJS.ProcessEnv;

  it('CHẾT nếu có FUELCONTROL_API_KEY trong môi trường', () => {
    // Đây là chốt quan trọng nhất của cả tệp. Một key trong môi trường tiến trình
    // HTTP nghĩa là ai đó đang định cho cả máy chủ dùng chung một danh tính: mọi
    // truy vấn mang tên người ảo, và thu hồi quyền một người phải đổi key của tất cả.
    expect(() => loadServerConfig({ ...base, FUELCONTROL_API_KEY: 'fck_aaaaaaaa_x' })).toThrow(
      /không được đặt ở chế độ HTTP/,
    );
  });

  it('chạy được khi không có key', () => {
    const cfg = loadServerConfig(base);
    expect(cfg.baseUrl).toBe('https://fleet.example.com');
    expect(cfg).not.toHaveProperty('apiKey');
  });

  it('từ chối gốc API không phải https', () => {
    expect(() => loadServerConfig({ FUELCONTROL_BASE_URL: 'http://fleet.example.com' })).toThrow();
  });
});

describe('Danh sách tool', () => {
  it('chỉ có tool CHỈ ĐỌC', () => {
    expect([...ALLOWED_TOOLS]).toEqual(['handover_daily', 'fuel_vs_booking', 'daily_summary']);
  });

  it('từ chối mọi tên nghe như tool ghi', () => {
    for (const t of ['create_trip', 'delete_fuel_log', 'update_vehicle', 'run_sql', 'exec']) {
      expect(isToolAllowed(t)).toBe(false);
    }
  });
});

describe('Đọc chìa khoá từ header', () => {
  it('lấy được tiền tố để ghi log, và tiền tố KHÔNG chứa phần bí mật', () => {
    const c = readCredential({ 'x-api-key': 'fck_a1b2c3d4_rat-bi-mat' });
    expect(c.prefix).toBe('fck_a1b2c3d4');
    expect(c.prefix).not.toContain('rat-bi-mat');
    expect(c.raw).toBe('fck_a1b2c3d4_rat-bi-mat');
  });

  it('key sai khuôn vẫn đọc được, chỉ là không có tiền tố', () => {
    // Phán chuỗi hợp lệ hay không là việc của API. Đoán ở đây tạo ra chỗ thứ hai
    // có thể lệch với chỗ thật, và lệch nghĩa là từ chối một key hoàn toàn tốt.
    expect(readCredential({ 'x-api-key': 'linh-tinh' }).prefix).toBe('');
  });

  it('header viết hoa thường kiểu gì cũng đọc được', () => {
    expect(readCredential({ 'X-API-Key': 'fck_a1b2c3d4_x' }).raw).toBe('fck_a1b2c3d4_x');
    expect(readCredential({ Authorization: 'Bearer fck_a1b2c3d4_x' }).raw).toBe('fck_a1b2c3d4_x');
  });

  it('không có gì thì ném lỗi chỉ đúng cách sửa', () => {
    expect(() => readCredential({})).toThrow(/X-API-Key/);
    expect(() => readCredential({ authorization: 'Basic abc' })).toThrow();
  });
});

describe('Chốt danh sách tool ở lúc chạy', () => {
  it('máy chủ CHẾT nếu có tool lạ được đăng ký', async () => {
    const { McpServer } = await import('@modelcontextprotocol/sdk/server/mcp.js');
    const { assertOnlyAllowedTools } = await import('../src/http.js');
    const { z } = await import('zod');

    const server = new McpServer({ name: 't', version: '1' });
    // Giả cảnh người sau thêm một tool GHI vào registerTools() rồi quên tệp policy.
    server.registerTool(
      'delete_everything',
      { description: 'x', inputSchema: { ok: z.boolean() } },
      async () => ({ content: [] }),
    );

    expect(() => assertOnlyAllowedTools(server)).toThrow(/chưa nằm trong danh sách cho phép/);
  });

  it('ba tool thật thì qua', async () => {
    const { McpServer } = await import('@modelcontextprotocol/sdk/server/mcp.js');
    const { assertOnlyAllowedTools } = await import('../src/http.js');
    const { registerTools } = await import('../src/tools/index.js');
    const { FuelControlClient } = await import('../src/client.js');

    const server = new McpServer({ name: 't', version: '1' });
    registerTools(
      server,
      new FuelControlClient(
        { baseUrl: 'https://x.example.com', apiKey: 'k', timeoutMs: 1000, ratePerMinute: 60, rateBurst: 10 },
        async () => new Response('{}'),
      ),
    );
    expect(() => assertOnlyAllowedTools(server)).not.toThrow();
  });
});
