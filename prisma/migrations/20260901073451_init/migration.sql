-- CreateTable
CREATE TABLE `Session` (
    `id` VARCHAR(191) NOT NULL,
    `shop` VARCHAR(191) NOT NULL,
    `state` VARCHAR(191) NOT NULL,
    `isOnline` BOOLEAN NOT NULL DEFAULT false,
    `scope` VARCHAR(191) NULL,
    `expires` DATETIME(3) NULL,
    `accessToken` VARCHAR(191) NOT NULL,
    `userId` BIGINT NULL,
    `firstName` VARCHAR(191) NULL,
    `lastName` VARCHAR(191) NULL,
    `email` VARCHAR(191) NULL,
    `accountOwner` BOOLEAN NOT NULL DEFAULT false,
    `locale` VARCHAR(191) NULL,
    `collaborator` BOOLEAN NULL DEFAULT false,
    `emailVerified` BOOLEAN NULL DEFAULT false,
    `refreshToken` VARCHAR(191) NULL,
    `refreshTokenExpires` DATETIME(3) NULL,

    INDEX `Session_shop_idx`(`shop`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `MerchantSettings` (
    `id` VARCHAR(191) NOT NULL,
    `shop` VARCHAR(191) NOT NULL,
    `badgesEnabled` BOOLEAN NOT NULL DEFAULT true,
    `badgeStyle` VARCHAR(191) NOT NULL DEFAULT 'classic',
    `showOnProduct` BOOLEAN NOT NULL DEFAULT true,
    `showOnCart` BOOLEAN NOT NULL DEFAULT true,
    `protectionPayer` VARCHAR(191) NOT NULL DEFAULT 'customer',
    `enabledClaimTypes` VARCHAR(191) NOT NULL DEFAULT 'lost,damaged,stolen,shortage,concealed,wrong_item',
    `claimWindows` TEXT NOT NULL,
    `protectionFeeType` VARCHAR(191) NOT NULL DEFAULT 'flat',
    `protectionFlatFeeCents` INTEGER NOT NULL DEFAULT 299,
    `protectionPercentBasisPoints` INTEGER NOT NULL DEFAULT 200,
    `protectionMinFeeCents` INTEGER NOT NULL DEFAULT 99,
    `protectionMaxFeeCents` INTEGER NOT NULL DEFAULT 999,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `MerchantSettings_shop_key`(`shop`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ProtectionClaim` (
    `id` VARCHAR(191) NOT NULL,
    `shop` VARCHAR(191) NOT NULL,
    `orderNumber` VARCHAR(191) NOT NULL,
    `confirmationCode` VARCHAR(191) NULL,
    `fullName` VARCHAR(191) NOT NULL,
    `email` VARCHAR(191) NOT NULL,
    `issueType` VARCHAR(191) NOT NULL,
    `details` VARCHAR(191) NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'submitted',
    `shopifyOrderId` VARCHAR(191) NULL,
    `shopifyOrderName` VARCHAR(191) NULL,
    `orderRiskLevel` VARCHAR(191) NULL,
    `evidenceUrl` VARCHAR(191) NULL,
    `resolvedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `ProtectionClaim_shop_idx`(`shop`),
    INDEX `ProtectionClaim_shop_email_idx`(`shop`, `email`),
    INDEX `ProtectionClaim_shop_status_idx`(`shop`, `status`),
    INDEX `ProtectionClaim_shop_createdAt_idx`(`shop`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Order` (
    `id` VARCHAR(191) NOT NULL,
    `shop` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `email` VARCHAR(191) NOT NULL,
    `status` VARCHAR(191) NOT NULL,
    `riskLevel` VARCHAR(191) NULL,
    `shippedAt` DATETIME(3) NULL,
    `totalPrice` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `Order_shop_idx`(`shop`),
    INDEX `Order_shop_email_idx`(`shop`, `email`),
    INDEX `Order_shop_status_idx`(`shop`, `status`),
    UNIQUE INDEX `Order_shop_name_key`(`shop`, `name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `AuditLog` (
    `id` VARCHAR(191) NOT NULL,
    `shop` VARCHAR(191) NOT NULL,
    `action` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NULL,
    `resource` VARCHAR(191) NOT NULL,
    `oldValue` JSON NULL,
    `newValue` JSON NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `AuditLog_shop_idx`(`shop`),
    INDEX `AuditLog_shop_createdAt_idx`(`shop`, `createdAt`),
    INDEX `AuditLog_resource_idx`(`resource`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `MerchantConsent` (
    `id` VARCHAR(191) NOT NULL,
    `shop` VARCHAR(191) NOT NULL,
    `acceptedTerms` BOOLEAN NOT NULL DEFAULT false,
    `acceptedAt` DATETIME(3) NULL,
    `version` VARCHAR(191) NOT NULL DEFAULT '1.0',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `MerchantConsent_shop_key`(`shop`),
    INDEX `MerchantConsent_shop_idx`(`shop`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
