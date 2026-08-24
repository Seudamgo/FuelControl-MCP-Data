/**
 * Chốt kiểm địa chỉ đích trước khi MCP gửi API key đi đâu đó.
 *
 * Đây KHÔNG phải chống agent — agent không đặt được địa chỉ, nó nằm trong .env
 * do người vận hành điền. Thứ nó chặn là một cấu hình gõ sai hoặc bị sửa: một
 * chuỗi bí mật sống 12 tháng mà bay nhầm sang máy khác thì thu hồi cũng đã muộn.
 *
 * Giới hạn phải nói thẳng: hàm này chặn được ĐỊA CHỈ IP viết thẳng (kể cả cổng
 * metadata của nhà cung cấp máy chủ). Nó KHÔNG phân giải tên miền, nên một tên
 * miền trỏ về IP nội bộ vẫn lọt. Muốn chặn tới đó thì phải tra DNS mỗi lần gọi,
 * mà bản thân việc đó lại mở ra ca DNS rebinding — không đáng cho một cấu hình
 * người vận hành tự điền một lần.
 */

const PRIVATE_V4: Array<[string, number]> = [
  ['10.0.0.0', 8],
  ['172.16.0.0', 12],
  ['192.168.0.0', 16],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16], // gồm 169.254.169.254 — cổng metadata của máy chủ đám mây
  ['0.0.0.0', 8],
  ['100.64.0.0', 10], // CGNAT
];

const LOCAL_HOSTNAMES = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

export interface UrlVerdict {
  ok: boolean;
  reason?: string;
  /** Địa chỉ đã chuẩn hoá: bỏ dấu '/' thừa ở cuối. */
  normalized?: string;
}

function ipv4ToInt(ip: string): number | null {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  let out = 0;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const n = Number(part);
    if (n > 255) return null;
    out = out * 256 + n;
  }
  return out;
}

function inCidr(ip: string, base: string, bits: number): boolean {
  const a = ipv4ToInt(ip);
  const b = ipv4ToInt(base);
  if (a === null || b === null) return false;
  const mask = bits === 0 ? 0 : (-1 << (32 - bits)) >>> 0;
  return ((a & mask) >>> 0) === ((b & mask) >>> 0);
}

/** true khi hostname là một IP nội bộ viết thẳng (v4 hoặc vài dạng v6 hay gặp). */
export function isPrivateHost(hostname: string): boolean {
  const h = hostname.toLowerCase();
  if (h === '::1' || h === '[::1]') return true;
  if (h.startsWith('fd') || h.startsWith('[fd')) return true; // fd00::/8
  if (h.startsWith('fe80') || h.startsWith('[fe80')) return true; // link-local v6
  if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(h)) return false;
  return PRIVATE_V4.some(([base, bits]) => inCidr(h, base, bits));
}

export function validateBaseUrl(
  raw: string,
  opts: { allowInsecureLocal?: boolean } = {},
): UrlVerdict {
  const trimmed = raw.trim();
  if (!trimmed) return { ok: false, reason: 'FUELCONTROL_BASE_URL đang để trống' };

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return { ok: false, reason: `không phải một địa chỉ hợp lệ: "${trimmed}"` };
  }

  // Tên đăng nhập nhúng trong URL là dấu hiệu của một địa chỉ bị dán nhầm chỗ,
  // và nó sẽ đi kèm mọi request mà không ai thấy.
  if (url.username || url.password) {
    return { ok: false, reason: 'địa chỉ không được chứa user:password' };
  }
  if (url.search || url.hash) {
    return { ok: false, reason: 'địa chỉ gốc không được kèm query hay #fragment' };
  }

  const isLocal = LOCAL_HOSTNAMES.has(url.hostname.toLowerCase());

  if (url.protocol !== 'https:') {
    if (!(opts.allowInsecureLocal && isLocal && url.protocol === 'http:')) {
      return {
        ok: false,
        reason:
          'chỉ chấp nhận https:// — API key đi kèm mọi request, gửi qua http trần là ' +
          'ai đứng giữa cũng đọc được. Chạy backend ở máy mình thì bật ' +
          'FUELCONTROL_ALLOW_INSECURE_LOCAL=true.',
      };
    }
  }

  if (isPrivateHost(url.hostname) && !(opts.allowInsecureLocal && isLocal)) {
    return {
      ok: false,
      reason: `địa chỉ trỏ vào mạng nội bộ hoặc cổng metadata (${url.hostname})`,
    };
  }

  return { ok: true, normalized: trimmed.replace(/\/+$/, '') };
}
