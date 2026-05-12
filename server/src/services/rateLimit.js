// Simple in-memory token bucket per (userId, bucketName).
const buckets = new Map();

export function allow(userId, bucketName = "chat", max = 30, windowMs = 10_000) {
  const key = `${userId}:${bucketName}`;
  const now = Date.now();
  const b = buckets.get(key) || { tokens: max, resetAt: now + windowMs };
  if (now > b.resetAt) {
    b.tokens = max;
    b.resetAt = now + windowMs;
  }
  if (b.tokens <= 0) {
    buckets.set(key, b);
    return false;
  }
  b.tokens -= 1;
  buckets.set(key, b);
  return true;
}
