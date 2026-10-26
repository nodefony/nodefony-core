ALTER TABLE erp_user ADD UNIQUE INDEX uk_user_login (login, entity);
ALTER TABLE erp_user ADD INDEX idx_user_fk_country (fk_country);
ALTER TABLE erp_user ADD CONSTRAINT fk_user_fk_country FOREIGN KEY (fk_country) REFERENCES erp_country (rowid);
