create table erp_user
(
  rowid          integer AUTO_INCREMENT PRIMARY KEY,
  entity         integer DEFAULT 1 NOT NULL,
  login          varchar(50) NOT NULL,
  lastname       varchar(50),
  email          varchar(255),
  admin          smallint DEFAULT 0,
  statut         tinyint DEFAULT 1,
  datec          datetime,
  tms            timestamp DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  fk_country     integer,
  signature      text
) ENGINE=innodb;
