import type { FuelVsBooking, HandoverDaily } from './schemas.js';

/**
 * Dựng bản tin tóm tắt một ngày — cùng khuôn với bản tin LINE ở PLAN.md §C3.
 *
 * Cùng một khuôn ở hai nơi là có chủ đích: người đọc tin LINE buổi sáng và
 * người hỏi Claude buổi chiều phải thấy CÙNG MỘT hình dạng, nếu không thì mỗi
 * lần đổi kênh là một lần phải học đọc lại.
 *
 * Thứ tự cố ý đảo so với trực giác: BẤT THƯỜNG LÊN ĐẦU (PLAN.md §7, khuyến nghị
 * cho Q4). Ngày sạch thì bản tin ngắn hẳn, và mắt nhận ra sự khác biệt đó trước
 * khi kịp đọc chữ.
 */

const num = new Intl.NumberFormat('vi-VN');
const num1 = new Intl.NumberFormat('vi-VN', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

export function formatDate(iso: string): string {
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

export function formatDailySummary(handover: HandoverDaily, fuel: FuelVsBooking): string {
  const lines: string[] = [`📊 FuelControl — ${formatDate(handover.date)}`, ''];

  const day = fuel.days.find((d) => d.date === handover.date) ?? fuel.days[0];

  // --- Bất thường lên đầu ---
  const alerts: string[] = [];
  if (handover.incomplete.length > 0) {
    alerts.push(`⚠️ ${handover.incomplete.length} chuyến thiếu giao nhận:`);
    for (const row of handover.incomplete) {
      const missing = !row.hasCheckout && !row.hasCheckin
        ? 'thiếu CẢ HAI'
        : !row.hasCheckin
          ? 'thiếu check-in'
          : 'thiếu check-out';
      const who = row.staffCode ? `${row.staffCode} ${row.staffName}` : row.staffName;
      const veh = row.vehicle ? ` (${row.vehicle})` : '';
      alerts.push(`  · ${who} — ${row.tripCode}${veh} — ${missing}`);
    }
  }
  if (day && day.fuel.reconWarning > 0) {
    alerts.push(`⚠️ ${day.fuel.reconWarning} phiếu xăng dầu bị đối soát CẢNH BÁO — xem sổ nhiên liệu.`);
  }

  if (alerts.length === 0) {
    lines.push('✅ Không có bất thường.', '');
  } else {
    lines.push(...alerts, '');
  }

  // --- Tổng kết ---
  const s = handover.summary;
  lines.push('🚗 Giao nhận xe');
  lines.push(`  Tài xế:        ${s.driver.complete}/${s.driver.trips} chuyến đủ  ·  ${s.driver.people} người`);
  lines.push(`  Thuyền trưởng: ${s.captain.complete}/${s.captain.trips} chuyến đủ  ·  ${s.captain.people} người`);
  if (s.driver.trips === 0 && s.captain.trips === 0) {
    lines.push('  (không có chuyến nào trong ngày)');
  }
  lines.push('');

  if (!day) {
    lines.push('⛽ Xăng dầu', '  (không có dữ liệu cho ngày này)');
    return lines.join('\n');
  }

  lines.push('⛽ Xăng dầu');
  if (day.fuel.logs === 0) {
    lines.push('  (không có phiếu nào)');
  } else {
    lines.push(`  ${day.fuel.logs} phiếu · ${num1.format(day.fuel.liters)} L · ฿${num.format(day.fuel.cost)}`);
    lines.push(
      `  Đối soát: ${day.fuel.reconOk} ok · ${day.fuel.reconWarning} cảnh báo · ${day.fuel.reconSkipped} bỏ qua`,
    );
    lines.push(`  Đổ tại kho: ${day.fuel.depotFills} phiếu`);
  }
  lines.push('');

  lines.push('👥 Khách');
  lines.push(
    `  Booking ${num.format(day.trips.bookedPax)}  ·  Thực đi ${num.format(day.trips.actualPax)}  ·  ` +
      `lệch ${day.trips.paxGap > 0 ? '+' : ''}${num.format(day.trips.paxGap)}`,
  );
  lines.push(
    day.litersPerPax === null
      ? '  Lít/khách: — (không có khách nào đi)'
      : `  Lít/khách: ${num1.format(day.litersPerPax)} (chỉ số xu hướng, không phải chốt gian lận)`,
  );

  return lines.join('\n');
}
