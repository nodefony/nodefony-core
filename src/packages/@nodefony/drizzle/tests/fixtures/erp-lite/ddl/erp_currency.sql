--Devises : clé CHAÎNE (code ISO), visée par des références
create table erp_currency
(
  code_iso  varchar(3) PRIMARY KEY,
  label     varchar(128),
  unicode   varchar(32) DEFAULT NULL,
  active    tinyint DEFAULT 1 NOT NULL
) ENGINE=innodb;
