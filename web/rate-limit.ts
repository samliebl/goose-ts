/**
 * Minimal in-memory sliding-window rate limiter. Scoped to a single
 * process, which is fine here -- this app runs as one small Fly machine,
 * not a fleet, and a limiter that resets on restart is an acceptable
 * tradeoff against pulling in a dependency (or a shared store) for
 * something this small.
 */
export function createRateLimiter(maxRequests: number, windowMs: number) {
  const hits = new Map<string, number[]>();

  // Periodic sweep so keys for IPs that stop showing up don't sit in
  // memory forever. unref() so this timer never keeps the process alive on
  // its own -- auto-stop should still be able to sleep an idle machine.
  setInterval(
    () => {
      const now = Date.now();
      for (const [key, timestamps] of hits) {
        const recent = timestamps.filter((t) => now - t < windowMs);
        if (recent.length === 0) hits.delete(key);
        else hits.set(key, recent);
      }
    },
    Math.max(windowMs, 60_000),
  ).unref();

  return function isAllowed(key: string): boolean {
    const now = Date.now();
    const timestamps = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
    timestamps.push(now);
    hits.set(key, timestamps);
    return timestamps.length <= maxRequests;
  };
}
