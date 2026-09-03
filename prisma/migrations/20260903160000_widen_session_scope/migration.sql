-- The granted access-scope string can exceed varchar(191) once enough scopes
-- are requested (e.g. adding write_order_edits), which broke session storage.
ALTER TABLE `Session` MODIFY `scope` TEXT NULL;
