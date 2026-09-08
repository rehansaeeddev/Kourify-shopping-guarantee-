-- CreateTable
CREATE TABLE `SyncJob` (
    `id` VARCHAR(191) NOT NULL,
    `shop` VARCHAR(191) NOT NULL,
    `type` VARCHAR(191) NOT NULL DEFAULT 'order_backfill',
    `status` VARCHAR(191) NOT NULL DEFAULT 'queued',
    `bulkOperationId` VARCHAR(191) NULL,
    `objectCount` INTEGER NULL,
    `errorMessage` VARCHAR(191) NULL,
    `startedAt` DATETIME(3) NULL,
    `finishedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `SyncJob_shop_createdAt_idx`(`shop`, `createdAt`),
    INDEX `SyncJob_bulkOperationId_idx`(`bulkOperationId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
