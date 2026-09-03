CREATE TABLE `StorefrontTranslation` (
  `id` VARCHAR(191) NOT NULL,
  `shop` VARCHAR(191) NOT NULL,
  `locale` VARCHAR(191) NOT NULL,
  `label` VARCHAR(191) NOT NULL,
  `direction` VARCHAR(191) NOT NULL DEFAULT 'ltr',
  `enabled` BOOLEAN NOT NULL DEFAULT true,
  `strings` TEXT NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  UNIQUE INDEX `StorefrontTranslation_shop_locale_key`(`shop`, `locale`),
  INDEX `StorefrontTranslation_shop_idx`(`shop`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
