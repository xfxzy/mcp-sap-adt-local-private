export class RateLimiter {
  private readonly starts: number[] = [];
  private queue: Promise<void> = Promise.resolve();

  constructor(
    private readonly limit: number,
    private readonly windowMs = 60_000,
    private readonly now: () => number = () => Date.now(),
    private readonly sleep: (milliseconds: number) => Promise<void> = (
      milliseconds,
    ) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
  ) {
    if (!Number.isInteger(limit) || limit < 1) {
      throw new Error("Rate limit must be a positive integer");
    }
  }

  acquire(): Promise<void> {
    const next = this.queue.then(() => this.acquireSlot());
    this.queue = next.catch(() => undefined);
    return next;
  }

  private async acquireSlot(): Promise<void> {
    let current = this.now();
    this.discardOld(current);
    if (this.starts.length >= this.limit) {
      const delay = Math.max(0, this.starts[0] + this.windowMs - current);
      await this.sleep(delay);
      current = this.now();
      this.discardOld(current);
    }
    this.starts.push(current);
  }

  private discardOld(current: number): void {
    while (
      this.starts.length > 0 &&
      current - this.starts[0] >= this.windowMs
    ) {
      this.starts.shift();
    }
  }
}
