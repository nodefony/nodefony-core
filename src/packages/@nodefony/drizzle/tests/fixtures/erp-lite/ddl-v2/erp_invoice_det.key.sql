ALTER TABLE erp_invoice_det ADD INDEX idx_invoice_line_fk_invoice (fk_invoice);
ALTER TABLE erp_invoice_det ADD INDEX idx_invoice_line_fk_product (fk_product);
ALTER TABLE erp_invoice_det ADD CONSTRAINT fk_invoice_line_fk_invoice FOREIGN KEY (fk_invoice) REFERENCES erp_invoice (rowid);
ALTER TABLE erp_invoice_det ADD CONSTRAINT fk_invoice_line_fk_product FOREIGN KEY (fk_product) REFERENCES erp_product (rowid);
