import { describe, it, expect } from 'vitest';
import { isPrivateHost, validateBaseUrl } from '../src/networkPolicy.js';

describe('chặn địa chỉ đích nguy hiểm (skill §7.3)', () => {
  it.each([
    ['http://fleet.seudambite.com', 'http trần — key bay qua mạng dạng đọc được'],
    ['https://169.254.169.254', 'cổng metadata của máy chủ đám mây'],
    ['https://10.0.0.5', 'mạng nội bộ 10/8'],
    ['https://172.16.3.9', 'mạng nội bộ 172.16/12'],
    ['https://192.168.1.1', 'mạng nội bộ 192.168/16'],
    ['https://127.0.0.1', 'loopback khi chưa bật cờ dev'],
    ['https://[::1]', 'loopback IPv6'],
    ['https://user:pw@fleet.seudambite.com', 'nhúng mật khẩu trong URL'],
    ['https://fleet.seudambite.com/api?key=x', 'kèm query ở địa chỉ gốc'],
    ['ftp://fleet.seudambite.com', 'giao thức không phải https'],
    ['không-phải-url', 'chuỗi rác'],
    ['', 'để trống'],
  ])('từ chối %s (%s)', (url) => {
    expect(validateBaseUrl(url).ok).toBe(false);
  });

  it('nhận địa chỉ prod', () => {
    const v = validateBaseUrl('https://fleet.seudambite.com');
    expect(v.ok).toBe(true);
    expect(v.normalized).toBe('https://fleet.seudambite.com');
  });

  it('cắt dấu / thừa ở cuối để ghép đường dẫn không ra //', () => {
    expect(validateBaseUrl('https://fleet.seudambite.com///').normalized).toBe('https://fleet.seudambite.com');
  });

  it('chỉ mở localhost khi bật cờ dev, và chỉ đúng localhost', () => {
    expect(validateBaseUrl('http://localhost:8080', { allowInsecureLocal: true }).ok).toBe(true);
    expect(validateBaseUrl('http://127.0.0.1:8080', { allowInsecureLocal: true }).ok).toBe(true);

    // Cờ dev KHÔNG được nới ra cả mạng nội bộ — đó là chỗ dễ trượt tay nhất:
    // "cho localhost đi" rất dễ thành "cho mọi IP riêng đi".
    expect(validateBaseUrl('http://10.0.0.5', { allowInsecureLocal: true }).ok).toBe(false);
    expect(validateBaseUrl('http://169.254.169.254', { allowInsecureLocal: true }).ok).toBe(false);
  });

  it('co dev bat + https van khong mo duong vao mang noi bo', () => {
    // Bài trên một mình KHÔNG canh được điều nó nói: http bị chốt giao thức
    // chặn trước, nên chốt mạng nội bộ chưa bao giờ được chạm tới. Đổi
    // isPrivateHost thành "bỏ qua khi bật cờ dev" thì bài trên vẫn xanh.
    // Dùng https ở đây để đi thẳng vào đúng chốt cần canh.
    expect(validateBaseUrl('https://10.0.0.5', { allowInsecureLocal: true }).ok).toBe(false);
    expect(validateBaseUrl('https://169.254.169.254', { allowInsecureLocal: true }).ok).toBe(false);
    expect(validateBaseUrl('https://192.168.1.1', { allowInsecureLocal: true }).ok).toBe(false);
  });

  it('cờ dev không mở đường cho http ra Internet', () => {
    expect(validateBaseUrl('http://fleet.seudambite.com', { allowInsecureLocal: true }).ok).toBe(false);
  });
});

describe('isPrivateHost', () => {
  it('phân biệt IP nội bộ với IP công cộng', () => {
    expect(isPrivateHost('10.255.255.255')).toBe(true);
    expect(isPrivateHost('172.31.0.1')).toBe(true);
    expect(isPrivateHost('172.32.0.1')).toBe(false); // ngay ngoài rìa 172.16/12
    expect(isPrivateHost('11.0.0.1')).toBe(false);
    expect(isPrivateHost('8.8.8.8')).toBe(false);
    expect(isPrivateHost('fleet.seudambite.com')).toBe(false);
  });
});
