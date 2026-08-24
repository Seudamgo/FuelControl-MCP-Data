import { describe, it, expect } from 'vitest';
import {
  MAX_RANGE_DAYS,
  bangkokToday,
  bangkokYesterday,
  checkRange,
  defaultRange,
  parseIsoDate,
  shiftDays,
} from '../src/dates.js';

describe('mốc ngày theo giờ Bangkok (luật N2)', () => {
  it('23:30 UTC đã là NGÀY HÔM SAU ở Bangkok', () => {
    // Đây là bài quan trọng nhất của tệp: lấy giờ máy hay giờ UTC thì cả 7 tiếng
    // đầu mỗi ngày giờ Thái bị ghi sang ngày hôm trước.
    expect(bangkokToday(new Date('2026-08-23T23:30:00Z'))).toBe('2026-08-24');
  });

  it('16:59 UTC vẫn là ngày cũ, 17:00 UTC đã sang ngày mới', () => {
    expect(bangkokToday(new Date('2026-08-23T16:59:59Z'))).toBe('2026-08-23');
    expect(bangkokToday(new Date('2026-08-23T17:00:00Z'))).toBe('2026-08-24');
  });

  it('hôm qua là hôm nay lùi đúng một ngày', () => {
    expect(bangkokYesterday(new Date('2026-08-23T23:30:00Z'))).toBe('2026-08-23');
    expect(bangkokYesterday(new Date('2026-01-01T02:00:00Z'))).toBe('2025-12-31');
  });

  it('cộng trừ ngày đi qua được ranh giới tháng và năm nhuận', () => {
    expect(shiftDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(shiftDays('2024-03-01', -1)).toBe('2024-02-29');
    expect(shiftDays('2025-12-31', 1)).toBe('2026-01-01');
  });
});

describe('parseIsoDate', () => {
  it('nhận ngày đúng dạng và có thật', () => {
    expect(parseIsoDate('2026-08-23').ok).toBe(true);
  });

  it.each(['23/08/2026', '2026-8-3', '2026-08-23T00:00:00Z', 'hôm qua', '', '20260823'])(
    'từ chối dạng sai: %s',
    (input) => {
      expect(parseIsoDate(input).ok).toBe(false);
    },
  );

  it('từ chối ngày không có thật thay vì trượt sang ngày khác', () => {
    // new Date('2026-02-30') không ném lỗi, nó lặng lẽ thành mùng 2 tháng 3.
    // Trả lời một câu hỏi về ngày không tồn tại bằng số liệu ngày khác là kiểu
    // sai không ai phát hiện được.
    expect(parseIsoDate('2026-02-30').ok).toBe(false);
    expect(parseIsoDate('2026-13-01').ok).toBe(false);
    expect(parseIsoDate('2025-02-29').ok).toBe(false);
  });
});

describe('checkRange', () => {
  it('khoảng hợp lệ đi qua', () => {
    const r = checkRange('2026-08-01', '2026-08-07');
    expect(r.ok).toBe(true);
  });

  it('từ chối from đứng sau to', () => {
    const r = checkRange('2026-08-07', '2026-08-01');
    expect(r.ok).toBe(false);
  });

  it('cùng một ngày là khoảng hợp lệ (1 ngày)', () => {
    expect(checkRange('2026-08-07', '2026-08-07').ok).toBe(true);
  });

  it(`chặn khoảng dài hơn ${MAX_RANGE_DAYS} ngày`, () => {
    const r = checkRange('2025-01-01', '2026-01-01');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain(String(MAX_RANGE_DAYS));
  });

  it('đúng trần thì vẫn cho qua, hơn một ngày thì chặn', () => {
    const to = shiftDays('2026-01-01', MAX_RANGE_DAYS - 1);
    expect(checkRange('2026-01-01', to).ok).toBe(true);
    expect(checkRange('2026-01-01', shiftDays(to, 1)).ok).toBe(false);
  });
});

describe('defaultRange', () => {
  it('là đúng 7 ngày kết thúc hôm nay giờ Bangkok', () => {
    const r = defaultRange(new Date('2026-08-23T23:30:00Z'));
    expect(r).toEqual({ from: '2026-08-18', to: '2026-08-24' });
    expect(checkRange(r.from, r.to).ok).toBe(true);
  });
});
