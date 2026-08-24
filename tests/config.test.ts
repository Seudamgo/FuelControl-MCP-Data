import { describe, it, expect } from 'vitest';
import { loadConfig } from '../src/config.js';
import { FuelControlError } from '../src/errors.js';

const base = {
  FUELCONTROL_BASE_URL: 'https://fleet.seudambite.com',
  FUELCONTROL_API_KEY: 'fc_abcd1234_secret',
} as NodeJS.ProcessEnv;

describe('doc cau hinh', () => {
  it('cau hinh toi thieu chay duoc, phan con lai co mac dinh', () => {
    const cfg = loadConfig(base);
    expect(cfg.baseUrl).toBe('https://fleet.seudambite.com');
    expect(cfg.timeoutMs).toBe(15_000);
    expect(cfg.ratePerMinute).toBe(30);
    expect(cfg.rateBurst).toBe(10);
  });

  it('thieu API key thi noi ro lay key o dau', () => {
    // Câu lỗi phải dẫn tới hành động tiếp theo. "missing config" trần khiến
    // người đọc đi mò, mà đường lấy key thì không đoán ra được.
    let err: FuelControlError | undefined;
    try {
      loadConfig({ FUELCONTROL_BASE_URL: base.FUELCONTROL_BASE_URL });
    } catch (e) {
      err = e as FuelControlError;
    }
    expect(err?.kind).toBe('config');
    expect(err?.message).toContain('API key');
    expect(err?.message).toContain('read');
  });

  it('key toan khoang trang cung la thieu key', () => {
    expect(() => loadConfig({ ...base, FUELCONTROL_API_KEY: '   ' })).toThrow(FuelControlError);
  });

  it('dia chi http tran bi tu choi', () => {
    expect(() => loadConfig({ ...base, FUELCONTROL_BASE_URL: 'http://fleet.seudambite.com' })).toThrow(
      FuelControlError,
    );
  });

  it('co dev phai la dung chu true, khong phai bat ky chuoi nao', () => {
    // "false" hay "0" mà mở cửa được thì cái cờ này thành vô nghĩa.
    expect(() =>
      loadConfig({ ...base, FUELCONTROL_BASE_URL: 'http://localhost:8080', FUELCONTROL_ALLOW_INSECURE_LOCAL: 'false' }),
    ).toThrow(FuelControlError);
    expect(() =>
      loadConfig({ ...base, FUELCONTROL_BASE_URL: 'http://localhost:8080', FUELCONTROL_ALLOW_INSECURE_LOCAL: '0' }),
    ).toThrow(FuelControlError);
    expect(
      loadConfig({ ...base, FUELCONTROL_BASE_URL: 'http://localhost:8080', FUELCONTROL_ALLOW_INSECURE_LOCAL: 'TRUE' })
        .baseUrl,
    ).toBe('http://localhost:8080');
  });

  it.each(['abc', '-5', '0', '999999999', '1.5'])('so tuy chon sai thi bao loi ngay: %s', (raw) => {
    // Chết lúc khởi động còn hơn chạy với một giá trị vô nghĩa rồi hỏng lệch chỗ.
    expect(() => loadConfig({ ...base, FUELCONTROL_TIMEOUT_MS: raw })).toThrow(FuelControlError);
  });

  it('so tuy chon hop le duoc dung', () => {
    expect(loadConfig({ ...base, FUELCONTROL_TIMEOUT_MS: '5000' }).timeoutMs).toBe(5000);
  });
});
