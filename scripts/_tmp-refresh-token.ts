import "dotenv/config";
import shopify from "../app/shopify.server";
import db from "../app/db.server";

async function main() {
  const shop = "oveelab.myshopify.com";
  const stored = await db.session.findUniqueOrThrow({ where: { id: `offline_${shop}` } });
  if (!stored.refreshToken) throw new Error("No refresh token stored.");

  const { session } = await (shopify as any).api.auth.refreshToken({
    shop,
    refreshToken: stored.refreshToken,
  });

  console.log("refreshed session:", {
    accessTokenPrefix: session.accessToken?.slice(0, 8),
    expires: session.expires,
  });

  await db.session.update({
    where: { id: stored.id },
    data: {
      accessToken: session.accessToken!,
      expires: session.expires ?? null,
      refreshToken: (session as any).refreshToken ?? stored.refreshToken,
      refreshTokenExpires: (session as any).refreshTokenExpires ?? stored.refreshTokenExpires,
    },
  });
  console.log("persisted refreshed token to DB");
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
