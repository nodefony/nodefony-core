# RETEX.md — digest des retours d'expérience (SAS, lu à chaque début de session)

> **Rôle** : sas entre les retex bruts (`docs/session-retros/archive/<date>-<id>.md`, jamais relus
> seuls) et les leçons durables (mémoires `feedback_*` indexées dans `MEMORY.md`). Il porte les
> **frictions récentes pas encore confirmées** (vues 1-2×). Le skill `nodefony-session` le **lit au
> START/RESUME** et le **met à jour au END** (3-5 bullets du jour, par thème).
>
> **Règle anti-doublon (CRITIQUE)** : une leçon est **soit** ici (sas), **soit** en `feedback_*`
> (graduée). **JAMAIS les deux.** À **3×** → CONSOLIDATE la promeut et la **retire d'ici**.
>
> **Taille bornée : ~1 écran.** Deux sorties, gérées par CONSOLIDATE : (a) ≥3× → graduée puis
> retirée ; (b) thème dont le chantier est clos → archive. Format : `[N× — date courte]`.
>
> Snapshots complets avant coupe : `archive/RETEX-snapshot-<date>.md` — rien n'est perdu.

---

## 📦 Surface npm & publication (chantier release en cours)

- `[1× — 2026-07-23]` **Le seul consommateur qu'on exerce n'est jamais celui qui a le problème.** Six paquets publiaient `exports["."].types → ./index.ts`, absent du tarball (`files:`) : invisible dans le repo self-hosted, cassé pour tout installeur npm. Vérifier une surface publiée = **dépaqueter le tarball** (`npm pack` + lire le manifeste), jamais lire le `package.json` du dépôt.
- `[1× — 2026-07-23]` **`publishConfig.exports` n'est PAS appliqué par npm** (c'est pnpm/yarn). Testé avant de le proposer.
- `[1× — 2026-07-23]` **Un import non déclaré ne casse rien ICI et deux choses AILLEURS** : turbo ne peut pas ordonner le build, et le consommateur npm n'installe pas la dépendance. Auditer les imports de **valeur** (pas seulement de types) contre les `dependencies`.
- `[1× — 2026-07-23]` **Un contournement documenté peut cacher une contrainte RÉELLE — la vérifier avant de le retirer.** `exports.types → ./index.ts` avait l'air d'une paresse ; c'était l'anti-race du CLAUDE.md. 4 `clean && build` complets pour le prouver (le `dist` d'avant masque exactement cette panne).

## 🐳 Décor de test (conteneurs, dist, sortie capturée)

- `[1× — 2026-07-23]` **Un service derrière un `profiles:` compose n'est JAMAIS monté par un `up` nu** — PostgreSQL et MariaDB étaient marqués « exercés » sans avoir jamais tourné. Un ID de réseau docker recréé les fait échouer au démarrage (volumes nommés = 0 perte à la recréation).
- `[1× — 2026-07-23]` **Un `dist/` réduit à `types/` casse un AUTRE module, avec un message qui ne le nomme pas.** Vérifier le décor AVANT la batterie : `docker ps` + profils compose + `ls <paquet>/dist/index.js`. Trois commandes contre quinze minutes de run.
- `[1× — 2026-07-22]` **Remplacer un décor ÉPHÉMÈRE par un décor PERSISTANT révèle les bancs non rejouables** (mongod neuf à chaque run → conteneur permanent : les bancs qui n'effaçaient rien sont tombés).
- `[1× — 2026-07-22]` **« Même dialecte » n'est pas « même serveur »** : MariaDB et MySQL Community partagent driver et dialecte, mais divergent sur collation, bornes numériques et arbitrage des uniques.

## 🧯 Justifier une absence (le réflexe qui fabrique des trous)

- `[1× — 2026-07-23]` ⭐ **Un slogan sur la NATURE d'un composant n'est pas une justification.** « Couverture adaptée à la nature, pas parité SQL×NoSQL » servait à expliquer une absence qui n'avait aucune raison d'être.
- `[1× — 2026-07-23]` ⭐ **Vérifier ce que le composant porte DÉJÀ de la même famille avant d'invoquer sa nature.**
- `[1× — 2026-07-23]` **Une couverture partielle affichée sans ses cases vides devient un choix aux yeux du lecteur** — montrer AUSSI ce qui n'est pas couvert.

## 👻 Le MIROIR — une option qu'on POSE mais que rien ne LIT (motif du registre en cours)

- `[1× — 2026-07-23]` **Retirer une clé morte du schéma AGGRAVE le silence** : l'app continue de la poser, plus rien ne la refuse. Le remède est un **lecteur** (ou un avertissement au boot), pas une suppression.
- `[1× — 2026-07-23]` **Un champ d'audit non rempli peut EFFACER** (`markUsed(id, { at })` sans `ip`/`userAgent` remet les colonnes à `null`) — et **rempli, il ne sert à rien s'il n'est exposé nulle part**.
- `[1× — 2026-07-13]` **Une option que le code LIT mais que rien ne permet de POSER** : `timing.enabled` lu par le `Context`, absent du schéma Zod → inatteignable en production. Le pendant exact du miroir.

## 🗄️ Concurrence & atomicité (ce que le dialecte ne dit pas) — utile pour l'ORM S5

- `[1× — 2026-07-17]` **Un pool FROID masque les races** : le 1ᵉʳ écrivain (seule connexion chaude) finit avant que les autres aient leur TCP+auth → vert 3/3 sans le fix, structurellement. Chauffer (`Promise.all` de `count()`) avant de mesurer.
- `[1× — 2026-07-17]` **`ON CONFLICT (x)` n'arbitre QU'UN index** ; **MySQL n'a ni `RETURNING` ni `WHERE` sur ODKU** (tout upsert conditionnel y coûte 2-3 requêtes, donc une course) ; **un upsert reste un INSERT qui bascule** (colonnes `NOT NULL` obligatoires même quand la ligne existe).
- `[1× — 2026-07-17]` **La concurrence est un angle mort structurel des bancs** (séquentiels) : `Promise.allSettled` + tenir le travail ouvert, sinon les tâches se sérialisent et le bug ne sort jamais.
- `[1× — 2026-07-17]` **Les valeurs JOUETS ne prouvent rien sur le type d'une colonne** : `1000` passe partout ; `1_775_000_000_123` prouve le bigint, `INT32_MAX` trouve la borne.

## 🚦 Gates — le régime doit épouser la NATURE de ce qu'il vérifie

- `[1× — 2026-07-22]` **Un gate qui échoue toujours pour de mauvaises raisons finit ignoré, y compris le jour où il a raison.** Corollaires : distinguer le CODE de la PROSE dans un markdown ; nommer le fichier, pas son basename ; **dire combien d'exceptions il a acceptées**.
- `[1× — 2026-07-22]` **Un contrôle peut être satisfait PAR ACCIDENT — le vérifier avant de l'imposer** (l'« intro en blockquote » matchait déjà pour une autre raison).
- `[1× — 2026-07-20]` **Changer le FORMAT d'un contenu peut le sortir du champ de vision de son gate** — étendre le gate en même temps que le format.

## 📏 Mesure & bancs

- `[1× — 2026-07-23]` **Un banc qui ne vérifie pas que le travail a EU LIEU mesure la vitesse à laquelle on échoue** (vécu 2× le même jour).
- `[1× — 2026-07-22]` **Pour un gain d'ÉTAGE, banc d'étage** : le banc système (variance ×3) ne peut pas trancher quelques dizaines de % — il prouve un comportement (fan-out, injection, mémoire sous rafale). Le micro-banc écrit en 10 min a donné la réponse.
- `[1× — 2026-07-22]` **Éteindre soi-même une infra en cours de session rend des tests silencieusement verts.**
- `[1× — 2026-07-23]` **« Je n'ai pas la mesure » voulait dire « je n'ai pas CHERCHÉ la mesure »** ; et **vérifier l'hypothèse commode au lieu de la défendre** (4 testées en une session, 2 fausses).

## 🎨 Front / Studio (chaud)

- `[1× — 2026-07-23]` **En HMR, l'import passe AVANT le JSX qui l'utilise** : esbuild ne vérifie pas les identifiants → Vite sert une version cassée sans le dire. Le typecheck du module est le seul juge.
- `[1× — 2026-07-23]` **Un schéma se dessine à sa taille NATURELLE, puis se contraint** (un `viewBox` étiré à 100 % donne des textes de 8 px).
- `[1× — 2026-07-23]` **Avant d'écrire un écran explicatif, fixer le LECTEUR** (« quelqu'un qui ne connaît pas le mot backplane ») au même titre que les blocs : 3 des 4 refontes venaient de là. Le cahier des charges figé doit porter le **niveau de langue** et la **taille des dessins**, pas seulement le contenu.
- `[1× — 2026-07-13]` **Une modif front Studio ne se voit dans une app `--link` (ui static) qu'après `npm run build:ui`** — le HMR ne concerne pas le `dist/frontend` servi.

## 🔤 Nommer

- `[1× — 2026-07-22]` **Un nom de classe qui décrit le premier cas branché égare son propre auteur** (`SessionRealtimeAuthenticator` promeut TOUTE identité résolue par le firewall).
- `[1× — 2026-07-22]` **Un type figé en dur est une décision d'autorisation déguisée** (`type = "session"` faisait passer un agent JWT pour un humain).
- `[2× — 2026-07-14]` **DEUX noms pour UN concept = un bug qui attend** (`orm:` côté entité vs `connectors:` côté config, pour le même objet).
