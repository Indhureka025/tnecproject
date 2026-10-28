/**
 * Tiny in-process metrics registry. Prometheus text exposition on /metrics.
 * A real deployment would use prom-client + a scrape target; this keeps the
 * dependency surface small while making the numbers visible.
 */
class Metrics {
  private counters = new Map<string, number>();
  private hist = new Map<string, { count: number; sum: number; max: number }>();

  inc(name: string, by = 1): void {
    this.counters.set(name, (this.counters.get(name) ?? 0) + by);
  }

  observe(name: string, ms: number): void {
    const h = this.hist.get(name) ?? { count: 0, sum: 0, max: 0 };
    h.count += 1;
    h.sum += ms;
    h.max = Math.max(h.max, ms);
    this.hist.set(name, h);
  }

  /** returns a stop() fn that records elapsed ms */
  timer(name: string): () => void {
    const start = performance.now();
    return () => this.observe(name, performance.now() - start);
  }

  snapshot(): { counters: Record<string, number>; timings: Record<string, { count: number; avgMs: number; maxMs: number }> } {
    const timings: Record<string, { count: number; avgMs: number; maxMs: number }> = {};
    for (const [k, v] of this.hist) timings[k] = { count: v.count, avgMs: v.count ? +(v.sum / v.count).toFixed(1) : 0, maxMs: +v.max.toFixed(1) };
    return { counters: Object.fromEntries(this.counters), timings };
  }

  prometheus(): string {
    const lines: string[] = [];
    for (const [k, v] of this.counters) lines.push(`ec_${k} ${v}`);
    for (const [k, v] of this.hist) {
      lines.push(`ec_${k}_count ${v.count}`);
      lines.push(`ec_${k}_sum_ms ${v.sum.toFixed(1)}`);
      lines.push(`ec_${k}_max_ms ${v.max.toFixed(1)}`);
    }
    return lines.join("\n") + "\n";
  }

  reset(): void {
    this.counters.clear();
    this.hist.clear();
  }
}

export const metrics = new Metrics();
