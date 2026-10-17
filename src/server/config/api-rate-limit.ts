export interface ApiRateLimitDecision {
  allowed: boolean;
  retryAfterSeconds: number;
}

interface WindowState {
  startedAt: number;
  count: number;
}

export class ApiRequestLimiter {
  private readonly clients = new Map<string, WindowState>();

  constructor(
    private readonly maxRequests = 120,
    private readonly windowMs = 60_000,
    private readonly maxTrackedClients = 256,
  ) {}

  consume(key: string, now = Date.now()): ApiRateLimitDecision {
    const state = this.clients.get(key);
    if (!state || now - state.startedAt >= this.windowMs || now < state.startedAt) {
      if (!state && this.clients.size >= this.maxTrackedClients) this.removeExpired(now);
      if (!state && this.clients.size >= this.maxTrackedClients) {
        return { allowed: false, retryAfterSeconds: 60 };
      }
      this.clients.set(key, { startedAt: now, count: 1 });
      return { allowed: true, retryAfterSeconds: 0 };
    }

    if (state.count >= this.maxRequests) {
      return {
        allowed: false,
        retryAfterSeconds: Math.max(1, Math.ceil((state.startedAt + this.windowMs - now) / 1000)),
      };
    }

    state.count += 1;
    return { allowed: true, retryAfterSeconds: 0 };
  }

  private removeExpired(now: number): void {
    for (const [key, state] of this.clients) {
      if (now - state.startedAt >= this.windowMs || now < state.startedAt) this.clients.delete(key);
    }
  }
}
