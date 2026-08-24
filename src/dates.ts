/**
 * Mọi mốc ngày trong hệ FuelControl tính theo giờ Bangkok (luật N2 của dự án).
 *
 * Máy Bee chạy giờ Việt Nam, máy chủ chạy UTC, và cả hai đều không phải giờ
 * Bangkok. Nên "hôm qua" phải được tính ra ở đây một lần, đúng một cách, chứ
 * không để mỗi tool tự lấy new Date() rồi trừ đi một ngày.
 */

export const BANGKOK = 'Asia/Bangkok';

/** Số ngày tối đa cho một lần hỏi khoảng. */
export const MAX_RANGE_DAYS = 92;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

const fmt = new Intl.DateTimeFormat('en-CA', {
  timeZone: BANGKOK,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** Ngày hôm nay theo giờ Bangkok, dạng YYYY-MM-DD. */
export function bangkokToday(now: Date = new Date()): string {
  return fmt.format(now);
}

/** Ngày hôm qua theo giờ Bangkok. */
export function bangkokYesterday(now: Date = new Date()): string {
  return shiftDays(bangkokToday(now), -1);
}

/**
 * Cộng/trừ ngày trên chuỗi YYYY-MM-DD.
 *
 * Tính bằng UTC có chủ đích: chuỗi ngày ở đây là một nhãn lịch, không phải một
 * thời điểm. Dùng giờ địa phương của máy thì đúng hai ngày mỗi năm (chuyển giờ
 * mùa hè ở một số múi) phép cộng nhảy sai một ngày.
 */
export function shiftDays(date: string, days: number): string {
  const parsed = parseIsoDate(date);
  if (!parsed.ok) throw new Error(parsed.reason);
  const ms = Date.UTC(parsed.year, parsed.month - 1, parsed.day) + days * 86_400_000;
  return new Date(ms).toISOString().slice(0, 10);
}

export type DateParse =
  | { ok: true; year: number; month: number; day: number }
  | { ok: false; reason: string };

/**
 * Nhận đúng YYYY-MM-DD và đúng ngày CÓ THẬT trên lịch.
 *
 * Kiểm cả hai vế vì new Date('2026-02-30') không ném lỗi — nó lặng lẽ trượt
 * sang mùng 2 tháng 3. Một câu hỏi về ngày không tồn tại phải bị từ chối, không
 * phải được trả lời bằng số liệu của ngày khác.
 */
export function parseIsoDate(input: string): DateParse {
  const s = input.trim();
  if (!ISO_DATE.test(s)) {
    return { ok: false, reason: `ngày phải có dạng YYYY-MM-DD, nhận được "${input}"` };
  }
  const year = Number(s.slice(0, 4));
  const month = Number(s.slice(5, 7));
  const day = Number(s.slice(8, 10));
  const probe = new Date(Date.UTC(year, month - 1, day));
  if (
    probe.getUTCFullYear() !== year ||
    probe.getUTCMonth() !== month - 1 ||
    probe.getUTCDate() !== day
  ) {
    return { ok: false, reason: `ngày không có thật trên lịch: "${input}"` };
  }
  return { ok: true, year, month, day };
}

export interface Range {
  from: string;
  to: string;
}

export type RangeCheck = { ok: true; range: Range } | { ok: false; reason: string };

/** Khoảng mặc định: 7 ngày gần nhất, kết thúc ở hôm nay (giờ Bangkok). */
export function defaultRange(now: Date = new Date()): Range {
  const to = bangkokToday(now);
  return { from: shiftDays(to, -6), to };
}

/**
 * Kiểm khoảng ngày trước khi gửi xuống API.
 *
 * Trần MAX_RANGE_DAYS không phải để làm khó người hỏi: một câu hỏi buột miệng
 * kiểu "cho xem cả năm ngoái" biến thành một truy vấn nặng trên đúng cái
 * database đang phục vụ người thật ở quầy.
 */
export function checkRange(from: string, to: string): RangeCheck {
  const a = parseIsoDate(from);
  if (!a.ok) return { ok: false, reason: `"from" ${a.reason}` };
  const b = parseIsoDate(to);
  if (!b.ok) return { ok: false, reason: `"to" ${b.reason}` };

  if (from > to) {
    return { ok: false, reason: `"from" (${from}) đứng sau "to" (${to})` };
  }
  const days = Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1;
  if (days > MAX_RANGE_DAYS) {
    return {
      ok: false,
      reason: `khoảng ${days} ngày vượt trần ${MAX_RANGE_DAYS} ngày — chia nhỏ ra rồi hỏi lại`,
    };
  }
  return { ok: true, range: { from, to } };
}
