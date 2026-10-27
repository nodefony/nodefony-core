-- Réglages : défauts chaîne (apostrophe, vide), booléen natif, JSON, mediumtext/longtext.
create table erp_const
(
  rowid       integer AUTO_INCREMENT PRIMARY KEY,
  name        varchar(180) NOT NULL,
  entity      integer DEFAULT 1 NOT NULL,
  value       text NOT NULL,
  type        varchar(64) DEFAULT 'chaine',
  visible     tinyint DEFAULT 1 NOT NULL,
  note        text,
  label       varchar(128) DEFAULT 'l''été',
  enabled     boolean DEFAULT true NOT NULL,
  composed_of json,
  history     longtext,
  tms         timestamp DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=innodb;
