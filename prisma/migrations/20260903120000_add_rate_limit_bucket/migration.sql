CREATE TABLE `RateLimitBucket` (
  `key` VARCHAR(191) NOT NULL,
  `count` INTEGER NOT NULL,
  `windowStart` DATETIME(3) NOT NULL,
  `expiresAt` DATETIME(3) NOT NULL,
  INDEX `RateLimitBucket_expiresAt_idx`(`expiresAt`),
  PRIMARY KEY (`key`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
