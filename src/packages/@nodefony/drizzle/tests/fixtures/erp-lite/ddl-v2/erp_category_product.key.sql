ALTER TABLE erp_category_product ADD PRIMARY KEY pk_category_product (fk_category, fk_product);
ALTER TABLE erp_category_product ADD INDEX idx_category_product_fk_category (fk_category);
ALTER TABLE erp_category_product ADD INDEX idx_category_product_fk_product (fk_product);
ALTER TABLE erp_category_product ADD CONSTRAINT fk_category_product_category_rowid FOREIGN KEY (fk_category) REFERENCES erp_category (rowid);
ALTER TABLE erp_category_product ADD CONSTRAINT fk_category_product_product_rowid  FOREIGN KEY (fk_product) REFERENCES erp_product (rowid);
