import { describe, expect, it } from 'vitest';
import { clientIpFrom, isPrivateAddress, normalizeIp } from '../src/clientIp.js';

describe('normalizeIp', () => {
  it('bo vo ::ffff: quanh IPv4', () => {
    expect(normalizeIp('::ffff:172.19.0.8')).toBe('172.19.0.8');
  });

  it('de nguyen IPv6 that', () => {
    expect(normalizeIp('2001:db8::1')).toBe('2001:db8::1');
  });
});

describe('isPrivateAddress', () => {
  it.each([
    ['127.0.0.1', true],
    ['::1', true],
    ['10.1.2.3', true],
    ['172.19.0.8', true], // dai Docker mac dinh
    ['172.16.0.1', true],
    ['172.31.255.254', true],
    ['192.168.1.1', true],
    ['169.254.1.1', true],
    ['fd00::1', true],
    // Ranh gioi 172.16-31: hai dau NGOAI dai phai la cong khai. Thieu chot nay
    // thi mot dai cong khai that bi coi la noi bo va header gia duoc tin.
    ['172.15.0.1', false],
    ['172.32.0.1', false],
    ['8.8.8.8', false],
    ['203.0.113.7', false],
    ['2001:db8::1', false],
  ])('%s -> %s', (ip, want) => {
    expect(isPrivateAddress(ip)).toBe(want);
  });
});

describe('clientIpFrom', () => {
  it('sau nginx thi lay dia chi that trong header', () => {
    expect(clientIpFrom('::ffff:172.19.0.8', { 'x-real-ip': '203.0.113.7' })).toBe('203.0.113.7');
  });

  it('nginx khong gui header thi quay ve dia chi o cam', () => {
    expect(clientIpFrom('::ffff:172.19.0.8', {})).toBe('172.19.0.8');
  });

  it('nguoi la ngoai Internet KHONG tu khai duoc dia chi', () => {
    // Chay tran khong co proxy: header la chuoi client tu gui, tin no la cho
    // ho tu chon gao phanh va tu viet nhat ky kiem toan cua chinh minh.
    expect(clientIpFrom('203.0.113.7', { 'x-real-ip': '10.0.0.1' })).toBe('203.0.113.7');
  });

  it('header rac thi bo qua, khong ghi rac vao log', () => {
    expect(clientIpFrom('172.19.0.8', { 'x-real-ip': 'khong phai ip' })).toBe('172.19.0.8');
    expect(clientIpFrom('172.19.0.8', { 'x-real-ip': '1.1.1.1, 2.2.2.2' })).toBe('172.19.0.8');
  });

  it('doc header khong phan biet hoa thuong', () => {
    expect(clientIpFrom('172.19.0.8', { 'X-Real-IP': '203.0.113.7' })).toBe('203.0.113.7');
  });

  it('khong co o cam thi noi thang la khong biet', () => {
    expect(clientIpFrom(undefined, { 'x-real-ip': '203.0.113.7' })).toBe('unknown');
  });
});
