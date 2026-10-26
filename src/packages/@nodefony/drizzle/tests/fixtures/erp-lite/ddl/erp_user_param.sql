-- Table SANS clé primaire : une clé est ajoutée par la conversion.
create table erp_user_param
(
  fk_user       integer NOT NULL,
  entity        integer DEFAULT 1 NOT NULL,
  param         varchar(180) NOT NULL,
  value         text NOT NULL
) ENGINE=innodb;
