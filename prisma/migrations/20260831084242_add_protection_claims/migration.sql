-- CreateTable
CREATE TABLE "ProtectionClaim" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "orderNumber" TEXT NOT NULL,
    "confirmationCode" TEXT,
    "fullName" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "issueType" TEXT NOT NULL,
    "details" TEXT,
    "status" TEXT NOT NULL DEFAULT 'submitted',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE INDEX "ProtectionClaim_shop_idx" ON "ProtectionClaim"("shop");
