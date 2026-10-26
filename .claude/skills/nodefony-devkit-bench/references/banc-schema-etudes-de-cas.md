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

## Banc de schéma RÉEL — ce que 421 tables écrites par d'autres ont trouvé

> Détail du `SKILL.md` § « Banc de schéma réel ». Chaque cas ci-dessous était INVISIBLE au corpus
> synthétique et aux bancs écrits pour le kit : seul un schéma qu'on n'a pas dessiné les montre.

### Un nom d'index peut porter le nom de sa propre table

MySQL range les noms d'index **par table** ; SQLite et PostgreSQL les rangent avec les **tables**.
Le corpus déclare `ADD INDEX <table> (fk_object)` sur la table du même nom : légal à l'origine,
refusé ailleurs (`there is already a table named …`) sur une base NEUVE. Le convertisseur gérait
les collisions entre index, pas avec les tables : son espace de noms part désormais des noms de
tables, **sans casse** (SQLite n'en fait pas). Règle : toute collision de nom se juge dans
l'espace de noms du moteur le PLUS strict, jamais dans celui de la source.

### Un nom que le kit FABRIQUE dépasse 63 caractères

`<table>_<colonne>_<cible>_<clé>_fk` sur une table au nom long : MySQL et MariaDB refusent au-delà
de 64, PostgreSQL TRONQUE en silence à 63 (deux contraintes peuvent alors porter le même nom). 58
clés étrangères et 54 CHECK du corpus étaient concernées. Tout nom généré passe par
`boundedIdentifier` (`drizzle/nodefony/entity/colKit.shared.ts`) — inchangé jusqu'à 63, ce qui
laisse intactes les migrations déjà écrites.

### Un montant `decimal` se trie en ALPHABET sous SQLite

Le kit range un `decimal` en TEXT (exact, chiffre pour chiffre) ; comparé tel quel, `"9.5"` passe
après `"100"`. Le dépôt lit les comparaisons d'ordre par `CAST … AS REAL` sur les colonnes que
`isTextDecimal` reconnaît — exact jusqu'à 15 chiffres significatifs. Le SQL natif (SUM flottant,
tri alphabétique) est une divergence DÉCLARÉE (`drizzle/docs/index.md` § « Le décimal en SQLite »)
que le banc affirme au lieu de la sauter. Les requêtes métier lourdes (jointure de 6 tables, SUM
groupé, RANK, `$gt`/`$lte` par les chemins direct ET préparé) vivent dans
`drizzle/tests/integration/erp-lite-contract.ts`. Piège payé : un premier jeu de données où
l'ordre texte et l'ordre numérique COÏNCIDAIENT rendait le test vert sans correctif — choisir des
montants de longueurs différentes, un négatif, et une borne qui sépare les deux ordres.

### `orm:generate` lit les exports UN PAR UN

Une application qui range ses tables dans un tableau (`export const ENTITIES = [...]`) obtient un
refus : la génération examine chaque export (`drizzle/nodefony/src/migrator/appSchema.ts`) et ne
voit pas une table dans un tableau. Le banc exporte donc chaque table à plat, comme `create entity`
— et c'est aussi ce qu'un utilisateur doit faire.

### Le graphe de la console ne voyait que les liens DÉCLARÉS

421 tables, 241 clés étrangères en base, et l'ERD affichait « 0 relation » : les arêtes ne venaient
que de `relations` dans `defineEntity`. `describeEntity` rend désormais la cible de chaque clé
étrangère d'une colonne (`IColumnInfo.references`) et le graphe en dérive les arêtes manquantes.
Le cas « chaque référence ressort de `describeEntity` » du contrat de schéma le tient sur les quatre
moteurs et sur le corpus réel. Le **domaine** (axe de regroupement) n'est pas dans le DDL : c'est
une donnée du catalogue (`CORPORA.<corpus>.domains`), portée par l'ENTITÉ, jamais par la table.

### Mesurer l'écran : l'instrument d'abord

Deux faux verdicts évités en suspectant la sonde : `nodefony inspect graph` rend **zéro colonne**
en mode console (l'ORM n'y est pas connecté) — la vraie mesure se fait sur le serveur démarré ; et
une capture prise PENDANT l'animation de recadrage montre un canevas vide. Le décor gardé
(`--keep`) se démarre (`nodefony development --detach --wait`, ports 5395/5396) et se mesure par le
skill `nodefony-browser` ; l'interface de la console qu'il sert est celle de SON archive : une
modification de Studio se rebâtit (`npm run build:ui`) puis se pose dans le décor avant d'être vue.
