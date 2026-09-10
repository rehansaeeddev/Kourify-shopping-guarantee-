-- Coverage eligibility ceiling (per-item unit value, ex shipping/tax).
-- NULL = merchant has set no ceiling; no monetary default is implied.
ALTER TABLE `MerchantSettings` ADD COLUMN `maxEligibleItemValueCents` INT NULL;

-- Merchandise value coverage is assessed against, and a snapshot of the
-- ceiling in force when the order was protected.
ALTER TABLE `ProtectedOrder` ADD COLUMN `coveredMerchandiseCents` INT NOT NULL DEFAULT 0;
ALTER TABLE `ProtectedOrder` ADD COLUMN `maxEligibleItemValueCents` INT NULL;

-- Item-level coverage rows.
CREATE TABLE `ProtectedOrderItem` (
  `id` VARCHAR(191) NOT NULL,
  `shop` VARCHAR(191) NOT NULL,
  `protectedOrderId` VARCHAR(191) NOT NULL,
  `lineItemId` VARCHAR(191) NOT NULL,
  `title` VARCHAR(191) NOT NULL,
  `variantId` VARCHAR(191) NULL,
  `sku` VARCHAR(191) NULL,
  `quantity` INT NOT NULL,
  `unitPriceCents` INT NOT NULL,
  `eligible` BOOLEAN NOT NULL DEFAULT true,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  UNIQUE INDEX `ProtectedOrderItem_protectedOrderId_lineItemId_key` (`protectedOrderId`, `lineItemId`),
  INDEX `ProtectedOrderItem_shop_idx` (`shop`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `ProtectedOrderItem`
  ADD CONSTRAINT `ProtectedOrderItem_protectedOrderId_fkey`
  FOREIGN KEY (`protectedOrderId`) REFERENCES `ProtectedOrder`(`id`)
  ON DELETE CASCADE ON UPDATE CASCADE;

-- Claim becomes item-level and carries the merchant's settlement decision.
ALTER TABLE `ProtectionClaim` ADD COLUMN `protectedOrderId` VARCHAR(191) NULL;
ALTER TABLE `ProtectionClaim` ADD COLUMN `protectedItemId` VARCHAR(191) NULL;
ALTER TABLE `ProtectionClaim` ADD COLUMN `claimedQuantity` INT NULL;
ALTER TABLE `ProtectionClaim` ADD COLUMN `itemValueCents` INT NULL;
ALTER TABLE `ProtectionClaim` ADD COLUMN `eligibleLossCents` INT NULL;
ALTER TABLE `ProtectionClaim` ADD COLUMN `settlementCents` INT NULL;
ALTER TABLE `ProtectionClaim` ADD COLUMN `decisionNote` TEXT NULL;

CREATE INDEX `ProtectionClaim_protectedOrderId_idx` ON `ProtectionClaim`(`protectedOrderId`);
CREATE INDEX `ProtectionClaim_protectedItemId_idx` ON `ProtectionClaim`(`protectedItemId`);
