/**
 * Chạy thử toàn tuyến mà KHÔNG cần API key thật:
 * dựng một API giả ở localhost, spawn máy chủ MCP đã build, rồi nói chuyện với
 * nó bằng đúng giao thức JSON-RPC qua stdio.
 *
 * Đây là thứ duy nhất chứng minh được ba việc mà test đơn vị không chạm tới:
 * máy chủ lên được, stdout sạch (không dòng log nào lọt vào giữa giao thức), và
 * tool gọi được từ bên ngoài.
 *
 *   npm run build && npm run smoke
 */
import http from 'node:http';
import { spawn } from 'node:child_process';

const KEY = 'fc_test1234_secret';
const role = (o = {}) => ({
  people: 8, trips: 14, complete: 13, missingCheckin: 1, missingCheckout: 0, missingBoth: 0, ...o,
});

const api = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  const json = (status, body) => {
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(body));
  };

  if (req.headers['x-api-key'] !== KEY) {
    return json(401, { error: 'API_KEY_INVALID', message: 'key sai' });
  }

  if (url.pathname === '/api/reports/handover-daily') {
    return json(200, {
      date: url.searchParams.get('date'),
      summary: { driver: role(), captain: role({ people: 3, trips: 5, complete: 5, missingCheckin: 0 }) },
      incomplete: [
        {
          staffName: 'Mr. Worawit', staffCode: 'GO040', role: 'captain',
          tripCode: 'TRIP/SEA/2026/0182', vehicle: 'CAT-02',
          hasCheckout: true, hasCheckin: false,
          scheduledDepartureAt: '2026-08-23T02:00:00Z', plannedEnd: '2026-08-23T06:00:00Z',
        },
      ],
    });
  }

  if (url.pathname === '/api/reports/fuel-vs-booking') {
    return json(200, {
      days: [
        {
          date: url.searchParams.get('from'),
          fuel: { logs: 6, liters: 412.5, cost: 15230, reconOk: 4, reconWarning: 1, reconSkipped: 1, depotFills: 2 },
          trips: { count: 14, bookedPax: 96, actualPax: 88, paxGap: -8 },
          litersPerPax: 4.69,
        },
      ],
    });
  }
  return json(404, { error: 'NOT_FOUND' });
});

await new Promise((r) => api.listen(0, '127.0.0.1', r));
const port = api.address().port;

const child = spawn(process.execPath, ['dist/index.js'], {
  env: {
    ...process.env,
    FUELCONTROL_BASE_URL: `http://127.0.0.1:${port}`,
    FUELCONTROL_API_KEY: KEY,
    FUELCONTROL_ALLOW_INSECURE_LOCAL: 'true',
  },
  stdio: ['pipe', 'pipe', 'pipe'],
});
child.stderr.on('data', (d) => process.stderr.write('  [mcp] ' + d));

let buf = '';
const pending = new Map();
child.stdout.on('data', (d) => {
  buf += d.toString();
  let i;
  while ((i = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, i).trim();
    buf = buf.slice(i + 1);
    if (!line) continue;
    // Dòng nào không phải JSON-RPC ở đây là một lỗi nghiêm trọng: nghĩa là có
    // thứ gì đó đang ghi ra stdout và làm hỏng giao thức.
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      console.error('❌ RÁC TRÊN STDOUT (hỏng giao thức stdio):', line);
      process.exit(1);
    }
    if (msg.id && pending.has(msg.id)) {
      pending.get(msg.id)(msg);
      pending.delete(msg.id);
    }
  }
});

let seq = 0;
const rpc = (method, params) =>
  new Promise((resolve) => {
    const id = ++seq;
    pending.set(id, resolve);
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
  });

let failed = 0;
const check = (label, cond) => {
  console.log(`${cond ? '✅' : '❌'} ${label}`);
  if (!cond) failed += 1;
};

const init = await rpc('initialize', {
  protocolVersion: '2025-06-18',
  capabilities: {},
  clientInfo: { name: 'smoke', version: '1' },
});
check(`initialize -> ${init.result?.serverInfo?.name}`, init.result?.serverInfo?.name === 'fuelcontrol-mcp-data');
child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');

const list = await rpc('tools/list', {});
const names = (list.result?.tools ?? []).map((t) => t.name);
check(`tools/list -> ${names.join(', ')}`, names.join(',') === 'handover_daily,fuel_vs_booking,daily_summary');

const ok = await rpc('tools/call', { name: 'daily_summary', arguments: { date: '2026-08-23' } });
const text = ok.result?.content?.[0]?.text ?? '';
check('daily_summary chạy được', !ok.result?.isError);
check('bất thường xếp trên phần tổng kết', text.indexOf('thiếu check-in') < text.indexOf('Giao nhận xe'));
console.log('\n' + text.split('\n').map((l) => '     ' + l).join('\n') + '\n');

const bad = await rpc('tools/call', { name: 'handover_daily', arguments: { date: '23/08/2026' } });
check('ngày sai định dạng bị từ chối', bad.result?.isError === true);
check(
  'thông báo lỗi nói rõ đây KHÔNG phải "không có dữ liệu"',
  (bad.result?.content?.[0]?.text ?? '').includes('không phải "không có dữ liệu"'),
);

child.kill();
api.close();
console.log(failed === 0 ? '\nXong — toàn tuyến chạy được.' : `\n${failed} phép kiểm hỏng.`);
process.exit(failed === 0 ? 0 : 1);
