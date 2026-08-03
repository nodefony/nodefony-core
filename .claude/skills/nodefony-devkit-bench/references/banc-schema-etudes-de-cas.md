# Banc de schéma — études de cas

> Détail du `SKILL.md` § « Banc de schéma » : pourquoi le décor doit sortir du dépôt, et pourquoi
> le juge lui-même doit s'éprouver avant de rendre un verdict.
>
> **Maintenance** : édition en place. Pas de journal, pas de date : l'historique vit dans
> `git log`.

### Le décor doit être celui de l'utilisateur, pas celui du mainteneur

Le premier verdict a été rendu dans un décor qui le faussait : l'application
vivait sous le checkout, paquets symlinkés. L'agent est allé lire
`src/packages/@nodefony/drizzle/` — un savoir qu'aucun installeur npm ne
possède, puisqu'un tarball ne contient que `dist/`. **Le banc mesurait un agent
mieux servi que l'utilisateur réel**, et le seul chiffre qui compte en dépendait.

Deux gestes, tous deux nécessaires : le décor **sort du dépôt** (sinon `../..`
y ramène) et les paquets s'installent **depuis les tarballs** de `pack-all.mjs`
(sinon le lien expose les sources malgré la distance). L'isolation est ensuite
**constatée** avant l'agent — run hors dépôt, aucun lien qui sorte, aucune
source `.ts` atteignable — et le banc s'arrête si le constat échoue : mieux vaut
aucun verdict qu'un verdict sur autre chose.

`--link` reste là pour la boucle courte ; le rapport énonce alors que la mesure
n'est pas transposable. **Deux runs de décors différents ne se comparent pas.**

Le rapport compte aussi les **accès hors de l'application** : zéro est le
résultat attendu en décor fermé, et c'est ce chiffre qu'on relit quand un
verdict surprend.

### Le juge s'éprouve AVANT de juger

`bench-schema.selftest.mjs` refait chaque compte par un chemin **indépendant**
du lecteur, et `--prove` ampute les lecteurs pour montrer que le contrôle mord.
Il existe parce que ce banc a livré des verdicts faux avec l'aplomb des justes :
un lecteur knex perdant les définitions multi-lignes (130 colonnes — l'allure
d'un compte juste), un `array_agg` rendu en chaîne brute que le pilote ne décode
pas, un `String @db.Uuid` pris pour une chaîne — **18 faux positifs qui noyaient
le seul vrai écart**. Et le tout premier de ces défauts était **dans le
contrôle**, pas dans le lecteur : `indexOf("posts: {")` tombait sur
`show_latest_posts: {`.

Le juge PostgreSQL est exercé contre une table au **DDL écrit à la main** — la
référence n'emprunte pas une ligne au banc. S'il n'y a pas de base, le contrôle
n'est pas silencieusement sauté : il est **annoncé non exécuté** et la sortie
vaut **2**, parce qu'un vert incomplet lu comme un vert complet est le piège
maison n°1.
