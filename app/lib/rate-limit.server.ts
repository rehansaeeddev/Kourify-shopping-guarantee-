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

export function clientIpFromRequest(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]!.trim();
  return "unknown";
}
