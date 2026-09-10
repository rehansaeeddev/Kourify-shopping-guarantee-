ALTER TABLE `Order` ADD COLUMN `placedAt` DATETIME(3) NULL;

CREATE INDEX `Order_shop_placedAt_idx` ON `Order`(`shop`, `placedAt`);
