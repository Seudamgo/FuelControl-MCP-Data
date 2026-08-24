/**
 * Địa chỉ THẬT của người gọi, dùng cho nhật ký kiểm toán và cho gáo phanh
 * dự phòng.
 *
 * # Vì sao không dùng thẳng req.socket.remoteAddress
 *
 * Máy chủ này đứng sau nginx, nên địa chỉ ổ cắm LUÔN là IP của nginx trong mạng
 * Docker. Ghi nguyên nó vào log thì mọi dòng đều trỏ về cùng một chỗ và nhật ký
 * không trả lời được câu hỏi duy nhất nó sinh ra để trả lời — request này từ đâu
 * tới. Nó còn làm hỏng gáo phanh dự phòng: key sai khuôn thì đếm theo địa chỉ,
 * mà mọi địa chỉ đều là nginx, nên tất cả dùng CHUNG một gáo và một người gõ sai
 * key liên tục phanh luôn người khác.
 *
 * # Vì sao không tin header vô điều kiện
 *
 * X-Real-IP là chuỗi do client gửi được. Tin nó ở mọi hoàn cảnh là cho phép bất
 * kỳ ai tự khai địa chỉ của mình — tức là tự chọn gáo phanh và tự viết nhật ký
 * kiểm toán của chính mình.
 *
 * Chốt: CHỈ tin header khi đầu bên kia của ổ cắm là địa chỉ nội bộ. Sau nginx
 * thì điều đó luôn đúng (container không mở cổng ra host), và nginx GHI ĐÈ
 * X-Real-IP bằng $remote_addr nên chuỗi client tự gửi bị vứt trước khi tới đây.
 * Chạy trần ngoài Internet thì điều kiện sai, và ta quay về địa chỉ ổ cắm —
 * thứ không giả được.
 */

export const REAL_IP_HEADER = 'x-real-ip';

/** Địa chỉ IPv4 hoặc IPv6 dạng gọn, không dấu cách, không dấu phẩy. */
const RE_PLAUSIBLE_IP = /^[0-9a-fA-F:.]{3,45}$/;

/** Bỏ vỏ "::ffff:" mà Node bọc quanh IPv4 khi ổ cắm chạy chế độ kép. */
export function normalizeIp(addr: string): string {
  const m = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(addr);
  return m ? m[1]! : addr;
}

/** Đúng khi địa chỉ nằm trong mạng riêng hoặc là chính máy này. */
export function isPrivateAddress(addr: string): boolean {
  const ip = normalizeIp(addr).toLowerCase();

  if (ip === '::1' || ip === 'localhost') return true;
  if (ip.startsWith('fd') || ip.startsWith('fc')) return true; // unique-local IPv6
  if (ip.startsWith('fe80:')) return true; // link-local IPv6

  const p = ip.split('.');
  if (p.length !== 4) return false;
  const [a, b] = [Number(p[0]), Number(p[1])];
  if (!Number.isInteger(a) || !Number.isInteger(b)) return false;

  if (a === 127 || a === 10) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 169 && b === 254) return true; // link-local IPv4
  return false;
}

export function clientIpFrom(
  peer: string | undefined,
  headers: Record<string, string | string[] | undefined>,
): string {
  if (!peer) return 'unknown';
  const socketIp = normalizeIp(peer);

  // Đầu kia là người lạ ngoài Internet -> không có proxy nào đáng tin ở giữa.
  if (!isPrivateAddress(socketIp)) return socketIp;

  const claimed = firstHeader(headers, REAL_IP_HEADER);
  if (!claimed || !RE_PLAUSIBLE_IP.test(claimed)) return socketIp;
  return normalizeIp(claimed);
}

function firstHeader(
  headers: Record<string, string | string[] | undefined>,
  name: string,
): string | undefined {
  for (const [k, v] of Object.entries(headers)) {
    if (k.toLowerCase() !== name) continue;
    const s = Array.isArray(v) ? v[0] : v;
    const t = (s ?? '').trim();
    if (t) return t;
  }
  return undefined;
}
