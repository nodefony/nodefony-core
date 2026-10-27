create table erp_product
(
  rowid                integer AUTO_INCREMENT PRIMARY KEY,
  ref                  varchar(128) NOT NULL,
  entity               integer DEFAULT 1 NOT NULL,
  label                varchar(255) NOT NULL,
  description          text,
  datec                datetime,
  tms                  timestamp DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  price                double(24,8) DEFAULT 0,
  price_ttc            double(24,8) DEFAULT 0,
  tva_tx               double(7,4),
  tosell               tinyint DEFAULT 1,
  finished             tinyint DEFAULT NULL,
  weight               float DEFAULT NULL,
  barcode              varchar(180) DEFAULT NULL,
  stock                real,
  duration             varchar(6),
  fk_unit              integer DEFAULT NULL,
  extra_counter        bigint,
  special_code         integer unsigned DEFAULT 0
) ENGINE=innodb;
