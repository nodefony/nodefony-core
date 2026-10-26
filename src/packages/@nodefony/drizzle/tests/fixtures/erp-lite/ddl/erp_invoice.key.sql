ALTER TABLE erp_invoice ADD UNIQUE INDEX uk_invoice_ref (ref, entity);
ALTER TABLE erp_invoice ADD INDEX idx_invoice_fk_soc (fk_soc);
ALTER TABLE erp_invoice ADD INDEX idx_invoice_datef (datef);
ALTER TABLE erp_invoice ADD CONSTRAINT fk_invoice_fk_soc            FOREIGN KEY (fk_soc) REFERENCES erp_thirdparty (rowid);
ALTER TABLE erp_invoice ADD CONSTRAINT fk_invoice_fk_user_author    FOREIGN KEY (fk_user_author) REFERENCES erp_user (rowid);
ALTER TABLE erp_invoice ADD CONSTRAINT fk_invoice_fk_facture_source FOREIGN KEY (fk_facture_source) REFERENCES erp_invoice (rowid);
ALTER TABLE erp_invoice ADD CONSTRAINT fk_invoice_fk_currency       FOREIGN KEY (fk_currency) REFERENCES erp_currency (code_iso);
