import { describe, it, expect, vi } from 'vitest';
import { FuelControlClient, ENDPOINTS } from '../src/client.js';
import { FuelControlError } from '../src/errors.js';
import type { Config } from '../src/config.js';

const cfg: Config = {
  baseUrl: 'https://fleet.seudambite.com',
  apiKey: 'fc_abcd1234_secret-value',
  timeoutMs: 15_000,
  ratePerMinute: 60,
  rateBurst: 10,
};

function reply(status: number, body: unknown, headers: Record<string, string> = {}) {
  return new Response(typeof body === 'string' ? body : JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

describe('FuelControlClient — cách gửi request', () => {
  it('gắn X-API-Key, dùng GET, và không đi theo chuyển hướng', async () => {
    const fetchImpl = vi.fn(async () => reply(200, { date: '2026-08-23' }));
    const client = new FuelControlClient(cfg, fetchImpl as never);

    await client.get('handoverDaily', { date: '2026-08-23' });

    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://fleet.seudambite.com/api/reports/handover-daily?date=2026-08-23');
    expect(init.method).toBe('GET');
    expect((init.headers as Record<string, string>)['X-API-Key']).toBe(cfg.apiKey);
    // redirect: 'manual' là chốt chống rò key: fetch chỉ tự gỡ vài header chuẩn
    // khi đổi host, X-API-Key thì không nằm trong số đó.
    expect(init.redirect).toBe('manual');
  });

  it('từ chối chuyển hướng thay vì đi theo', async () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 302, headers: { location: 'https://evil.example' } }));
    const client = new FuelControlClient(cfg, fetchImpl as never);

    await expect(client.get('handoverDaily')).rejects.toMatchObject({ kind: 'network' });
  });

  it('bỏ tham số rỗng thay vì gửi date=', async () => {
    const fetchImpl = vi.fn(async () => reply(200, {}));
    const client = new FuelControlClient(cfg, fetchImpl as never);

    await client.get('me', { date: '' });
    expect((fetchImpl.mock.calls[0] as unknown as [string])[0]).toBe('https://fleet.seudambite.com/api/me');
  });

  it('chỉ gọi được đường dẫn trong danh sách cho phép', () => {
    expect(Object.values(ENDPOINTS)).toEqual([
      '/api/reports/handover-daily',
      '/api/reports/fuel-vs-booking',
      '/api/me',
    ]);
  });
});

describe('FuelControlClient — dịch lỗi', () => {
  it.each([
    [401, 'API_KEY_EXPIRED', 'auth', 'hết hạn'],
    [401, 'API_KEY_INVALID', 'auth', 'thu hồi'],
    [401, 'API_KEY_MALFORMED', 'auth', 'fc_'],
    [401, 'API_KEY_OWNER_INACTIVE', 'auth', 'bị khoá'],
    [403, 'API_KEY_SCOPE', 'scope', 'read'],
    [403, 'FORBIDDEN', 'permission', 'reports.read'],
    [500, 'INTERNAL', 'server', 'KHÔNG lấy được'],
  ])('HTTP %i %s -> kind=%s', async (status, code, kind, needle) => {
    const fetchImpl = vi.fn(async () => reply(status, { error: code, message: 'x' }));
    const client = new FuelControlClient(cfg, fetchImpl as never);

    const err = await client.get('handoverDaily').catch((e) => e as FuelControlError);
    expect(err).toBeInstanceOf(FuelControlError);
    expect((err as FuelControlError).kind).toBe(kind);
    expect((err as FuelControlError).message).toContain(needle);
  });

  it('404 nói thẳng là Giai đoạn A chưa build, không nói chung chung', async () => {
    // Đây gần như luôn là nguyên nhân thật trong giai đoạn này của dự án. Nói
    // đúng nguyên nhân tiết kiệm cho người đọc cả buổi đi dò cấu hình.
    const fetchImpl = vi.fn(async () => reply(404, { error: 'NOT_FOUND' }));
    const client = new FuelControlClient(cfg, fetchImpl as never);

    const err = (await client.get('handoverDaily').catch((e) => e)) as FuelControlError;
    expect(err.kind).toBe('not_built');
    expect(err.message).toContain('Giai đoạn A');
  });

  it('phản hồi không phải JSON không được coi là dữ liệu rỗng', async () => {
    const fetchImpl = vi.fn(async () => new Response('<!doctype html><html>...', { status: 200 }));
    const client = new FuelControlClient(cfg, fetchImpl as never);

    await expect(client.get('handoverDaily')).rejects.toMatchObject({ kind: 'bad_response' });
  });

  it('hết giờ chờ báo là lỗi mạng, không trả về gì cả', async () => {
    const fetchImpl = vi.fn(async () => {
      const e = new Error('The operation was aborted due to timeout');
      e.name = 'TimeoutError';
      throw e;
    });
    const client = new FuelControlClient(cfg, fetchImpl as never);

    const err = (await client.get('handoverDaily').catch((e) => e)) as FuelControlError;
    expect(err.kind).toBe('network');
    expect(err.message).toContain('không phải "không có dữ liệu"');
  });

  it('chặn phản hồi khổng lồ theo content-length', async () => {
    const fetchImpl = vi.fn(async () => reply(200, {}, { 'content-length': String(50 * 1024 * 1024) }));
    const client = new FuelControlClient(cfg, fetchImpl as never);

    await expect(client.get('fuelVsBooking')).rejects.toMatchObject({ kind: 'bad_response' });
  });

  it('phanh chặn khi gọi quá dày, và KHÔNG gửi request đi', async () => {
    const fetchImpl = vi.fn(async () => reply(200, {}));
    const client = new FuelControlClient({ ...cfg, ratePerMinute: 60, rateBurst: 2 }, fetchImpl as never, () => 0);

    await client.get('me');
    await client.get('me');
    await expect(client.get('me')).rejects.toMatchObject({ kind: 'rate_limited' });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});
