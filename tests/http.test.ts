import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';

import { createHttpServer } from '../src/http.js';
import type { ServerConfig } from '../src/serverConfig.js';

/**
 * Biên an ninh của đường link MCP (skill §11.1 và §8).
 *
 * Chạy máy chủ thật trên một cổng ngẫu nhiên và gõ vào bằng fetch. Không giả lập
 * req/res: đúng những chốt cần kiểm — 401, 429, 413, 404 — nằm ở tầng HTTP, và
 * một bản giả lập sẽ kiểm chính bản giả lập đó.
 */

const cfg: ServerConfig = {
  baseUrl: 'https://fleet.example.com',
  timeoutMs: 5_000,
  ratePerMinute: 60,
  rateBurst: 3,
  port: 0,
  maxBodyBytes: 1_024,
};

/** Chìa khoá bịa, đúng khuôn <tag>_<8 hex>_<secret>. Không bao giờ rời máy này. */
const KEY_A = 'fck_aaaaaaaa_secret-a';
const KEY_B = 'fck_bbbbbbbb_secret-b';

let server: Server;
let base: string;
const calls: string[] = [];

beforeAll(async () => {
  server = createHttpServer(cfg, {
    // API giả: ghi lại header đã nhận để khẳng định CHÌA KHOÁ CỦA NGƯỜI GỌI được
    // chuyển tiếp, chứ không phải một key nào của máy chủ.
    fetchImpl: async (_url, init) => {
      const h = new Headers(init.headers as Record<string, string>);
      calls.push(h.get('x-api-key') ?? '(khong co)');
      return new Response(JSON.stringify({ date: '2026-08-23', summary: {}, incomplete: [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    },
    log: () => {},
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() => new Promise<void>((r) => server.close(() => r())));

const rpc = (body: unknown, headers: Record<string, string> = {}) =>
  fetch(`${base}/mcp`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...headers },
    body: JSON.stringify(body),
  });

const initialize = {
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1' } },
};

describe('Xác thực', () => {
  it('không có chìa khoá thì 401 và nói phải gửi gì', async () => {
    const res = await rpc(initialize);
    expect(res.status).toBe(401);
    expect(res.headers.get('www-authenticate')).toContain('Bearer');
    const body = (await res.json()) as { message?: string };
    expect(String(body.message)).toContain('X-API-Key');
  });

  it('nhận cả X-API-Key lẫn Authorization: Bearer', async () => {
    expect((await rpc(initialize, { 'x-api-key': KEY_A })).status).toBe(200);
    expect((await rpc(initialize, { authorization: `Bearer ${KEY_B}` })).status).toBe(200);
  });
});

describe('Đường ra vào', () => {
  it('/health không cần chìa khoá và không kể gì', async () => {
    const res = await fetch(`${base}/health`);
    expect(res.status).toBe(200);
    // Chỉ đúng một trường. Thêm phiên bản hay cấu hình vào đây là biếu không
    // thông tin do thám cho một trang mở công khai.
    expect(Object.keys((await res.json()) as object)).toEqual(['status']);
  });

  it('đường lạ trả 404, GET /mcp trả 405', async () => {
    expect((await fetch(`${base}/`)).status).toBe(404);
    expect((await fetch(`${base}/admin`)).status).toBe(404);
    const res = await fetch(`${base}/mcp`);
    expect(res.status).toBe(405);
    expect(res.headers.get('allow')).toBe('POST');
  });
});

describe('Thân request', () => {
  it('quá lớn thì 413, không nuốt trọn rồi mới từ chối', async () => {
    const res = await fetch(`${base}/mcp`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': KEY_A },
      body: JSON.stringify({ pad: 'x'.repeat(cfg.maxBodyBytes * 2) }),
    });
    expect(res.status).toBe(413);
  });
});

describe('Chuyển tiếp chìa khoá — cốt lõi của thiết kế', () => {
  it('gửi ĐÚNG chìa khoá của người gọi sang API, không phải key nào của máy chủ', async () => {
    // Chìa khoá RIÊNG cho bài này. Dùng lại KEY_A/KEY_B thì gáo nước của chúng đã
    // vơi vì các bài trước, và cú gọi tool cuối cùng ăn 429 — bài test đỏ vì lý
    // do chẳng liên quan gì tới thứ nó đang canh.
    const one = 'fck_11111111_secret-1';
    const two = 'fck_22222222_secret-2';
    calls.length = 0;
    await callTool(one);
    await callTool(two);

    // Hai người gọi, hai chìa khoá khác nhau đi tới API. Nếu máy chủ ôm một key
    // dùng chung thì cả hai dòng ở đây sẽ giống hệt nhau — và mọi truy vấn trong
    // nhật ký kiểm toán sẽ mang tên cùng một người ảo.
    expect(calls).toEqual(['fck_11111111_secret-1', 'fck_22222222_secret-2']);
  });
});

describe('Phanh nhịp gọi theo TỪNG chìa khoá', () => {
  it('người này bị phanh không kéo theo người kia', async () => {
    const busy = 'fck_cccccccc_secret-c';
    const quiet = 'fck_dddddddd_secret-d';

    let limited = 0;
    for (let i = 0; i < cfg.rateBurst + 3; i++) {
      if ((await rpc(initialize, { 'x-api-key': busy })).status === 429) limited++;
    }
    expect(limited).toBeGreaterThan(0);

    // Chìa khoá khác vẫn vào được. Phanh chung sẽ làm dòng này đỏ, và đó chính
    // là kiểu hỏng biến sự cố của một người thành sự cố của cả nhà.
    const other = await rpc(initialize, { 'x-api-key': quiet });
    expect(other.status).toBe(200);
  });

  it('phản hồi 429 nói rõ chờ bao lâu', async () => {
    const k = 'fck_eeeeeeee_secret-e';
    let res = await rpc(initialize, { 'x-api-key': k });
    for (let i = 0; i < cfg.rateBurst + 3 && res.status !== 429; i++) {
      res = await rpc(initialize, { 'x-api-key': k });
    }
    expect(res.status).toBe(429);
    expect(Number(res.headers.get('retry-after'))).toBeGreaterThan(0);
  });
});

/** Gọi một tool thật, đi hết đường initialize → tools/call. */
async function callTool(key: string): Promise<void> {
  await rpc(initialize, { 'x-api-key': key });
  await rpc(
    {
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: { name: 'handover_daily', arguments: { date: '2026-08-23' } },
    },
    { 'x-api-key': key },
  );
}

describe('Chốt danh sách tool nằm TRÊN đường chạy', () => {
  it('một tool lạ làm request hỏng, không lặng lẽ công bố ra ngoài', async () => {
    const { z } = await import('zod');
    const rogue = createHttpServer(cfg, {
      fetchImpl: async () => new Response('{}'),
      log: () => {},
      // Đúng cảnh người sau thêm một tool GHI vào registerTools() rồi quên
      // src/toolPolicy.ts.
      registerToolsImpl: (server) => {
        server.registerTool(
          'delete_everything',
          { description: 'x', inputSchema: { ok: z.boolean() } },
          async () => ({ content: [] }),
        );
      },
    });
    await new Promise<void>((r) => rogue.listen(0, '127.0.0.1', r));
    const port = (rogue.address() as AddressInfo).port;

    const res = await fetch(`http://127.0.0.1:${port}/mcp`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        'x-api-key': 'fck_99999999_secret-9',
      },
      body: JSON.stringify(initialize),
    });

    expect(res.status).toBe(500);
    await new Promise<void>((r) => rogue.close(() => r()));
  });
});
