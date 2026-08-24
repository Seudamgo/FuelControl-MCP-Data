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

/**
 * Một gáo nước cho MỖI chìa khoá (skill §8.1).
 *
 * Bản RateLimiter ở trên đếm theo TIẾN TRÌNH, và đó là đúng cho transport stdio:
 * ở đó một tiến trình phục vụ đúng một người. Với transport HTTP thì cùng một
 * tiến trình phục vụ nhiều người, và phanh chung nghĩa là một agent hỏng của
 * người này khoá luôn cửa của người kia — nó biến một sự cố thành một sự cố
 * chung, đúng thứ phanh sinh ra để ngăn.
 */
export class RateLimiterRegistry {
  private readonly buckets = new Map<string, RateLimiter>();

  constructor(
    private readonly perMinute: number,
    private readonly burst: number,
    private readonly now: () => number = Date.now,
    /**
     * Trần số gáo giữ trong bộ nhớ.
     *
     * Có vì khoá của Map tới từ header do người ngoài gửi: không có trần thì một
     * kẻ gửi hàng triệu key bịa sẽ làm phình bộ nhớ cho tới khi tiến trình chết —
     * chính phanh chống-quá-tải trở thành đường quá tải.
     */
    private readonly maxBuckets = 10_000,
  ) {}

  take(clientId: string): RateVerdict {
    let bucket = this.buckets.get(clientId);
    if (!bucket) {
      // Đầy thì dọn sạch thay vì đuổi từng cái theo LRU. Ở quy mô này (một
      // resort, vài chìa khoá) trần không bao giờ chạm tới trong lúc dùng thật;
      // chạm tới nghĩa là đang bị dội key rác, và lúc ấy một lần dọn đơn giản
      // đúng hơn là một cấu trúc LRU phải tự bảo trì mãi mãi.
      if (this.buckets.size >= this.maxBuckets) this.buckets.clear();
      bucket = new RateLimiter(this.perMinute, this.burst, this.now);
      this.buckets.set(clientId, bucket);
    }
    return bucket.take();
  }

  /** Số gáo đang giữ — chỉ dùng cho test và cho /health. */
  size(): number {
    return this.buckets.size;
  }
}
