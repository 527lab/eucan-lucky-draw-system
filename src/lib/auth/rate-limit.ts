/**
 * 登入失敗速率限制：同一 key（IP）在視窗內最多 limit 次失敗，之後回 429。
 * 記憶體實作（單一 app 容器足夠）；時間由參數注入。
 */
export class LoginRateLimiter {
  private readonly failures = new Map<string, number[]>();

  constructor(
    private readonly limit = 5,
    private readonly windowMs = 60_000,
  ) {}

  private recent(key: string, nowMs: number): number[] {
    const list = (this.failures.get(key) ?? []).filter((t) => nowMs - t < this.windowMs);
    if (list.length === 0) this.failures.delete(key);
    else this.failures.set(key, list);
    return list;
  }

  /** 已達上限時回 retryAfterSeconds，否則 null。 */
  check(key: string, nowMs: number): { retryAfterSeconds: number } | null {
    const list = this.recent(key, nowMs);
    if (list.length < this.limit) return null;
    return { retryAfterSeconds: Math.max(1, Math.ceil((list[0] + this.windowMs - nowMs) / 1000)) };
  }

  recordFailure(key: string, nowMs: number): void {
    const list = this.recent(key, nowMs);
    list.push(nowMs);
    this.failures.set(key, list);
  }

  reset(key: string): void {
    this.failures.delete(key);
  }
}
