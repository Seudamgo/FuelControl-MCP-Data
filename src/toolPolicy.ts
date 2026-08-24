/**
 * Danh sách tool được phép công bố (skill §5 — Tool Authorization).
 *
 * # Vì sao cần một danh sách khi cả ba tool đều chỉ đọc
 *
 * Đúng là hôm nay không có tool nào ghi được, nên danh sách này chưa chặn gì.
 * Nó tồn tại cho NGÀY MAI: người thêm một tool ghi vào registerTools() sẽ thấy
 * nó không xuất hiện, và phải sửa đúng tệp này — tức là quyết định mở một cửa
 * ghi ra Internet để lại vết trong lịch sử git, thay vì lọt vào cùng một commit
 * "thêm tính năng".
 *
 * Đây cũng là chốt duy nhất KHÔNG dựa vào phía server. RBAC ở API vẫn là lớp
 * quyết định cuối, nhưng nó trả lời câu "người này xem được gì", không trả lời
 * câu "máy chủ MCP này được phép mời gọi những gì".
 */

/** Tool chỉ đọc, được công bố ra ngoài. */
export const ALLOWED_TOOLS = ['handover_daily', 'fuel_vs_booking', 'daily_summary'] as const;

export type AllowedTool = (typeof ALLOWED_TOOLS)[number];

export function isToolAllowed(name: string): name is AllowedTool {
  return (ALLOWED_TOOLS as readonly string[]).includes(name);
}
