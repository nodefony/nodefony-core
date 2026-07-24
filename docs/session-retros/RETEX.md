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

## 🧮 Un compteur dérivé ment quand la source parle deux langues

- `[1× — 2026-07-24]` ⭐ **Le rapport du registre affichait 68 items ouverts pour 33 réels, et 2 « critiques » déjà corrigés.** Il PARSE le kit, mais ne lit que la **colonne « suite à donner »** ; les lots soldés « par geste » étaient racontés en **prose sous le tableau**. Deux façons d'écrire le même état dans une même source, une seule que l'outil regarde. **Écrire l'état LÀ OÙ l'outil lit** — sinon on pilote un chantier sur un chiffre faux, et on croit qu'il reste le double de travail.
- `[1× — 2026-07-24]` **Recaler un compteur à la main peut abîmer la source.** Mon script a marqué « ✅ SOLDÉ » dans la 3ᵉ colonne d'un tableau de SYNTHÈSE dont la 3ᵉ colonne signifiait « ce que fait le code ». Vérifier ce que la colonne VEUT DIRE avant d'y écrire, pas seulement son index.

## 🎯 Une garantie LOCALE n'est pas une garantie de bout en bout

- `[1× — 2026-07-24]` ⭐ **Un commentaire peut être vrai chez lui et faux dans le pipeline.** `Resolver.executeAction` affirmait que `@IsGranted` « court-circuite l'instanciation DI + `initialize()` (Zero Trust) » : exact **de sa méthode**, faux du trajet HTTP, où le kernel avait déjà instancié en amont. Personne n'avait menti — le contexte d'appel a invalidé la promesse. **Une garantie de sécurité écrite dans un commentaire doit être prouvée par un test qui part du DEHORS** (ici : frapper la route en anonyme et regarder si le code du controller a tourné), pas relue dans la fonction qui la porte.
- `[1× — 2026-07-24]` **Pour prouver un ORDRE d'exécution, instrumenter le point observé et le relire par une route publique.** Le mouchard vit hors des instances (une instance ne survit pas à sa requête) et se lit hors de la zone protégée (un banc anonyme ne peut pas lire ce qu'une zone fermée a écrit). Trois lignes de décor, et l'ordre devient un fait mesuré au lieu d'une phrase.

## 📐 La cible d'une mesure fait partie du décor

- `[1× — 2026-07-24]` **Le défaut d'un script de banc peut être périmé alors que la bonne cible existe.** Je mesurais sur `/nodefony/kernel/api/livez` — qui traverse EN PLUS la zone firewall, un authenticator, le broker admin et appelle `getBootReport()`. Le user a rappelé qu'une route avait été faite EXPRÈS (`/nodefony/kernel/bench`, corps figé, hors aire admin, flag `NF_BENCH_ROUTE=1`). **Avant de mesurer : chercher si une cible dédiée existe** — sinon on chiffre l'étage d'à côté. Figé depuis dans le skill + posé par le script.
- `[1× — 2026-07-24]` **Un symbole introuvable à l'import = symbole DÉPLACÉ, pas runtime cassé.** Cinq bancs cluster importaient `RealtimeHub`/`ClusterBackplane` de `@nodefony/framework` ; tout est passé dans `@nodefony/realtime`. `.ai/symbols.json` (`.symbols.X.module`) le dit en une commande — avant de soupçonner une régression.

## 🧷 Un run vert ne typecheck rien — et tous les typechecks ne se valent pas

- `[1× — 2026-07-24]` **Deux erreurs de type dans mes propres tests, invisibles en vert.** Vitest efface les types à la transpilation : les 6 tests passaient alors qu'un import pointait un type non exporté (TS2459) et qu'une conversion sautait `unknown` (TS2352). C'est le **pre-push** qui a mordu, deux fois de suite. Pire piège : `npx tsc --noEmit` lancé DANS le module était vert — il ne couvre pas les mêmes fichiers que `npm run typecheck`, qui est le gate réel. **Avant un push : `npm run typecheck` à la racine, pas le tsc du module.**

## 📎 Un diff de code décale les ancres de la doc

- `[1× — 2026-07-24]` **40 lignes insérées dans un service → 16 ancres `fichier:ligne` fausses dans sa page de doc**, qu'aucun humain ne verrait. `anchor-check` les nomme mais ne les répare pas : recaler par SYMBOLE (chercher la ligne du symbole cité, la plus proche de l'ancienne) puis relancer jusqu'à 0 SUSPECT. **Toute modification de code touche la doc qui l'ancre** — le gate doit tourner dans le même geste, pas à la revue suivante.

## 🧪 Un contrôle négatif mal conçu ne prouve rien (et c'est le mien)

- `[3× — 2026-07-23e]` **Casser une règle NON normative ne fait pas mordre un gate.** Pour éprouver la barrière des skills, j'ai réduit une description à un caractère : toujours vert, car 1 ≤ 1024 — la règle n'était pas violée. Puis j'ai copié un lanceur existant pour simuler un orphelin : classé « à déplacer », catégorie que `--strict` ignorait. **Deux contrôles négatifs faux avant un vrai** (nom de skill ≠ dossier). Choisir la règle qu'on viole, et vérifier qu'elle est bien violée AVANT de conclure sur le gate.
- `[1× — 2026-07-23e]` **Le contrôle négatif a trouvé un vrai trou** : `--strict` ne comptait que orphelins et renvois morts, jamais « à déplacer » — un gate à moitié aveugle que j'allais livrer en disant qu'il marchait.
- `[1× — 2026-07-23e]` **Un outil externe voit ce que le contrôle maison rate.** `skills-ref` (validateur officiel) a trouvé 2 frontmatter YAML invalides que mon parseur regex laissait passer : une description **en ligne** contenant un `:` casse le mapping. Corollaire : auditer le paquet avant de l'exécuter (celui-ci n'a ni `repository` ni `homepage` et lit tous les skills — 20 Ko, `node:fs` seulement, vérifié).

- `[1× — 2026-07-24]` **Un test qui n'assertait que le cas REFUSÉ cachait que le chemin nominal est asynchrone.** Mon test F86 échouait : le handler n'avait « pas tourné ». En réalité le dispatch d'une requête JSON-RPC passe par une microtask — le test existant ne l'avait jamais montré, puisqu'il ne vérifiait que le refus (synchrone). **Un test qui ne couvre qu'une branche apprend faux sur l'autre.**
- `[1× — 2026-07-24]` **Le durcissement bat la documentation.** `UploadedFile.move()` composait sa destination avec le nom de fichier CLIENT ; un `[!WARNING]` dans la doc « couvrait » le piège. Un avertissement demande à chaque application de se souvenir ; un `basename` forcé ferme la porte. Quand le choix est « durcir ou documenter », c'est durcir.

## 🕰️ Une norme externe bouge — le gate qui la contrôle dérive en silence

- `[1× — 2026-07-23f]` **Rafraîchir le standard AAIF a révélé DEUX dérives de mon gate** : le champ `compatibility` avait été ajouté à la spec (≤500) et manquait à `ALLOWED_FIELDS` (faux positif « hors standard » en puissance) ; la règle `name` interdit les tirets consécutifs et aux bords, que ma regex laissait passer. **Un contrôle de conformité calibré une fois se périme quand la norme avance — revalider contre la spec FRAÎCHE avant de lui faire confiance ou de le durcir.** Les constantes du standard citent désormais leur source en tête du script.
- `[1× — 2026-07-23f]` **Une fiche générée peut PROUVER sa conformité, pas seulement l'affirmer** : badge en tête (N/N normatifs MUST · projet · recommandé SHOULD) + une colonne qui CITE la règle exacte du standard et sa nature. « Du vrai travail visible » > un ✅ nu.

## 🧵 Générateur vs formateur — le diff perpétuel

- `[1× — 2026-07-23f]` **Prettier reformatait les fichiers GÉNÉRÉS à chaque commit ; le générateur les reproduisait sans ce formatage → diff perpétuel** (les tables se réalignaient dans un sens puis l'autre). Un fichier généré ne doit avoir **qu'un seul formateur : son générateur**. Fix = les exclure de `.prettierignore` ; idempotence de la régénération prouvée ensuite (0 diff).

## 🔎 Vérifier dans le rendu — et vérifier le décor de la vérification

- `[2× — 2026-07-23e]` **Deux fausses alertes d'affilée sur la même page.** (1) Une session expirée renvoyait du JSON d'erreur que mon parseur lisait comme un markdown vide → « les cards ont disparu ». (2) Le motif cherché était celui d'AVANT réécriture : le portail transforme `skills/x.md` en slug `root~skills~x.md`, comportement correct. **Avant de déclarer une régression sur une mesure HTTP : vérifier le code de retour, puis ce que la couche transforme légitimement.**

## 🧭 Où vit un outil

- `[2× — 2026-07-23e]` **Un script rejoint un skill quand son résultat dépend d'un PROTOCOLE** (décor, ordre, interprétation) ; il reste à la racine s'il est déterministe et câblé au manifeste. Corollaire découvert en appliquant la règle : **un script dans un skill que le skill ne cite pas est introuvable** — 24 bancs dans ce cas. Et **sortir un script d'une chaîne casse la chaîne** : le smoke test appelait l'empaqueteur par chemin absolu, plus trois renvois vivants dans la doc.
- `[1× — 2026-07-23e]` **Un skill muet n'est pas inutile : sa règle est recopiée dans le `CLAUDE.md`.** L'agent lit la règle au démarrage, exécute la commande, n'ouvre jamais le skill — qui portait le diagnostic. Cause n°1 des 11 skills à zéro invocation sur 194 sessions.
- `[1× — 2026-07-23f]` ⭐ **Un lien pourri que PERSONNE n'a remarqué en 2 mois est la preuve qu'on n'ouvre jamais le skill.** `ts-docs` : 2 de ses 4 URLs en 404 (repo TS-Website restructuré), 0 invocation → retiré, ses 3 sources valides repliées dans `framework-dev`. La rot silencieuse d'une ressource EST le signal de non-usage — plus fiable qu'un compteur.
- `[1× — 2026-07-23f]` **« Ni garder ni jeter » n'est pas une réponse quand le user demande de trancher.** Données à l'appui : `rfc` (4 invocations, URLs revérifiées valides) gardé ; `ts-docs` (0 + liens pourris) retiré. Décider + justifier, pas « on verra ».

## 📦 Surface npm & publication (chantier release en cours)

- `[1× — 2026-07-23]` **Le seul consommateur qu'on exerce n'est jamais celui qui a le problème.** Six paquets publiaient `exports["."].types → ./index.ts`, absent du tarball (`files:`) : invisible dans le repo self-hosted, cassé pour tout installeur npm. Vérifier une surface publiée = **dépaqueter le tarball** (`npm pack` + lire le manifeste), jamais lire le `package.json` du dépôt.
- `[1× — 2026-07-23]` **`publishConfig.exports` n'est PAS appliqué par npm** (c'est pnpm/yarn). Testé avant de le proposer.
- `[1× — 2026-07-23]` **Un import non déclaré ne casse rien ICI et deux choses AILLEURS** : turbo ne peut pas ordonner le build, et le consommateur npm n'installe pas la dépendance. Auditer les imports de **valeur** (pas seulement de types) contre les `dependencies`.
- `[1× — 2026-07-23]` **Un contournement documenté peut cacher une contrainte RÉELLE — la vérifier avant de le retirer.** `exports.types → ./index.ts` avait l'air d'une paresse ; c'était l'anti-race du CLAUDE.md. 4 `clean && build` complets pour le prouver (le `dist` d'avant masque exactement cette panne).

## 🐳 Décor de test (conteneurs, dist, sortie capturée)

- `[1× — 2026-07-23g]` **Un banc e2e a un DÉCOR ; les lancer en boucle naïve = faux « KO ».** 17 bancs e2e d'affilée sur le serveur dev standard → **13 « KO », 0 vrai bug**. Trois pièges, tous du décor : opt-in manquant (le banc DIT « relance avec `NF__…` »), DESTRUCTEURS (`graceful-shutdown`/`cluster-*` tuent le serveur partagé → cascade `ECONNREFUSED`), store PERSISTANT (résidus d'un run mort → « liste pas revenue à l'état initial »). Gradué → `nodefony-load-test` §RÈGLE N°2 + table décor.
- `[1× — 2026-07-23g]` **`assert.rejects(fn)` NE CAPTE PAS un throw SYNCHRONE du thunk.** Une garde qui lève AVANT le `Promise.resolve` d'un store non-`async` fuse hors du `await` interne → test rouge malgré le BON comportement. `try { await store.listPage(…) } catch` capte sync ET async — comme le vrai appelant admin (`async`).

- `[1× — 2026-07-23]` **Un service derrière un `profiles:` compose n'est JAMAIS monté par un `up` nu** — PostgreSQL et MariaDB étaient marqués « exercés » sans avoir jamais tourné. Un ID de réseau docker recréé les fait échouer au démarrage (volumes nommés = 0 perte à la recréation).
- `[1× — 2026-07-23]` **Un `dist/` réduit à `types/` casse un AUTRE module, avec un message qui ne le nomme pas.** Vérifier le décor AVANT la batterie : `docker ps` + profils compose + `ls <paquet>/dist/index.js`. Trois commandes contre quinze minutes de run.
- `[1× — 2026-07-22]` **Remplacer un décor ÉPHÉMÈRE par un décor PERSISTANT révèle les bancs non rejouables** (mongod neuf à chaque run → conteneur permanent : les bancs qui n'effaçaient rien sont tombés).
- `[1× — 2026-07-22]` **« Même dialecte » n'est pas « même serveur »** : MariaDB et MySQL Community partagent driver et dialecte, mais divergent sur collation, bornes numériques et arbitrage des uniques.

- `[2× — 2026-07-24]` **`head -N` fabrique un faux diagnostic.** J'ai conclu « la page Webhooks n'existe pas » sur un `ls | head -40` tronqué — le fichier venait juste après dans l'ordre alphabétique. Même famille que `tail`/`$?` après un pipe : **une sortie coupée n'est pas une absence**.
- `[2× — 2026-07-24]` **zsh ne découpe pas une variable non quotée** (contrairement à bash) : `perl … $FILES` a reçu UN seul argument contenant tous les chemins, et le message d'erreur ne le disait pas. Passer par `xargs` quand une liste de fichiers doit devenir des arguments.
- `[2× — 2026-07-24]` **Une substitution mécanique remplace plus large que prévu.** `s/ \(\)//g`, censé nettoyer des parenthèses vides laissées par une dé-datation, a mangé les `()` d'une arrow function dans un exemple de code ; et remplacer un motif « par `)` » a laissé neuf parenthèses orphelines. Après toute passe automatisée : relire le diff, et vérifier l'équilibrage.

## 🧯 Justifier une absence (le réflexe qui fabrique des trous)

- `[1× — 2026-07-23]` ⭐ **Un slogan sur la NATURE d'un composant n'est pas une justification.** « Couverture adaptée à la nature, pas parité SQL×NoSQL » servait à expliquer une absence qui n'avait aucune raison d'être.
- `[1× — 2026-07-23]` ⭐ **Vérifier ce que le composant porte DÉJÀ de la même famille avant d'invoquer sa nature.**
- `[1× — 2026-07-23]` **Une couverture partielle affichée sans ses cases vides devient un choix aux yeux du lecteur** — montrer AUSSI ce qui n'est pas couvert.
- `[1× — 2026-07-24]` **Écrire la limite vaut mieux qu'un exemple qui ne marche pas.** Demande d'un exemple « métier » pour les webhooks : impossible, la source est le journal d'audit et sa liste de catégories est FERMÉE. Plutôt qu'un `order.paid` qui ne partirait jamais, la page dit la limite et nomme le chantier qui la lèvera. Vérifier l'enum AVANT d'écrire l'exemple, pas après.

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

- `[1× — 2026-07-23g]` **Un banc qui n'EXTRAIT pas ce qu'il note teste du vent.** Le `trigger-bench` des skills exige `Déclencheurs :` (deux-points COLLÉ au mot) ; ma ligne `Déclencheurs (toute édition…) :` (parenthèse avant le `:`) cassait le split → **0 déclencheur extrait**, le skill ne scorait que sur sa prose. J'ai chassé un scoring « aberrant » côté FORMULE une demi-heure avant de voir que le PARSEUR ne lisait rien. Vérifier que le gate VOIT son entrée avant d'interpréter son verdict.
- `[1× — 2026-07-23g]` **Un test qui scanne PLUS LARGE que la prod fabrique des faux positifs.** `corpusLinks` scannait `session-retros` (exclu du portail réel via `scan.exclude`) et SUIVAIT un symlink racine (`docs/MIGRATION_STATUS.md`, liens relatifs à la RACINE) → 2 « liens morts » incliquables. Aligner le test sur ce que le consommateur RÉEL indexe (mêmes exclusions, ignorer les symlinks) — pas réécrire les fichiers.

- `[1× — 2026-07-22]` **Un gate qui échoue toujours pour de mauvaises raisons finit ignoré, y compris le jour où il a raison.** Corollaires : distinguer le CODE de la PROSE dans un markdown ; nommer le fichier, pas son basename ; **dire combien d'exceptions il a acceptées**.
- `[1× — 2026-07-22]` **Un contrôle peut être satisfait PAR ACCIDENT — le vérifier avant de l'imposer** (l'« intro en blockquote » matchait déjà pour une autre raison).
- `[1× — 2026-07-20]` **Changer le FORMAT d'un contenu peut le sortir du champ de vision de son gate** — étendre le gate en même temps que le format.

- `[1× — 2026-07-24]` ⭐ **Un test rouge en permanence cesse d'être lu.** `create.test.ts` échouait depuis des jours ; ni le test ni le code n'étaient fautifs — l'assertion cherchait `RequestContext` dans le FICHIER entier, et le template avait gagné un commentaire pédagogique qui le cite à raison. Une assertion doit viser **ce que le code fait**, pas ce que le fichier contient. Resserrer la visée, jamais désarmer : vérifié qu'elle mord encore sur un usage réel.
- `[1× — 2026-07-24]` **Un catalogue déclaré et consommé par personne** : `OPT_IN_SWITCHES` existait depuis toujours, seul `test:all` le lisait. Résultat, dès que l'infra était présente le rapport signait « ✔ toutes cibles exercées » en laissant 9 tests muets. Un gate qui ne regarde qu'une moitié du silence produit un vert menteur.

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
