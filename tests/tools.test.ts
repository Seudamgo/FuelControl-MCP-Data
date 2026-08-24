import { describe, it, expect, vi } from 'vitest';
import { registerTools } from '../src/tools/index.js';
import { FuelControlError } from '../src/errors.js';
import type { FuelControlClient } from '../src/client.js';

interface Registered {
  config: { title: string; description: string; inputSchema: Record<string, unknown> };
  handler: (args: Record<string, unknown>) => Promise<{ content: Array<{ text: string }>; isError?: boolean }>;
}

function harness(get: ReturnType<typeof vi.fn>, now = new Date('2026-08-24T05:00:00Z')) {
  const tools = new Map<string, Registered>();
  const server = {
    registerTool(name: string, config: Registered['config'], handler: Registered['handler']) {
      tools.set(name, { config, handler });
    },
  };
  registerTools(server as never, { get } as unknown as FuelControlClient, () => now);
  return tools;
}

const roleCount = { people: 0, trips: 0, complete: 0, missingCheckin: 0, missingCheckout: 0, missingBoth: 0 };
const okHandover = { date: '2026-08-23', summary: { driver: roleCount, captain: roleCount }, incomplete: [] };
const okFuel = {
  days: [
    {
      date: '2026-08-23',
      fuel: { logs: 0, liters: 0, cost: 0, reconOk: 0, reconWarning: 0, reconSkipped: 0, depotFills: 0 },
      trips: { count: 0, agencyTrips: 0, bookedPax: 0, actualPax: 0, paxGap: 0 },
      litersPerPax: null,
    },
  ],
};

describe('dang ky tool', () => {
  it('dung ba tool doc, khong hon', () => {
    // PLAN.md muc B2 chot ba tool. Them tool thu tu la mot quyet dinh, khong
    // phai mot buoc tien tay.
    const tools = harness(vi.fn());
    expect([...tools.keys()]).toEqual(['handover_daily', 'fuel_vs_booking', 'daily_summary']);
  });

  it('mo ta noi ro litersPerPax khong phai chot gian lan', () => {
    // Claude doc chinh dong nay de dien giai con so. Thieu no thi ti le lit tren
    // khach se bi doc thanh bang chung gian lan (PLAN.md muc 0.3).
    const d = harness(vi.fn()).get('fuel_vs_booking')!.config.description;
    expect(d).toContain('KHÔNG PHẢI BẰNG CHỨNG GIAN LẬN');
    expect(d).toContain('reconWarning');
    expect(d).toContain('null');
  });

  it('mo ta noi ro don vi tien la baht', () => {
    expect(harness(vi.fn()).get('fuel_vs_booking')!.config.description).toContain('baht');
  });
});

describe('mac dinh ngay gio Bangkok', () => {
  it('handover_daily bo trong = hom qua', async () => {
    // 2026-08-24T05:00Z la trua 24/8 gio Bangkok, nen hom qua la 23/8.
    const get = vi.fn(async () => okHandover);
    await harness(get).get('handover_daily')!.handler({});
    expect(get).toHaveBeenCalledWith('handoverDaily', { date: '2026-08-23' });
  });

  it('fuel_vs_booking bo trong = 7 ngay gan nhat', async () => {
    const get = vi.fn(async () => okFuel);
    await harness(get).get('fuel_vs_booking')!.handler({});
    expect(get).toHaveBeenCalledWith('fuelVsBooking', { from: '2026-08-18', to: '2026-08-24' });
  });
});

describe('kiem dau vao truoc khi goi API', () => {
  it('ngay sai dinh dang bi chan tai cho, KHONG goi API', async () => {
    const get = vi.fn();
    const res = await harness(get).get('handover_daily')!.handler({ date: '23/08/2026' });
    expect(res.isError).toBe(true);
    expect(get).not.toHaveBeenCalled();
  });

  it('ngay khong co that bi chan', async () => {
    const get = vi.fn();
    const res = await harness(get).get('handover_daily')!.handler({ date: '2026-02-30' });
    expect(res.isError).toBe(true);
    expect(get).not.toHaveBeenCalled();
  });

  it('khoang qua dai bi chan tai cho', async () => {
    const get = vi.fn();
    const res = await harness(get).get('fuel_vs_booking')!.handler({ from: '2020-01-01', to: '2026-01-01' });
    expect(res.isError).toBe(true);
    expect(get).not.toHaveBeenCalled();
  });
});

describe('loi KHONG BAO GIO tro thanh du lieu rong (luat N3)', () => {
  it('loi mang tra ve isError kem canh bao doc dung', async () => {
    const get = vi.fn(async () => {
      throw new FuelControlError('network', 'mất mạng');
    });
    const res = await harness(get).get('handover_daily')!.handler({ date: '2026-08-23' });

    expect(res.isError).toBe(true);
    const text = res.content[0]!.text;
    expect(text).toContain('KHÔNG LẤY ĐƯỢC SỐ LIỆU');
    expect(text).toContain('không phải "không có dữ liệu"');
    // Khong duoc tra ve thu trong nhu mot ket qua rong hop le.
    expect(text).not.toContain('"incomplete": []');
    expect(text).not.toContain('[]');
  });

  it('loi la (khong phai FuelControlError) van ra isError', async () => {
    const get = vi.fn(async () => {
      throw new TypeError('undefined is not a function');
    });
    const res = await harness(get).get('fuel_vs_booking')!.handler({});
    expect(res.isError).toBe(true);
  });

  it('daily_summary hong mot nua thi hong ca, khong ra nua ban tin', async () => {
    // Nua ban tin doc y het mot ngay binh yen — day la kieu hong nguy hiem nhat
    // ma lop nay co the tao ra.
    const get = vi.fn(async (endpoint: string) => {
      if (endpoint === 'handoverDaily') return okHandover;
      throw new FuelControlError('server', 'API 500');
    });
    const res = await harness(get as never).get('daily_summary')!.handler({ date: '2026-08-23' });

    expect(res.isError).toBe(true);
    expect(res.content[0]!.text).not.toContain('Giao nhận xe');
  });
});

describe('duong di binh thuong', () => {
  it('handover_daily tra ve JSON doc duoc', async () => {
    const get = vi.fn(async () => okHandover);
    const res = await harness(get).get('handover_daily')!.handler({ date: '2026-08-23' });
    expect(res.isError).toBeUndefined();
    expect(JSON.parse(res.content[0]!.text)).toMatchObject({ date: '2026-08-23' });
  });

  it('daily_summary goi ca hai endpoint cho cung mot ngay', async () => {
    const get = vi.fn(async (endpoint: string) => (endpoint === 'handoverDaily' ? okHandover : okFuel));
    const res = await harness(get as never).get('daily_summary')!.handler({ date: '2026-08-23' });

    expect(get).toHaveBeenCalledWith('handoverDaily', { date: '2026-08-23' });
    expect(get).toHaveBeenCalledWith('fuelVsBooking', { from: '2026-08-23', to: '2026-08-23' });
    expect(res.content[0]!.text).toContain('23/08/2026');
  });
});
