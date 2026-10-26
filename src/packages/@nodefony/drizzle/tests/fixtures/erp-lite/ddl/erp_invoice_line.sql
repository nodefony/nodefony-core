create table erp_invoice_line
(
  rowid              integer AUTO_INCREMENT PRIMARY KEY,
  fk_invoice         integer NOT NULL,
  fk_parent_line     integer NULL,
  fk_product         integer NULL,
  label              varchar(255) DEFAULT NULL,
  description        text,
  vat_src_code       varchar(10) DEFAULT '',
  tva_tx             double(7,4),
  qty                real,
  remise_percent     real DEFAULT 0,
  subprice           double(24,8),
  total_ht           double(24,8),
  total_ttc          double(24,8),
  product_type       integer DEFAULT 0,
  date_start         datetime DEFAULT NULL,
  info_bits          integer DEFAULT 0,
  special_code       integer unsigned DEFAULT 0,
  rang               integer DEFAULT 0,
  situation_percent  real DEFAULT 100,
  extraparams        varchar(255)
) ENGINE=innodb;
