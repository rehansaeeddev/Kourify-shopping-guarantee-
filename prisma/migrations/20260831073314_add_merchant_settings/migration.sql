-- CreateTable
CREATE TABLE "MerchantSettings" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "badgesEnabled" BOOLEAN NOT NULL DEFAULT true,
    "badgeStyle" TEXT NOT NULL DEFAULT 'classic',
    "showOnProduct" BOOLEAN NOT NULL DEFAULT true,
    "showOnCart" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "MerchantSettings_shop_key" ON "MerchantSettings"("shop");
