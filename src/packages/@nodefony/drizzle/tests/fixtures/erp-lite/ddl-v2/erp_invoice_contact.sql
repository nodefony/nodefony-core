-- Table NEUVE de la version 2 : deux références vers des tables déjà peuplées.
create table erp_invoice_contact
(
  rowid        integer AUTO_INCREMENT PRIMARY KEY,
  fk_invoice   integer NOT NULL,
  fk_user      integer NOT NULL,
  role         varchar(30) DEFAULT 'BILLING' NOT NULL
) ENGINE=innodb;
