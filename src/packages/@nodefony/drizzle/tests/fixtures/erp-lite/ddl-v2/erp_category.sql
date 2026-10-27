create table erp_category
(
  rowid        integer AUTO_INCREMENT PRIMARY KEY,
  entity       integer DEFAULT 1 NOT NULL,
  fk_parent    integer DEFAULT 0 NOT NULL,
  label        varchar(180) NOT NULL,
  type         integer DEFAULT 1 NOT NULL,
  colour       varchar(16),
  position     integer DEFAULT 0,
  visible      tinyint DEFAULT 1 NOT NULL,
  is_default   tinyint DEFAULT 0 NOT NULL
) ENGINE=innodb;
