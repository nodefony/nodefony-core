-- Pays : clé entière NON auto-incrémentée (les identifiants viennent d'un référentiel).
create table erp_country
(
  rowid    integer PRIMARY KEY,
  code     varchar(2) NOT NULL,
  code_iso varchar(3),
  label    varchar(128),
  active   tinyint DEFAULT 1 NOT NULL
) ENGINE=innodb;
