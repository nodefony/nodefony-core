ALTER TABLE erp_thirdparty ADD UNIQUE INDEX uk_thirdparty_code_client(code_client, entity);
ALTER TABLE erp_thirdparty ADD INDEX idx_thirdparty_user_creat(fk_user_creat);
ALTER TABLE erp_thirdparty ADD INDEX idx_thirdparty_nom (nom(64));
ALTER TABLE erp_thirdparty ADD CONSTRAINT fk_thirdparty_fk_currency FOREIGN KEY (fk_currency) REFERENCES erp_currency (code_iso);
ALTER TABLE erp_thirdparty ADD CONSTRAINT fk_thirdparty_fk_user_creat	FOREIGN KEY (fk_user_creat)	REFERENCES erp_user (rowid);
