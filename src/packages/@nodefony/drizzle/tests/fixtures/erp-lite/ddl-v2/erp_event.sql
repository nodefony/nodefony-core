create table erp_event
(
  id                integer AUTO_INCREMENT PRIMARY KEY,
  ref               varchar(30) NOT NULL,
  uid               char(36),
  entity            integer DEFAULT 1 NOT NULL,
  datep             datetime,
  datep2            datetime,
  fk_action         integer,
  code              varchar(50) NULL,
  label             varchar(255) NOT NULL,
  durationp         real,
  fulldayevent      smallint DEFAULT 0,
  percent           smallint NOT NULL DEFAULT 0,
  location          varchar(128),
  priority          smallint,
  transparency      integer,
  note              mediumtext,
  email_msgid       varchar(255),
  email_subject     varchar(255),
  extraparams       varchar(255),
  status            smallint DEFAULT -1 NOT NULL,
  ip                varchar(250)
) ENGINE=innodb;
