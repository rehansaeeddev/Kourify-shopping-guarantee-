-- AlterTable
ALTER TABLE `MerchantSettings` ADD COLUMN `cartTransformId` VARCHAR(191) NULL,
    ADD COLUMN `planTier` VARCHAR(191) NOT NULL DEFAULT 'unknown';
