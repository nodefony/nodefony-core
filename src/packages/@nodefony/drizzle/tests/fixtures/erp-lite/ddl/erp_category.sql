create table erp_category
(
  rowid        integer AUTO_INCREMENT PRIMARY KEY,
  entity       integer DEFAULT 1 NOT NULL,
  fk_parent    integer DEFAULT 0 NOT NULL,
  label        varchar(180) NOT NULL,
  type         integer DEFAULT 1 NOT NULL,
  color        varchar(8),
  position     integer DEFAULT 0,
  visible      tinyint DEFAULT 1 NOT NULL
) ENGINE=innodb;
