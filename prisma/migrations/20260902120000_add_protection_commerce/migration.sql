ALTER TABLE `MerchantSettings`
  ADD COLUMN `protectionEnabled` BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN `plan` VARCHAR(191) NOT NULL DEFAULT 'usage',
  ADD COLUMN `currency` VARCHAR(191) NOT NULL DEFAULT 'USD',
  ADD COLUMN `protectionProductId` VARCHAR(191) NULL,
  ADD COLUMN `protectionVariantId` VARCHAR(191) NULL;

CREATE TABLE `ProtectedOrder` (
  `id` VARCHAR(191) NOT NULL,
  `shop` VARCHAR(191) NOT NULL,
  `shopifyOrderId` VARCHAR(191) NOT NULL,
  `shopifyOrderName` VARCHAR(191) NULL,
  `protectionPriceCents` INTEGER NOT NULL,
  `currency` VARCHAR(191) NOT NULL,
  `customerSelected` BOOLEAN NOT NULL DEFAULT true,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  UNIQUE INDEX `ProtectedOrder_shop_shopifyOrderId_key`(`shop`, `shopifyOrderId`),
  INDEX `ProtectedOrder_shop_createdAt_idx`(`shop`, `createdAt`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `UsageEvent` (
  `id` VARCHAR(191) NOT NULL,
  `shop` VARCHAR(191) NOT NULL,
  `protectedOrderId` VARCHAR(191) NOT NULL,
  `eventType` VARCHAR(191) NOT NULL DEFAULT 'protected_order',
  `amountCents` INTEGER NOT NULL DEFAULT 60,
  `status` VARCHAR(191) NOT NULL DEFAULT 'pending',
  `shopifyUsageId` VARCHAR(191) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE INDEX `UsageEvent_protectedOrderId_eventType_key`(`protectedOrderId`, `eventType`),
  INDEX `UsageEvent_shop_status_createdAt_idx`(`shop`, `status`, `createdAt`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `UsageEvent` ADD CONSTRAINT `UsageEvent_protectedOrderId_fkey`
  FOREIGN KEY (`protectedOrderId`) REFERENCES `ProtectedOrder`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
