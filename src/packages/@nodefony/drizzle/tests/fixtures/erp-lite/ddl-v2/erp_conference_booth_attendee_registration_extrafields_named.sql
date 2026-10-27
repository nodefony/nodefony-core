-- Nom de table de 60 caractères : les noms que drizzle-kit dérive de la table
-- (clé primaire `<table>_rowid`, unicité `<table>_<col>_unique`) dépassent la
-- limite de 64 de MySQL — la table existe pourtant, MySQL nommant sa clé PRIMARY.
create table erp_conference_booth_attendee_registration_extrafields_named
(
  rowid                     integer AUTO_INCREMENT PRIMARY KEY,
  tms                       timestamp DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  registration_ref          varchar(32) NOT NULL UNIQUE,
  import_key                varchar(14)
) ENGINE=innodb;
