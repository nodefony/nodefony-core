-- Tiers : la table la plus large du corpus, en miniature.
create table erp_thirdparty
(
  rowid            integer AUTO_INCREMENT PRIMARY KEY,
  nom              varchar(128),
  name_alias       varchar(128),
  entity           integer DEFAULT 1 NOT NULL,
  ref_ext          varchar(255),                 -- référence dans un autre système
  statut           tinyint DEFAULT 0,
  status           tinyint DEFAULT 1,
  code_client      varchar(24),
  tms              timestamp DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  datec            datetime,
  address          varchar(255),
  zip              varchar(25),
  fk_country       integer DEFAULT 0,
  fk_currency      varchar(3),
  phone            varchar(20),
  capital          double(24,8) DEFAULT NULL,
  remise_client    real DEFAULT 0,
  note_private     text,
  note_public      mediumtext,
  geopoint         point DEFAULT NULL,
  default_lang     varchar(6),
  logo             varchar(255),
  fk_user_creat    integer NULL,
  import_key       varchar(14)
) ENGINE=innodb;
