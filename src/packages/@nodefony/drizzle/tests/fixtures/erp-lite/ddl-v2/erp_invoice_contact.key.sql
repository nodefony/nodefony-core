ALTER TABLE erp_invoice_contact ADD INDEX idx_invoice_contact_fk_invoice (fk_invoice);
ALTER TABLE erp_invoice_contact ADD CONSTRAINT fk_invoice_contact_fk_invoice FOREIGN KEY (fk_invoice) REFERENCES erp_invoice (rowid);
ALTER TABLE erp_invoice_contact ADD CONSTRAINT fk_invoice_contact_fk_user    FOREIGN KEY (fk_user) REFERENCES erp_user (rowid);
