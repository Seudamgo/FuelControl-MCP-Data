import { describe, it, expect, vi } from 'vitest';
import { logToolCall, redact } from '../src/audit.js';

describe('nhật ký gọi tool (skill §9.1, đã sửa cho stdio)', () => {
  it('KHÔNG BAO GIỜ ghi ra stdout — stdout là đường truyền JSON-RPC', () => {
    // Bài quan trọng nhất tệp này. Mẫu chung của skill ghi log ra stdout; với
    // transport stdio thì đó là chèn rác vào giữa giao thức, client đứt kết nối
    // kèm một lỗi phân tích JSON không nói gì về nguyên nhân thật.
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    logToolCall({ tool: 'handover_daily', params: { date: '2026-08-23' }, outcome: 'success', durationMs: 12 });

    expect(stdout).not.toHaveBeenCalled();
    expect(stderr).toHaveBeenCalledOnce();

    stdout.mockRestore();
    stderr.mockRestore();
  });

  it('ghi ra một dòng JSON đọc máy được', () => {
    let line = '';
    logToolCall(
      { tool: 'daily_summary', params: { date: '2026-08-23' }, outcome: 'error', durationMs: 40, errorKind: 'network' },
      (s) => {
        line = s;
      },
    );
    expect(line.endsWith('\n')).toBe(true);
    const parsed = JSON.parse(line);
    expect(parsed).toMatchObject({ tool: 'daily_summary', outcome: 'error', errorKind: 'network' });
    expect(typeof parsed.ts).toBe('string');
  });
});

describe('che chuỗi bí mật', () => {
  it('che theo tên khoá, mọi biến thể chữ hoa thường', () => {
    const out = redact({
      apiKey: 'fc_abcd_secret',
      API_KEY: 'fc_abcd_secret',
      authorization: 'Bearer x',
      userToken: 'tok',
      password: 'p',
      date: '2026-08-23',
    }) as Record<string, unknown>;

    expect(out.apiKey).toBe('[REDACTED]');
    expect(out.API_KEY).toBe('[REDACTED]');
    expect(out.authorization).toBe('[REDACTED]');
    expect(out.userToken).toBe('[REDACTED]');
    expect(out.password).toBe('[REDACTED]');
    expect(out.date).toBe('2026-08-23'); // dữ liệu thường vẫn phải đọc được
  });

  it('che cả trong object lồng và trong mảng', () => {
    const out = redact({ nested: { secret: 'x' }, list: [{ token: 'y' }] }) as any;
    expect(out.nested.secret).toBe('[REDACTED]');
    expect(out.list[0].token).toBe('[REDACTED]');
  });

  it('không chết vì cấu trúc lồng quá sâu', () => {
    let deep: any = { token: 'x' };
    for (let i = 0; i < 50; i++) deep = { nested: deep };
    expect(() => redact(deep)).not.toThrow();
  });
});
