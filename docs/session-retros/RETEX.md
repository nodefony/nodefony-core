# RETEX.md — digest des retours d'expérience (SAS, lu à chaque début de session)

> **Rôle** : sas entre les retex bruts (`docs/session-retros/archive/<date>-<id>.md`, jamais relus
> seuls) et les leçons durables (mémoires `feedback_*` indexées dans `MEMORY.md`). Il porte les
> **frictions récentes pas encore confirmées**. Le skill `nodefony-session` le **lit au START/RESUME**
> et le **met à jour au END** (3-5 bullets du jour, par thème).
>
> **Règle anti-doublon (CRITIQUE)** : une leçon est **soit** ici (sas), **soit** en `feedback_*`
> (graduée). **JAMAIS les deux.**
>
> **🔴 SEUIL DE GRADUATION — il porte sur le THÈME, pas sur le compteur d'un bullet.** Un thème qui
> atteint **~5 frictions distinctes** est démontré et part en `feedback_*`, puis disparaît d'ici.
> Le compteur `[N×]` ne sert qu'à repérer une friction qui se répète à l'identique — il ne
> déclenche rien. _Pourquoi ce changement (2026-08-02) : l'ancienne règle « ≥3× » n'a JAMAIS
> déclenché en 135 frictions — chaque session écrivait un bullet neuf au lieu d'incrémenter, si
> bien qu'un thème à 35 frictions en dix jours n'a jamais été gradué._
>
> **Taille bornée : ~1 écran.** Snapshots complets avant coupe :
> `archive/RETEX-snapshot-<date>.md` — rien n'est perdu.

---

## 🏭 Ce que le PRODUIT construit n'est pas ce que la CONFIG demande

- [1× — 09-05f] **Un mécanisme du produit injectait une clé que AUCUN fichier de configuration ne
  contient.** Passer les schémas de module en `z.strictObject` a fait tomber le boot du dépôt
  entier sur `module-security` — pas une faute de frappe, mais l'override inter-modules
  (`readOverrideModuleConfig`) : la clé est APPLIQUÉE à sa cible puis LAISSÉE dans les options du
  porteur. `z.object` la faisait disparaître au parse, donc personne ne l'avait jamais vue en des
  années. La leçon dépasse le cas : **la config qu'un schéma valide n'est pas celle qu'on lit dans
  les fichiers** — elle est composée au boot par le Kernel, et durcir une validation révèle
  d'abord ce que le produit s'injecte à lui-même.

- [1× — 09-04b] **Lire un fichier de configuration ne dit pas ce qui s'EXÉCUTE.** Le
  `include` du tsconfig d'une app générée ne contient pas `modules/**` : j'en ai conclu — et
  failli graver dans un commentaire — que le module généré n'était jamais typechecké. Faux :
  `create module` CHAÎNE les scripts de l'app vers ses workspaces (`ensureWorkspaces`), et
  c'est npm qui décide. Seul le TÉMOIN FAUTIF planté dans le module l'a montré. Une lecture
  de config est une hypothèse, pas une mesure.

- [1× — 09-02] **Le geste que le fichier PRESCRIT n'était joué par personne.** L'en-tête de l'entité générée dit « ne modifie pas ce fichier à la main : relance la commande avec tes champs ». Suivre ce conseil cassait l'application de TROIS façons — nom de table divergent, nom d'export divergent du gabarit (donc un `index.ts` qui importe un symbole disparu), câblage refusé. Aucun test ne jouait ce geste, et les trois sont tombés en vingt minutes dès qu'une tâche de banc l'a joué. **Ce qu'un produit conseille par écrit doit être exécuté par un banc** — sinon le conseil vieillit sans que personne s'en aperçoive.
- [1× — 09-02] **Un second bloc TSDoc DÉTACHE le premier.** Une garde conditionnelle insérée entre le TSDoc d'une classe et son décorateur donnait, au rendu, deux blocs `/** */` successifs : le premier — la documentation de la classe — n'était plus attaché à rien. Le code compile, le gate de format est vert, aucun contrôle ne le dit. Un décorateur ajouté se pose ENTRE les décorateurs existants, jamais avant le commentaire de la déclaration.
- [1× — 09-02] **Une ligne ajoutée à une table markdown casse les quatre variantes du gate de format.** prettier réaligne une table sur sa cellule la plus large : une entrée plus longue que ses voisines rend non conforme le rendu que l'UTILISATEUR reçoit, pas le gabarit du dépôt. Réaligner à la main sur la largeur des voisines, ou en faire une liste.

- [1× — 09-01] **Un fichier que personne ne mentionne décidait de ce que `npm install` EXÉCUTE.** L'image d'une application générée ne se construisait plus dès qu'un `package-lock.json` existait — c'est-à-dire dès le premier `npm install` du développeur : sans verrou npm SAUTE les scripts d'installation et le dit (« not yet covered by allowScripts ») ; avec verrou il les exécute, et `node-gyp rebuild` meurt faute de Python dans `node:*-slim`. Ni la plateforme ni la version de npm n'entrent en jeu — vérifié dans les deux sens. Rien dans le Dockerfile, la config ou les tests ne parlait de ce fichier : **quand deux exécutions de la MÊME commande divergent, chercher ce qui a changé dans le RÉPERTOIRE, pas dans la commande.**

- [1× — 09-01] **L'image de production ne contient PAS les outils de développement — donc certains gestes y sont structurellement impossibles.** J'avais fait générer la première migration par le banc DANS le conteneur, avant de l'appliquer. Refus du produit : `NF_GENERATE_TOOL_MISSING` — `drizzle-kit` est une devDep, et l'image installe en `--omit=dev`. C'est juste : APPLIQUER une migration ne réclame aucun outil tiers, seul l'ÉCRIRE en demande un. La leçon dépasse le cas : **avant de placer un geste dans une image, regarder ce que cette image CONTIENT** — le dépôt et l'artefact déployé n'ont pas le même inventaire, et seul le banc réel le dit.

- [1× — 09-01] `nodefony frontend:build` publiait un bundle de **développement** : `mode: "production"` était passé à Vite depuis toujours, mais Vite dérive `isProduction` de `process.env.NODE_ENV`, **qui prime**. Le défaut n'apparaissait ni dans la config, ni dans un test, ni dans un échec — seulement dans le fichier RENDU (`import.meta.env.DEV` vrai chez l'utilisateur final, messages d'aide du framework de vue publiés). Trouvé par hasard, en éprouvant un point que je venais de déclarer « non prouvé ».
- [1× — 09-01] Corollaire du même jour : le seul bundle qui disait la vérité sur l'état du produit était celui que je n'avais PAS reconstruit à la main. Mes propres expériences avaient « réparé » les quatre autres, et le tableau récapitulatif donnait une image rassurante et fausse — c'est l'HEURE de modification qui a rétabli la lecture.

## 🧭 Un identifiant écrit dans la MAUVAISE LANGUE fabrique un faux verdict

- [1× — 09-06b] **Un outil de renommage PRÉSERVE les contrats qu'il ne comprend pas, et laisse
  l'arbre à moitié traduit.** `findRenameLocations` déplie un raccourci pour ne pas casser la forme
  d'un objet : `{ dansConteneur }` devient `{ dansConteneur: inContainer }` — la clé d'ENTRÉE reste
  française, l'appelant continue de la passer, et rien ne le dit. Même mécanique sur les clés de
  sortie. Le contrôle de dérive VALIDE, puisque la transformation demandée a bien eu lieu.
  **Après un lot, relire les objets littéraux du diff, pas seulement le compte de symboles** — et
  se rappeler qu'un contrat de données n'est pas un symbole.
- [1× — 09-06b] **Un renommage juste peut être une erreur : la clé qui sert AUSSI d'en-tête.**
  `security:user:list` compose UN objet pour `console.table` et pour `--json` ; ses clés sont les
  colonnes affichées. `identifiant` → `login` a rendu une table à moitié traduite, à côté de
  `rôles` et `verrouillé` que leurs ACCENTS dérobaient au dictionnaire. Renommage fait, puis
  DÉFAIT, et l'exception déclarée avec son motif. **Le signe qui alerte : des clés voisines
  accentuées, ou un `console.table` en aval.**
- [1× — 09-06] **Un renommage peut CHANGER LE COMPORTEMENT sous un typecheck vert, et le contrôle
  de dérive le valide.** Deux fois dans le même lot. (1) Le span de rename d'un membre privé PORTE
  le croisillon : `#prendreVerrou` est devenu `takeLock`, membre **public** — compile, passe les
  tests, expose une méthode interne. (2) Renommer `cible` → `target` à côté d'un `target` existant
  ne casse rien : ça crée deux homonymes, et TypeScript relie le raccourci `{ target }` à la
  MAUVAISE — la fonction s'est mise à renvoyer l'URL analysée au lieu de la cible de migration.
  Le contrôle de dérive a dit « aucune dérive » : la transformation demandée est exactement celle
  qui a eu lieu. C'est `oxlint` (`no-unused-vars`) qui a sauvé le coup, par chance. **La règle qui
  en sort : avant de renommer, vérifier que la cible n'est pas DÉJÀ déclarée dans le fichier** —
  c'est une garde, pas une vigilance. Outil corrigé + auto-contrôle (`515be4f3`), les deux cas
  vus rouges en débranchant leur moitié.

- [1× — 09-05i] **Quatre sortes de consommateurs ne sont dans AUCUN programme TypeScript — et
  rompre un export ne leur arrache pas un mot.** Le retrait des alias de la veille les a tous
  trouvés d'un coup : (1) du `.mjs`, qui crie au moins une `SyntaxError` au premier import ; (2) un
  fichier `.ts` **hors de tout `tsconfig`** — `scripts/test-all.ts`, le lanceur de tests du dépôt,
  que l'`include` de la racine ne couvre pas ; (3) un **import dynamique**,
  `({x} = await import("nodefony"))`, qui rend `undefined` en SILENCE — ici `shell: undefined`,
  soit la règle du shell Windows morte sans un signe ; (4) un test qui **type son sujet à la main**
  (`Object.create(prototype) as { … }`, `JSON.parse(t) as { … }`) : le cast continue de compiler,
  seule l'exécution crie. Le typecheck vert ne dit donc rien de la surface RÉELLE. Après un lot de
  renommage, chercher l'ancien nom dans TOUT le dépôt — `.mjs`, `.ts` hors tsconfig, `.md` — pas
  seulement dans ce que le compilateur voit.
- [1× — 09-05i] **Un renommage juste peut déplacer une clé de DONNÉES sans qu'on le remarque.**
  `mcpText({ total, parPaquet })` composait une clé de la réponse JSON d'un outil MCP : le
  LanguageService l'a renommée comme un identifiant — ce qu'elle est aussi. Le choix se pose alors
  (ici : la garder anglaise, la sortie étant déjà à moitié en anglais), mais il faut le VOIR. Ce
  qui l'a rendu visible est le shorthand cassé (`perPackage: perPackage`) qu'`oxlint` ne recolle
  pas dans un objet littéral — un signal fortuit, pas un contrôle.

- [1× — 09-05h] **Un outil de renommage qui réutilise un offset relevé AVANT sa première édition
  désigne un AUTRE symbole.** `symbole()` s'est retrouvée nommée `state()`, homonyme de son propre
  paramètre — et ça COMPILE. Le typecheck ne voit pas un renommage FAUX, seulement un renommage
  INCOHÉRENT ; seul un contrôle qui confronte le résultat au plan, liaison par liaison, l'attrape.
  Corollaire : renommer édite aussi des sites situés AVANT celui qu'on traite, donc tout relevé de
  positions antérieur est périmé — recollecter à chaque tour.
- [1× — 09-05h] **Trois choses portent un nom sans être des identifiants, et se cassent si on les
  renomme** : une clé de registre désignée par chaîne (`group: "LANCER"` dans chaque commande), un
  littéral d'union qui est un CONTRAT (`"ok" | "echec"`), et du CODE écrit dans une chaîne (un
  worker passé à `node -e`). La première a fait disparaître deux groupes entiers d'un menu — sept
  tests rouges ; la troisième a rompu le protocole entre deux processus, sans un mot, parce que le
  récepteur lisait un `JSON.parse` donc un `any`.

- [1× — 09-05c] **Le gate de langue s'accusait lui-même 404 fois — et il avait tort.** Tous les constats portaient sur les CLÉS de sa table de traduction (`rendre: "render"`) : un dictionnaire français DOIT contenir des mots français. Mais écrites en JavaScript, ces clés sont des DÉCLARATIONS de propriété, que le gate a raison d'extraire ailleurs. Les quoter ne tenait pas (le formateur les dé-quote). Remède : sortir les données en `.json`, où un mot redevient une donnée — gate 2 880 → 1 147 lignes, `scripts/` 558 → 154 constats réels.
- [1× — 09-05c] **Le seul faux positif du dictionnaire sur 79 523 identifiants tiers était `comparer`** — un NOM anglais (`IEqualsComparer` mobx, rxjs, `IComparer` .NET) dont la racine `compare` figurait DÉJÀ dans les homographes exclus. Aucune règle syntaxique ne pouvait le trouver : « exclu + suffixe » rend 48 cas dont 47 légitimes (`cacher`, `chargement`, `poser` ne sont pas anglais). **Seule la mesure sur corpus tiers tranche cette question-là.**

- [1× — 09-02] **La matière portait des sauts de ligne ÉCHAPPÉS — un `[^\n]` les traverse sans les voir.** La parole de l'agent est du JSON re-sérialisé : un saut de ligne y est deux caractères. `rm -f copie.sqlite` suivi, LIGNE SUIVANTE, d'un `cp base.db …` a donc été lu comme une seule suppression de base, et l'agent qui supprimait sa copie jetable avant d'en refaire une — les deux gestes que le produit prescrit — s'est vu imputer la destruction. Le motif était juste ; c'est la MATIÈRE qui mentait. Avant d'appliquer un motif ligne à ligne, vérifier que les frontières de ligne sont réelles.
- [1× — 09-02] **Le contexte d'ANCRAGE d'une édition n'est pas un geste.** `Edit` transporte `old_string` : par définition ce qui était déjà là, et les lignes de `new_string` qui s'y retrouvent à l'identique sont l'ancre que l'outil réclame. Les compter fait imputer à l'agent ce que le PRODUIT a écrit — un `DROP TABLE` généré par `orm:generate` apparaissait des deux côtés d'un `Edit` portant sur une autre ligne.

- [1× — 08-29e] **Une sonde écrite au réflexe HTTP standard contre une API aux identifiants
  français.** Le socle du banc expose `demander(…, {corps, jeton, entetes})` → `{statut, corps}` ;
  mon juge neuf a passé `body`, `headers` et lu `.status`. Conséquence : le POST partait **VIDE**,
  la ligne témoin n'était jamais trouvée, et le rapport accusait l'AGENT d'avoir détruit une base
  intacte. Aucune erreur levée — un objet JS accepte n'importe quelle clé. Le contrôle ne pouvait
  pas le voir : il éprouvait `juger()` sur des faits DÉJÀ collectés, c'est-à-dire la moitié qui
  était juste. **Un juge imprime désormais sa COLLECTE à côté de son verdict** : sans elle,
  « la base ne l'a pas » ne dit pas si c'est la base qui refuse ou la sonde qui parle mal.
- [1× — 08-29e] **La règle du dépôt était claire, et je l'ai propagée au lieu de la signaler.**
  « Doc et commentaires en français, identifiants en anglais » : le socle la violait depuis
  longtemps, je m'y suis conformé en écrivant par-dessus. Se heurter à une convention fautive et
  s'y plier la grave un cran plus profond — c'est le moment où il faut la nommer.
- [1× — 08-29e] **Le renommage mécanique : la SIGNATURE se renomme, les USAGES non.** Cinq familles
  ratées par le script et trouvées une à une par les contrôles rouges — définition de méthode dans
  une classe (pas de `.` devant), usage nu dans un corps (`corps += c` après `let body`), import
  MULTI-LIGNES, **paramètre destructuré à valeur par défaut** (`{ statut = 200 }` face à un
  appelant passé à `status:`), et **raccourci de propriété** (`{ token }` ≠ clé `csrfToken`). Les
  deux dernières sont **MUETTES** : la valeur arrive `undefined`, rien ne lève, le faux serveur
  rend 200 au lieu de 404 et le juge conclut faux. Corollaire : un renommage global anglicise aussi
  la PROSE — bornée aux lignes de code, la règle épargne « le jeton », « le corps de la réponse ».

## 🤖 Un agent LIT l'interdit et le transgresse quand même — il manque le GESTE de remplacement

- [1× — 08-30c] **Le refus d'effacement PROPOSAIT le contournement de sa propre garde.** `orm:reset` hors développement rendait, en premier geste à copier, `NODE_ENV=development nodefony orm:reset` — et la liste blanche lit `NODE_ENV` en premier. La ligne effaçait donc la base de production de qui la copiait, et le contrat dit précisément qu'un agent exécute `nextActions[0]` sans lire la prose. Le `meaning`, lui, disait l'inverse (« fais-le avec l'outil de ta base ») : la prose et le geste machine se contredisaient. **Un refus n'offre jamais un geste qui rouvre ce qu'il refuse** — et c'est désormais gardé par un test qui interdit toute variable d'environnement dans les gestes d'un refus.
- [1× — 08-30c] **Un état sans AUCUNE sortie fabrique la destruction, même quand tous les messages sont vrais.** Un historique affirmant une migration jamais exécutée : la génération disait « c'est l'historique qu'il faut reprendre » et renvoyait à la réparation, qui ne sait lever que des marqueurs d'ÉCHEC et répondait « rien à réparer ». Trois messages exacts, zéro geste. Le remède n'était pas de mieux formuler mais de **rendre le geste au produit** (`repair --forget <source>/<tag>`, borné à une entrée nommée). Corollaire : quand un refus prescrit un geste, vérifier que la commande visée l'ACCEPTE dans l'état où l'on se trouve — quatre refus sur cette grappe rejouaient leur propre refus.

- [1× — 08-30] **Le produit ne laissait aucun chemin, une case plus loin.** Tâche 33 rejouée après
  les correctifs de la veille : 1 PASS / 3, et les trois runs suivent la MÊME route. `orm:generate`
  sur une base déjà en place produit un `CREATE TABLE` complet (l'outil compare le code à son propre
  journal, jamais à la base) ; `baseline` adopte cette migration jamais exécutée et déclare « à
  jour » alors que la colonne manque. Reste alors zéro geste : **2 agents sur 3 ont édité
  l'historique à la main** (`DELETE FROM nodefony_migrations`), **1 sur 3 a supprimé la base**, et le
  seul run vert a réparé le produit (migration `--custom` + `meta/_journal.json` édité). L'interdit
  tient tant qu'un chemin reste ouvert — ici il n'en restait aucun. Ticket #118.
- [1× — 08-29e] **Trois runs, trois destructions de base, avec la sonde de lecture VERTE.** La
  tâche de banc dit « la base doit pouvoir suivre, prouve-le » ; le skill dit « ne supprime pas une
  base pour repartir propre ». L'agent a lu le skill (sonde verte 3/3), trouvé `baseline`, et s'en
  est servi pour **se fabriquer un banc d'essai** : `rm -rf var/`, reconstruire une base « v1 »
  depuis le code d'avant, y rejouer sa migration. Ce n'est pas de la désobéissance : c'est la seule
  façon de PROUVER qu'il connaisse. **Un interdit sans son geste de remplacement ne tient pas** —
  il manquait « comment éprouver une migration sans toucher à la base » (une COPIE, `--dry-run`,
  un connecteur jetable). La découvrabilité n'était pas en cause, le contenu si.
- [1× — 08-29e] **La ligne SEMÉE au décor est ce qui a fait la différence.** Sans elle, ces trois
  runs passaient pour des succès : schéma correct, état à jour, ressource qui s'écrit, tests verts.
  Une donnée témoin transforme « ne détruis pas » d'une consigne en un FAIT mesurable.

- [1× — 08-29f] **Le geste de remplacement ne suffit pas si le PRODUIT ferme la dernière porte.** Après avoir écrit dans le skill « éprouve une migration sur une base d'ESSAI », le banc est resté rouge 3/3 — et le transcript montre que l'agent avait CHARGÉ le skill (une première) et appliqué sa méthode. Il a détruit parce que trois réponses, vraies chacune séparément, ne laissaient plus AUCUN geste : `orm:migrate` n'a rien en attente, `orm:migrate:status` rend 0, `orm:generate` répond « le schéma n'a pas bougé ». Qui lit ces trois-là conclut que l'outil ne peut plus rien pour lui. Un interdit ne tient que si un chemin reste OUVERT — et c'est l'outil, pas la doc, qui doit le laisser ouvert.

## ⚙️ Réutiliser du code d'un SCRIPT, c'est le RELANCER

- [1× — 09-05i] **`import()` d'un script pour « vérifier qu'il charge » l'EXÉCUTE.** Voulant
  prouver que trois scripts du banc importaient encore, j'en ai démarré un vrai (banc de scaffold,
  tué à la main). Un module au corps non trivial n'a pas de mode « je regarde seulement » : pour
  éprouver une chaîne d'imports, lancer l'auto-contrôle prévu — ici `exec-portable.selftest.mjs`,
  qui traverse le même module partagé et rend un verdict.

- [1× — 09-02] **Un module qui agit à l'import rend le contrôle de son IMPORTATEUR illisible.** Un décor de banc importait deux fonctions pures d'un décor frère ; celui-ci lançait son auto-contrôle sur `process.argv.includes("--selftest")`, au niveau module. Lancer le contrôle du NOUVEAU déclenchait donc aussi celui de l'ancien, et son rouge se serait affiché sous le mauvais nom. La forme sûre existait déjà dans le dépôt (`process.argv[1]?.endsWith("<ce fichier>")` d'abord, le drapeau ensuite) — elle n'avait simplement pas été appliquée partout.

- **Importer `test-all.ts` pour une seule fonction relançait l'infra, le build et la batterie
  entière.** Un script n'est pas une bibliothèque : son corps s'exécute à l'import. Ce qu'on veut
  partager se SORT du script d'abord (`scripts/lib/docker.ts`), sinon « réutiliser » veut dire
  « relancer ». Le symptôme était visible — `npm run coverage` affichait la bannière de la batterie
  de tests — mais il aurait pu ne pas l'être. [1× — 08-26]
- **Poser la variable d'un service ABSENT ne rend pas les tests skippés : elle les fait ÉCHOUER.**
  `NF_LOKI_TEST_URL` posée sans Loki → 4 tests du cœur rouges, module entier sans rapport, et le
  rouge imputé au produit. Un banc qui n'a personne au bout de son URL ne se tait pas, il tombe.
  Constater la santé du conteneur AVANT de poser quoi que ce soit. [1× — 08-26]

## 🧪 Un test qui ne parle jamais au serveur — et celui qui passe débranché

- [1× — 09-05f] **786 tests verts, et pas un seul ne bootait.** Le user a posé la question qui
  tranche : « comment un crash serveur sans test en échec, c'est possible ? » Réponse : les suites
  de `http`, `framework` et des huit autres modules valident les schémas sur des configs
  **fabriquées par le test**. Aucune ne compose la configuration comme le Kernel la compose. Le
  seul test qui boote pour de vrai (`CliIntegration.test.ts`) est **opt-in** (`NF_RUN_CLI_BOOT`),
  donc skippé par `npm test` — et un skip compte comme vert. Il rendait 10 échecs dès qu'on le
  lançait. **La forge le pose, le trou était LOCAL** : une passe verte en local ne dit rien de ce
  que la forge exercera. Corollaire : quand un changement touche ce que le RUNTIME compose, la
  seule preuve est un boot, pas une suite unitaire — si longue soit-elle.

- [1× — 09-04] **Trois tests HÉRITAIENT de leur décor au lieu de l'ÉNONCER : verts chez moi, rouges partout ailleurs.** Deux lisaient `process.env.CI` sans le savoir (posé sur toute forge, il arme `--strict` et change le code de sortie mesuré) ; le troisième lisait `process.stdout.columns` — le rendu replie ses phrases, si bien qu'un `assert.include` sur « SANS aucun serveur en écoute » passe au-delà de 72 colonnes et tombe en deçà. **Tout ce qu'un test ne pose pas, il l'emprunte à la machine.** Le décor se pose dans le helper de capture (largeur fixée) ou s'écrit dans l'appel (`--no-strict`), jamais ne se subit.

- [1× — 09-01] **Le décor du dépôt diverge de celui de la forge, et c'est le dépôt qui rend le faux rouge.** `test:all --load` démarre le serveur par `start.sh`, donc en développement AVEC le rechargement à chaud ; la CI lance le MÊME `test:load` en `development --no-watch`, précisément parce que le gate `heap WS sustained` est documenté depuis juin comme flaky avec le watcher (HMR/DevSupervisor retiennent du heap que `global.gc()` ne rend pas). Résultat : 70,6 MB en local contre un seuil de 30, et vert en CI sur le MÊME commit. Deux implémentations d'une même règle, dont la locale est la moins fidèle. **Avant de croire un seuil qui saute en local, regarder avec quel décor la forge le joue.**

- [1× — 31/08] **Sept mocks décrivaient un serveur qui n'existe pas** : ils ouvraient la socket sans jamais envoyer le `realtime:welcome` que le vrai serveur enchaîne. **16 cas verts contre un serveur imaginaire**, dont un nommé « ré-abonnement automatique au reconnect » qui prouvait l'INVERSE de son titre — le serveur jette tout ce qui arrive avant son welcome. Un mock répond ce qu'on a imaginé : quand il modélise un PROTOCOLE, il doit enchaîner les mêmes étapes, sinon les tests gardent le défaut au lieu de l'attraper.

- [1× — 08-31] **J'ai déclaré vert un banc dont l'étape décisive était SAUTÉE.** Validation faite en `--no-e2e` « pour aller plus vite », puis correctif poussé : la forge est tombée sur `la ressource RÉPOND vraiment (HTTP, serveur réel)` — précisément l'étape que ce drapeau saute. L'écrit disait pourtant « non lancé : e2e ». **Nommer ce qu'on n'a pas lancé ne dispense pas de le lancer avant de pousser** : la phrase protège le lecteur, pas le dépôt.

- [1× — 08-29d] **Rien n'exerçait l'artefact que le produit ÉCRIT LUI-MÊME, et il était piégé.** Le gabarit qu'`orm:generate --custom` dépose porte la phrase « Séparer les instructions par `--> statement-breakpoint` ». Or le découpage cherchait ce texte AVANT de retirer les commentaires : la ligne d'aide était coupée en deux, et sa moitié droite — qui ne commence plus par deux tirets — partait au pilote comme une instruction. **Toute migration libre écrite en suivant l'aide du produit échouait**, en gravant une migration `failed` dans l'historique, c'est-à-dire une base bloquée. Les bancs unitaires de `splitStatements` étaient verts depuis toujours : ils lui donnaient des cas FABRIQUÉS À LA MAIN, jamais le fichier que la commande d'à côté produit. Trouvé en jouant le cycle complet dans une application générée, pas en relisant la fonction. **Ce qu'un générateur écrit doit être RELU par le consommateur qui le lira en vrai, au moins une fois, dans un banc.**

- [1× — 08-28j] **Ma feature a rendu les tests EXISTANTS écrivains dans le dépôt.** Le noyau publie désormais l'état de disponibilité sous `kernel.path`, qui vaut `process.cwd()` : les cas de `readinessRegistry.test.ts` — écrits bien avant, et qui n'avaient jamais rien écrit — se sont mis à déposer un `readiness.json` dans l'arbre de travail. Découvert par hasard, en listant le dossier pour autre chose. **Ajouter un EFFET DE BORD à une méthode déjà appelée par des tests change ce que ces tests font, sans qu'aucun d'eux ne rougisse.** Le contrôle : après avoir rendu une méthode écrivante, chercher qui l'appelle DÉJÀ dans les bancs — et vérifier l'arbre (`git status`, `ls` du dossier visé) après une passe.

- [1× — 08-28j] **Un rouge sous charge que j'ai failli m'attribuer.** `scaffoldFormeRendue` a dépassé son délai de 30 s pendant `test:all`, juste après un diff qui touche le noyau. Le réflexe « suspecter son propre diff » était le bon — mais la mesure a tranché autrement : 5,2 s isolé, et **58 s la veille en passant**, parce que le délai est PAR CAS et non par fichier. La cause réelle est un banc qui démarre **un processus par fichier vérifié**. Deux chiffres à confronter avant d'accuser qui que ce soit : la durée ISOLÉE, et la durée du MÊME banc au run précédent.

- [1× — 08-28f] **J'ai fait échouer `test:all` en lançant mes propres tests sur la base qu'il utilisait au même moment** — des `DROP TABLE` sur MariaDB pendant que la suite tournait dessus. Deux tests rouges, dont j'ai d'abord cherché la cause dans mon diff. Le module SAIT pourtant que sa base est partagée : il porte `fileParallelism: false` et le commentaire qui l'explique. La sérialisation protège les fichiers d'une MÊME passe — elle ne protège de rien contre une seconde passe lancée à la main. Règle simple : pendant une suite qui touche une base réelle, on ne lance RIEN d'autre dessus ; et un échec pendant qu'on travaille en parallèle se rejoue seul avant d'être diagnostiqué.

- [1× — 08-28d] **`assert.rejects` n'appelle JAMAIS son validateur quand la fonction jette de façon synchrone** — et better-sqlite3 est synchrone. Le test rougissait en affichant l'erreur qu'il attendait pourtant (`CHECK constraint failed`), ce qui envoie chercher dans le produit un défaut qui est dans le banc. Le remède tient en un mot : `async () =>` au lieu de `() =>`. Second piège du même appel, dans la même heure : une déclaration `function` a un `prototype`, donc Node la prend pour une **classe d'erreur** et tente un `instanceof` qui échoue toujours — un validateur s'écrit en fonction fléchée. Deux fois, l'instrument accusait le produit.
- [1× — 08-27] **Seize bancs WebSocket d'intégration, et aucun n'employait le client livré.** Tous
  ouvraient une socket `ws` nue et composaient les trames JSON-RPC à la main : ils prouvaient le
  SERVEUR, jamais que `RealtimeClient` et ses observateurs savent lui parler. Le user l'a dit d'une
  phrase — « le serveur ne tourne même pas ». Le banc écrit ensuite (globale `WebSocket` → transport
  navigateur → socle) a immédiatement corrigé deux hypothèses que le transport MOCK validait sans
  broncher : `1006` ne s'ENVOIE pas (la RFC le réserve, `ws` refuse), et le format coalescé du
  journal n'était juste que par chance. **Un mock répond ce qu'on a imaginé** — c'est précisément ce
  qu'un décodeur de protocole ne doit jamais être cru sur parole.

- **Un gabarit vérifié par `assert.include` sur son TEXTE rendu ne prouve rien de son comportement** [1× — 08-27] : la seule preuve du fournisseur React était qu'une chaîne figurait dans un fichier généré. Le monter pour de vrai (jsdom) et compter les connexions ouvertes a demandé une devDep, et c'est ce qui a révélé que le contrat tenait. Le même angle mort avait laissé publier un contrat que rien n'implémentait, le matin même.

- [1× — 08-23d] **`savepoint()` est un NO-OP chez Mongoose** (MongoDB n'a pas de
  savepoints). Un banc de coupure copié de drizzle l'utilisait pour « sonder » le
  serveur : il ne lui parlait JAMAIS et serait passé au vert sur une base éteinte. Avant
  d'utiliser une méthode de contrat comme SONDE, vérifier qu'elle fait une E/S sur CE
  dialecte.
- [1× — 08-23d] **Un test de bascule de primaire passait même en débranchant
  l'idempotence** qu'il prétendait éprouver : Mongoose dédoublonne en amont (son
  `readyState` n'émet que sur changement). Le débranchement est le SEUL révélateur ; sans
  lui, on publie un test complaisant en croyant avoir prouvé.
- **J'ai pollué ma propre mesure en travaillant pendant qu'elle courait.** Soak de 90 min annoncé
  « poste inutilisable » — puis j'ai commité, poussé, régénéré des fiches et interrogé la forge
  pendant les mesures. Le banc l'a relevé tout seul : « charge montée à 8,05 (départ 1,65) — un
  tiers a travaillé pendant la mesure ». Un décor partagé **ne dégrade pas** une mesure : il en
  change l'objet. Ce qui survit malgré tout (un heap plat ne se fabrique pas par pollution CPU) se
  garde ; le chiffre de pente, lui, se rejoue. [1× — 08-26]

## 🗄️ 🩺 Une correction qui ne couvre qu’un cas — GRADUÉ

> Gradué au CONSOLIDATE du 2026-09-07 — 28 frictions en mémoire
> **`feedback_fix_the_family_not_the_instance`** : corriger la RÈGLE et pas l’instance,
> vérifier que le remède n’est pas exposé au défaut qu’il corrige, et que le geste est ENTIER.
> Ne PAS réécrire ici.

## 🌍 Une portée GLOBALE n'est pas « un peu intrusive » — elle est FAUSSE

- [1× — 09-04c] **Renommer par expression régulière casse ce qui n'était pas visé — et le mot le plus
  anodin est le pire.** Pour passer `kernel/checks/` en anglais, j'ai mis `options` dans la table de
  renommage (une variable locale de test). Résultat : `this.options` réécrit dans TOUT `Kernel.ts`,
  ~40 erreurs de compilation. Second essai avec protection des chaînes et commentaires : des
  occurrences orphelines, le fichier ne compilait toujours pas. Éditer du code est une opération
  STRUCTURELLE sur un arbre syntaxique ; une regex fait de la correspondance de texte. Règle : un
  renommage se fait fichier par fichier avec `tsgo --noEmit` derrière chacun, ou par un outil qui
  comprend le langage — jamais par une table globale, si mécanique que la tâche paraisse.

- [1× — 31/08] **« on fait le 10.1 en 10 » : j'ai basculé les 17 tickets du jalon, il en fallait 2.**
  La demande visait les tickets 10.1 **de la grappe en cours**, pas le jalon entier — le contexte de
  la phrase le disait, sa lettre non. Rattrapé en une minute (7 restaurations), mais c'est un geste
  de pilotage VISIBLE, exécuté sur un lot large depuis une phrase courte. Règle : quand une consigne
  brève commande un geste de MASSE, en énoncer la portée déduite AVANT d'agir — une ligne suffit, et
  elle coûte moins que la restauration.

- [1× — 08-28l] **Un test qui affirme un ABSOLU sur un registre PARTAGÉ n'est vrai que dans le mode
  où il a été écrit.** « il n'y a qu'un contributeur » passait en développement et tombait en
  production, où le module de base inscrit sa propre voix dès que le contrôle de schéma vaut `fail`
  — le défaut hors développement. Le test ne mesurait pas SA contribution, il mesurait l'état du
  monde. Remède qui vaut au-delà : faire poser au test lui-même un tiers ÉTRANGER, pour qu'il rejoue
  la condition de production au lieu de la subir — il devient discriminant, et le rouge se voit en
  développement.

- **Le défaut était documenté au lieu d'être corrigé.** `ai:mcp` écrivait la porte MCP dans le
  foyer pour Vibe et Codex, et l'ANNONÇAIT : « deux applications Nodefony se disputent le même nom,
  la seconde efface la première sans un mot ». Or l'URL d'une porte porte un PORT : une déclaration
  globale ne peut désigner qu'UNE application — ce n'est pas un inconfort, c'est un résultat faux.
  Signal à reconnaître : **un commentaire qui décrit une collision au lieu de l'empêcher.**
  `[1× — 08-23c]`
- **Le dépôt contredisait sa propre commande, et c'est le dogfooding qui l'a montré** : un
  `.vibe/config.toml` COMMITÉ disait « jamais dans ~/.vibe » pendant que la commande y écrivait.
  Quand un fichier du dépôt argumente contre une de nos commandes, c'est la commande qui a tort.
  `[1× — 08-23c]`
- **Deux objections bloquaient, une seule tenait.** « Écrire le format d'un tiers » : levée en
  redirigeant `VIBE_HOME`/`CODEX_HOME` sur le projet — c'est LEUR binaire qui écrit LEUR format.
  « Le fichier n'est lu que dans un dossier de confiance » : vraie, mais elle se RETOURNE — un
  fichier non lu est inerte, une déclaration globale fausse est active. **Entre échouer en silence
  et réussir à côté, choisir le premier.** `[1× — 08-23c]`
- **Rediriger le home d'un agent y fait déposer ses fichiers de TRAVAIL** (`trusted_folders.toml`,
  `.codex/tmp/`). Un `.gitignore` qui ne versionne que la DÉCLARATION — dans le dépôt ET dans le
  gabarit d'app générée, sinon chaque app naît avec ces artefacts. `[1× — 08-23c]`

## 🎯 Un PORT qui répond ne dit pas À QUI — l'identité de la cible se PROUVE

- [1× — 09-06b] **Deux serveurs peuvent écouter le MÊME port sans qu'aucun ne lève.** Le dépôt se
  lie à `127.0.0.1:5151`, une application générée à `*:5151` — sur macOS et les BSD ce sont deux
  liaisons distinctes, le noyau accepte, et c'est la plus SPÉCIFIQUE qui reçoit le trafic local.
  Conséquences en chaîne : la politique de glissement de port ne se déclenche jamais (elle attend
  un `EADDRINUSE` qui ne vient pas), l'app annonce `READY`, publie ses ports dans son état
  d'exécution, et ses tests e2e interrogent le serveur du VOISIN — 3 échecs sur 15, tous en 404.
  Le détecteur VOYAIT le conflit et l'annonçait (« cette app prendra les premiers ports libres ») :
  elle ne les prenait pas. **Un port libre ne se déduit pas d'un `listen` qui réussit** ; `lsof`
  montre l'adresse, et c'est elle qui tranche. Ticket #214.
- [1× — 09-04] **Un repli greffé sur un `catch` ne s'exécute que si quelque chose LÈVE.** Le TSDoc promettait « l'utilisateur a toujours un help » ; le code attendait un rejet de `kernel.start()`, or `Kernel.startBoot` ne lève pas — il `terminate(1)`. Le repli était mort depuis toujours, et personne ne pouvait le voir en lisant la fonction qui le pose. **Se demander non pas « ai-je un repli ? » mais « par quel chemin exact y arrive-t-on ? ».**
- [1× — 09-02] **Mon propre décor manuel a écarté un run du banc.** Pour éprouver un juge neuf, j'avais monté une application témoin à la main sur les ports DÉDIÉS du banc, puis lancé le banc sans vérifier que le port était rendu — un `nodefony stop` avait été exécuté depuis un `cwd` réinitialisé, donc ailleurs. La garde d'instrument a fait exactement son travail : `CAUSE=port-deja-tenu`, verdict NON rendu, run écarté comme cause de DÉCOR plutôt qu'imputé à l'agent. Le coût est un run d'agent (73 tours, 0,77 $) payé pour rien. **Éprouver un juge à la main se fait sur d'AUTRES ports que ceux du banc, ou le port se constate libre avant de lancer** — `lsof -ti :<port>`, pas un `stop` dont on suppose l'effet.

- [1× — 09-01] Sonde CSP lancée avant d'avoir CONSTATÉ qu'aucun serveur ne répondait : deux serveurs se sont mélangés dans la même chronologie (3 ports → 12 → 3, incompréhensible). Refaite sur terrain vierge (`curl` → `000` + `nodefony status`), elle est devenue lisible d'un coup. **Un banc de démarrage commence par prouver que rien ne tourne.**
- [1× — 08-31d] **Un banc qui RECOPIE la règle du produit ne prouve rien — celui qui DEMANDE au
  serveur a fait tomber mon correctif à sa première exécution.** Pour #121, j'ai écrit dans le
  produit « MySQL ignore la casse des tables », déduit du dialecte. Le banc, lui, ne l'assertait
  pas : il crée une table en minuscules, tente un `SELECT` en casse mélangée, et compare ce que le
  SERVEUR en a fait à ce que le lecteur affirme. Verdict immédiat : `lower_case_table_names = 0` sur
  MySQL 8.4, les tables y sont SENSIBLES — et cela dépend de la MACHINE (0 sur Linux, 1 ou 2
  ailleurs), pas du moteur. Un banc écrit dans l'autre sens aurait répété la même erreur que le
  produit, et les deux auraient été verts ensemble. La forme qui mord : **le verdict attendu n'est
  écrit nulle part, il est constaté**.

- [1× — 08-29c] **Un superviseur de développement ORPHELIN a fait rendre 404 à toute une suite, qui a accusé les routes qu'elle mesurait.** Il tenait `127.0.0.1:5151` (relancé par launchd, parent perdu) pendant que l'application générée écoutait sur `*:5151` : deux serveurs, un seul port, et `curl` atteint le plus spécifique. J'ai d'abord suspecté mon diff — à raison, mais la comparaison des plans de génération l'a innocenté, et c'est un `lsof` qui a tranché. **Avant de diagnostiquer un 404 sur un banc de bout en bout : `lsof -nP -iTCP:<port> -sTCP:LISTEN`, et compter les lignes.**
- [1× — 08-29c] **Le repli `?? 5151` de quatre gabarits de test fabriquait ce faux verdict.** Un port de repli n'est pas une commodité : quand l'état d'exécution est illisible, il envoie la suite interroger le premier serveur venu sur la machine. Un test qui parle au mauvais serveur ne se contente pas d'échouer — il rend un verdict FAUX, et l'on cherche le défaut dans le code mesuré. Remplacé par une fonction unique qui LÈVE en disant quoi vérifier.

- [1× — 08-27] **`-c core.hooksPath=.husky` a désarmé les hooks pendant deux commits, en silence.**
  Le dépôt utilise `.githooks` ; pointer un dossier VIDE ne produit aucune erreur — git n'exécute
  simplement rien. Ni prettier, ni oxlint, ni commitlint, ni le contrôle des fiches de skills. La
  forge serait sortie rouge sur quatre fichiers. Aucun message ne dit « ce chemin de hooks n'existe
  pas » : le succès et l'absence totale de contrôle sont indiscernables. Le nom mort venait d'un
  skill qui l'annonçait encore.

- **`nodefony check` accusait l'application témoin d'un défaut qui appartenait à MON poste** : deux
  manquements « le port 5151 est déjà tenu », parce que mon serveur de développement écoutait. Le
  banc frère posait des ports dédiés ; le mien, neuf, ne l'avait pas repris. Le verdict aurait été
  vert sur un runner — **une mesure qui dépend de ce qui tourne à côté ne mesure rien**, et elle ne
  le dit pas. [1× — 08-25]

- **Un run interrompu a empoisonné le suivant, et personne ne pouvait le voir.** Une passe arrêtée
  sur « l'agent n'a rendu aucun tour » a quitté sans éteindre son serveur ; le run d'après a trouvé
  ses ports dédiés pris, sa prémisse n'a donc jamais démarré le sien — et l'agent, le constat de
  porte et le juge des routes ont TOUS interrogé l'application du run précédent. Mêmes ports, même
  nom (`bench-app`) : aucun signal. Le seul verdict juste de la passe fut le rouge de
  `nodefony check` (« le port est tenu par un autre processus »), imputé à l'agent. Réflexe : avant
  de croire un port, demander à l'application sous test de se NOMMER — ici son `runtime.json`
  (`pid` + ports effectifs), local et gratuit. [1× — 08-23]
- **Un arrêt qui ne couvre pas les sorties d'URGENCE n'est pas un arrêt.** Celui du banc existait
  et nommait même le risque, mais il vivait après la boucle et ne valait qu'en régime `auth` — or
  une passe s'interrompt par `process.exit`, et une PRÉMISSE démarre l'application dans tous les
  régimes. Le nettoyage d'un décor s'arme sur `process.on("exit")` + signaux, jamais sur le seul
  chemin nominal. [1× — 08-23]

- 🔴 **Le DÉCOR d'une mesure ne vient pas de la machine qui l'AFFICHE.** Le générateur du
  rapport lisait Node et le nombre de cœurs sur la machine du RENDU (`process.version`,
  `sysctl`). En session, rendu et mesure ont lieu au même endroit : juste par COÏNCIDENCE, et
  rien ne pouvait le révéler. La première publication a rendu « **? cœurs logiques** » — et le
  cas dangereux est l'autre : un exécuteur qui répond attribue SES cœurs au banc, chiffre faux
  et crédible sur une page publique. Trouvé en comparant octet à octet la page SERVIE et la
  page bâtie. `[1× — 08-24]`
- **`os.tmpdir()` n'est PAS `/tmp` sous macOS** : c'est un dossier privé par utilisateur sous `/var/folders/…`. On cherchait dans `/tmp` (224 Ko) pendant que **13 Go** grossissaient à côté. Un outil qui agit sur un chemin doit l'ANNONCER, sinon l'appelant cherche ailleurs. [1× — 08-25]
- **Le verdict du gate se prend depuis SA cible** : il formate avec `cwd: dest` (le dossier de l'app générée). Reproduire la mesure ailleurs — même config, même version — rend un autre résultat, et on croit le sien. [1× — 08-25]

- [1× — 08-29f] **Ma propre garde jugeait une AUTRE base que celle dont elle décidait le sort.** Elle interroge l'ORM du registre — connecté à la base de la CONFIGURATION — pour décider si l'on peut adopter celle que la commande MIGRE ; dès que `NF_MIGRATE_DATABASE_URL` est posée, ce sont deux bases différentes. Trouvé en écrivant la garde, pas après : le réflexe qui l'a attrapé est de se demander, pour chaque fait consulté, DE QUI il parle.

## 🧭 La doc qui AFFIRME une automatisation qui n'existe pas

- [1× — 09-06h] **Un drapeau INOPÉRANT recopié depuis un ticket, sur la seule commande qui ne se
  rattrape pas.** `--from <ref>` figure dans le bloc « Le geste » de #220 et sur la ligne d'aide du
  `--publish` — or la publication SAUTE l'étape changelog, seule consommatrice de cette borne. Je
  l'ai recopié trois fois sans le vérifier ; c'est le user qui a demandé « ça fait quoi ? ». Un
  drapeau qui ne fait rien ne produit aucune erreur : il se transmet de ticket en ticket et donne
  l'illusion qu'on a compris la commande. Corrigé dans l'aide du script.

- [1× — 09-06g] **Le README d'un paquet est sa page npm, FIGÉE pour la version publiée** — et personne ne le contrôlait. Passe manuelle la veille de l'alpha sur les 15 README publiables : **8 affirmations fausses, 14 liens morts**, dont `npm install @nodefony/core` (E404) et deux imports par DÉFAUT sur la page du paquet principal, où le cœur n'exporte que du nommé. Le « Usage minimal » échouait à sa première ligne. Un README n'est pas de la documentation interne qu'on corrigera : c'est une **surface publiée**, au même titre qu'`exports`, et elle ne se rattrape qu'en republiant.

- [1× — 09-06e] **« Mets des tableaux dans les descriptions de jalons » — j'ai failli le faire sans
  vérifier que GitHub les rend.** Mesuré au navigateur piloté : **0 table, 0 image, 0 gras** dans le
  DOM, sur la liste comme sur la page dédiée — la description est du texte BRUT. Deux minutes de
  navigateur ont évité d'écrire un tableau que personne n'aurait jamais vu, puis de chercher
  pourquoi. **Une capacité d'une plateforme tierce se CONSTATE**, exactement comme une capacité du
  produit (axiome 4 du portage). Le constat est écrit dans le fichier généré, pour que personne ne
  repaie l'essai.

- [1× — 09-04] **Un drapeau de config déclaré, validé par Zod, stocké, affiché en badge — et lu par AUCUN code.** `stateless` promettait « la session est ignorée même si un cookie est présent » ; `git log -S` rend deux commits, celui qui l'assigne et celui qui l'affiche. Le contrôle qui tranche en dix secondes : **`git log -S'.<champ>'` — si aucun commit ne montre une BRANCHE, la promesse n'est tenue par rien.**
- [1× — 09-04] **Le récit d'un gabarit peut être faux SÉPARÉMENT du code.** Le même fichier décrivait un « 401 intermittent en production » qu'aucun mécanisme ne produit — et ce texte a orienté un agent du banc vers la mauvaise solution. Corriger le code ne corrige pas le récit ; les deux se relisent.

- [1× — 09-04b] **`Closes #N` dans un commit ne ferme rien tant que le commit n'atteint pas
  la branche PAR DÉFAUT.** Le travail vit sur `claude-ts`, la branche par défaut est `main` :
  le ticket est resté OUVERT, statut `Todo`, alors que le commit affichait fièrement sa
  clause. Quatre autres tickets fermés à la main le même soir ne l'ont pas révélé — c'est le
  contrôle du tableau de bord qui l'a attrapé. **Sur ce dépôt, on ferme explicitement.**

- **[1× — 09-02] Un TSDoc affirmait « elle rend un objet vide » ; mesuré sur les six croisements, elle LÈVE.** La conclusion pratique était juste (silence dans les deux cas, absorbé par un `catch`), la justification était inventée — et une justification inventée se recopie : elle était déjà passée dans le `MEMORY.md` du module. Même famille que le retex de la veille sur `--ignore-scripts`. Règle : ce qui est bon à AGIR ne suffit pas à ÉCRIRE ; un mécanisme énoncé dans un commentaire se mesure.
- [1× — 31/08] **Un contrat écrit d'un SEUL côté du fil n'est pas tenu.** Le TSDoc serveur énonçait la règle (« le client doit attendre `realtime:welcome` ») ET ajoutait « ce que `RealtimeClient` fait nativement » — faux depuis toujours, le client rejouait sur `onOpen`. Personne ne relit une phrase de contrat : elle a l'air d'une garantie et n'est qu'une intention. Une règle inter-modules ne vaut que si un TEST la tient des deux côtés.

- [1× — 08-29d] **Deux réglages documentés ne faisaient pas ce qu'ils promettaient, chacun à sa façon.** `migrations.divergence: "off"` — décrite « `off` : rien » — n'avait AUCUN lecteur : la comparaison tournait quand même, au prix d'une requête par table, et son résultat était publié ; elle se comportait donc comme `report`. Et le commentaire de `NF_E2E_DATABASE_URL`, dans le gabarit du décor livré à chaque application, promettait « éprouver la suite sur le dialecte réel de production (PostgreSQL, MySQL) » : constaté en essayant, une application SQLite pointée vers PostgreSQL refuse de démarrer en nommant l'entité non portée. **Une valeur d'énumération se cherche par son LECTEUR (`rg` sur la valeur, pas sur la clé), et une promesse de variable d'environnement s'ESSAIE — c'est en dix secondes qu'on sait si elle tient.**

- [1× — 08-28i] **Sept documents affirmaient encore que Nodefony ne sait pas migrer, une session APRÈS la livraison des commandes.** Le plus coûteux n'est pas le README : c'est le GABARIT (`engine.ts`), dont le texte est **figé dans chaque application créée** — « ⚠ production : aucune migration générée (orm:migrate n'existe pas encore) ». Une affirmation dans un gabarit ne se périme pas comme une page : elle est **recopiée chez l'utilisateur** au moment où il crée son application, et elle y reste. Le geste qui les trouve tous coûte dix secondes (`rg` sur la formule, pas sur le concept) ; ce qui manque, c'est de se demander « qui d'autre AFFIRME ce que je viens de rendre faux ? » au moment du commit, pas trois sessions plus tard.

- [1× — 08-28i] **Une action rendue par un refus doit être une commande qui RÉPOND.** Le verdict `divergent` proposait `nodefony orm:generate`, qui n'existe pas (ticket ouvert). Inoffensif tant que le verdict était inatteignable — et exposé au public par le commit qui l'a branché. Le trou n'était donc pas dans le code écrit ce jour-là : **brancher une capacité rend soudain visible tout ce qu'elle disait dans le vide**. Après tout branchement, relire ce que la chose PRODUIT — messages, actions, verdicts — et vérifier que chaque commande citée répond.

- [1× — 08-28f] **Quatre en-têtes d'entités et une page de doc affirmaient que le DDL de développement ne crée PAS les index.** Il les crée (`#createIndexSQL`) — mesuré en montant une base et en listant `sqlite_master`. L'affirmation avait été recopiée d'un fichier à l'autre, ce qui lui donnait l'air d'un fait établi : quatre occurrences concordantes ne sont pas quatre preuves, c'est une seule erreur copiée. Ce qu'elle coûtait : elle enseignait qu'un index n'existe qu'en production, donc que le développement ne peut rien dire des performances — et elle aurait fait accepter comme normal un banc de parité rouge sur les index.

- [1× — 08-28c] **Un document de conception VALIDÉ écrit « le service enregistre un contrôle sur `/readyz` »** comme si le mécanisme existait. Il n'existe pas : `/readyz` est un court-circuit à réponses pré-allouées (`http-kernel.ts:453`, `:501`), aucun module ne peut y enregistrer quoi que ce soit. Le filet cloud-native du chantier reposait donc sur une brique à créer **dans un autre module et dans le chemin le plus chaud**. Une conception qui dit « X enregistre » se relit toujours en cherchant le `register` correspondant.

- [1× — 08-28] **J'ai annoncé au user un défaut que je n'avais pas mesuré.** Ayant constaté que
  Svelte prend le nouvel abonnement avant de rendre l'ancien, j'ai écrit que Vue et Angular
  « laissent un trou d'une microtâche où le serveur ne pousse plus rien ». C'est faux pour le cas
  courant : deux canaux DIFFÉRENTS, on quitte l'un et on rejoint l'autre, l'ordre est sans
  conséquence. Le trou n'existerait que sur le MÊME canal (clé de ré-abonnement changée), et le
  ref-comptage l'absorbe dès qu'un second composant tient le canal. **Une différence observée dans
  un front ne devient un défaut chez les autres qu'après avoir été mesurée chez eux** — le user a
  d'ailleurs immédiatement demandé « il faut corriger les autres ? », c'est-à-dire qu'il a agi sur
  mon affirmation.

- **La doc enseignait une URL qui n'est montée NULLE PART.** `client.md` et `react-hooks.md`
  ouvraient sur `RealtimeClient.shared({ url: "/nodefony/api/realtime" })` — aucune route ne sert
  cette adresse (Studio expose `/nodefony/studio/api/realtime`, l'app générée `/api/live/realtime`).
  Un débutant copiait l'exemple d'entrée et obtenait une socket qui ne se connecte jamais, **sans
  message** : l'échec est une tentative WebSocket qui retente en boucle. Trouvé en vérifiant une
  trouvaille de sous-agent qui ne visait que la valeur par défaut du code. [1× — 08-27]
- **Le §10.9 du plan de release — « ce qui bloque encore » — était périmé sur 4 de ses 5 items** :
  il annonçait bloquants le preset Svelte et devkit S1→S4 (livrés), deux rouges CI dont les
  workflows n'existent plus, et « la CI n'a jamais tourné sur un runner réel » (7/8 verts). Un
  document de pilotage qui ment envoie refaire du travail fini — c'est ce qui a déclenché tout
  l'audit du jour. [1× — 08-27]

- **Une mémoire m'a envoyé refaire une tâche déjà faite.** [2× — 08-27] (a) Un kit : « Publier
  docs/performance — dossier exhaustif PRÊT », alors que les dix pages étaient écrites, commitées
  et publiées sous `/performance/` depuis dix jours. (b) Un `_state` au RESUME : « PROCHAINE =
  merger `claude-ts` sur `main` » — `main`, `claude-ts` et `origin/main` pointaient déjà le MÊME
  commit, zéro écart ; restitué tel quel au user, qui a dû corriger. **Le garde-fou anti-`_state`
  périmé du skill `nodefony-session` ne couvre PAS ce cas** : il vérifie que le dernier commit
  figure bien dans `## Fait`, jamais que la PROCHAINE ÉTAPE reste à faire. **Un plan de mémoire
  n'est pas le terrain** — avant de restituer une prochaine étape, l'éprouver d'une commande
  (`git rev-parse main claude-ts`, `ls`, `git log -- <dossier>`).
- **Deux lignes du MÊME dashboard se contredisaient** : « RSS en PLATEAU ~244 MB » d'un côté,
  « AUCUN plateau » de l'autre. Personne ne lit un fichier de 900 lignes d'un bout à l'autre, donc
  la contradiction survit. Elle ne se voit qu'en cherchant le même FAIT à deux endroits. [1× — 08-26]
- **Mon propre outil renvoyait vers une section inexistante.** `npm run coverage` finissait par
  « Détail : docs/guides/integration-continue.md » — la page ne parlait pas de couverture. Un
  renvoi mort envoie chercher une explication qui n'existe pas : pire qu'aucun renvoi. [1× — 08-26]

- **Mon commentaire donnait un exemple d'attaque que je n'ai pas su reproduire.** J'avais écrit
  que `<<a>script>` redevient une balise après une passe ; testé, c'est faux. Ce qui protège
  vraiment était AILLEURS (`esc()` au rendu). Un commentaire qui invente sa justification est pire
  qu'un commentaire absent : il détourne le prochain lecteur de la vraie garde. `[1× — 08-25]`

- **« Ajouter un choix = ajouter UNE entrée ici ; aucun front n'est à modifier »** — vrai pour deux
  fronts sur trois. La voie FLAGS a une analyse écrite à la main : une question ajoutée y est servie
  à l'humain et REFUSÉE au script, sans un mot. J'ai cru l'en-tête et raté le drapeau. Une
  affirmation d'automatisation se vérifie avant d'être crue, et se corrige quand elle est fausse —
  ici par un gate qui refuse toute question qu'aucun drapeau ne sert. [1× — 08-22h]
- **Une doc dont tous les exemples passent par Docker fait prendre le chemin long.** Le skill
  navigateur disait « la voie locale d'abord » puis montrait dix `docker exec` : j'ai démarré un
  conteneur pour regarder une page locale, puis conclu à tort qu'un navigateur piloté était en
  panne (certificat de développement refusé). Ce que la doc MONTRE pèse plus que ce qu'elle dit.
  [1× — 08-22h]
- **Une doc périmée est lue comme la vérité par un tiers — et nous coûte plus que le défaut
  qu'elle décrit mal.** Un audit externe du dépôt a noté la sécurité 8/10 et l'a déclarée « pas
  terminée » : il avait lu le README de `@nodefony/security`, qui annonçait comme RESTANT deux
  briques livrées et câblées en production (voters d'autorisation, `@CsrfProtect`). Nous nous
  étions sous-notés nous-mêmes, dans une page publique. Deux autres du même lot : « TypeScript
  strict, zéro `any` » (3 casts + 128 `...args: any[]` en réalité) et un `MEMORY.md` de module qui
  contredisait le tableau de migration sur le RBAC. **Une promesse invérifiable se remplace par une
  promesse vérifiable** — « zéro `@ts-ignore` » se contrôle d'un `rg`, « zéro any » non. [1× — 08-26]
- [1× — 09-01] **Deux textes normatifs décrivaient l'architecture ÉCARTÉE**, et l'un renvoyait à l'autre : le ticket #18 disait « le périmètre fait foi : `docs/release/nodefony-10.md` §8 », et cette section portait la même conception périmée (générateur `--extends framework`, clés étrangères incluses). Un exécutant qui ouvre le ticket serait parti sur la mauvaise conception. **Corriger l'un sans l'autre recrée la contradiction le jour même** — quand un texte en désigne un autre comme faisant foi, ils se corrigent d'un seul geste.

## ⏳ Un symptôme qui ressemble à un DÉLAI n'en est pas forcément un

- [1× — 09-05d] **Et le symétrique, plus coûteux : ce qui ne ressemblait PAS à un délai en était un.** `doctor --deep` sortait en **0 au milieu de `npm run test`**, sans erreur — lu comme une sortie prématurée de la boucle d'évènements. C'était une BORNE DE TEMPS : l'action d'une commande est câblée comme un écouteur de cycle de vie, et le kernel borne chaque écouteur au délai de démarrage (20 s). Passé ce délai, la garde l'abandonne en fail-soft et le boot enchaîne sur `finishOrPark(0)`. Ce qui tranche en une commande : `--trace-exit` NOMME l'appelant de `process.exit`, et faire varier la borne (`NF_BOOT_TIMEOUT_MS=2000`) déplace le point de mort. Deux mesures, aucune lecture de code.
- [1× — 09-05d] **Passer de `spawnSync` à `spawn` RÉVEILLE les minuteurs que le blocage éteignait.** Le défaut ci-dessus existait depuis toujours et ne pouvait pas se manifester : un appel synchrone gèle la boucle, donc aucun `setTimeout` de garde ne se déclenche. Rendre asynchrone — pour une raison sans rapport, faire tourner une animation — l'a armé. Toute conversion sync → async doit se demander QUELLES gardes dormaient.

- **[1× — 09-02] Trois rouges consécutifs lus comme « permanent » — le quatrième était vert.** J'ai écrit dans un TICKET que la case macOS était « rouge en permanence », sur trois observations dont un relancement. La passe suivante a tout viré au vert. Un ticket est cru sans être relu : corrigé (titre compris) en relevé chiffré « 3 rouges / 1 vert », et son critère de fin ne repose plus sur un comptage de passes — un banc rouge une fois sur quatre passe deux fois de suite sans rien prouver.
- **« La commande meurt toute seule » n'était pas un timeout — il n'en existait aucun sur ce
  chemin.** Une question est une promesse en attente ; Node ne compte pas les promesses, il compte
  les HANDLES. Une commande qui boote a des dizaines de handles, donc sa question tient sans que
  personne n'y pense ; une commande standalone n'en a AUCUN, et le process sort au milieu de la
  question, code 0, sans erreur. Le user avait donné le discriminant sans le savoir : « sur le menu
  ça a l'air de tenir » — c'est exactement la frontière du fast-path. Réflexe à garder : quand un
  symptôme ressemble à un délai, chercher d'abord ce qui RETIENT le process, pas ce qui le tue.
  [1× — 08-22f]
- **Le défaut ne frappait que les commandes les plus SOIGNÉES.** Celles qu'on a travaillé à rendre
  rapides (zéro boot) sont précisément celles qui n'ont plus rien pour tenir. Une optimisation peut
  retirer un effet de bord dont personne n'avait noté qu'il servait de garde. [1× — 08-22f]
- [1× — 08-27h] **Le ticket accusait une course d'écriture ; les JOURNAUX du run l'ont réfutée en
  une commande.** `gh run download <id>` : les journaux serveur des deux plateformes en échec
  étaient conservés en artefacts, et le même enchaînement s'y lisait — cinq millisecondes avant le
  refus, un autre banc RÉVOQUAIT la session. Ma première reproduction (260 enchaînements
  login→handshake) n'a rien montré, et c'était logique : je reproduisais l'HYPOTHÈSE du ticket, pas
  le scénario du journal. Réflexe : quand une passe a laissé des artefacts, les lire AVANT de
  reproduire quoi que ce soit — reproduire une supposition ne réfute rien.
- [1× — 08-27h] **La même reproduction rendait 0/20 puis 20/20 — seul l'ORDRE avait changé.** La
  liste étant triée par récence, le voisin n'emporte la session que s'il s'est connecté APRÈS. Une
  reproduction qui échoue ne réfute donc pas un mécanisme : elle peut n'avoir que le mauvais ordre,
  et l'ordre se lit sur le journal, il ne se devine pas.
- [1× — 09-03] La garde anti-ReDoS de `bearerToken` mesurait un ratio de temps entre deux TAILLES (800 k → 1,6 M) : ×3,5 sur macOS, ×3,0 sur ubuntu, ×4 sous couverture, pour un motif inchangé — 4ᵉ flake, et les trois remèdes précédents avaient GROSSI l'entrée « pour sortir du bruit », jusqu'à ce que 1,6 Mo et 3,2 Mo ne tiennent plus dans le même cache. Ce qui ressemblait à une courbe quadratique était la hiérarchie mémoire. Remède : un TÉMOIN (l'ancien motif) sur la même entrée, au même instant — un écart ×1 000 qu'aucun bruit ne comble.

## 🗄️ 🚪 Une porte a plusieurs ENTRÉES — GRADUÉ

> Gradué au CONSOLIDATE du 2026-09-07 — 21 frictions versées dans
> **`feedback_single_source_rule`** (§ « Une porte a plusieurs ENTRÉES ») : le défaut vit dans
> la COMPARAISON des copies, jamais dans l’une d’elles. Ne PAS réécrire ici.

## 🧭 Une garde ne couvre jamais une AUTRE question — même quand elle y ressemble

- [1× — 09-07c] **La garde existait, et c'est MOI qui l'ai désarmée — avec l'option prévue pour ça.**
  `release.mjs` refuse de PRÉPARER hors de la branche attendue (défaut `main`) ; j'ai passé
  `--branch dev` parce que je préparais depuis `dev`, ce qui est légitime. Mais le même drapeau
  gouvernait implicitement la publication, et le tag `v10.0.0-alpha.2` s'est posé sur `dev` — la
  branche que ni le site public, ni les README publiés, ni les liens `/blob/` ne décrivent. Le
  commentaire du code NOMMAIT le trou (« à la publication, c'est le TAG qui fait foi, pas la
  branche ») sans le fermer. **Préparer et publier sont deux questions ; un seul drapeau les
  couvrait, donc le désarmer une fois les désarmait toutes les deux.** Repéré par le user, pas par
  moi. Fermé : `--publish` constate l'APPARTENANCE du commit à la branche de publication — la
  branche courante ne dit rien sur un HEAD détaché — et une branche introuvable REFUSE.

- [1× — 09-06g] **Vérifier qu'une chose EXISTE ne vérifie pas ce que le texte en AFFIRME.** Deux fois dans la même passe : `REDIS_URL` marquée VRAI parce que la variable existe — le README la disait « prioritaire » alors que `infra.ts:136` lit `NF_REDIS_URL` d'abord ; et `securityConfigJsonSchema` marquée VRAI en citant la ligne d'**import interne** du module, qui ne prouve aucun **export** (l'import documenté échouait). La question posée est toujours « le texte dit-il vrai ? », jamais « le symbole est-il là ? ».

- [1× — 09-06g] **Mon propre automate exhaustif avait un bord, et il rendait un faux positif.** Un script croisant les `import { … } from "@nodefony/…"` des README avec `.ai/symbols.json` a déclaré `IMcpTool` introuvable : le graphe **ne porte pas les réexports de types**. L'exhaustivité d'un automate porte sur SON index, pas sur le monde — un verdict d'automate se recontrôle comme un verdict de modèle. Le bord est consigné dans #255 pour que le gate ne le reproduise pas.

- [1× — 09-04] **« Non demandé » et « empêché » n'étaient qu'une seule catégorie, et le mode strict condamnait les deux.** L'étage 2 de `doctor` ne tourne que sur `--live` ; compté comme un contrôle qu'on n'a pas PU faire, il faisait échouer la commande sous `CI` — donc dans toute chaîne automatisée, y compris celle qui contrôle une application fraîchement générée, tant qu'elle n'ajoutait pas un démarrage complet. **Une abstention VOULUE et un empêchement se ressemblent dans le rapport et s'opposent dans le verdict.** Les deux restent affichés (ni l'un ni l'autre n'est un quitus) ; seul le second pèse.

- [1× — 31/08] **Deux surfaces voisines, deux défauts OPPOSÉS, et l'asymétrie n'est écrite nulle
  part.** Une action RPC non déclarée reçoit d'office une politique fermée ; un canal ENTRANT
  déclaré sans politique reste **libre**. Même fichier, même famille de décorateurs, défauts
  inverses — je ne l'ai vu qu'en lisant le code du dispatch, pas en lisant les décorateurs. Quand
  deux mécanismes se ressemblent, **le défaut de l'un ne se déduit jamais du défaut de l'autre** :
  il se lit à l'endroit qui l'applique.

- [1× — 08-29] **Un détecteur PRUDENT par conception bloquait le ticket qui en dépendait — la sortie
  est de le GRADUER, pas de l'élargir.** Le détecteur de « schéma en retard » excluait SQLite
  volontairement (code générique, « mieux vaut ne rien dire que dire faux ») ; or le cas de preuve
  du ticket suivant ÉTAIT une trace SQLite, c'est-à-dire le défaut par défaut d'une application
  fraîche. Élargir le détecteur aurait changé le comportement d'un ticket déjà clos et prouvé ;
  en écrire un second était explicitement interdit. Il rend désormais une **force de signal**
  (`certain` / `probable` / rien), et chaque lecteur choisit son seuil : celui qui PUBLIE au client
  reste strict, celui qui sait déjà ce qu'il a demandé accepte le signal faible. **Deux lecteurs
  peuvent partager une reconnaissance sans partager le même seuil — c'est le seuil qui appartient à
  l'appelant, pas la reconnaissance.**

- [1× — 08-28g] **Un document de conception VALIDÉ portait une impossibilité mécanique, invisible jusqu'au contact.** Il prescrivait de réutiliser l'adapter pour la connexion de l'applicateur — or l'adapter ouvre un POOL, et les verrous prescrits par le même document (`pg_advisory_lock`, `GET_LOCK`) sont de SESSION : verrou sur une connexion, DDL sur une autre, libération sur une troisième. La conception se contredisait elle-même à deux paragraphes d'écart, et rien dans sa lecture ne le signalait. **Une conception se relit en confrontant ses prescriptions ENTRE ELLES, pas seulement au code** — troisième fois que le terrain corrige un document validé (cf 08-28c, 08-28f).

- **`--publish` forçait `--write` : deux gestes couplés qui ne devaient pas l'être.** Révélé en
  écrivant le workflow, qui serait tombé DÈS SA PREMIÈRE PASSE — sur le changelog, sans aucun
  rapport avec la publication. Préparer écrit et se relit ; publier part d'un tag et ne doit RIEN
  écrire. Écrire le second consommateur d'une API est ce qui montre ses couplages. `[1× — 08-25]`

- [1× — 08-25] **Mon banc de durée refusait de mesurer sans ramasse-miettes et sans charge — et
  acceptait sans broncher une machine PARTAGÉE.** Deux runs perdus le même jour : l'un tué par mes
  propres compilations (p99 × 12), l'autre faussé par une console d'administration ouverte dans un
  navigateur, qui tapait sur le serveur MESURÉ. Le tas s'est mis à monter de 13 MB/h alors qu'il
  est plat partout ailleurs — c'est-à-dire exactement la signature qu'on traquait : le décor a
  failli faire accuser le framework. Deux relevés gratuits manquaient : la charge machine, et le
  nombre de connexions (un banc en ouvre un nombre CONSTANT, donc toute connexion en plus est un
  intrus). **Une machine partagée ne rend pas une mesure moins bonne : elle rend une AUTRE mesure.**

- **La garde anti-abandon rendait NON JUGEABLE la tâche dont la bonne réponse est INVISIBLE au
  diff.** « Aucun fichier touché ⇒ abandon » est juste partout — sauf pour la tâche de
  configuration, qui se résout dans `.env.local`, **gitignoré par conception**. Un agent PARFAIT
  n'y touche aucun fichier suivi : deux passes écartées pendant que le juge d'état rendait exit 0.
  Le banc CONNAISSAIT le piège (son commentaire interdit toute sonde de diff sur cette tâche depuis
  longtemps) ; la garde, ajoutée plus tard **à un autre étage**, l'a réintroduit. L'exception se
  DÉCLARE sur la tâche, jamais en affaiblissant la garde pour tous. [1× — 08-24d]
- **Un `--dry-run` qui ne rend qu'un inventaire de fichiers n'est pas une simulation.** Les notes
  (table visée, connecteur, dialecte, routes) ne sortaient qu'en exécution RÉELLE ; l'agent à qui
  l'on demande un plan colle la sortie et ne peut pas nommer la base sur laquelle il travaille.
  Une simulation doit dire ce que la vraie commande dirait. [1× — 08-24d]

- **`grid.containLabel` d'ECharts contient les ÉTIQUETTES, pas les NOMS d'axes** — deux questions qui
  se ressemblent, une seule couverte. J'ai passé une itération à compenser par des marges calculées à
  la main, qui déplaçaient le défaut sans le corriger. La doc officielle le dit en une ligne
  (l'option est dépréciée en v6 et vaut `outerBoundsContain: 'axisLabel'`) ; le défaut de la v6
  couvre les deux. **Lire la doc de l'option AVANT de compenser son comportement.** [1× — 08-24]

- **`PACKAGE_NAME` bornait la traversée de chemin, pas le PÉRIMÈTRE.** Les deux gardes se
  ressemblent (« quel nom de paquet accepte-t-on ? ») et répondent à deux questions distinctes : la
  première empêche `../../etc`, la seconde décide ce qu'on a le DROIT de servir. Sans la seconde,
  la porte de documentation rendait les pages de n'importe quelle dépendance installée. [1× — 08-22f]
- **`requiresAuth` regardait comment l'identité est PROUVÉE, pas ce que l'appelant PEUT.** Une
  porte plus stricte en apparence cachait des données moins sensibles que celles qu'une autre
  rendait déjà au même appelant — et rendait la capacité inatteignable dans le mode nominal. [1× — 08-22f]
- [1× — 08-27h] **La console comparait l'UTILISATEUR pour répondre à une question sur la SESSION.**
  « Cette ligne est-elle à moi ? » et « cette ligne est-elle CELLE d'où je regarde ? » se
  ressemblent, et dans un écran « mes sessions » la première est vraie PARTOUT — l'avertissement
  s'affichait donc sur toutes les lignes, c'est-à-dire sur aucune. Signe qui aurait dû alerter :
  deux consommateurs indépendants (la console, un banc) bricolaient chacun leur approximation du
  même verdict. Quand deux clients contournent, c'est le CONTRAT qui manque l'information — ici,
  aucun d'eux ne POUVAIT la calculer, la référence étant un HMAC du cookie.
- [1× — 08-30] **`lib: ["DOM"]` fait compiler un identifiant qui n'existe pas dans la portée.**
  `name` nu, écrit dans une méthode où il n'était pas déclaré, s'est résolu sur la globale
  `Window.name` : typecheck VERT, chaîne vide au runtime dans un message d'erreur destiné à
  l'utilisateur. Le typecheck contrôle les types, pas la PROVENANCE. Les autres pièges du même
  ensemble : `length`, `status`, `origin`, `close`, `top`, `event`. Repéré à la relecture du diff,
  pas par un outil.

## 📐 Composer une assertion de chemin ne suffit pas — il faut composer avec la MÊME opération

- [1× — 08-30] **La forge a vu ce qu'aucun poste ne pouvait voir, et la doctrine d'injection l'a
  rendu éprouvable ici.** Un chemin publié dans un rapport sortait en `var\db.sqlite` sous Windows
  seulement : deux plateformes désignaient différemment la MÊME base, dans une charge utile que des
  scripts comparent. Corrigé en normalisant (**un chemin qui VOYAGE s'écrit en `/`**), puis rendu
  testable partout en INJECTANT la grammaire (`typeof path`, `path.win32` au test) — vu rouge sur
  macOS. Une fonction qui lit `path` global ne s'éprouve que sur la plateforme qu'elle décrit.

- **La CI Windows était rouge sur deux tests qui SUIVAIENT pourtant l'axiome** (composés au
  `path.join`, jamais littéraux). Le code rendait un chemin ABSOLU (`path.resolve` → `D:\…`),
  l'attendu était seulement ENRACINÉ (`\…`). `resolve` d'un côté et `join` de l'autre ne décrivent
  pas le même chemin dès qu'une plateforme distingue les deux. Et mes tests du jour portaient le
  même défaut, non encore poussé. [1× — 08-22f]

- [1× — 08-29f] **Un filtre appliqué au chemin ABSOLU rend le watch aveugle, sans un mot.** Exclure les dossiers de travail (`tmp`, `var`) du watch de développement est juste — mais `ignored` reçoit un chemin absolu, et `TMPDIR` vaut `/var/folders/…` sur macOS, là où nos propres bancs de scaffold créent l'application. Chaque entrée aurait été rejetée. La règle ne vaut que DANS le projet : relativiser AVANT de filtrer (axiome de portabilité n°2), et le prouver en débranchant la seule relativisation.

## 🚧 Ajouter une EXIGENCE sans regarder qui PRODUIT l'artefact exigé

- [1× — 09-06i] **Un `package.json` n'est pas le seul endroit où la version est écrite.**
  `man/nodefony.1` est GÉNÉRÉE, commitée et publiée ; l'estampillage de version ne la régénérait
  pas. Elle a annoncé « nodefony 10.0.0 » dans le tarball d'une `10.0.0-alpha.1`, et le gate de
  fraîcheur du cœur en est resté ROUGE sur les trois plateformes — sous un intitulé qui ne nommait
  pas la release, donc personne ne faisait le lien. **Estampiller une version, c'est régénérer TOUT
  ce qui la porte** : la question à poser est « quels artefacts committés embarquent ce nombre ? ».

- [1× — 09-02] **Le décor du banc n'avait pas l'artefact que ma prémisse supposait.** J'avais écrit « applique la migration initiale » en m'appuyant sur un ticket qui affirme qu'une application naît avec la sienne. C'est vrai — mais seulement quand `create app` a pu installer ET bâtir, et le banc, lui, installe APRÈS (tarballs) : `migrations/` était VIDE. Sans le montage réel du décor, la tâche aurait été jugée sur une table qui n'existe pas. **Une prémisse qui repose sur un artefact produit par une AUTRE commande se constate dans le décor, jamais dans le ticket qui l'annonce.**

- [1× — 09-01] **Un artefact qui CHANGE de producteur casse en silence tous les décors qui le supposaient livré.** La table `User` a quitté les migrations du framework pour celles de l'application. Trois décors reposaient sur l'hypothèse inverse, et aucun ne l'énonçait : le banc d'adoption vidait le dossier de migrations du dépôt (9 cas rouges par dialecte, tous sur « table absente : User ») ; le décor MySQL dérivait ses tables à nettoyer des seules migrations du PAQUET, donc ne nettoyait plus `User`, qui survivait d'un cas à l'autre ; un troisième amputait `User` en la croyant livrée (`no such table`). **Déplacer la propriété d'un artefact, c'est devoir relire tout ce qui le CONSOMME** — et un décor consomme sans le dire.

- [1× — 08-31d] **Le ticket prescrivait de CONSTRUIRE ce que le produit portait déjà.** #122 demandait
  un module de décor `policy:"mandatory"` — un espace de travail de plus, chargé à CHAQUE démarrage du
  dépôt, production comprise — pour qu'une entité entre au registre sous `NODE_ENV=production`. Or
  `NF_WITH_DEV_MODULES=1` existe depuis longtemps (`Kernel.ts:225`), documentée en TSDoc, et fait
  exactement cela : déroger au gating `policy:"dev"`, en le CRIANT, sans effet hors production. Le
  ticket avait pourtant été instruit DEUX fois, et contrôlé la veille. Ce que ni l'instruction ni le
  contrôle ne font : chercher **qui fournit déjà** la capacité qu'on s'apprête à bâtir — ils
  vérifient que ce qui est écrit est vrai, pas que ce qui est prescrit est nécessaire. Le geste qui
  aurait suffi : avant d'ouvrir un fichier neuf, `rg` sur le CONCEPT (« charger un module dev en
  production »), pas sur le nom de la chose à construire.

- [1× — 08-29] Un ticket écrit la veille demandait un verdict NEUF ; le code l'interdisait — l'énumération est GELÉE avec le format `--json`, un mot de plus casserait tout consommateur exhaustif. Le correctif a dû porter ailleurs : le fait restait juste, c'est ce que la SONDE en déduisait qui était faux. **Écrire un critère de fin sans lire la contrainte du code produit un critère inapplicable.**
- [1× — 08-28l] **Un banc rouge qui ne POUVAIT pas devenir vert.** Le harnais e2e généré appliquait
  les migrations avant le trafic — c'est le patron de production, il a raison. Mais il applique ce
  qui EXISTE, et personne n'écrivait jamais celles de l'application : les tables du framework
  arrivaient, les tables applicatives non, 31 cas rendaient 500. Le rouge était juste, et sa cause
  n'était pas dans le code jugé mais dans une commande ABSENTE. Corollaire : **livrer une capacité
  oblige à revisiter les bancs qui l'attendaient sans le dire** — sinon ils restent rouges, et un
  rouge permanent finit par se lire comme du décor.

- [1× — 08-28h] **Le dépôt générait ses migrations par un script npm privé, et c'est ce qui a caché
  le trou.** `npm run generate:migrations` : le framework savait générer, personne n'avait remarqué
  qu'une application ne le pouvait pas — parce que le dépôt passait par un chemin qui n'est pas
  celui de ses utilisateurs. Repéré par le user, pas par moi (« pourquoi encore des scripts !!! »).
  **Quand le dépôt ne consomme pas sa propre commande, il ne peut pas voir ce qui manque à ses
  utilisateurs** : le banc est vert et le produit est troué.

- **J'ai contredit une décision que le dépôt portait DÉJÀ, écrite dans un test, avec son
  motif.** Une mémoire listait « `verify` ignore les e2e » parmi les écarts de l'application
  générée ; je l'ai « corrigé ». Or `create.test.ts` exige l'inverse — « le gate LENT reste
  dehors : un `verify` qui boote l'app ne serait plus lancé, et on aurait remplacé quatre gates
  oubliés par un seul » — et la CI générée joue `test:e2e` SÉPARÉMENT, donc rien n'était oublié.
  Huit jobs rouges sur trois systèmes. Avant d'ajouter une exigence, chercher qui la porte déjà :
  un test qui l'INTERDIT est une décision, pas un oubli. Et une liste d'écarts héritée d'une
  session précédente se reconfronte au code avant d'être exécutée. [1× — 08-25]

- **J'ai posé `--deny-warnings` au gabarit de l'application sans regarder ce que le générateur
  ÉCRIT.** Le `vitest.config.ts` produit utilisait `Array#sort()` : toute application fraîchement
  générée aurait échoué à son PREMIER `npm run lint`, sur une porte que je venais d'ajouter pour
  l'aider. Invisible en relisant le gabarit — attrapé en lintant une app RÉELLEMENT générée avec ses
  propres règles. Une exigence neuve se mesure sur l'artefact reçu, jamais sur sa source.
  [1× — 08-25]

- **La porte s'est mise à exiger un scope ; la commande qui fabrique le jeton n'en demandait
  aucun.** `ai:mcp` enchaîne `security:token --write` (sans `--scope`) : le parcours nominal de
  l'utilisateur aurait produit un jeton refusé à la première lecture — un 401 remplacé par un 403,
  sans raison visible. C'est le **user** qui a demandé « le token mcp a des scopes par défaut ? ».
  Le geste manquant : quand on ajoute une condition d'accès, remonter la chaîne jusqu'à CE QUI
  fabrique l'artefact soumis à cette condition, et le vérifier en le LANÇANT. [1× — 08-22e]
- **Et l'exiger sans le PUBLIER, c'est exiger l'invisible** : le client suit le défi, lit le
  document de ressource, n'y voit aucun scope, obtient un jeton nu, se fait refuser — et n'a aucun
  moyen de savoir quoi demander. Une exigence neuve se publie dans le document que le refus
  désigne. [1× — 08-22e]

## ⏳ Un défaut « pratique » grave un pouvoir pour le jour où la distinction deviendra réelle

- **`admin:read admin:write` par défaut n'avait aucun effet** — le plan d'administration n'a qu'un
  rôle, les deux scopes ouvrent la même chose. Précisément pour ça, personne ne l'aurait remarqué ;
  et le jour où la séparation lecture/écriture deviendrait réelle, tous les jetons émis d'office
  porteraient le pouvoir d'écrire sans qu'aucune décision ne l'ait accordé. Un défaut se choisit sur
  ce qu'il vaudra APRÈS le durcissement prévu, pas sur ce qu'il vaut pendant qu'il est inerte —
  le plus étroit se durcit tout seul dans le bon sens. [1× — 08-22e]

## 🔑 Un secret écrit là où personne ne le lit — et la question « qui le lit ? » qu'on ne pose pas

- [1× — 09-05f] **Un FAUX secret dans un dépôt public est refusé exactement comme un vrai, et
  c'est correct.** `SMOKE_SECRET="0123456789abcdef…"` — 32 hexadécimaux, valeur jetable d'un banc
  local, n'ouvrant rien — a fait rougir le gate `Secrets` le soir même. Aucun relecteur, humain ou
  automate, ne distingue les deux. Un secret jetable se **TIRE** (`openssl rand -hex 16`, repli
  `/dev/urandom`) : il n'a aucune raison d'être reproductible. L'exclure par une règle de
  `.gitleaks.toml` aurait appris au scanner à se taire sur cette FORME partout ailleurs — c'est
  `.gitleaksignore`, par empreinte exacte, qui acquitte un constat déjà commité.

- **Un jeton écrit SANS son mode : 0644, lisible par toute la machine.** Parti d'une alerte de
  RACE (`existsSync` puis `write`), j'ai trouvé pire à deux lignes. Et le remède existait DÉJÀ dans
  le paquet (`JwtKeystore` écrit sa clé en 0600) : une CLI en avait une version dégradée.
  Après chaque « on écrit quoi, où ? », poser « et qui a le droit de le LIRE ? ». `[1× — 08-25]`
- **Le fichier TEMPORAIRE porte le secret, et survivait à l'échec.** L'écriture atomique passe par
  `<f>.<pid>.tmp` puis `rename` ; si le `rename` lève, le tmp reste EN CLAIR sur le disque. On avait
  durci les permissions de la cible en laissant fuir le contenu à côté. Le cas est PROBABLE sous
  Windows (remplacer une cible ouverte y échoue, là où POSIX remplace) — et la cible est un `.env`
  que l'utilisateur a sous les yeux dans son éditeur. `[1× — 08-25]`

- **`--write` posait le jeton MCP dans `.env.local` : AUCUN code de l'application ne le lit.** Elle
  est le serveur de ressource, elle vérifie des jetons, elle n'en porte pas. Le consommateur — un
  agent — le cherchait ailleurs et recevait un 401 qui accusait le jeton. Une heure de diagnostic.
  `[1× — 08-22]`
- **La duplication ne survit pas à la ROTATION** : le fichier refusait d'être touché pendant que les
  agents auraient dû recevoir le neuf. La question de l'utilisateur — « pourquoi aussi dans
  `.env.local` ? » — valait mieux que ma conception. `[1× — 08-22]`
- **L'état de câblage n'a pas à être mémorisé : il EST dans les fichiers.** Un agent qui porte la
  clé a été câblé un jour ⇒ rotation muette. Un fichier d'état parallèle aurait menti à la première
  édition manuelle. `[1× — 08-22]`

- [1× — 08-29f] **Un avertissement émis à un niveau AVALÉ n'existe pas — et changer le niveau ne suffit pas.** Le message qui annonce qu'une variable détourne la base partait en `INFO` ; passé en `WARNING`, il n'est toujours PAS sorti (le boot silencieux des commandes avale les deux) — constaté en exécutant, pas déduit. La bonne question n'est pas « à quel niveau ? » mais « PAR OÙ ça sort ? ». Porté dans l'en-tête du rapport, qui emprunte le même chemin que le `--json`, l'écran et la charge utile ne peuvent plus diverger. Un avertissement qui n'atteint personne est pire qu'aucun : on le croit posé.

## 🗄️ 🟢 Un test peut passer depuis TOUJOURS sans rien mesurer — GRADUÉ

> Gradué au CONSOLIDATE du 2026-09-07 — 61 frictions versées dans
> **`feedback_prove_the_target_not_the_verdict`** (§ « Récidive massive »), dont le motif
> dominant : un `tsconfig.json` qui EXCLUT les tests rend un typecheck vert sans en avoir lu un
> seul (vu 3×), et un code de sortie lu APRÈS un tube mesure le tube. Ne PAS réécrire ici.

## 🎭 Mon PROPRE `--dry-run` mentait — l'option dont le seul rôle est de dire ce qui va se passer

- [1× — 09-07] **L'outil dont le seul rôle est de DICTER les champs à recopier en donnait un faux.**
  `release-preflight.yml` obtient le jeton d'identité OIDC et écrit le tableau « Ce qu'il faut saisir
  sur npmjs.com » ; son défaut annonçait `release-publish.yml` — un fichier qui n'existe pas, le flux
  qui publie s'appelant `release.yml`. La faute n'était pas rattrapable là où elle se serait produite :
  npm FIXE les champs d'un publieur de confiance à sa création (« cannot be changed later »), et il y
  en a quinze à déclarer. Le comble : `release.yml` s'ouvre sur « LE NOM DE CE FICHIER EST UN
  IDENTIFIANT […] sensible à la casse » — la règle était écrite, et l'outil chargé de la transmettre
  disait autre chose. **Un défaut PAR DÉFAUT ne se voit pas** : il faut déjà connaître la bonne
  réponse pour remarquer que l'outil ment, or on consulte cet outil précisément parce qu'on ne la
  connaît pas. Corollaire : une valeur irréversible qu'un outil dicte se DÉRIVE du dépôt (le nom du
  fichier existe, on peut le lire), elle ne se code pas en dur dans un défaut.

- [1× — 09-05] **Un geste PRESCRIT se constate applicable avant d'être proposé.** `doctor --live` prescrivait `git checkout -- migrations/` sur une dérive d'empreinte : le fichier incriminé ne vivait pas dans `migrations/` (il est livré par un paquet) et n'était pas modifié localement — le geste ne pouvait RIEN faire, et le user l'a exécuté pour rien. Même famille, même jour : « retire `policy: "dev"` de devkit », geste dont l'application aurait embarqué l'outillage de développement en production. **Un outil qui ne peut pas savoir si son geste s'applique doit INFORMER, pas prescrire.**

- [1× — 09-05] **Un état NORMAL rangé dans la catégorie « anormal » condamne l'outil, pas l'application.** Trois fois le même motif : un module `policy: "dev"` qui disparaît en production (sa raison d'être) rendu en `✗` ; « aucune entité Drizzle » compté comme contrôle EMPÊCHÉ, donc échec en forge ; le verdict sain comparé à un mot inexistant. Sur les **23** états « non exécuté » du produit, **un seul** ne pesait pas sur le code de sortie. La règle qui manquait : _le contrôle a-t-il REGARDÉ et trouvé qu'il n'y avait rien, ou n'a-t-il pas pu regarder ?_
- [1× — 09-04g] **Mon contrôle de sécurité s'est ACCUSÉ LUI-MÊME, au premier essai.** Le module qui cherche `@BypassFirewall` dans les contrôleurs contient forcément cette chaîne — dans son expression régulière et dans ses libellés. Il a donc inventorié deux « routes ouvertes » dans son propre source, affichées au même rang que les vraies. Aucune exclusion de dossier ne règle ça proprement (elle serait arbitraire, et le prochain fichier qui parle du sujet retomberait dedans). **Le remède est de COMPOSER le motif** (`${AT}BypassFirewall`) pour que la chaîne cherchée n'existe nulle part dans le module : il n'y a alors rien à excepter. Vaut pour tout contrôle qui cherche un littéral — linter maison, gate de convention, scanner de secrets.
- [1× — 09-04g] **Un outil de diagnostic ne vérifiait pas sa propre ENTRÉE.** `doctor --env produntion` rendait un rapport COMPLET et plausible — verdict, problèmes numérotés, gestes copiables — sur un environnement qui n'existe nulle part ; le mot inventé s'affichait dans chaque phrase. C'est le user qui l'a vu. Une faute de frappe dans une option ne doit pas produire un résultat crédible : distance d'édition ≤ 2 d'une valeur connue ⇒ refus avec suggestion, et les valeurs légitimement ouvertes (`preprod`, `qa`) passent. **Un outil dont le rôle est de dire la vérité ne peut pas être le seul à ne pas la vérifier sur ce qu'on lui donne.**

- [1× — 09-04] **Le contrôle de pilotage que je venais d'écrire a rendu six accusations FAUSSES à son deuxième run.** Il déléguait la borne de mot à `git log --grep='#53\\b' -E` : `\\b` n'appartient pas à la grammaire ERE, et selon la plateforme elle ne filtre rien ou rejette tout. Ici elle rejetait tout — six tickets déclarés « en cours sans le moindre commit » alors qu'un commit du jour les citait. **Déléguer une règle à la grammaire d'un OUTIL, c'est la rendre inéprouvable** : `git` dégrossit maintenant, et la borne est une fonction pure testée. Un gate qui crie faux apprend à passer outre, et celui-là avait deux heures.

- [1× — 09-03b] **Le mode « ne relance RIEN » relançait TOUT — et sa promesse était écrite deux fois.** `--depistage` du banc devkit lisait son drapeau très tôt, mais ne le TRAITAIT qu'après avoir monté un décor et déroulé le catalogue entier avec de vrais agents ; il comparait alors le rapport du run qu'il venait de payer. Lancé en croyant à une comparaison gratuite, il tournait encore une heure plus tard. Le texte de l'usage ET le skill affirmaient l'inverse — deux écrits ne valent pas une garde. **Le motif générique : entre LIRE un drapeau et le TRAITER, tout ce qui se trouve au milieu s'exécute.** Un mode dont le contrat est de ne rien faire refuse AVANT la première dépense, ou il ne le tient pas. Corollaire appliqué : le refus ne CHOISIT pas non plus la mesure à la place de l'opérateur — « le dernier run » serait un run partiel ou d'un autre décor, c'est-à-dire la comparaison fausse qu'une autre garde existait déjà pour interdire.

- [1× — 08-29c] **Quatre réglages de commande ne faisaient pas ce qu'ils annonçaient, et AUCUN n'était testé.** `--up-to <tag inconnu>` ne rencontrait jamais sa condition d'arrêt et adoptait TOUT l'historique en rendant 0 ; `--source <inconnue>` filtrait en SQL sur un nom inexistant et rendait « rien à réparer » ; un `.sql` annoncé par le journal mais absent remontait un `ENOENT` nu ; et `NF_MIGRATE_DATABASE_URL` était **jetée en silence** dès que le connecteur était sqlite — un travail de déploiement migrait alors une base locale éphémère et rendait le code du SUCCÈS. Le point commun : chacun a un chemin « heureux » testé, et le chemin où l'argument est FAUX n'existait dans aucun banc. **Le contrôle : pour chaque drapeau, écrire le couple — le refus SANS lui, le travail AVEC.** C'est ce couple qui a rendu les quatre défauts visibles en une passe.

- [1× — 08-28] **L'outil que je venais d'écrire a accusé à tort, à son premier usage réel.** Le
  compte rendu de fermeture annonçait « aucun commit ne cite #95 » juste après le commit qui le
  citait : `git log --grep='#95\b'` ne mord sur RIEN, le moteur de git étant une expression
  rationnelle POSIX étendue, sans borne de mot. Un outil de pilotage qui accuse est pire qu'un outil
  absent — il envoie chercher un oubli inexistant. Aucun test sur la CHAÎNE du motif ne l'aurait vu ;
  seul un dépôt git réel (trois commits citant `#9`, `#95`, `#950`) le prouve. Corollaire : un
  script neuf se lance sur un cas dont on CONNAÎT la réponse avant d'être livré.
- **Mon `--check` rendait ROUGE sur l'empreinte qu'il venait d'écrire** : il comparait l'objet
  interne à l'objet écrit, lequel portait deux champs de plus. L'option dont le seul rôle est de
  dire « à jour ou pas » disait faux dès sa première utilisation. Un mode de contrôle se lance sur
  sa propre sortie AVANT d'être cru. [1× — 08-27]

- [1× — 08-25] **Mon test d'attaque a cassé la forge sur une plateforme.** Pour prouver qu'une
  injection s'exécutait, j'ai fait lancer `; touch …` par un shell — et le `touch` de BSD, qui
  ignore les options longues, a pris ses arguments pour des NOMS DE FICHIERS. Deux fichiers créés
  à la racine, `git add -A` les emporte, sept jobs Windows tombent au CHECKOUT (`invalid path`,
  exit 128), avant tout test. J'avais nettoyé le témoin attendu, pas les deux inattendus. Une
  charge d'attaque se joue dans un répertoire JETABLE, et l'on relève ce qu'elle a produit
  (`git status`), pas ce qu'on croit qu'elle a produit.
- [1× — 08-25] **J'ai lu le code de sortie du WRAPPER, pas celui de la commande.** `gh run watch`
  écrivait `exit=1` dans son fichier ; la notification de tâche annonçait « exit code 0 » — celui
  du shell qui l'enveloppait. J'ai annoncé la CI verte sur deux workflows... rouges, et sur 2 des
  6 seulement. Un verdict de forge se prend sur l'ÉNUMÉRATION complète des runs du commit, pas
  sur les quelques-uns qu'on a pensé à surveiller.

- **La même URL recomposée à trois endroits, et l'un avait gardé l'origine nue** : `--dry-run`
  annonçait `http://localhost:5151` là où l'exécution visait `…/nodefony/mcp`. On croit un dry-run
  sur parole — c'est précisément pour ça qu'on le lance. Une valeur, calculée une fois.
  `[1× — 08-22]`
- **Un texte de sortie PÉRIME sans que rien ne le signale** : le rendu disait encore « écrit
  `NF_MCP_TOKEN` dans `.env` » le lendemain du jour où ce comportement avait été retiré. Un message
  qui envoie chercher un secret dans un fichier qui ne le porte pas, c'est le diagnostic d'une heure
  qu'on vient de payer, offert au suivant. `[1× — 08-22]`
- **Un compteur de ressources comparait deux instantanés pris dans des RÉGIMES différents.** Le
  banc de durée a rendu « handles 21 → 73 (+52) · TCPSocketWrap +48 » suivi de « des ressources
  s'accumulent : c'est un défaut PRODUIT » — de quoi chercher une fuite de sockets pendant des
  heures. Les handles OSCILLAIENT (6, 72, 5, 73, 29, 72, 73) : une fenêtre tombe tantôt pendant une
  rafale `wrk` (c64 ⇒ ~66 sockets vivantes), tantôt entre deux. Le PLANCHER, lui, valait 5 au début
  comme à la fin. **Ce qui se compare, c'est l'état au repos — jamais deux relevés dont on ignore
  le régime.** [1× — 08-26]
- **`grep -q` sous `set -o pipefail` transforme un SUCCÈS en échec.** `grep -q` ferme le pipe dès
  qu'il trouve ; l'amont meurt en SIGPIPE (141) et le pipeline REND 141. Et seulement si l'amont
  avait encore de quoi écrire — donc de façon non déterministe : le même scénario de smoke, sans
  qu'une ligne ne change, vert ou rouge. Démontré nu : `seq 1 10000000 | grep -q "^1$"` → 141,
  `seq 1 3 | grep -q "^1$"` → 0. Le remède ne rustine pas un site : `case "$texte" in *"$motif"*)`
  ne crée aucun pipe. [1× — 08-26]
- **`$?` lu après un pipe est celui du DERNIER maillon** — relu deux fois dans la même soirée (un
  banc jugé « exit 0 » alors qu'il sortait 1, un commit cru accepté alors que le hook l'avait
  refusé). Capturer dans un fichier, PUIS lire le code sans pipe. [2× — 08-26]
- [1× — 09-01] **Un chemin SECONDAIRE produit un artefact différent du chemin normal, et j'ai failli en tirer un défaut.** `orm:migrate:baseline --from-database` relit la base et renomme l'index (`User_identifier_key` au lieu de `User_identifier_unique`) ; j'ai conclu à une divergence du gabarit. Le chemin normal (`orm:generate` sur base vierge) produisait le nom exact, sur les trois moteurs. **Avant d'imputer un écart au produit, vérifier qu'on l'a mesuré par le chemin que l'utilisateur emprunte.**

## 🪟 Un message d'erreur qui n'énonce QU'UNE cause envoie chercher là où il n'y a rien

- [1× — 09-06i] **`npm publish` noie la demande du code à deux facteurs sous 800 lignes de
  `notice`** — le contenu intégral du tarball, par paquet, quinze fois. La seule chose que
  l'opérateur DOIT voir arrive après le mur. `--loglevel=warn` : ce que contient chaque archive
  vient d'être inspecté à l'étape précédente, qui refuse sur contenu suspect. **Une sortie qui
  attend une action humaine se juge sur ce qu'elle rend VISIBLE, pas sur ce qu'elle contient.**

- [1× — 09-06] **Un port peut être indisponible SANS être « déjà pris » — et seulement sous
  Windows.** Le repli de port ne retentait que sur `EADDRINUSE`. Or Hyper-V, WSL et WinNAT
  **réservent des plages entières** de ports éphémères, qu'un `listen` refuse en **`EACCES`**. Une
  app qui glisse de port en port y tombe statistiquement — et meurt là où linux et macOS
  continuent. Le symptôme en forge était un test rouge **par intermittence**, selon la plage
  tirée : exactement ce qu'on classe « flake » avant de regarder. Le remède a une borne, sans quoi
  il devient un défaut : sous 1024, `EACCES` veut dire « pas les droits », et glisser de 80 à 81 en
  silence serait la dégradation muette qu'on refuse (`f1212cde`).

- [1× — 09-04b] **Un code de sortie qui porte DEUX faits opposés fait rougir la forge sur une
  panne qui ne nous appartient pas.** `npm audit` rend `1` pour « des vulnérabilités » ET pour
  « je n'ai pas pu demander » — le registre npm a rendu 503 puis un timeout, et la CI est
  restée rouge une nuit entière. C'est le pire rouge : il n'apprend rien et il apprend à ne
  plus regarder. **Un gate doit séparer « la mesure a échoué » de « la mesure est mauvaise »**,
  et l'annoncer plutôt que de choisir en silence l'un des deux.
- [1× — 09-04b] **Un gate qui tombe TÔT masque tous ceux qui suivent.** Les étapes d'un job
  s'arrêtent au premier échec : réparer l'audit a révélé, derrière lui, un contrôle qui
  écrivait sur un socket fermé depuis des semaines peut-être. Un job rouge ne dit pas combien
  de rouges il contient.

- [1× — 08-31e] **Le refus qui annonce une destruction accusait la BASE, jamais le dossier
  d'entités.** `NF_GENERATE_DESTRUCTIVE` nommait un `drop table` sans dire un mot de ce que la
  découverte avait relevé. Quand le schéma déclaré est AMPUTÉ — fichier illisible, table écrite
  pour un autre moteur, entité qui n'exporte rien sous la configuration courante —, l'outil de
  diff ne distingue pas « absente de la découverte » de « supprimée du schéma ». Le message était
  donc exact sur la mécanique et muet sur la cause, et la correction naturelle qu'il appelle est
  d'accepter la destruction ou de repartir d'une base vide. **Un refus qui propose un geste
  destructeur doit énoncer ce qu'il a VU**, pas seulement ce qu'il a décidé. Et il n'était couvert
  par aucun test : le trou s'est vu en cherchant tout autre chose.

- [1× — 08-31] **Le fourre-tout a fait DÉTRUIRE une base.** Un agent avait suivi le conseil
  « éprouve la migration sur une copie » ; sa copie, fabriquée à la main faute de savoir quel
  fichier copier, portait une table d'historique inventée. La migration a échoué sur `no such
column: source` — et le fourre-tout des pannes a habillé ça de DEUX causes fausses, « la base
  n'a pas répondu » et « le compte n'a pas les droits ». La base répondait parfaitement. Sans
  issue, il a détruit la vraie. Le message était vrai sur la mécanique et faux sur la cause :
  troisième fois en trois sessions que ce motif coûte une base. Un fourre-tout ne doit RIEN
  affirmer — et ce qu'il peut reconnaître doit sortir AVANT lui.
- [1× — 08-29] « pod 1 n'a jamais écouté sur 5251 » : le pod écoutait, journalisait et servait la requête — c'est `/` qui mourait dans le magasin de session, faute de table. La sonde du banc interrogeait `/`, donc la réponse dépendait de toute l'application. Trois questions distinctes exigent trois sondes : le port (`/livez`), le service (`/readyz` 200), l'application (`/`). Le même banc a ensuite accusé le port alors qu'un runtime de développement tenait le verrou d'instance unique — cause désormais NOMMÉE (`causeProbable`).
- [1× — 08-28h] **DEUX messages EXACTS qui envoyaient chercher au mauvais endroit, dans la même
  commande.** (1) Un connecteur SQL enregistré hors configuration recevait « ne gère pas de
  migrations de schéma » : il en gère parfaitement, il manque ses coordonnées de connexion. La
  conception interdisait nommément cette phrase — « un message faux publié est appris par les
  scripts qui le lisent » — et je l'ai quand même écrite, parce que je constatais la propriété sur
  la seule configuration du module. (2) En mode `auto`, `orm:migrate` refuse toujours avec « cette
  base porte déjà les tables » : c'est le DÉMARRAGE qui vient de les créer, quelques
  millisecondes plus tôt. Le fait est vrai, la cause est ailleurs, et l'utilisateur cherche une
  vieille base qui n'existe pas. **Un message n'est pas jugé sur son exactitude mais sur l'endroit
  où il envoie chercher.** Les deux ne se voyaient qu'en EXÉCUTANT.

- [1× — 08-25e] **TROIS attentes muettes le même jour, dans trois bancs différents — et la troisième
  cachait un défaut de TEST qu'on prenait pour un défaut PRODUIT.** `new Promise(r => ws.once("pong",
r))` n'a aucune issue si la connexion se ferme : 60 s de « timed out » sans cause, une exécution
  sur deux. `abortedGet` résolvait sur `error` comme sur `close` sans jamais dire ce qu'il avait vu :
  « expected 1 to equal 20 », dix-neuf requêtes disparues en silence. Instrumenté, le message est
  devenu « côté client : 20 abandon(s) : expected 9 to equal 20 » — c'est-à-dire : les vingt ONT été
  abandonnées, le serveur n'en a vu que neuf, **parce que le test coupait avant qu'elles soient
  entrées dans l'action**. Sans l'instrumentation, on cherchait une fuite d'abandons dans le pipeline.
  **Toute attente doit avoir autant d'issues que la réalité en a**, et les nommer.

- **`spawnSync npm ENOENT` se lit « npm n'est pas installé »** — sur un runner où `npm ci` venait
  de réussir. La cause réelle : `npm` est un `.cmd` sous Windows, que Node refuse d'exécuter sans
  shell. Le message ne parle jamais de ce qui manque VRAIMENT (l'extension). [1× — 08-25]

- **Et quand il n'y a pas de message du tout : `status null`.** Un `.cmd` lancé sans shell ne rend
  ni sortie ni code — la garde du banc traduisait ce `null` en « un motif d'exclusion écarte
  l'application témoin », qui envoie chercher dans la configuration d'oxlint. Une garde qui
  INTERPRÈTE un symptôme doit d'abord distinguer « le contrôle a jugé et refusé » de « le contrôle
  n'a pas tourné ». [1× — 08-25]

- Trois jobs Windows rouges deux jours durant sur « man/nodefony.1 est PÉRIMÉE — node
  scripts/generate-man.mjs ». La page n'était pas périmée : git la convertissait en CRLF au checkout
  (`core.autocrlf`), le générateur écrit du LF, le gate compare octet pour octet. **Régénérer n'y
  changeait rien.** Le message nomme désormais les DEUX causes. Corollaire : un dépôt Node
  multiplateforme sans `.gitattributes` a ce piège en dormance. `[1× — 08-22]`

## 📐 Le verdict BINAIRE d'un banc gaspille ce qu'il a déjà mesuré

- [1× — 09-02] **Le FAIT et le JUGEMENT étaient figés ENSEMBLE, ce qui interdisait toute correction rétroactive.** La cause d'un rouge est mesurée pendant la tâche : elle appartient au run, elle reste. Son imputation est un classement : elle appartient à la table du jour, et elle se corrige. Le rapport gelait les deux, si bien qu'après avoir classé les causes manquantes, les runs déjà payés restaient « écartés, trou d'instrument » — il aurait fallu repayer des heures d'agent pour obtenir un verdict qu'un recalcul rendait en dix secondes. Séparés, le re-jugement a immédiatement changé trois verdicts sans relancer un seul agent.

- [1× — 08-28k] **Le même gaspillage dans le PRODUIT, pas dans un banc — et c'est l'exploitant
  qui paie.** Le verdict `divergent` des migrations dit qu'il y a un écart, jamais LEQUEL :
  `compareToDeclared()` rend un objet complet (tables absentes, colonnes manquantes nommées,
  séparées selon qu'elles se rattrapent) que `isDivergent()` réduit à `true`/`false` à un pas
  de la sortie. Le détail est même déjà publié ailleurs (`schemaDrift` de l'ORM) : rien à
  calculer, tout à laisser passer. Constaté au prix fort — une demi-heure de `psql` à comparer
  table par table ce que le produit connaissait. **Un booléen rendu sur un calcul riche est une
  décision de jeter**, et elle se prend sans qu'on la voie. Ticket #105 — **soldé** : le
  producteur rend le détail, et c'est le détail qui PRODUIT le verdict (plus de booléen à côté).

- [1× — 08-25e] **Le banc de tenue mesurait DEUX grandeurs et n'en jugeait qu'une.** Verdict « ✅ pas
  de fuite » sur un tas parfaitement plat, pendant que son RSS montait de 235 à 251 Mo avec un R² de
  0,92 et sans plafonner — en satisfaisant les trois conditions que le même fichier exige pour oser
  dire « fuite ». Pire : il recevait `heapTotal` et `external` de sa sonde et les JETAIT, donc il ne
  pouvait pas dire OÙ la hausse allait. Ventilé (tas réservé / externe / reste), le diagnostic tombe
  en une ligne — et il désigne l'extérieur de V8. **Ce qu'un banc mesure sans le juger est du travail
  déjà payé qu'on jette** ; ce qu'il juge sans le ventiler n'oriente vers rien.

- L'unanimité sur 3 runs a une résolution catastrophique : une tâche réussie 4 fois sur 5 sort
  « instable » **une fois sur deux** (P(3/3 | p=0,8) = 0,51). Vérifié dans le fichier : la tâche 13
  était à `2/3` le 2 août ; trois runs rejoués trois semaines plus tard ont rendu `2/3`. Deux
  mesures payées, zéro information. Les TOURS, eux, séparaient nettement (52·54 contre 69·88) —
  et le banc les jetait à la décision. `[1× — 08-22]`
- **Ne pas contourner à la main le refus d'un outil** : le dépistage a REFUSÉ de comparer (décor
  différent), je l'ai refait au `jq` et j'ai lu trois « chutes » qu'aucun changement n'expliquait.
  Refaire le calcul qu'une garde interdit, c'est reproduire l'erreur qu'elle empêche. `[1× — 08-22]`

## 🎭 Un test de CARACTÉRISATION grave un défaut au lieu de le décrire

- [1× — 09-05c] **Un DÉCOR de test a fait accuser un fichier situé à l'autre bout du dépôt.** `scripts-audit.mjs` repère les scripts « jamais lancés » en cherchant leur NOM DE FICHIER dans les sources ; mon faux dépôt en mémoire contenait la chaîne `"src/mirror/schema.ts"`, et l'audit en a conclu qu'un `schema.ts` d'un skill était désormais lancé — acquittement « périmé », forge rouge. Un décor de test est du texte comme un autre pour un scanner : lui donner des noms que rien d'autre ne porte.
- [1× — 09-05c] **Huit cas verts en local, rouges sous `CI=true`.** Le décor lisait le vrai `process.env`, et la règle neuve refusait d'animer en forge. Un décor qui interroge l'environnement doit le DÉCLARER (`animate: true`), sinon il éprouve la machine de son auteur. Contrôle qui a sauvé le push : rejouer la suite sous `CI=true` et `TERM=dumb` avant de commiter.

- [1× — 08-29c] **Un test nommé « elle ne détourne jamais un connecteur SQLite » gravait un faux succès de déploiement.** Il décrivait exactement le comportement fautif — la variable de migration ignorée — avec l'assurance d'un contrat. Personne ne le relit en se demandant s'il a raison : un test vert est une preuve, pas une question. Il n'est tombé que parce que j'ai capturé les ÉCRANS RÉELS pour les faire valider, et qu'un écran annonçait « ✓ appliqué » sur la mauvaise base. **Un test dont le titre commence par « ne … jamais » mérite qu'on demande POURQUOI jamais.**

- [1× — 08-27j] **Le test gravait le SILENCE, et son intitulé disait pourquoi c'était normal.**
  « canal LIBRE non déclaré → autorisé mais 0 provider » avec `expect(denials).to.have.length(0)`
  et le commentaire « pas refusé (canal applicatif libre) ». Il figeait exactement le trou que je
  venais de fermer : un abonnement sans réponse, indiscernable d'un canal calme. Signal à
  reconnaître, plus fin que « un intitulé sans pourquoi » : **un intitulé qui JUSTIFIE une absence**
  (« pas de X, c'est normal parce que Y »). Ici la justification était vraie pour l'AUTORISATION et
  fausse pour la RÉSOLUTION — deux étapes que le test confondait sans le dire.

- « initSyslog 2x avec kernel → 2 listeners (**pas de deduplication**) » — aucune justification, un
  simple constat figé. Il gardait un vrai bug : `listenWithConditions` AJOUTE un abonné, donc
  reconfigurer le filtre ne servait à rien (l'ancien écrivait toujours) et chaque ligne acceptée par
  plusieurs abonnés était écrite plusieurs fois. Signal à reconnaître : un intitulé qui **décrit un
  comportement sans dire pourquoi il serait souhaitable**. `[1× — 08-21e]`
- **Un renommage mécanique EMPORTE le témoin qui portait l'ancienne forme.** Le selftest du décor
  posait `NODEFONY_DEV_PORTS` pour graver « l'ancienne forme échappe au filtre `NF_` » ; le
  renommage global l'a transformée en `NF_DEV_PORTS`, donc correctement filtrée — et le test est
  tombé **parce que la réalité s'était améliorée**. Signal : un test rouge dont l'intitulé commence
  par « ⚠️ connue ». Le geste est de RETIRER la règle, pas de rafistoler le témoin. `[1× — 08-23c]`

## 🚪 Un fast-path standalone ne vaut QUE pour l'invocation directe

- [1× — 09-05d] **L'aide PROMET, la commande REFUSE — et rien ne dit qui a raison.** `nodefony create app --interactive` répondait « option inconnue », alors que `nodefony --help` annonce `-i, --interactive` deux lignes plus haut. Cause : ces options sont posées sur commander pour tout le CLI, et SEPT commandes répondent par le raccourci autonome, qui lit `process.argv` lui-même — précisément pour répondre sans démarrer l'application. Aucune ne cassait ; toutes démentaient l'aide, sur la toute première commande qu'on tape en découvrant le framework. Le raccourci n'hérite de RIEN : ce que la couche court-circuitée offrait doit être réoffert explicitement, à UN endroit (`cli/globalFlags.ts`), sinon la huitième commande autonome rouvre le trou sans que personne le voie.

- `card`, `check`, `env`, `symbols`, `ai:sync`, `ai:mcp`, `git:hooks` : lancées depuis le MENU, le
  kernel tourne déjà, elles passent par commander et **BOOTENT** — leur sortie arrivait sous dix à
  trente lignes de « MODULE ADD ». Même piège pour les capacités déclarées : `CliKernel.start()` les
  applique d'après la commande DEMANDÉE, or depuis le menu c'est `menu`. Toute règle posée « au
  démarrage d'après argv » a un angle mort : le choix différé. `[1× — 08-21e]`

## 🧨 Une commande de DÉCLARATION ne doit jamais désarmer ce qu'elle trouve

- **[1× — 09-01] Un banc qui « nettoie son décor » détruit un artefact COMMITÉ dès que le dépôt se met à en produire un.** Le banc d'adoption vidait `migrations/<dialecte>` avant et après chaque cas — sans risque tant que le dépôt n'avait aucune migration d'application. Depuis que l'identité lui appartient, il en a. Le dossier disparaissait du disque **sans que `git status` soit consulté**, et le manque se manifestait des heures plus tard sur un « table absente : User » qui accusait le produit. Règle : un banc qui écrit dans l'arbre du dépôt met de côté ce qu'il y trouve et le remet — supprimer n'est légitime que sur ce qu'on a soi-même écrit.

- [1× — 08-28h] **La question que personne n'avait posée : et si la migration DÉTRUIT ?**
  `orm:migrate` appliquait un `DROP COLUMN` en production sans un mot — ni la conception validée,
  ni le ticket, ni moi ne l'avions vu. La question est venue du user (« le backup c'est pas
  obligatoire ??? »). La bonne réponse n'était pas celle qu'elle suggérait : aucun outil de
  migration ne sauvegarde, et le faire donnerait une assurance qui n'existe pas — mais **l'absence
  de sauvegarde rendait le silence de l'outil inacceptable**. L'outil ne sauvegarde pas : il
  empêche d'appliquer SANS SAVOIR. Au démarrage, le garde est plus strict et sans drapeau pour le
  lever — un exemplaire qui redémarre ne supprime jamais de données de lui-même, personne ne
  regarde à ce moment-là. **Toute commande d'exploitation doit répondre à « et si ça détruit ? »
  AVANT sa première ligne de code.**

- [1× — 08-27] **`docker compose --profile X down` ne borne PAS la descente au profil.** Voulant
  arrêter le seul conteneur navigateur, j'ai emporté `nodefony-redis` — un service d'infra que
  d'autres suites utilisent. Le drapeau qui SÉLECTIONNE à la montée ne RESTREINT pas à la
  descente. Relancé aussitôt, mais le geste juste était `down <service>` nommé, ou `stop`.

- `ai:mcp` sans option RETIRAIT l'en-tête `Authorization` posé la veille — deux fois en une heure sur
  la config du développeur, dont une par un `--json` de simple vérification. Le message disait
  « (remplaçait <la MÊME url>) » : un remplacement qui ne remplace rien de visible. Deux règles :
  **`null` ≠ `false`** (« je n'ai rien demandé » n'est pas « je veux l'anonyme »), et **ce qu'on
  enlève se NOMME** dans la sortie. `[1× — 08-21e]`

## 🧵 Trois choses ne suivent PAS d'un process à l'autre — enchaîner se teste

- [1× — 09-05d] **Un test lisait `NODE_ENV` de SON process pour savoir si le SERVEUR tourne en production.** Deux horloges : la forge démarre le serveur en production et lance la suite sans ce mode. Le cas exigeait donc, en production, la phrase que la production retire exprès — rouge sur les trois plateformes à la fois. Le porteur existait déjà (`NF_TEST_ENV`, posé par un `globalSetup` qui SONDE le serveur sur `/livez`) ; ce cas était le seul à ne pas l'appeler. Avant d'écrire une condition sur l'environnement dans un test d'intégration, chercher QUI porte déjà le mode de la cible.

- Enchaîner une commande sur une autre (`spawnSync`) : l'ENVIRONNEMENT (un enfant ne reçoit que ce
  qu'on lui donne — et `NODE_ENV` si la cible n'existe qu'en dev), le RÉPERTOIRE (écrire dans le
  PROJET, pas là où l'on a tapé), le TERMINAL (`stdio: "inherit"`, sinon `isTTY` est faux chez
  l'enfant et il ne peut rien demander). Rendre la DÉCISION pure et la tester ; le spawn est de la
  plomberie. Le gabarit `create command` l'enseigne désormais. `[1× — 08-21e]`

## 🖥️ Piloter un TTY par `expect` prouve mal — préférer rendre le câblage testable

- Cinq tentatives pour valider un choix de menu : filtres qui ne mordent pas, `\r` qui valide le
  premier item, prompt masqué impilotable, serveur de dev lancé par erreur **deux fois** (qu'il a
  fallu arrêter). Le prompt `search` d'inquirer ne se pilote pas de façon fiable. Quand un câblage a
  échoué en silence, l'exposer (méthode publique) et l'ÉPROUVER coûte moins cher qu'un pty.
  `[1× — 08-21e]`

## 💾 Un CACHE à demi écrit est pire qu'un cache absent — il écrase une donnée valide

- `[1× — 08-21d]` 🔴 **Trois symptômes sans rapport apparent, une seule racine : un `writeFile` en
  fire-and-forget.** Le menu perdait TOUTES ses commandes de module, la complétion proposait des
  noms de commandes au lieu des options, et le user devait relancer `nodefony -h` « à chaque fois ».
  Cause unique : `writeFile` OUVRE et TRONQUE avant d'écrire, donc un process qui sort avant la fin
  — le cas NOMINAL d'une commande CLI courte — laisse un fichier de **0 octet**. Chaque commande
  détruisait ainsi le cache que la précédente avait écrit. Le geste : **temporaire + `rename`**
  (atomique) dès qu'une écriture n'est pas attendue ; un process tué laisse alors l'ancien fichier
  INTACT. Et le diagnostic : `wc -c` sur le cache AVANT de suspecter sa logique de lecture.
- `[1× — 08-21d]` **Un fallback silencieux transforme un cache manquant en fonctionnalité amputée.**
  Le menu masquait le groupe entier sans un mot ; il ÉNONCE désormais l'absence et renvoie à
  `--help`. Corollaire de conception : ce qui répond à un TAB ou ouvre un menu ne doit jamais
  démarrer l'application — mais doit dire ce qu'il ne sait pas.

## 🖥️ L'interactif se prouve au PTY — et chaque couche peut salir la sortie

- [1× — 09-05c] **La brique éprouvée, la chaîne jamais — et seul l'ÉCRAN l'a dit.** Un tourniquet neuf, 27 cas verts, branché sur `doctor --deep` : il peignait sa première image puis restait figé. Cause : `runNpmScript` appelait `spawnSync`, qui BLOQUE la boucle d'évènements — aucun `setInterval` ne s'y déclenche. Aucun test ne pouvait le voir (ils éprouvent l'objet isolément, avec des minuteurs simulés), et le user l'a vu du premier coup d'œil. **Une animation ne se prouve pas en testant l'animateur : elle se prouve en regardant la chaîne tourner.** Corollaire : corriger UN des deux `spawnSync` laissait l'autre figer trente secondes de plus.

- [1× — 08-29c] **Mon rapport d'écrans est sorti entièrement MONOCHROME, et j'ai failli le livrer ainsi.** J'avais posé `FORCE_COLOR=1` en croyant la question réglée : les commandes lisaient `process.stdout.isTTY` en direct, sans honorer ni `FORCE_COLOR` ni `NO_COLOR`, alors que le cœur porte déjà la règle. Conséquence de fond : **aucune sortie colorée n'était capturable** — ni dans un fichier, ni en intégration continue, ni dans un rapport. Le défaut n'a été trouvé qu'en REGARDANT la page rendue ; un compte de séquences ANSI sur la capture l'aurait dit plus tôt, et c'est le contrôle à faire dès qu'on capture une sortie censée être colorée.

- `[1× — 08-21c]` **`script(1)` + `printf` piloté = prouver un prompt TTY sans machine ni
  main** : `(sleep 4; printf 'blog'; sleep 1; printf '\r') | script -q cap.txt npx nodefony
menu` — quatre preuves rendues dans la session (rendu groupé, filtre à la frappe, Ctrl+C,
  écran reset + commande exécutée). La capture se relit APRÈS strip ANSI, et le viewport
  d'inquirer ne rend que la fenêtre : « absent de la capture » ≠ « absent du menu » (vécu :
  un groupe en bas de liste cru manquant, révélé par le filtre).
- `[1× — 08-21c]` 🔴 **Un Ctrl+C « propre » a demandé DEUX corrections, chacune une couche
  plus bas** : (1) `throw` après `terminate()` — terminate est ASYNCHRONE, l'erreur remontait
  au kernel avant l'exit (CRITIC + exit 1) ; (2) `quiet` perdu par `CliKernel.terminate` qui
  délègue au kernel → le log INFO ressurgissait après « À bientôt. ». La sortie d'un CLI est
  une CHAÎNE de terminaisons : la prouver au pty à CHAQUE couche, pas au premier vert.
- `[1× — 08-21c]` **`stream-json` ne montre PAS le contexte initial injecté** : « VÉRIFIER
  absent du transcript » ne prouvait pas « CLAUDE.md pas injecté ». Tranché par une sonde
  discriminante à 1 centime : CLAUDE.md témoin « réponds BANANE42 » + `claude -p` → réponse
  conforme = le pointeur EST le seul canal injecté d'office en headless. L'instrument d'abord.
- `[1× — 08-21c]` **`perl -pe 's/\x{00A0}//'` sans décodage UTF-8 opère en OCTETS** : il a
  matché le seul 0xA0 et laissé le 0xC2 orphelin — fichier UTF-8 invalide, pire qu'avant.
  Remplacer un caractère multi-octets exige `-CSD` (ou opérer sur la séquence complète), et
  se vérifie à l'`od -c`, pas à l'œil.

## 🗄️ 🧪 Vérifier que la transformation a EU LIEU — GRADUÉ

> Gradué au CONSOLIDATE du 2026-09-07 — 57 frictions réparties entre
> **`feedback_prove_on_received_artifact`** (mesurer sur l’artefact reçu) et
> **`feedback_shell_false_diagnostics`** (§ « Six pièges de plus » : `sed -i ’’` BSD muet,
> `for f in $VAR` en zsh, `--json` tronqué dans un tube, commande refusée par le harnais).
> Ne PAS réécrire ici.

## 🗄️ Gradué aux CONSOLIDATE (retiré d'ici — règle anti-doublon)

Ces thèmes ont quitté le sas pour des mémoires durables. Ne pas les réécrire ici.

**CONSOLIDATE 2026-08-24 :**

| Thème (frictions)                                                  | Destination                                      |
| ------------------------------------------------------------------ | ------------------------------------------------ |
| 🔌🧪🎭 Le DÉCOR d'un banc : variable, pas dû ; ni celui livré (19) | `feedback_stale_decor_poisons_verdicts` (§ banc) |
| 🎯🔍⚖️🗣️ La sonde mesure-t-elle la CHOSE ? zéro muet (12)          | `feedback_prove_the_target_not_the_verdict` (§)  |
| 🏭🖨️ Le GABARIT n'est pas son RENDU — formater l'un ≠ l'autre (9)  | `feedback_dogfood_distributed_templates` (§)     |
| 🚦🐚🧾 Le code de sortie LU n'est pas celui MESURÉ (7)             | `feedback_shell_false_diagnostics` (§)           |
| 🎯🧰 La commande du DÉPÔT est l'autorité — le frère existe (7)     | **`feedback_repo_command_is_authority`** (neuve) |
| 🧪 Un test neuf peut FIGER sans discriminer (6)                    | `feedback_gate_must_bite` (§ figer)              |
| 📌 Un chiffre publié sans son COMMIT n'est pas réfutable (6)       | `feedback_measure_method` (§ 5)                  |
| 🩹🔁🧭 Corriger l'OCCURRENCE, pas le MOTIF — se recontaminer (6)   | `feedback_single_source_rule` (§)                |
| 🔎 Une ABSENCE de trace n'est pas une preuve (5)                   | `feedback_source_over_memory` (§)                |
| 🔗 « Valider la chaîne » = l'EXÉCUTER (5)                          | `feedback_prove_on_received_artifact` (§)        |

_Coupés au même passage (toutes frictions antérieures au CONSOLIDATE du 08-20, jamais reconduites) :_
🚦 contrôle de cible rouge · 🔇 mode machine qui coupe le journal · 📐 pourcentage de profil ·
🤖 `haiku` trompé 2× · 🕵️ cause temporelle commune · 🧭 leçon gravée dans UN artefact ·
🏷️ nom de variable déjà pris · 🧾 racine ≠ paquet · 🧰 réécrire le métier d'un outil ·
⛓️ gate en chaîne · 🎚️ valeur par défaut · 🎭 état sauvegardé sans identité · 🪟 Windows « après » ·
🖼️ rendu qui remplace · 🎲 variance d'un banc d'agent · 🪦 phrase qui justifie une absence ·
🤝 nom partagé entre paquets · 🕸️ interface sans son appelant · 🚚 déménager un artefact ·
🪞 serveur tolérant vs strict · 🚧 donnée arrêtée à la frontière · 🕳️ pointeur conforme ·
📏 cellule obèse · 🩺 montée de version · 🗣️ juge qui exige une sortie vide.
Snapshot : `archive/RETEX-snapshot-2026-08-24.md`.

**CONSOLIDATE 2026-08-20 :**

| Thème (frictions)                                             | Destination                                    |
| ------------------------------------------------------------- | ---------------------------------------------- |
| 🧰 Outillage : ce qui pend, ce qui ment, ce qui lance (24)    | `feedback_prove_the_target_not_the_verdict`    |
| 🧪 Un gate ne prouve rien tant qu'on ne l'a pas vu ROUGE (14) | `feedback_gate_must_bite` (§ débranchement)    |
| 🧭 Annoncer une NORME sans l'avoir lue jusqu'aux ÈRES (10)    | `feedback_spec_conformance_vs_reachability`    |
| 📚 La doc officielle périme la mémoire (7)                    | `feedback_source_over_memory`                  |
| 🔬 Quatre instruments faux d'affilée sur UNE question (6)     | `feedback_suspect_instrument_and_own_diff` (§) |
| 🔦🧩 Une capacité qu'on n'ATTEINT pas n'existe pas (6)        | `feedback_capability_unreachable_is_absent`    |
| ⏱️ Un test qui attend un DÉLAI FIXE mesure la machine (5)     | `feedback_test_no_fixed_delay`                 |
| 🗣️🧭 Le user REPOSE la question · prémisse à vérifier (7)     | `feedback_user_repeats_question`               |
| 📦 npm : un arbre réparé à la MAIN n'est pas une garantie (5) | `feedback_npm_tree_not_a_guarantee`            |

_Coupés au même passage (antérieurs au 2026-08-06, déjà couverts par une mémoire graduée) :_
🧬 patron N fois · ⚖️ geste puni par l'outil · ⚙️ montée d'outil · 📖 API d'une lib maison ·
🔎 ce que le journal des commits cache · 🔴 gate rouge en permanence · 🛡️ garde posée/retirée ·
🕳️ import qui compile chez moi. Snapshot : `archive/RETEX-snapshot-2026-08-20.md`.

**CONSOLIDATE 2026-08-06 :**

| Thème (frictions)                                             | Destination                                                        |
| ------------------------------------------------------------- | ------------------------------------------------------------------ |
| 🧾🎛️ Paramètre accepté puis jeté · capacité au store (21)     | `feedback_param_accepted_then_dropped`                             |
| 📏🌡️🔬 Régime machine · fenêtre de banc · profil/in-situ (26) | `feedback_bench_machine_regime`                                    |
| ✅🚫🕳️ Données discriminantes · refus≠capacité · filet (22)   | `feedback_test_discriminant_or_dead`                               |
| 🥫🧬 Gabarits distribués · dogfooding · agent étranger (11)   | `feedback_dogfood_distributed_templates`                           |
| 🧰🎚️ Décor sale : serveurs, ports, stores, env de banc (10)   | `feedback_stale_decor_poisons_verdicts`                            |
| 📄 Une livraison n'entraîne pas sa doc · anchor-fix (6)       | `feedback_refactor_grep_consumers` (section doc)                   |
| 🧰 Formes shell : zsh `:A`, BRE `\{`, `rg -oh`, `&&` (6)      | `feedback_shell_false_diagnostics` (tableau)                       |
| 🗄️ Concurrence & dialectes (ESCAPE, ODKU, pool froid) (9)     | kit `project_orm_multidialect_chantier_kit` (§ Leçons dialectes)   |
| 📦 Surface npm & publication (6)                              | kit `project_release_nodefony10` (§ Pièges de surface npm)         |
| 🤖 Piloter un agent TIERS (6)                                 | kit `project_devkit_bench_agent_switch` (§ Piloter un agent tiers) |
| ⚖️🎯🎭 Juges, sondes de moyen, décor du banc (11)             | kit `project_devkit_bench_matrix` (§ Juges et sondes)              |
| 🔀 Deux appels au même traducteur (2)                         | fondu dans `feedback_param_accepted_then_dropped`                  |
| 📣 Commande maison filtrée par la familiarité (2)             | fondu dans `feedback_dogfood_distributed_templates`                |
| 🧹 Remise à zéro fichiers ≠ process (2)                       | fondu dans `feedback_stale_decor_poisons_verdicts` + kit matrix    |

**CONSOLIDATE 2026-08-02 :**

| Thème (frictions)                                       | Mémoire                                                                 |
| ------------------------------------------------------- | ----------------------------------------------------------------------- |
| 🧪 Suspecter son instrument / son propre diff (35)      | `feedback_suspect_instrument_and_own_diff`                              |
| 🪞 Un exemple de CODE agit, même faux (8)               | `feedback_agent_example_over_prose`                                     |
| 🕳️ Gate qui ne LIT rien · débranchement destructeur (7) | `feedback_gate_must_bite` + `feedback_destructive_needs_identity_scope` |
| 🎯 Isoler une variable · sonde de proximité (8)         | `feedback_measure_method` + `feedback_bench_probe_false_verdicts`       |
| 🔍 Inventaire exhaustif par croisement (4)              | `feedback_inventory_needs_crosscheck`                                   |
| 🎲 Variance d'un run à l'autre (4)                      | `feedback_measure_method` + `feedback_bench_probe_false_verdicts`       |
| ✅🧷 Un vert de test ne typecheck rien (3)              | `feedback_gate_must_bite`                                               |
| 🟢 Test non exécuté = rouge · vert annoncé (4)          | `feedback_gate_must_bite` + `feedback_green_covers_only_its_diff`       |
| 📦🔗🔬 Ce qui est COPIÉ ne se met pas à jour (4)        | `feedback_single_source_rule`                                           |
| 🧨 Commande composée refusée (1)                        | `feedback_shell_false_diagnostics`                                      |

## 🗄️ 🧰 Un GATE excellent que personne ne lance ne garde rien — GRADUÉ

> Gradué au CONSOLIDATE du 2026-09-07 en mémoire **`feedback_gate_must_run`** — 47 frictions,
> cinq façons dont un contrôle cesse de garder : personne ne le lance · son verdict est avalé ·
> son périmètre est amputé · il est rouge et personne ne le lit · sa règle vit hors des fichiers
> relus. Ne PAS réécrire ici (règle anti-doublon) — verser les frictions neuves dans la mémoire.

## 🗄️ 🎯 Une ancre PLAUSIBLE et fausse — GRADUÉ

> Gradué au CONSOLIDATE du 2026-09-07 — 27 frictions en mémoire
> **`feedback_anchor_expires_silently`** : ligne, nom, CHIFFRE, renvoi et preuve se périment
> sans rien dire ; se relisent au moment où l’on s’en sert. Ne PAS réécrire ici.

## 🤝 Un sous-agent répond « INCHANGÉE » quand chercher devient pénible

- [1× — 09-06g] **Il ÉCHANTILLONNE quand on lui demande d'être rigoureux ; il BALAIE quand on lui dit quelles UNITÉS énumérer.** Trois lots de README confiés à `haiku` avec « rends un verdict pour CHAQUE affirmation vérifiable » : le lot données/sécu a rendu **17 affirmations pour 798 lignes** — `security` (182 l.) en a produit 2. Relancé avec « traite CHAQUE bloc de code, CHAQUE ligne de tableau, CHAQUE commande, CHAQUE valeur par défaut annoncée », il a rendu **26 affirmations sur le seul README de 106 lignes**, preuves ancrées dans le schéma Zod. La consigne qui mord n'est pas un adjectif de qualité, c'est **la liste des unités à parcourir**. Et la **preuve circulaire** est revenue une fois de plus (une variable d'environnement « prouvée » par le tableau du README qui l'annonce) — même mécanisme qu'en 09-01 : quand la source facile répond, le modèle ne va pas chercher la coûteuse.

- [1× — 09-06g] **Une TROISIÈME relance dégrade au lieu d'améliorer.** Le même agent, repris deux fois, a fini par annoncer qu'il « synthétiserait pour respecter le budget », s'est arrêté après 2 des 5 fichiers restants, et a cité un `CLAUDE.md` comme preuve — explicitement interdit dans sa propre consigne. Les trois derniers ont été faits à la main en moins de temps que la relance. **Deux passes maximum : si la seconde ne rend pas ce qu'on attend, reprendre le travail, pas l'agent.**

- [1× — 09-06e] **Un agent a rendu « 2 fichiers » là où il y en a 3** (`frontend-build`, `-dev`, et
  `-status` qu'il avait raté) — dans un rapport par ailleurs excellent, 16 verdicts justes sur 17.
  Le recontrôle d'un `ls` a pris trois secondes. La règle du `CLAUDE.md` — « toute affirmation
  d'inventaire se recontrôle avant d'entrer dans une synthèse » — a mordu ici ; **elle ne mord que
  si on la joue sur les rapports QU'ON CROIT BONS**, pas seulement sur ceux qui sentent le faux.

- [1× — 09-05d] **Un relevé délégué en `haiku` portait deux affirmations FAUSSES, plausibles toutes les deux.** Un `TODO P14.11` lu comme « fonctionnalité non implémentée » alors que c'est le numéro de phase du fichier, et une couverture attribuée à un fichier de test qui ne l'exerce pas. Le relevé restait utile — 29 fichiers cités sur 29 existaient bel et bien —, mais aucune de ses conclusions n'est entrée dans la page sans être remesurée par un automate. La délégation donne la MATIÈRE ; le verdict se reprend.

- [1× — 09-01] **Il a rendu le COMPTE et pas les VERDICTS.** Dix affirmations d'un ticket confiées à `haiku` avec la consigne « verdict + citation + ancrage ACTUEL, pour CHACUNE » : le rapport annonce « 10 affirmations : 4 VRAI, 4 FAUX, 2 NON VÉRIFIABLE » — et ne donne le détail d'AUCUNE. À la place, un tableau de cinq autres emplacements, trouvés par la question bonus. Le compte est invérifiable et le travail utile absent. J'ai dû reprendre les dix à la main (six `rg`, deux minutes) — et six des dix étaient **déjà corrigées** par les tickets de la veille. Consigne à durcir : « rends une LIGNE PAR ITEM, numérotée comme l'énoncé ; un résumé chiffré sans le détail vaut zéro ».

- [1× — 09-01] **Un verdict binaire ne rend pas la tâche mécanique.** 50 ancres confiées à `haiku` « définition ou occurrence ? » : rapport rendu confiant, **~1 verdict sur 6 exact** (`tmpDir` donné à 485, il est à 512 ; quatre autres pointant des commentaires). Rien appliqué. Le tri s'est fait par un script à motifs forts, puis à la main. Distinguer une DÉFINITION d'une occurrence demande de lire du TypeScript, pas de faire un `grep` — le test « la réponse est-elle vérifiable ? » ne suffit pas, il faut « est-elle lisible SANS juger ? ». À l'inverse, `fable` sur un audit de corpus (liens, schémas périmés) a rendu **5 affirmations sur 5 exactes** après recontrôle.

- [1× — 09-01] **Deux sous-agents chargés de confronter 49 cases de la feuille de route au CODE ont confronté les libellés au FICHIER** — 21 preuves sur 26 pour le second étaient des lignes de `MIGRATION_STATUS.md` lui-même. Le tableau rendu était impeccable de forme et **circulaire de fond** : un fichier confirme toujours ce qu'il affirme. Le prompt disait « ancrage `fichier:ligne` ACTUEL » et donnait le périmètre `src/` — insuffisant, parce que le fichier de référence EST un ancrage valide au sens littéral. **Ce qu'il fallait écrire** : « l'ancrage doit citer un fichier de `src/`, jamais le document audité » — et le recontrôler à la réception. Même mécanisme que l'« INCHANGÉE » : quand la source facile répond, le modèle ne va pas chercher la source coûteuse.

- [1× — 08-28c] **Il annonce lui-même qu'il renonce, et on ne le lit pas** : « étant donné la complexité et la longueur croissante de la tâche, je vais synthétiser » → 5 items sur 15 rendus « NON VÉRIFIABLE PAR LECTURE », dont **4 que `rg` tranche en une commande** (une commande CLI existe-t-elle ? un champ est-il en int ?). Un « non vérifiable » sur une question mécanique est un **abandon**, pas un verdict : le recompter soi-même, toujours.

- **Le verdict « en fait livré » se déclenche dès qu'une PARTIE du travail existe.** Sur 48 lignes
  de feuille de route confrontées au code, 26 rendues « livrées » — plusieurs contredites par les
  remarques du même relevé (« reste à généraliser », « bug CLI ⬜ »). Le même biais a classé
  « corrigée » une dette qui ne l'était pas, en se fondant sur le seul module du lot qui l'était,
  ce que la ligne indiquait déjà. La question qui manque : _TOUT_ le travail décrit est-il là ?
  Corollaire : ne jamais appliquer un lot de verdicts délégués sans recontrôler ce qu'on va
  changer — les 4 « corrigées » recontrôlées ont livré 1 faux. [1× — 08-27]

- **Trois lots sur quatre ont classé la majorité des cas difficiles « INCHANGÉE — contexte correct
  pour le concept ».** J'ai répercuté ce verdict tel quel, en concluant « faux positifs pour
  l'essentiel ». Un échantillon tiré au hasard a rendu **6 sur 6 FAUX**. La complaisance ne se voit
  pas : la réponse est plausible, motivée, et arrive vite. Réflexe : sur un lot délégué, TIRER AU
  SORT quelques items et les vérifier soi-même avant de croire la proportion annoncée — c'est le
  seul contrôle qui distingue « rien à faire » de « l'agent n'a pas cherché ». [1× — 08-23b]
- **Un sous-agent s'est aussi trompé sur un fait simple** (`SLOW_CONSUMER_BYTES` déclaré disparu
  alors qu'il est défini `RealtimeHub.ts:63`). Un vérificateur AUTOMATIQUE — la ligne proposée
  contient-elle la preuve annoncée ? — a rejeté 7 propositions sur 77 sans rien lire. Déléguer la
  RECHERCHE, garder l'ÉCRITURE, et intercaler un automate entre les deux. [1× — 08-23b]
- [1× — 08-31] **Un sous-agent `haiku` a brûlé 84 k tokens et 40 tours pour ne RIEN rendre** (limite de tours atteinte, rapport vide) sur 16 affirmations à confronter au code — que cinq `rg` groupés ont tranchées ensuite en trois minutes. Le déclencheur « ≥ 6 affirmations » était rempli, et il a quand même coûté plus que faire soi-même : ces 16 items étaient des motifs EXACTS (`rg -n 'NF_X' fichier`), donc du ressort de la QUESTION ZÉRO — un automate rend la réponse, exhaustivement et gratuitement. Le seuil ne suffit pas : avant de déléguer, se demander si un motif répond. Si oui, l'écrire soi-même.

## 🗄️ 🪤 Une garde peut EMPÊCHER ce qu’elle prétend gérer — GRADUÉ

> Gradué au CONSOLIDATE du 2026-09-07 — 20 frictions versées dans
> **`feedback_gate_must_bite`** (§ « Le RETOURNEMENT ») : un gate qui mord à l’envers, punit la
> bonne conduite, ou mange son propre témoin. Ne PAS réécrire ici.

## 🔇 Ce qu'on COUPE pour mesurer, on le coupe aussi pour DIAGNOSTIQUER

- [1× — 09-05g] **Un gate qui EXCLUT un dossier applique la règle au produit et pas à ce que le
  produit FAIT PRODUIRE.** `check-identifier-language.mjs:1050` exclut `templates` — or les 95
  gabarits sont exactement ce que `nodefony create` écrit chez l'utilisateur : un identifiant
  français y produit un identifiant français dans CHAQUE application générée, et rien ne le voit.
  Même défaut que #174 (le framework moins sévère que ce qu'il fait produire). Le geste : devant un
  gate, **lire sa liste d'exclusions avant de croire son verdict vert**.

- [1× — 09-05] **`expect(...).not.toThrow()` autour d'une commande jette son rapport.** Le cas de conformité du banc lançait `nodefony check` et rendait « Command failed: …/bin/nodefony check », rien d'autre — alors que la commande AVAIT écrit un diagnostic nommant le manquement. Deux allers-retours de forge pour apprendre ce que la sortie disait du premier coup ; et une SECONDE cause, cachée derrière la première, n'est apparue qu'une fois le cas rendu bavard. Capter `stdout`/`stderr` et les remonter dans le message d'échec.
- [1× — 08-31e] **Un symptôme qui ne se reproduit pas ne se chasse pas — il se rend LISIBLE.**
  Un banc rendait un verdict dépendant des dialectes joués dans la même passe : 2 rouges sur 5 la
  veille, **0 sur 7 aujourd'hui**, décor et commandes identiques. Trente-cinq minutes de tirages
  pour une conclusion nulle. Ce qui manquait au rouge n'était pas une répétition de plus, c'était
  l'ÉTAT dans lequel il était survenu — tables réellement en base, fichiers écrits, journal — que
  le banc ne capturait nulle part. **Quand re-tirer coûte plus que la réponse, arrêter de tirer et
  instrumenter le point d'échec** ; l'enrichissement se pose au point UNIQUE par lequel tous les
  cas passent, sinon il est oublié au premier cas ajouté. Corollaire vécu deux jours de suite :
  **instruire le ticket a rendu plus que l'exécuter** — le vrai défaut trouvé était ailleurs que
  là où l'énoncé pointait.

- [1× — 08-28] **Deux tests rouges accusaient mon diff ; c'était mon propre `npm run build` qui
  tournait EN MÊME TEMPS.** Le script du cœur commence par `rimraf dist` : lancé pendant qu'une
  suite en arrière-plan bootait un vrai CLI, il a effacé `dist/node/index.js` sous ses pieds
  (`ERR_MODULE_NOT_FOUND`). Rejoués après le build, les deux cas étaient verts. **Une tâche de
  fond et un build ne se chevauchent jamais impunément quand le build DÉTRUIT avant de
  reconstruire** — et le rouge qui en sort ressemble trait pour trait à une régression.

- [1× — 08-25] **Un `tail -200` qui se fait passer pour le journal.** Sur un serveur qui
  journalise chaque requête, 200 lignes couvrent TROIS secondes : l'échec du milieu de suite n'y
  était pas. J'en ai conclu que la trace était perdue et j'ai renoncé au diagnostic — alors que
  le journal ENTIER était publié en artefact depuis toujours, au step suivant. Un aperçu doit
  DIRE qu'il est un aperçu et où est le complet ; sinon il ne tronque pas seulement la sortie,
  il tronque la recherche.

- [1× — 08-23e] Un banc de performance pose `NF_LOG_DRIVER=null` pour ne pas mesurer le coût des
  journaux. Le jour où le serveur n'a pas démarré, il n'a su dire que « BOOT TIMEOUT — voir
  /tmp/nf-bench.log », en renvoyant vers un fichier de **zéro octet**. La cause tenait en une ligne
  `CRITIC`, invisible par construction. Un réglage qui protège la MESURE aveugle le DIAGNOSTIC :
  prévoir, sur le chemin d'échec, un rejeu sans ce réglage — on n'y arrive que quand il n'y a plus
  rien à mesurer.

## 👯 Un JUMEAU non vérifié n'est pas vérifié — « aligné » n'est pas « prouvé »

- [1× — 08-29c] **J'ai écrit un gabarit de test avec la convention du DÉPÔT, pas celle d'une application générée.** Le dépôt tourne en `globals: true` ; une application générée, non — ses tests importent leurs primitives. Le fichier a échoué sur `beforeAll is not defined`, dans l'application, à l'exécution. Même famille au cas suivant : le banc visait la base de DÉVELOPPEMENT et non celle de la suite, donc il rendait « en retard » — un verdict juste, sur la mauvaise base. **Un gabarit ne se relit pas, il se GÉNÈRE puis se LANCE** : les deux défauts étaient invisibles à la lecture et évidents à la première exécution.

- [1× — 08-28d] **Mes tickets contredisaient la conception sur DEUX contrats publics, et je les croyais dérivés d'elle.** J'exigeais quatre codes de sortie distincts là où elle en fige trois ; j'écrivais `orm:status` là où elle écrit `orm:migrate:status` — un nom de commande gelé à la publication, cité par ses propres messages d'erreur testés comme contrats. Écrire « d'après le document » n'est pas l'avoir relu : ce qu'on dérive de mémoire diverge silencieusement de sa source, et un contrat gravé faux ne se répare plus qu'en rupture majeure. La confrontation ligne à ligne coûte deux minutes, et c'est le seul geste qui l'attrape.
- [1× — 08-23e] Deux scripts de banc portent en en-tête « à garder alignés ». J'ai appliqué le même
  correctif aux deux, puis validé la sortie JSON **d'un seul**. L'autre ajoutait cinq `%s` au format
  sans les arguments correspondants et produisait du JSON invalide (`"warmupSec":,"durSec":,`) —
  découvert seulement parce qu'un consommateur a refusé de le lire, plusieurs heures après.
  **Prouver sur un artefact ne prouve rien sur son jumeau**, et un `printf` mal alimenté ne lève
  jamais : il écrit un trou. ↝ [[feedback_prove_on_received_artifact]]

## 🎪 Le DÉCOR d'un banc est un état PARTAGÉ — et il accuse le produit à sa place

- [1× — 09-06f] **Un banc a laissé une table dans la base de TRAVAIL, et c'est une suite d'un AUTRE
  paquet qui en est morte.** `db-outage-pod.mjs` migrait son application dans `postgres://…/nodefony`
  — la base partagée — sans `search_path` : `orm:migrate` pose son historique dans le premier schéma
  du chemin, donc `public`. Le test drizzle `migrator-postgres.e2e` interrogeait
  `information_schema` sur TOUTE la base et rougissait depuis, en accusant le migrateur. Deux
  défauts se répondaient : un banc qui salit un état partagé, un test qui mesure plus large que ce
  qu'il possède. **Le geste qui a tranché** : un déclencheur d'événement DDL PostgreSQL armé
  pendant une passe complète — 140 créations capturées, **zéro dans `public`** — a innocenté la
  suite entière en un run, là où essayer les paquets un par un aurait pris l'après-midi. Un piège
  posé DANS le serveur nomme le producteur ; le chercher dans le code ne fait que le supposer.
- [1× — 09-06f] **Mon débranchement était pollué par son propre décor.** Pour prouver qu'un test
  mordait, j'avais posé à la main une table homonyme à trois colonnes : le test est tombé sur
  `column "hash" does not exist`, un rouge parfaitement réel qui ne prouvait rien de ce que je
  voulais montrer. Un débranchement se lit comme une mesure — il faut vérifier que c'est bien
  l'assertion visée qui a mordu, et pas le décor qu'on vient d'improviser.

- [1× — 09-06d] **`npm sbom` refuse d'inventorier une application liée au framework (`--link`) — et
  c'est le DÉCOR, pas l'application.** `ESBOMPROBLEMS` sur deux paquets « invalid » venus de
  `lighthouse`, plus une dizaine d'« extraneous » remontant dans le `node_modules` du monorepo. Lu
  vite, cela accuse l'app générée. **Un refus de mesurer se NOMME dans l'outil** : sortie 2
  (distincte du 1 d'un verdict négatif) et le cas connu cité — sinon le prochain cherchera le défaut
  dans le produit.

- [1× — 09-05e] **Deux bancs ORM composaient leur décor sur un chemin FIXE du dépôt** (`tmp/orm-adopt-<dialecte>`). Deux exécutions simultanées — un `npm test` complet et une vérification lancée à côté — écrivaient au même endroit : `ENOTEMPTY` plus deux expirations de délai, aucune n'appartenant au code. Le décor ne pouvait pas déménager sous `os.tmpdir()` (la résolution de `drizzle-kit` remonte aux `node_modules` du dépôt) : il reste sous `tmp/`, discriminé par le numéro de processus. Preuve : deux runs EN PARALLÈLE, chemin fixe → A=1 et B=1 ; chemin discriminé → A=0 et B=0.
- [1× — 09-05e] **J'ai pollué la mesure du user** en lançant le même banc pendant le sien, puis en le tuant en plein vol. Trois rouges qui lui ont été présentés comme les siens. Avant de lancer une suite, demander si une autre tourne — un décor partagé ne se voit pas dans la sortie.
- [1× — 09-05e] **Un banc qui ne pose pas les secrets que la PRODUCTION exige accuse l'ORM.** Le smoke `studio` lançait le conteneur sans `NF_CSRF_SECRET` : l'app refusait de démarrer (à raison), et l'échec se manifestait trois lignes plus loin en « migrations non appliquées » — un message qui envoie chercher dans l'ORM. Le scénario `base` n'était pas touché : son preset minimal n'exige aucun secret, ce qui rendait le défaut invisible.

- [1× — 09-06c] **Un état partagé qui GROSSIT fait passer un test pendant des mois, puis échouer un jour.** `session-revocation.test.ts` a rougi sur son garde-fou de pagination : le Redis partagé portait **5 816 sessions résiduelles** accumulées par les runs successifs, et le SCAN dépassait les 60 pages tolérées. Purge de la famille `nf:nodefony-core:sess:*` → **7/7 en 571 ms**, contre 48 539 ms avant. Le test DOCUMENTE pourtant sa dépendance (« le nombre de pages d'un SCAN dépend du keyspace ENTIER du store ») — dans un commentaire que personne ne relit au moment où il rougit. Le geste qui tranche en dix secondes : demander le compte (`redis-cli INFO keyspace`) avant de suspecter le code.
- [1× — 09-06c] **Sur une passe complète, la saturation est le premier suspect, pas le produit.** Neuf rouges avec les interrupteurs de coût ouverts, **tous verts en isolé** : sept fois le même `worker fork: ready timeout` (délais en dur de 5 s et 6 s), plus deux délais de 20 s et 30 s. Une passe turbo fait tourner des dizaines d'espaces de travail en parallèle — un délai écrit en dur y saute sans que rien ne soit cassé. Rejouer le cas SEUL coûte une minute et tranche ; relever le délai ne fait que déplacer le seuil.
- [1× — 09-06c] **Le classement d'un banc dans un catalogue se PÉRIME en silence, et chaque erreur coûte une enquête.** Quatre bancs rangés dans une classe où ils ne tombent pas : `graceful-shutdown` dit « autonome » mais exige un serveur booté, `capacity` en exige un et ne le disait pas (trace `ECONNREFUSED` brute), deux sondes réclament un cookie non documenté, et un banc cluster prescrivait dans son propre entête une variable que la configuration ne lit plus (`NF_REDIS_PASSWORD` au lieu de `NF_REDIS_URL` — le cluster partait en boucle de redémarrage). Le skill énonçait pourtant la règle : « le classement d'un banc se vérifie en le LANÇANT ». Une règle écrite ne relit pas le tableau à côté d'elle.

## 📖 Une DOC qui enseigne un geste dangereux le propage — et survit à sa correction

- [1× — 09-01] **Le correctif était bon, sa JUSTIFICATION était inventée — et gravée dans un gabarit livré.** La veille, `--ignore-scripts` posé dans le Dockerfile des applications avec ce commentaire : « sans verrou npm SAUTE les scripts et le dit ; avec un verrou il les EXÉCUTE ». Mesuré cette fois dans `node:24-slim` : sans verrou npm **ne dit rien et n'exécute rien**, et aucun comportement général de npm ne distingue les deux cas. Le vrai motif est un défaut amont précis (`npm/cli#9837` : `gypfile: false` n'est pas lu sur un arbre bâti depuis un lockfile, npm SYNTHÉTISE alors un `node-gyp rebuild` que le paquet interdit). Le retex de la veille disait pourtant « ne pas conclure sur le mécanisme quand le FAIT suffit à agir » — juste pour AGIR, faux pour ÉCRIRE : une justification inventée survit au correctif, se recopie, et enverra chercher au mauvais endroit le jour où l'image de base passera à npm 12.

- [1× — 08-30c] **La sonde d'un banc comptait NOTRE documentation comme une faute de l'agent.** La sonde « n'a jamais proposé de supprimer la base » cherchait `orm:reset` dans le transcript ENTIER — où entrent les résultats d'outils, donc le contenu des fichiers lus, donc la page qui nomme cette commande précisément pour l'interdire. Mesuré : sept, deux et une occurrences dans le transcript ; **zéro** dans la parole de l'agent sur deux répétitions de trois. Second faux positif, plus fin : l'agent commentait dans son RAISONNEMENT le `DROP TABLE` du patron d'expansion-contraction que le produit avait écrit pour lui. **Un interdit se juge sur ce que l'agent ÉMET, moins son brouillon** — et un filtre de matière doit rendre le tout quand il ne reconnaît rien, jamais le vide.

- [1× — 08-30] **Un skill enseignait le contournement d'un manque comblé la veille.** Le gate de
  portabilité des skills publiés était rouge sur six variantes : `env | grep NF_MIGRATE_DATABASE_URL`
  (pas de `grep` dans cmd.exe). La bonne correction n'était pas de rendre la commande portable — le
  paragraphe entier affirmait « aucun verdict n'annonce la base visée », faux depuis #113 qui fait
  annoncer sa cible à chaque commande. **Un contournement documenté survit au comblement du manque**,
  et il enseigne alors une astuce à la place d'une capacité.
- [1× — 08-27] **Une DÉMONSTRATION enseigne autant qu'une doc — et celle-ci enseignait le contraire
  du framework.** Le canal de vitrine poussait une trame par seconde et par client pour ne rien
  dire : coût réseau et processeur permanent, et surtout l'idée qu'une socket Nodefony serait du
  polling inversé. Le user a posé la seule question qui compte — « à quoi ça sert ? » — et la réponse
  était : à rien. L'état de la connexion prouvait déjà que le lien est vivant, sans une trame. Ce que
  le produit MONTRE est copié bien plus sûrement que ce qu'il écrit : **un exemple qui contredit la
  règle du framework la désarme.** (Le même battement vit encore dans les gabarits d'application.)

- [1× — 08-27] **Un code de planification interne dans un titre n'est pas une abréviation, c'est un
  pointeur MORT.** « exécuter R6 », « S5 DDL prod » : le lecteur n'a pas le document derrière, donc
  le titre ne lui dit rien — reproche direct du user, deux fois dans la même session (« S ?? n'a
  rien à faire dans un titre », « un idiot doit comprendre »). Vaut pour tout artefact qui SORT de
  ma tête : ticket, message de commit, page publiée. Le test tient en une question — quelqu'un qui
  n'a jamais ouvert ce dépôt sait-il ce dont on parle ? Si la réponse exige d'aller chercher un
  tableau de bord, c'est raté. Et le sigle qui reste nécessaire (DDL, TOTP) se DÉFINIT sur place.
- [1× — 08-25] **Une source qui fait autorité peut être PÉRIMÉE, et le dire avec aplomb.** Le guide
  npm de l'OpenSSF recommande encore d'authentifier une publication par un jeton d'automatisation
  — retirés du registre depuis novembre 2025, et remplacés par la publication de confiance
  précisément parce que ces jetons étaient le vecteur des vols de compte. La doc du dépôt, elle,
  était à jour. Une source externe se DATE avant d'être suivie ; ici, c'est le dépôt qui avait
  raison contre la référence.

- [1× — 08-23e] Après avoir corrigé une purge de ports qui tuait son propre lanceur, la même
  commande restait **enseignée** dans la table de dépannage d'un autre skill (`lsof -ti:PORT |
xargs kill -9`) — c'est-à-dire exactement ce qu'un agent lit puis applique. Elle venait d'un retex
  de juillet dont la leçon était JUSTE (les orphelins échappent à `pkill -f`), à un mot près.
  Corriger le code sans balayer ce qui l'ENSEIGNE laisse la classe de bug se réintroduire par la
  documentation. Le balayage se fait sur le CONCEPT, pas sur le fichier corrigé.

- [1× — 08-29f] **Le document d'accueil PRESCRIVAIT le geste interdit**, et l'agent l'a copié à la lettre — drapeaux compris (`npx nodefony orm:reset -c default -y`, la ligne d'`AGENTS.md` telle quelle). Le skill qui l'interdit était installé dans l'application et n'a JAMAIS été ouvert : aucun `Read`, aucun appel `Skill`. Il ne s'est chargé qu'après avoir écrit « charge d'abord le skill `X` » dans le renvoi. Deux leçons qui se complètent : ce qu'un agent lit, il l'exécute ; et ce qui n'est pas nommé à l'endroit qu'il lit n'existe pas.
- [1× — 09-05e] **Un TICKET peut prescrire le geste que le CODE a explicitement rejeté.** #19 demandait de « rendre Vite optionnelle à la source » ; fait — puis annulé en lisant `pack-all.mjs:35`, qui porte la décision INVERSE avec sa mesure : une peer optionnelle DÉJÀ installée (Vite l'est, en devDep de l'app) SATISFAIT la peer et survit à `npm prune --omit=dev` ; la seule chose qui marche est de ne rien déclarer. Le ticket datait d'avant ce correctif. **Un ticket est cru sans être relu** — le lire ne suffit pas, il faut vérifier que le code ne l'a pas déjà dépassé. Le commentaire qui sauve était à trois lignes du geste.

## 👻 Un process qui n'écoute AUCUN port échappe à toute purge par port

- [1× — 08-29] `process.exit()` posé dans un `try` ne déroule AUCUN `finally` : les pods déjà levés survivaient au banc avec leur port ET leur connexion à la base, et le run suivant échouait sur un `DROP DATABASE` refusé — pour une raison qui n'était pas la sienne. Pire dans un cas : le pod fautif n'était pas encore rangé dans la variable que le `finally` inspecte, donc personne ne l'aurait arrêté. Abandonner se fait par une sentinelle qu'on JETTE.
- [1× — 08-23e] Un superviseur de développement orphelin (son enfant tué en `-9`) survit sans tenir
  le moindre port : invisible à `lsof`, absent d'un `pkill -f bin/nodefony` (son titre de process est
  autre), et pourtant bien vivant. Deux conséquences opposées le même soir — il **interdisait** tout
  démarrage en production (garde qui déduisait la collision d'une présence au lieu de la constater),
  et il **ressuscitait** le serveur au milieu d'une mesure. Un décor de banc se remet à zéro par
  l'arrêt PROPRE de l'outil (`nodefony stop`), la purge par port n'étant que le filet.

## 🗄️ Archivé au CONSOLIDATE du 2026-07-30 — 59 thèmes, 190 frictions

Snapshot : `archive/RETEX-snapshot-2026-07-30.md`.

## 🧱 Remplacer un mécanisme du NAVIGATEUR par du code à soi, c'est en devenir responsable

- [1× — 09-01d] Pour rendre le titre d'une section cliquable, j'ai troqué `<details>/<summary>` —
  dont le pliage est NATIF et ne peut pas tomber — contre un en-tête à deux commandes plié en
  JavaScript. Le pliage est tombé : l'écouteur était bien attaché (vérifié au protocole de débogage
  du navigateur), sans aucun effet, et le user a trouvé le menu bloqué avant moi. Revert. **Ce qui
  marche sans JavaScript ne se remplace pas pour un confort ; on AJOUTE à côté.**

## 🕶️ Faire relire EN AVEUGLE — puis seulement donner sa propre liste

- [1× — 09-05] **Sur un outil, l'USAGE trouve ce que l'audit ne voit pas.** Deux audits `fable` de `doctor` avaient rendu 11 défauts. En une session à s'en SERVIR, six de plus sont tombés, tous plus graves — et les trois pires ont été trouvés par le user en lançant la commande. Le point commun : aucun n'est visible à la lecture. Un audit ne lance pas la commande, ne lit pas ce qu'elle imprime, ne suit pas le geste qu'elle prescrit, et ne voit pas un décor de test qui parle une autre langue que le produit. **Pour un outil en ligne de commande, budgéter l'usage réel avant un nouvel audit de lecture.**
- [1× — 09-01] **Une conception relue en aveugle a corrigé deux décisions structurantes que j'avais arrêtées.** Le relecteur a reçu le TERRAIN (ancres, faits, contraintes) sans mes conclusions ni mon vocabulaire — et il a écarté l'architecture que je retenais, en relevant au passage que je m'étais réclamé d'un précédent (Devise) dont j'avais **inversé le sens**. Donner ses conclusions à un relecteur l'ancre dessus : il cherche à les confirmer au lieu de regarder ailleurs.
- [1× — 09-01] **Le second temps compte autant : soumettre sa propre liste APRÈS**, pour la faire juger par quelqu'un qui n'en est pas l'auteur. Sur sept points relevés de mon côté, six ont tenu, **un était mal formulé** (« il manque une entrée de changelog » — le changelog est engendré depuis les commits à la publication ; ce qui manquait vraiment était une note de montée de version). Et trois de mes points recoupaient les siens au point de devoir être traités comme un seul lot.
