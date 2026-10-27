ALTER TABLE erp_user_param ADD UNIQUE INDEX uk_user_param(fk_user,param,entity);
ALTER TABLE erp_user_param ADD CONSTRAINT fk_user_param_fk_user FOREIGN KEY (fk_user) REFERENCES erp_user (rowid);
