import db from "../db.server";

/** A database-backed fixed-window limiter shared by every app instance. */
export async function isRateLimited(
  key: string,
  maxRequests: number,
  windowMs: number,
): Promise<boolean> {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + windowMs);

  const bucket = await db.$transaction(async (tx) => {
    const existing = await tx.rateLimitBucket.findUnique({ where: { key } });
    if (!existing || existing.expiresAt <= now) {
      return tx.rateLimitBucket.upsert({
        where: { key },
        create: { key, count: 1, windowStart: now, expiresAt },
        update: { count: 1, windowStart: now, expiresAt },
      });
    }

    return tx.rateLimitBucket.update({
      where: { key },
      data: { count: { increment: 1 } },
    });
  });

  return bucket.count > maxRequests;
}

// Single-value client-IP headers set by the edge/CDN. These are written by the
// infrastructure (not the client), so they are trustworthy when present —
// unlike the left-most x-forwarded-for entry, which the caller controls.
const TRUSTED_IP_HEADERS = [
  "cf-connecting-ip",
  "true-client-ip",
  "fly-client-ip",
  "x-real-ip",
];

export function clientIpFromRequest(request: Request): string {
  for (const header of TRUSTED_IP_HEADERS) {
    const value = request.headers.get(header)?.trim();
    if (value) return value;
  }
  // Fall back to x-forwarded-for. The left-most entry is client-supplied and
  // spoofable; the right-most is the one appended by the closest trusted proxy,
  // so prefer that. Callers should additionally scope the bucket key (e.g. by
  // shop) so an absent/duplicated IP can't lock out unrelated traffic.
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    const parts = forwarded.split(",").map((p) => p.trim()).filter(Boolean);
    if (parts.length) return parts[parts.length - 1]!;
  }
  return "unknown";
}
