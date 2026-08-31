-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_MerchantSettings" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "badgesEnabled" BOOLEAN NOT NULL DEFAULT true,
    "badgeStyle" TEXT NOT NULL DEFAULT 'classic',
    "showOnProduct" BOOLEAN NOT NULL DEFAULT true,
    "showOnCart" BOOLEAN NOT NULL DEFAULT true,
    "protectionPayer" TEXT NOT NULL DEFAULT 'customer',
    "enabledClaimTypes" TEXT NOT NULL DEFAULT 'lost,damaged,stolen,shortage,concealed,wrong_item',
    "claimWindows" TEXT NOT NULL DEFAULT '{"lost":{"minDays":0,"maxDays":30},"damaged":{"minDays":0,"maxDays":7},"stolen":{"minDays":3,"maxDays":15},"shortage":{"minDays":0,"maxDays":7},"concealed":{"minDays":0,"maxDays":14},"wrong_item":{"minDays":0,"maxDays":14}}',
    "protectionFeeType" TEXT NOT NULL DEFAULT 'flat',
    "protectionFlatFeeCents" INTEGER NOT NULL DEFAULT 299,
    "protectionPercentBasisPoints" INTEGER NOT NULL DEFAULT 200,
    "protectionMinFeeCents" INTEGER NOT NULL DEFAULT 99,
    "protectionMaxFeeCents" INTEGER NOT NULL DEFAULT 999,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_MerchantSettings" ("badgeStyle", "badgesEnabled", "claimWindows", "createdAt", "enabledClaimTypes", "id", "protectionPayer", "shop", "showOnCart", "showOnProduct", "updatedAt") SELECT "badgeStyle", "badgesEnabled", "claimWindows", "createdAt", "enabledClaimTypes", "id", "protectionPayer", "shop", "showOnCart", "showOnProduct", "updatedAt" FROM "MerchantSettings";
DROP TABLE "MerchantSettings";
ALTER TABLE "new_MerchantSettings" RENAME TO "MerchantSettings";
CREATE UNIQUE INDEX "MerchantSettings_shop_key" ON "MerchantSettings"("shop");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
