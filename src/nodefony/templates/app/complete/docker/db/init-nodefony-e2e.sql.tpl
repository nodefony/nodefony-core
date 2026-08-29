<% if (it.db) { %>-- Les DEUX bases que la suite e2e de <%= it.appName %> exige, créées à
-- l'initialisation du serveur.
--
-- Pourquoi elles ne se créent pas toutes seules au moment des tests : sur un
-- moteur SERVEUR, `CREATE DATABASE` est un privilège d'administration que
-- l'utilisateur applicatif n'a pas — et ne doit pas avoir. Une suite de tests
-- ne fabrique donc pas sa base ; le décor la FOURNIT, ici comme en recette.
-- (Sur SQLite il n'y a rien de tout ça : un fichier s'efface.)
--
--   <%= it.db.databaseE2e %>         → la base de la suite e2e, jamais celle du développement
--   <%= it.db.databaseScratch %> → la base VIERGE que la suite de migrations salit puis remet à zéro
--
-- Du SQL, et pas un script shell : l'entrée d'initialisation EXÉCUTE un `.sh`
-- dès qu'il porte le bit exécutable, et un montage qui ne le transmet pas fait
-- mourir le serveur au démarrage (`bad interpreter`, code 126) — constaté. Un
-- `.sql` est joué par le client, sans aucune question de permission.
--
-- ⚠️ Ce fichier n'est joué qu'à la PREMIÈRE initialisation du volume. Sur une
-- infra déjà montée : `docker compose down -v` (PURGE les données), ou créer
-- les deux bases à la main.
<% if (it.db.choice === "postgres") { %>CREATE DATABASE "<%= it.db.databaseE2e %>" OWNER "<%= it.appName %>";
CREATE DATABASE "<%= it.db.databaseScratch %>" OWNER "<%= it.appName %>";
<% } else { %>-- L'utilisateur applicatif n'a de droits QUE sur sa base : les deux nouvelles
-- lui sont accordées explicitement, sinon il ne pourrait pas y créer ses tables.
CREATE DATABASE IF NOT EXISTS `<%= it.db.databaseE2e %>`;
CREATE DATABASE IF NOT EXISTS `<%= it.db.databaseScratch %>`;
GRANT ALL PRIVILEGES ON `<%= it.db.databaseE2e %>`.* TO '<%= it.appName %>'@'%';
GRANT ALL PRIVILEGES ON `<%= it.db.databaseScratch %>`.* TO '<%= it.appName %>'@'%';
FLUSH PRIVILEGES;
<% } %><% } %>
