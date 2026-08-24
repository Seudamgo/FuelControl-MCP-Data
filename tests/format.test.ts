import { describe, it, expect } from 'vitest';
import { formatDailySummary } from '../src/format.js';
import type { FuelVsBooking, HandoverDaily } from '../src/schemas.js';

const zeroRole = { people: 0, trips: 0, complete: 0, missingCheckin: 0, missingCheckout: 0, missingBoth: 0 };

const cleanDay: HandoverDaily = {
  date: '2026-08-23',
  summary: {
    driver: { people: 8, trips: 14, complete: 14, missingCheckin: 0, missingCheckout: 0, missingBoth: 0 },
    captain: { people: 3, trips: 5, complete: 5, missingCheckin: 0, missingCheckout: 0, missingBoth: 0 },
  },
  incomplete: [],
};

const baseFuelDay = {
  date: '2026-08-23',
  fuel: { logs: 6, liters: 412.5, cost: 15230, reconOk: 6, reconWarning: 0, reconSkipped: 0, depotFills: 2 },
  trips: { count: 14, bookedPax: 96, actualPax: 88, paxGap: -8 },
  litersPerPax: 4.69,
};

const fuelDay: FuelVsBooking = { days: [baseFuelDay] };

describe('ban tin tom tat', () => {
  it('ngay sach thi noi thang la khong co bat thuong', () => {
    const out = formatDailySummary(cleanDay, fuelDay);
    expect(out).toContain('Không có bất thường');
    expect(out).toContain('23/08/2026');
  });

  it('bat thuong dung TRUOC phan tong ket', () => {
    // Thứ tự này là cả điểm của bản tin (PLAN.md mục 7, khuyến nghị Q4). Tổng kết
    // lên đầu thì ngày sạch và ngày có chuyện trông giống nhau ở dòng đầu tiên.
    const withGap: HandoverDaily = {
      ...cleanDay,
      incomplete: [
        {
          staffName: 'Worawit',
          staffCode: 'GO040',
          role: 'captain',
          tripCode: 'TRIP/SEA/2026/0182',
          vehicle: 'CAT-02',
          hasCheckout: true,
          hasCheckin: false,
        },
      ],
    };
    const out = formatDailySummary(withGap, fuelDay);
    expect(out.indexOf('check-in')).toBeLessThan(out.indexOf('Giao nhận xe'));
    expect(out).toContain('GO040 Worawit');
    expect(out).toContain('CAT-02');
  });

  it('thieu ca hai buoc noi khac voi thieu mot buoc', () => {
    const both: HandoverDaily = {
      ...cleanDay,
      incomplete: [{ staffName: 'A', role: 'driver', tripCode: 'T1', hasCheckout: false, hasCheckin: false }],
    };
    expect(formatDailySummary(both, fuelDay)).toContain('CẢ HAI');
  });

  it('doi soat canh bao duoc nang len thanh bat thuong', () => {
    const warn: FuelVsBooking = {
      days: [{ ...baseFuelDay, fuel: { ...baseFuelDay.fuel, reconOk: 5, reconWarning: 1 } }],
    };
    const out = formatDailySummary(cleanDay, warn);
    expect(out).toContain('CẢNH BÁO');
    expect(out.indexOf('CẢNH BÁO')).toBeLessThan(out.indexOf('Giao nhận xe'));
  });

  it('ngay khong co gi van ra ban tin, khong ra khoang trang', () => {
    // Ngày im lặng và ngày hệ thống hỏng phải phân biệt được (PLAN.md muc C3).
    const empty: HandoverDaily = {
      date: '2026-08-23',
      summary: { driver: zeroRole, captain: zeroRole },
      incomplete: [],
    };
    const noFuel: FuelVsBooking = {
      days: [
        {
          date: '2026-08-23',
          fuel: { logs: 0, liters: 0, cost: 0, reconOk: 0, reconWarning: 0, reconSkipped: 0, depotFills: 0 },
          trips: { count: 0, bookedPax: 0, actualPax: 0, paxGap: 0 },
          litersPerPax: null,
        },
      ],
    };
    const out = formatDailySummary(empty, noFuel);
    expect(out).toContain('không có chuyến nào');
    expect(out).toContain('không có phiếu nào');
  });

  it('litersPerPax null hien dau gach, KHONG hien so 0', () => {
    // Trả 0 đọc ra như "rất tiết kiệm", trong khi sự thật là tỉ lệ không tồn tại.
    const noPax: FuelVsBooking = {
      days: [
        { ...baseFuelDay, trips: { count: 2, bookedPax: 4, actualPax: 0, paxGap: -4 }, litersPerPax: null },
      ],
    };
    const out = formatDailySummary(cleanDay, noPax);
    expect(out).toContain('Lít/khách: —');
    expect(out).not.toContain('Lít/khách: 0,0');
  });

  it('luon nhac lit tren khach chi la xu huong', () => {
    expect(formatDailySummary(cleanDay, fuelDay)).toContain('không phải chốt gian lận');
  });

  it('tien hien don vi baht, khong phai dong', () => {
    const out = formatDailySummary(cleanDay, fuelDay);
    expect(out).toContain('15.230');
    expect(out).not.toContain('VND');
  });
});
