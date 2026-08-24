import { FuelControlError } from './errors.js';

/**
 * Lấy chìa khoá của NGƯỜI GỌI ra khỏi một request HTTP.
 *
 * # Vì sao máy chủ này không giữ chìa khoá nào
 *
 * Cách thường thấy là container MCP ôm sẵn một API key dùng chung. Làm vậy thì:
 * mọi truy vấn đều mang tên một người ảo nên nhật ký kiểm toán mất hết ý nghĩa,
 * ai vào được container là có toàn bộ dữ liệu, và thu hồi quyền của MỘT người
 * thì phải đổi key của TẤT CẢ.
 *
 * Ở đây chìa khoá đi cùng từng request và được chuyển tiếp nguyên vẹn sang API.
 * Container không lưu gì cả — không có gì để trộm, đúng dòng nguy hiểm nhất
 * trong bảng mối đe doạ của skill (credential theft → full account takeover).
 * Quyền vẫn do RBAC của chủ key quyết, và thu hồi key là cắt đường ngay lập tức.
 */

/** Hai tên header được chấp nhận. */
export const API_KEY_HEADER = 'x-api-key';
export const AUTH_HEADER = 'authorization';

export interface Credential {
  /** Chuỗi key thô — CHỈ để chuyển tiếp sang API. Không log, không lưu. */
  readonly raw: string;
  /**
   * Tiền tố 8 ký tự của key, thứ DUY NHẤT được phép đi vào log.
   *
   * Đây đúng là chuỗi app hiện trong bảng API key, nên đọc log xong tra ngược ra
   * key nào mà không cần biết chính chuỗi bí mật.
   */
  readonly prefix: string;
}

/**
 * Đọc header và trả về chìa khoá.
 *
 * Nhận CẢ "X-API-Key" lẫn "Authorization: Bearer". Backend FuelControl chỉ nhận
 * X-API-Key và có lý do riêng cho việc đó, nhưng ở đây là lớp khác: nhiều client
 * MCP chỉ biết gửi Authorization, và từ chối chúng không làm ai an toàn hơn —
 * chuỗi vẫn phải qua đúng một cửa xác thực ở API.
 */
export function readCredential(headers: Record<string, string | string[] | undefined>): Credential {
  const raw = firstHeader(headers, API_KEY_HEADER) ?? bearer(firstHeader(headers, AUTH_HEADER));
  if (!raw) {
    throw new FuelControlError(
      'auth',
      'Thiếu chìa khoá. Gửi header "X-API-Key: <key>" (hoặc "Authorization: Bearer <key>"). ' +
        'Key cấp ở fleet.seudambite.com → tab "API key", scope chỉ tick "read".',
    );
  }
  return { raw, prefix: prefixOf(raw) };
}

function firstHeader(
  headers: Record<string, string | string[] | undefined>,
  name: string,
): string | undefined {
  // Node hạ tên header về chữ thường, nhưng quét lại cho chắc: một proxy đứng
  // giữa có thể trả về hoa-thường khác, và bỏ sót header ở đây thì mọi request
  // đều 401 mà không ai đoán ra tại sao.
  for (const [k, v] of Object.entries(headers)) {
    if (k.toLowerCase() !== name) continue;
    const s = Array.isArray(v) ? v[0] : v;
    const t = (s ?? '').trim();
    if (t) return t;
  }
  return undefined;
}

function bearer(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const m = /^bearer\s+(.+)$/i.exec(value.trim());
  const token = m?.[1]?.trim();
  return token ? token : undefined;
}

/**
 * Tiền tố của key, dạng "<tag>_<8 hex>". Rỗng khi chuỗi không đúng khuôn.
 *
 * KHÔNG ném lỗi khi khuôn sai: việc phán chuỗi này hợp lệ hay không là của API,
 * và đoán ở đây chỉ tạo ra chỗ thứ hai có thể lệch với chỗ thật. Nó chỉ cần một
 * cái tên để ghi log và để đếm nhịp gọi.
 */
function prefixOf(raw: string): string {
  const parts = raw.split('_');
  if (parts.length < 3) return '';
  const [tag, prefix] = parts;
  if (!tag || !prefix || prefix.length !== 8) return '';
  return `${tag}_${prefix}`;
}
