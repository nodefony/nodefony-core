-- Table de liaison : clé COMPOSITE, posée dans le fichier de clés.
create table erp_category_product
(
  fk_category  integer NOT NULL,
  fk_product   integer NOT NULL,
  import_key   varchar(14)
) ENGINE=innodb;
