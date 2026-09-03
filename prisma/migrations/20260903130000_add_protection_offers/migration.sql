CREATE TABLE `ProtectionOffer` (
  `id` VARCHAR(191) NOT NULL,
  `shop` VARCHAR(191) NOT NULL,
  `originalOrderId` VARCHAR(191) NOT NULL,
  `originalOrderName` VARCHAR(191) NOT NULL,
  `customerEmail` VARCHAR(191) NOT NULL,
  `tokenHash` VARCHAR(191) NOT NULL,
  `status` VARCHAR(191) NOT NULL DEFAULT 'offer_sent',
  `protectionPriceCents` INTEGER NOT NULL,
  `currency` VARCHAR(191) NOT NULL,
  `protectionPurchaseId` VARCHAR(191) NULL,
  `expiresAt` DATETIME(3) NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  UNIQUE INDEX `ProtectionOffer_tokenHash_key`(`tokenHash`),
  INDEX `ProtectionOffer_shop_status_createdAt_idx`(`shop`, `status`, `createdAt`),
  INDEX `ProtectionOffer_shop_originalOrderId_idx`(`shop`, `originalOrderId`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `Order` ADD COLUMN `deliveredAt` DATETIME(3) NULL;

ALTER TABLE `MerchantSettings`
  ADD COLUMN `storefrontFallbackLanguage` VARCHAR(191) NOT NULL DEFAULT 'en',
  ADD COLUMN `storefrontLanguages` VARCHAR(191) NOT NULL DEFAULT 'en,fr';
