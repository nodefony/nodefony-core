ALTER TABLE erp_category ADD UNIQUE INDEX uk_category_ref (entity, fk_parent, label, type);
