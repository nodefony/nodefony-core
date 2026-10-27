ALTER TABLE erp_product ADD UNIQUE INDEX uk_product_ref (ref, entity);
ALTER TABLE erp_product ADD UNIQUE INDEX uk_product_barcode (barcode, entity);
ALTER TABLE erp_product ADD INDEX idx_product_label (label);
ALTER TABLE erp_product ADD CONSTRAINT fk_product_finished FOREIGN KEY (finished) REFERENCES erp_product_nature (code);
