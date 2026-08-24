import { describe, it, expect } from 'vitest';
import { fuelVsBookingSchema, handoverDailySchema, parseResponse } from '../src/schemas.js';
import { FuelControlError } from '../src/errors.js';

const roleCount = { people: 1, trips: 2, complete: 1, missingCheckin: 1, missingCheckout: 0, missingBoth: 0 };

const goodHandover = {
  date: '2026-08-23',
  summary: { driver: roleCount, captain: roleCount },
  incomplete: [
    {
      staffName: 'GO040-Mr. Worawit',
      staffCode: 'GO040',
      role: 'captain',
      tripCode: 'TRIP/SEA/2026/0182',
      vehicle: 'CAT-02',
      hasCheckout: true,
      hasCheckin: false,
      scheduledDepartureAt: '2026-08-23T02:00:00Z',
      plannedEnd: '2026-08-23T06:00:00Z',
    },
  ],
};

const goodFuel = {
  days: [
    {
      date: '2026-08-23',
      fuel: { logs: 6, liters: 412.5, cost: 15230, reconOk: 4, reconWarning: 1, reconSkipped: 1, depotFills: 2 },
      trips: { count: 14, agencyTrips: 0, bookedPax: 96, actualPax: 88, paxGap: -8 },
      litersPerPax: 4.69,
    },
  ],
};

describe('kiem hinh dang phan hoi', () => {
  it('nhan dung ban thiet ke o PLAN.md', () => {
    expect(parseResponse(handoverDailySchema, goodHandover, 'x').date).toBe('2026-08-23');
    expect(parseResponse(fuelVsBookingSchema, goodFuel, 'x').days).toHaveLength(1);
  });

  it('backend them truong moi thi KHONG gay', () => {
    // Thêm trường là chuyện lành. Bắt lỗi ở đây sẽ làm MCP hỏng mỗi lần backend
    // tiến lên một bước, và người ta sẽ học cách gỡ luôn lớp kiểm này.
    const extended = { ...goodFuel, days: [{ ...goodFuel.days[0], newField: 'gi do' }], meta: {} };
    expect(() => parseResponse(fuelVsBookingSchema, extended, 'x')).not.toThrow();
  });

  it('litersPerPax = null la hop le (khong co khach nao di)', () => {
    const d = { days: [{ ...goodFuel.days[0], litersPerPax: null }] };
    const [first] = parseResponse(fuelVsBookingSchema, d, 'x').days;
    expect(first?.litersPerPax).toBeNull();
  });

  it.each([
    ['thieu summary', { date: '2026-08-23', incomplete: [] }],
    ['thieu mot o dem', { date: '2026-08-23', summary: { driver: { people: 1 }, captain: roleCount }, incomplete: [] }],
    ['incomplete khong phai mang', { date: '2026-08-23', summary: goodHandover.summary, incomplete: null }],
    ['so gui duoi dang chuoi', { date: '2026-08-23', summary: { driver: { ...roleCount, trips: '2' }, captain: roleCount }, incomplete: [] }],
    ['rong hoan toan', {}],
    ['khong phai object', 'oops'],
  ])('tu choi phan hoi lech: %s', (_label, body) => {
    expect(() => parseResponse(handoverDailySchema, body, '/api/reports/handover-daily')).toThrow(FuelControlError);
  });

  it('loi noi ro truong nao lech, khong noi chung chung', () => {
    // Không có dòng này thì một undefined sẽ trôi xuống lớp định dạng và hiện ra
    // chữ "NaN" nằm giữa mấy con số thật — sai kiểu khó nhận ra nhất.
    let err: FuelControlError | undefined;
    try {
      parseResponse(handoverDailySchema, { date: '2026-08-23', incomplete: [] }, '/api/reports/handover-daily');
    } catch (e) {
      err = e as FuelControlError;
    }
    expect(err?.kind).toBe('bad_response');
    expect(err?.message).toContain('summary');
  });
});
