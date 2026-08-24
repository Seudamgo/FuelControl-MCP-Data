import { describe, it, expect } from 'vitest';
import { RateLimiter } from '../src/rateLimit.js';

describe('phanh gọi API (skill §8.1)', () => {
  it('cho phép hỏi dồn đúng bằng mức bùng nổ', () => {
    const rl = new RateLimiter(60, 5, () => 0);
    for (let i = 0; i < 5; i++) expect(rl.take().allowed).toBe(true);
  });

  it('chặn khi vượt mức bùng nổ và nói phải chờ bao lâu', () => {
    const rl = new RateLimiter(60, 3, () => 0);
    for (let i = 0; i < 3; i++) rl.take();
    const v = rl.take();
    expect(v.allowed).toBe(false);
    expect(v.retryAfterMs).toBeGreaterThan(0);
  });

  it('gáo tự đầy lại theo thời gian', () => {
    let now = 0;
    const rl = new RateLimiter(60, 2, () => now);
    rl.take();
    rl.take();
    expect(rl.take().allowed).toBe(false);

    now = 1000; // 60/phút = 1 token mỗi giây
    expect(rl.take().allowed).toBe(true);
  });

  it('không tích luỹ quá mức bùng nổ dù để lâu', () => {
    // Không có trần này thì im lặng một giờ rồi bung ra 60 request một lúc —
    // đúng cái đợt dồn mà phanh sinh ra để chặn.
    let now = 0;
    const rl = new RateLimiter(60, 3, () => now);
    now = 3_600_000;
    let allowed = 0;
    for (let i = 0; i < 10; i++) if (rl.take().allowed) allowed += 1;
    expect(allowed).toBe(3);
  });
});
