// Small Riot API client: routing, rate limits and errors.
//
// Riot gives every key a budget per routing value (e.g. 20 requests per second and 100 per two
// minutes on each of tr1, euw1, europe, asia, …). People waiting for a post-game card always go
// first; the background stats collector only uses what's left and keeps a reserve free for them.

export type Priority = 'interactive' | 'background';

export class RiotError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

/** tr1 / euw1 / eun1 / ru → europe, na1 → americas, … (used by match-v5 and account-v1). */
export function regionOf(platform: string): 'europe' | 'americas' | 'asia' | 'sea' {
  const p = platform.toLowerCase();
  if (['euw1', 'eun1', 'tr1', 'ru', 'me1'].includes(p)) return 'europe';
  if (['na1', 'br1', 'la1', 'la2'].includes(p)) return 'americas';
  if (['kr', 'jp1'].includes(p)) return 'asia';
  return 'sea';
}

/** "TR1_123456" → "tr1" */
export const platformOfMatch = (matchId: string) => matchId.split('_')[0]!.toLowerCase();

interface Window {
  limit: number;
  ms: number;
  stamps: number[];
}

/** Parses Riot's "20:1,100:120" (requests:seconds) limit header. */
export function parseLimits(header: string | null | undefined): { limit: number; ms: number }[] | null {
  if (!header) return null;
  const out = header
    .split(',')
    .map((part) => part.split(':').map(Number))
    .filter(([n, s]) => Number.isFinite(n) && Number.isFinite(s) && n! > 0 && s! > 0)
    .map(([n, s]) => ({ limit: n!, ms: s! * 1000 }));
  return out.length ? out : null;
}

export class RateLimiter {
  private windows: Window[];
  private pausedUntil = 0;

  constructor(
    limits = [
      { limit: 20, ms: 1000 },
      { limit: 100, ms: 120_000 },
    ],
    /** Share of each window the background collector may use. */
    private backgroundShare = 0.7,
    private now = () => Date.now(),
  ) {
    this.windows = limits.map((l) => ({ ...l, stamps: [] }));
  }

  /** Adopt the limits Riot reports for this key (they differ between key types). */
  update(limits: { limit: number; ms: number }[] | null) {
    if (!limits) return;
    const same =
      limits.length === this.windows.length && limits.every((l, i) => l.limit === this.windows[i]!.limit && l.ms === this.windows[i]!.ms);
    if (same) return;
    const old = this.windows;
    this.windows = limits.map((l) => ({ ...l, stamps: old.find((w) => w.ms === l.ms)?.stamps ?? [] }));
  }

  pause(ms: number) {
    this.pausedUntil = Math.max(this.pausedUntil, this.now() + ms);
  }

  /** How long to wait before a request of this priority may go out (0 = now). */
  delay(priority: Priority): number {
    const t = this.now();
    if (this.pausedUntil > t) return this.pausedUntil - t;
    let wait = 0;
    for (const w of this.windows) {
      while (w.stamps.length && w.stamps[0]! <= t - w.ms) w.stamps.shift();
      const cap = priority === 'interactive' ? w.limit : Math.max(1, Math.floor(w.limit * this.backgroundShare));
      if (w.stamps.length >= cap) wait = Math.max(wait, w.stamps[w.stamps.length - cap]! + w.ms - t + 1);
    }
    return wait;
  }

  record() {
    const t = this.now();
    for (const w of this.windows) w.stamps.push(t);
  }

  async acquire(priority: Priority) {
    for (;;) {
      const wait = this.delay(priority);
      if (wait <= 0) return this.record();
      await new Promise((r) => setTimeout(r, Math.min(wait, 5000)));
    }
  }
}

export interface RiotClientOptions {
  apiKey: string;
  /** Test override: every request goes to `${base}/${host}/path` instead of https://host.api.riotgames.com/path */
  apiBase?: string | null;
  /** One limiter for every host (tests); by default each host gets its own, like Riot counts them. */
  limiter?: RateLimiter;
  fetchImpl?: typeof fetch;
}

export class RiotClient {
  private limiters = new Map<string, RateLimiter>();
  private fetchImpl: typeof fetch;

  constructor(private opts: RiotClientOptions) {
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  /** Rate limits are counted per routing value: "tr1" and "europe" each have their own budget. */
  limiterFor(host: string): RateLimiter {
    if (this.opts.limiter) return this.opts.limiter;
    let l = this.limiters.get(host);
    if (!l) this.limiters.set(host, (l = new RateLimiter()));
    return l;
  }

  private url(host: string, path: string) {
    return this.opts.apiBase ? `${this.opts.apiBase}/${host}${path}` : `https://${host}.api.riotgames.com${path}`;
  }

  /** GET JSON from a Riot host ("euw1", "europe", …). Retries once after a 429 or a 5xx. */
  async get<T>(host: string, path: string, priority: Priority = 'interactive'): Promise<T> {
    const limiter = this.limiterFor(host);
    for (let attempt = 0; ; attempt++) {
      await limiter.acquire(priority);
      let res: Response;
      try {
        res = await this.fetchImpl(this.url(host, path), {
          headers: { 'X-Riot-Token': this.opts.apiKey, accept: 'application/json' },
          signal: AbortSignal.timeout(10_000),
        });
      } catch (err) {
        if (attempt < 1) continue;
        throw new RiotError(0, `Riot API unreachable: ${(err as Error).message}`);
      }
      limiter.update(parseLimits(res.headers.get('x-app-rate-limit')));
      if (res.status === 429) {
        const retry = Number(res.headers.get('retry-after') ?? 5);
        limiter.pause((Number.isFinite(retry) ? retry : 5) * 1000);
        if (attempt < 2) continue;
      }
      if (res.status >= 500 && attempt < 1) {
        await new Promise((r) => setTimeout(r, 1000));
        continue;
      }
      if (!res.ok) throw new RiotError(res.status, `Riot API ${res.status} for ${path.split('?')[0]}`);
      return (await res.json()) as T;
    }
  }
}
