-- Protection can be revoked when the purchase is legitimately reversed.
ALTER TABLE `ProtectedOrder` ADD COLUMN `revokedAt` DATETIME(3) NULL;
ALTER TABLE `ProtectedOrder` ADD COLUMN `revokedReason` VARCHAR(191) NULL;

-- Decision maker on a claim.
ALTER TABLE `ProtectionClaim` ADD COLUMN `decidedByUserId` VARCHAR(191) NULL;
ALTER TABLE `ProtectionClaim` ADD COLUMN `decidedByName` VARCHAR(191) NULL;
