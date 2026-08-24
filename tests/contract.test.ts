import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { fuelVsBookingSchema, handoverDailySchema, parseResponse } from '../src/schemas.js';
import { formatDailySummary } from '../src/format.js';

/**
 * Kiểm HỢP ĐỒNG giữa hai repo.
 *
 * Hai tệp trong tests/fixtures/ là phản hồi THẬT của backend, chụp bằng
 * `go test ./internal/reports/ -run TestDumpContractJSON` chạy trên Postgres
 * thật với đủ 67 migration. Không phải do tay tôi gõ ra.
 *
 * Vì sao cần: schema zod ở đây và câu SQL bên kia nằm trong HAI repo khác nhau,
 * hai ngôn ngữ khác nhau, và không có gì buộc chúng đi cùng nhau. Ngày backend
 * đổi tên một trường, thứ duy nhất phát hiện ra là bài test này — nếu không thì
 * lỗi chỉ lộ ra lúc Bee đang hỏi Claude một câu về đội xe.
 *
 * Bản mẫu lệch thì chụp lại, ĐỪNG nới lỏng schema cho vừa.
 */

const fixture = (name: string) =>
  JSON.parse(readFileSync(fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url)), 'utf-8'));

describe('hop dong voi backend that', () => {
  it('phan hoi that cua /api/reports/handover-daily qua duoc schema', () => {
    const data = parseResponse(handoverDailySchema, fixture('handover-daily.json'), 'handover-daily');
    expect(data.summary.driver).toBeDefined();
    expect(data.summary.captain).toBeDefined();
    expect(Array.isArray(data.incomplete)).toBe(true);
  });

  it('phan hoi that cua /api/reports/fuel-vs-booking qua duoc schema', () => {
    const data = parseResponse(fuelVsBookingSchema, fixture('fuel-vs-booking.json'), 'fuel-vs-booking');
    expect(data.days.length).toBeGreaterThan(0);
  });

  it('backend tra ve MOT DONG MOI NGAY, ke ca ngay trong', () => {
    // Bản mẫu chụp khoảng 10-12/3 nhưng chỉ ngày 11 có dữ liệu. Ba dòng nghĩa
    // là generate_series bên backend còn sống.
    const data = parseResponse(fuelVsBookingSchema, fixture('fuel-vs-booking.json'), 'x');
    expect(data.days.map((d) => d.date)).toEqual(['2026-03-10', '2026-03-11', '2026-03-12']);
  });

  it('ngay khong co khach thi litersPerPax la null, khong phai 0', () => {
    const data = parseResponse(fuelVsBookingSchema, fixture('fuel-vs-booking.json'), 'x');
    const empty = data.days.find((d) => d.trips.actualPax === 0);
    expect(empty).toBeDefined();
    expect(empty?.litersPerPax).toBeNull();
  });

  it('ban tin dung duoc tren du lieu that, khong ra NaN hay undefined', () => {
    // Lớp định dạng là nơi một trường thiếu biến thành chữ "NaN" nằm giữa mấy
    // con số thật — kiểu sai khó nhận ra nhất trong cả chuỗi này.
    const handover = parseResponse(handoverDailySchema, fixture('handover-daily.json'), 'x');
    const fuel = parseResponse(fuelVsBookingSchema, fixture('fuel-vs-booking.json'), 'x');

    const text = formatDailySummary(handover, fuel);
    expect(text).not.toContain('NaN');
    expect(text).not.toContain('undefined');
    expect(text).toContain('11/03/2026');
    expect(text).toContain('thiếu check-in');
  });
});
