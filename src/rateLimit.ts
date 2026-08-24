/**
 * Phanh cho chính mình.
 *
 * Đầu kia của MCP là một API đang phục vụ người thật đứng ở quầy. Một vòng lặp
 * hỏng của agent ("hỏi lại cho chắc" 400 lần) không được phép biến thành một
 * đợt tấn công vô tình vào đó. Gáo nước (token bucket) cho phép hỏi dồn vài câu
 * liên tiếp — đúng nhịp người dùng thật — rồi mới siết lại.
 */

export interface RateVerdict {
  allowed: boolean;
  retryAfterMs?: number;
}

export class RateLimiter {
  private tokens: number;
  private lastRefill: number;

  constructor(
    private readonly perMinute: number,
    private readonly burst: number,
    private readonly now: () => number = Date.now,
  ) {
    this.tokens = burst;
    this.lastRefill = now();
  }

  take(): RateVerdict {
    const t = this.now();
    const elapsed = Math.max(0, t - this.lastRefill);
    this.tokens = Math.min(this.burst, this.tokens + (elapsed / 60_000) * this.perMinute);
    this.lastRefill = t;

    if (this.tokens < 1) {
      const waitMs = Math.ceil(((1 - this.tokens) / this.perMinute) * 60_000);
      return { allowed: false, retryAfterMs: waitMs };
    }
    this.tokens -= 1;
    return { allowed: true };
  }
}
