import { AppError } from '../common/errors';

interface Options {
  cooldownMs: number;
  perDestinationPerHour: number;
  perIpPerHour: number;
  now?: () => number;
}

/**
 * In-memory OTP send limits (design §5.1): 60 s cooldown and 5/hour per destination, 20/hour per IP.
 * Single process in v1, so memory is enough. A restart resets it, which only loosens the limit briefly.
 */
export class OtpLimiter {
  private readonly byDestination = new Map<string, number[]>();
  private readonly byIp = new Map<string, number[]>();
  private readonly now: () => number;

  constructor(private readonly opts: Options = { cooldownMs: 60_000, perDestinationPerHour: 5, perIpPerHour: 20 }) {
    this.now = opts.now ?? Date.now;
  }

  /** Throws RATE_LIMITED and records nothing when over a limit; otherwise records the send. */
  check(destination: string, ip: string): void {
    const t = this.now();
    const dest = this.recent(this.byDestination, destination.toLowerCase(), t);
    const ips = this.recent(this.byIp, ip, t);
    const last = dest[dest.length - 1];
    if (last !== undefined && t - last < this.opts.cooldownMs) {
      throw this.limited(Math.ceil((this.opts.cooldownMs - (t - last)) / 1000));
    }
    if (dest.length >= this.opts.perDestinationPerHour) throw this.limited(Math.ceil((3_600_000 - (t - dest[0]!)) / 1000));
    if (ips.length >= this.opts.perIpPerHour) throw this.limited(Math.ceil((3_600_000 - (t - ips[0]!)) / 1000));
    dest.push(t);
    ips.push(t);
  }

  private recent(map: Map<string, number[]>, key: string, t: number): number[] {
    const list = (map.get(key) ?? []).filter((x) => t - x < 3_600_000);
    map.set(key, list);
    return list;
  }

  private limited(retryAfterSeconds: number) {
    return new AppError('RATE_LIMITED', 429, 'Too many codes requested', { retryAfterSeconds });
  }
}
