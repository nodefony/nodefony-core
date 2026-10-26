-- Nom de table LONG : les noms de contraintes qui en dérivent dépassent 63 caractères.
create table erp_thirdparty_extrafields_long_named
(
  rowid                     integer AUTO_INCREMENT PRIMARY KEY,
  tms                       timestamp DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  fk_object                 integer NOT NULL,
  ref_external_system_code  varchar(64),
  import_key                varchar(14)
) ENGINE=innodb;
