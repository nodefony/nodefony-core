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

- [1× — 09-02] **Le geste que le fichier PRESCRIT n'était joué par personne.** L'en-tête de l'entité générée dit « ne modifie pas ce fichier à la main : relance la commande avec tes champs ». Suivre ce conseil cassait l'application de TROIS façons — nom de table divergent, nom d'export divergent du gabarit (donc un `index.ts` qui importe un symbole disparu), câblage refusé. Aucun test ne jouait ce geste, et les trois sont tombés en vingt minutes dès qu'une tâche de banc l'a joué. **Ce qu'un produit conseille par écrit doit être exécuté par un banc** — sinon le conseil vieillit sans que personne s'en aperçoive.
- [1× — 09-02] **Un second bloc TSDoc DÉTACHE le premier.** Une garde conditionnelle insérée entre le TSDoc d'une classe et son décorateur donnait, au rendu, deux blocs `/** */` successifs : le premier — la documentation de la classe — n'était plus attaché à rien. Le code compile, le gate de format est vert, aucun contrôle ne le dit. Un décorateur ajouté se pose ENTRE les décorateurs existants, jamais avant le commentaire de la déclaration.
- [1× — 09-02] **Une ligne ajoutée à une table markdown casse les quatre variantes du gate de format.** prettier réaligne une table sur sa cellule la plus large : une entrée plus longue que ses voisines rend non conforme le rendu que l'UTILISATEUR reçoit, pas le gabarit du dépôt. Réaligner à la main sur la largeur des voisines, ou en faire une liste.

- [1× — 09-01] **Un fichier que personne ne mentionne décidait de ce que `npm install` EXÉCUTE.** L'image d'une application générée ne se construisait plus dès qu'un `package-lock.json` existait — c'est-à-dire dès le premier `npm install` du développeur : sans verrou npm SAUTE les scripts d'installation et le dit (« not yet covered by allowScripts ») ; avec verrou il les exécute, et `node-gyp rebuild` meurt faute de Python dans `node:*-slim`. Ni la plateforme ni la version de npm n'entrent en jeu — vérifié dans les deux sens. Rien dans le Dockerfile, la config ou les tests ne parlait de ce fichier : **quand deux exécutions de la MÊME commande divergent, chercher ce qui a changé dans le RÉPERTOIRE, pas dans la commande.**

- [1× — 09-01] **L'image de production ne contient PAS les outils de développement — donc certains gestes y sont structurellement impossibles.** J'avais fait générer la première migration par le banc DANS le conteneur, avant de l'appliquer. Refus du produit : `NF_GENERATE_TOOL_MISSING` — `drizzle-kit` est une devDep, et l'image installe en `--omit=dev`. C'est juste : APPLIQUER une migration ne réclame aucun outil tiers, seul l'ÉCRIRE en demande un. La leçon dépasse le cas : **avant de placer un geste dans une image, regarder ce que cette image CONTIENT** — le dépôt et l'artefact déployé n'ont pas le même inventaire, et seul le banc réel le dit.

- [1× — 09-01] `nodefony frontend:build` publiait un bundle de **développement** : `mode: "production"` était passé à Vite depuis toujours, mais Vite dérive `isProduction` de `process.env.NODE_ENV`, **qui prime**. Le défaut n'apparaissait ni dans la config, ni dans un test, ni dans un échec — seulement dans le fichier RENDU (`import.meta.env.DEV` vrai chez l'utilisateur final, messages d'aide du framework de vue publiés). Trouvé par hasard, en éprouvant un point que je venais de déclarer « non prouvé ».
- [1× — 09-01] Corollaire du même jour : le seul bundle qui disait la vérité sur l'état du produit était celui que je n'avais PAS reconstruit à la main. Mes propres expériences avaient « réparé » les quatre autres, et le tableau récapitulatif donnait une image rassurante et fausse — c'est l'HEURE de modification qui a rétabli la lecture.

## 🧭 Un identifiant écrit dans la MAUVAISE LANGUE fabrique un faux verdict

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

## 🩺 Une correction qui ne couvre qu'un cas, présentée comme complète

- **[1× — 09-02] Une même expression régulière portait DEUX chemins quadratiques ; j'en ai corrigé un et fermé le sujet.** L'analyse de code a rendu une alerte NEUVE à la place des deux fermées, sur la MÊME ligne — et c'est son message qui l'a dit : il avait perdu son premier cas (`[[[[`) et gardé le second (`[](` répété). Mesuré : 1047 ms encore, là où je croyais avoir tout ramené à 0,3 ms. Règle : quand un outil signale une expression, lire ce que son message ÉNUMÈRE — il nomme les cas un par un, et une correction qui n'en tue qu'un laisse l'alerte se rouvrir sous un autre numéro.
- **[1× — 09-01] Donner l'ENTITÉ ne suffit pas : il faut donner la MIGRATION.** Après avoir retiré `User` des migrations du framework, j'ai doté le dépôt de son entité et déclaré l'effet de bord traité. En développement le schéma est dérivé du code, donc tout marchait. La CI a rendu **dix jobs rouges** : en production personne ne crée la table. Le même oubli valait pour les applications générées. Règle : dès qu'un objet quitte le framework pour l'application, se demander QUI le crée dans chacun des deux modes de schéma.

- [1× — 09-01] Premier correctif CSP : plage de ports déclarée en PERMANENCE → en-tête de **7,9 Ko sur chaque réponse** (au bord des 8 Ko que refusent beaucoup de relais). Le correctif marchait et coûtait plus cher que le défaut. Refait par famille : bloc entier tant que rien ne sert, port réel dès que ça sert. **Mesurer le COÛT de son correctif fait partie du correctif.**
- [1× — 08-30] **Déclarer sans installer est un demi-geste — et c'est le user qui l'a vu.**
  `create entity` ajoutait l'outil de migration au `package.json` et laissait l'utilisateur lancer
  `npm install` ; la commande suivante échouait sur un paquet que le manifeste annonce (3 agents sur
  3 l'ont posé à la main). Ma première correction ne couvrait que l'app neuve, et conditionnée au
  preset. Deux questions du user ont élargi les deux bords : « pourquoi pas tout le temps ? » et
  « quel intérêt de le mettre au générateur si l'user le fait à la main ? ».
- [1× — 08-29d] **Le défaut par défaut était justifié par un cas, et aveugle à l'autre — le commentaire l'expliquait très bien.** `migrations.divergence: "report"` ne retenait aucun déploiement, au motif écrit qu'« une application à migrations libres a une base légitimement différente du schéma déclaré, en permanence ». C'est vrai pour une COLONNE en écart. Ça ne l'est pas pour une TABLE d'entité absente : aucune main légitime ne la fait disparaître, et quand elle manque le schéma applicatif n'a jamais été posé. Le pod se déclarait donc PRÊT avec zéro table applicative et 500 sur chaque route — exactement le constat qui avait ouvert le ticket, et rien ne l'arrêtait. **Une justification de défaut nomme le cas qu'elle couvre ; chercher celui qu'elle NE couvre pas est le geste, et il se pose au moment de LIRE la justification, pas de l'écrire.**

- [1× — 08-28f] **Ma garde « pas de clé primaire en `text`/`blob`/`json` » était ancrée au DÉBUT de la chaîne** (`/^(text|blob|json)/`) — elle laissait donc passer `longtext`, `mediumtext`, `longblob`. Or `longtext` est précisément ce que MariaDB donne à une colonne JSON, qu'il implémente en alias de `LONGTEXT` : la garde était aveugle sur le serveur PAR DÉFAUT du décor, et verte. Trouvée non pas en relisant la garde, mais en comparant les deux moteurs sur demande du user. Une garde écrite pour un moteur se relit sur l'AUTRE avant d'être crue.

- [1× — 08-28d] **J'ai découpé un chantier en cinq lots et annoncé la grappe complète ; elle en couvrait cinq sur huit.** Un contrôle de couverture, section par section, a rendu deux livrables que personne ne portait (l'écran de suivi, décrit sur vingt lignes ; la recette de déploiement promise au générateur), puis une revue éditoriale en a trouvé un troisième — la commande de génération côté application, dont **deux tickets dépendaient déjà**. Le tableau récapitulatif d'un document de conception n'est pas le document : il résume les lots, il ne liste pas les livrables. Un découpage se confronte au corps, pas à son sommaire.
- [1× — 08-28c] **J'ai corrigé l'ENCADRÉ sans corriger la phrase qu'il dément**, cinq lignes plus haut : le texte porteur affirmait encore le mécanisme que son propre encadré qualifiait de FAUX. Quand on ajoute un démenti, chercher ce qu'il dément — l'ajout ne supprime pas.
- [1× — 08-28c] **Affirmé au user « impossible de couper `autoIndex` » sans avoir lu la fonction qui construit les options.** Elle fusionne le record du connecteur (`MongooseOrm.ts:72`, `:236`) : c'est possible, juste non typé. « Aucune configuration ne l'expose » se prouve en lisant le CHEMIN des options, pas en cherchant le nom de la clé.
- [1× — 08-28c] **Une prémisse écartée en une demi-phrase gouvernait une décision d'architecture** : « pas d'abstraction à un implémenteur (mongoose = schemaless) » — or mongoose crée des index au démarrage, donc a bien une étape de déploiement. La conclusion restait juste, pour une **autre** raison. Une justification jamais vérifiée finit par être recopiée comme un fait.

- [2× — 08-27j] **Le statut « In Progress » remonte sur une simple MENTION, et c'est le RETEX qui
  le pose.** Redescendus hier, #54/#37/#38/#39 étaient de nouveau « en cours » ce matin : le commit
  de retex 08-27i les cite pour dire ce qui RESTE, et `ticket-progress.mjs` monte sur toute mention
  non fermante. Le geste de clôture recrée donc le défaut qu'il vient de corriger — chaque soir.
  La dérivation est bonne (le premier commit qui cite est un fait observable), mais elle n'a pas de
  contre-exemple : un commit `docs(session)` ne fait avancer aucun ticket, par construction.

- [1× — 08-27j] **Ma propre note de banc affirmait DEUX défauts ; un seul existait.** Elle disait
  « un subscribe vers un canal refusé (`nodefony:audit`) OU inexistant est ignoré sans un mot ». La
  sonde contre le pod a montré `nodefony:audit` avec `subscribers: 1` — le compte de banc porte
  `ROLE_NODEFONY_ADMIN`, l'abonnement PASSAIT, le canal était simplement calme. Le « ou » avait été
  écrit sans être vérifié, et je serais parti corriger un refus qui n'existait pas. **Un constat
  qui énumère des cas doit les avoir constatés un par un** : la conjonction est la partie qu'on
  n'éprouve jamais.

- [1× — 08-27] **`gh issue create` fait la MOITIÉ du travail et rend un succès.** L'issue est
  créée, elle n'entre PAS au tableau de bord — donc dans aucun compteur d'avancement, ni ordre de
  travail, ni reste-à-faire, ni empreinte hors ligne. Le ticket ouvert ainsi est resté invisible du
  pilotage jusqu'à un contrôle manuel. Un oubli qui ne crie pas coûte plus cher qu'une erreur : on
  ne le cherche pas.

- **Dégraisser un fichier casse ses LECTEURS, et aucun ne se plaint.** Après avoir sorti 113
  lignes de `MIGRATION_STATUS.md` : le comptage du skill d'audit rendait `✅=0` (il lisait le seul
  fichier vivant), une ancre `fichier:ligne` écrite deux heures plus tôt pointait une phrase sans
  rapport, et huit règles disséminées affirmaient encore « l'avancement = ce fichier ». Aucune
  barrière ne l'a signalé — `anchor-check` ne mord que sur fichier absent ou ligne hors fichier.
  Avant de retirer d'une source, chercher qui la LIT : `rg --hidden` sur son nom, et exécuter les
  recettes qui la parcourent. [1× — 08-27]

- [1× — 08-25] **CodeQL n'a signalé QU'UN des trois frères.** L'alerte visait
  `generate-man.mjs` ; le même `existsSync(f) ? readFileSync(f) : …` vivait aussi dans
  `aiMcp.ts` — où le test préalable court-circuitait un `catch` qui distinguait pourtant DÉJÀ
  « illisible » d'« absent » — et dans `security-secrets.ts`, où une 4ᵉ copie ignorait le
  `lireSiPresentSync` de son PROPRE paquet. Un `rg` sur le MOTIF (pas sur le fichier signalé)
  les rend en une seconde ; l'analyseur montre ce qu'il atteint, jamais ce qui existe.

- **L'analyseur n'a signalé qu'UN des deux frères.** CodeQL pointait `MD_LINK` ; `JSON_HREF`, deux
  lignes plus bas, portait le MÊME motif quadratique sans être vu. Un outil montre ce qu'il atteint,
  pas ce qui existe — après chaque alerte, chercher le frère. `[1× — 08-25]`
- **Deux sites du même motif dans le fichier signalé.** L'alerte donnait `security-token.ts:250` ;
  le second `existsSync ? read : ""` (l.191) n'y figurait pas. `[1× — 08-25]`

- [1× — 08-25] **« Les handles trancheront » — non.** Un signal ASYMÉTRIQUE ne tranche que dans un
  sens : des ressources qui s'accumulent désignent un défaut, mais un compte stable n'explique
  RIEN — il retire un suspect sur quatre. Je l'ai présenté comme la mesure décisive alors qu'elle
  ne répondait même pas à la question posée (« palier ou hausse sans fin ? »), à laquelle seule la
  DURÉE répond. Le user a relevé en trois mots. Avant d'annoncer qu'une mesure tranchera, se
  demander ce que son résultat NÉGATIF prouverait.

- [1× — 08-25] **QUATRE défauts d'une même session étaient la MÊME faute : une règle appliquée à un
  seul frère.** Le gate Redis renommé d'un côté et pas dans le workflow ; `attendreServeur` écrit
  pour PostgreSQL quand le bloc MySQL relançait son conteneur sans attendre ; `NF_GATES_ALLOW` posé
  sur un step et pas sur son voisin ; `premierMessage` durci pour la deuxième attente d'un test
  pendant que `consumeHandshake`, dix lignes plus haut, restait un `once("message")` nu. Chaque fois
  le dépôt PORTAIT déjà la leçon — souvent avec le commentaire qui la raconte juste à côté. Le geste
  qui manque n'est pas « corriger » mais **« chercher les frères AVANT de commiter »** : `rg` sur le
  motif corrigé, pas sur le fichier. Coût mesuré : deux allers-retours de forge, dont un où le rouge
  suivant était MASQUÉ par celui que je venais de fermer (steps séquentiels d'un même job).
- [1× — 08-25] **Le dépôt possédait la réponse, le banc la redevinait — 2× dans la même nuit.** Un
  banc tuait son serveur par `process.kill(-pid)` (groupe de process : n'existe pas sous Windows,
  l'appel LÈVE et le `catch` le lit « déjà mort ») alors que `signalProcessGroup` est publiée par le
  cœur et utilisée par cinq sites du produit. Même motif que `besoinDeShell` la veille. **Avant
  d'écrire une primitive système dans un banc : chercher qui la porte déjà dans le barrel.**

- [1× — 08-25] **J'ai corrigé ma propre règle une heure après l'avoir écrite, et c'est la CI qui
  l'a trouvée.** « Un chemin absolu désigne un vrai exécutable, qui n'a besoin d'aucun shell » —
  une INFÉRENCE, pas un constat : `…\node_modules\.bin\oxlint.cmd` est parfaitement absolu et
  reste un script batch. Ce qui empêche Node de lancer une chose n'est pas l'ENDROIT où elle est,
  c'est ce qu'elle EST. Quand une règle de portabilité s'écrit, énumérer les formes, pas les
  emplacements.

- [1× — 08-23d] Détection de coupure câblée sur les événements de pool : ils ne voient
  que le client **INACTIF** (`pg-pool` retire son auditeur pendant l'usage). J'ai livré
  en annonçant le problème résolu ; c'est le user qui a douté, et il avait raison.
  **Avant d'annoncer une couverture, énumérer les cas et dire lesquels ne sont PAS
  couverts** — ici : coupure sous trafic, base gelée.
- [1× — 08-23d] Corollaire : **une sonde doit avoir sa propre montre**. Le premier
  battement de cœur était inopérant contre une base gelée — `ping()` PEND, et la sonde
  pendait avec la panne qu'elle devait observer.

- 🔴 **Un chiffre écrit EN DUR survit à la mesure qui le contredit — quatre fois dans une
  seule page.** Carte de tête annonçant le ratio d'un autre niveau · sous-titre d'une figure
  **contredisant les barres qu'il surmonte** (1,61/1,29/1,07 au-dessus de 1,42/1,09/1,07) ·
  avertissement « le comparatif reste à rejouer » alors qu'il venait de l'être · bandeau
  « BROUILLON » en tête d'une page qu'on s'apprêtait à lier depuis le README. Aucun n'était
  signalé par un test : ils se voient à l'ÉCRAN, et seulement là. Tout chiffre affiché se
  DÉRIVE de sa source. `[1× — 08-24]`
- **Un livrable annoncé en DEUX pièces livré en une** : j'avais dit « deux fichiers, deux
  publics », j'en ai publié un et clôturé. Le user a dû le relever. Annoncer un plan en N
  parties, c'est s'engager à recompter N à la livraison. `[1× — 08-24]`
- **Le banc nommait DEUX contournements dans son propre code, le produit n'en désamorçait qu'un.** Tâche 18 : le rôle recopié au semis est averti en toutes lettres dans le skill ; la liste de rôles sur l'action — celle que l'agent écrit réellement — ne l'était nulle part. Le gabarit MONTRE en plus la forme fautive, et elle fonctionne sur la route mesurée. Quand un code de banc énumère les façons de contourner, chacune est une ligne de doc à écrire. [1× — 08-25]
- **La règle existait, un cran plus bas.** La puce voisine du même fichier disait déjà « jamais la liste des routes du jour ; énumérer marche à l'essai, passe la revue, et laisse la route sœur NAÎTRE PUBLIQUE ». Écrite pour les routes, jamais pour les rôles. Chercher la convention-frère AVANT d'écrire une règle neuve. [1× — 08-25]
- **J'ai corrigé sur une cause PLAUSIBLE que je n'avais pas prouvée, et commité l'explication.**
  Un smoke rouge dont le message cherché figurait dans le diagnostic imprimé deux lignes plus bas :
  j'ai conclu « course de propagation de `docker logs` », ajouté une attente bornée, commité. Le
  rejeu suivant est retombé rouge — le message était là depuis dix secondes. La vraie cause était
  mécanique (`grep -q` sous `pipefail`). **Un rejeu VERT ne confirme pas une hypothèse : il ne fait
  que ne pas la contredire.** Le commit suivant a dû corriger le précédent. [1× — 08-26]
- **Le hook ne lançait qu'UNE des trois gardes que la forge lance.** `npm run skills:check` en
  compte trois ; le pre-commit n'avait branché que la première. Un script de skill orphelin passait
  donc en local pour se faire refuser vingt minutes plus tard en CI — l'aller-retour que ce hook
  existe pour supprimer. Coût de l'ensemble mesuré : **une seconde**. Il n'y avait aucun argument à
  l'asymétrie, seulement l'habitude d'avoir branché la première. [1× — 08-26]
- [1× — 08-27h] **La leçon était DÉJÀ écrite, dans le fichier d'à côté — et n'avait pas franchi la
  frontière de paquet.** `session-revocation.test.ts` porte un compte jetable et un commentaire qui
  DÉCRIT exactement le symptôme d'aujourd'hui (« un banc WebSocket dont le handshake s'est vu fermer
  en 1008 »). Le fichier équivalent de l'autre paquet, lui, révoquait encore sur le compte partagé.
  Une correction qui s'arrête au fichier où le rouge est tombé laisse le défaut chez le voisin, avec
  sa propre explication écrite au-dessus. Après avoir corrigé UN cas : chercher les frères par le
  geste (`rg` sur `revoke`), pas par le module.
- [1× — 08-27h] **Le symétrique, aussi coûteux : une correction qui couvre PLUS que son ticket, sans
  que le ticket voisin le sache.** #42 semblait entier ; les deux tiers avaient été livrés la veille
  par #43 (le client ne devine plus d'adresse, la doc était déjà recalée), et seul le gate manquait.
  Sans la vérification au terrain, je reprenais un travail fait. `ticket-verify --touched-by` dit
  quels tickets un commit rend faux, mais il n'a rien signalé — il compare des ancres, pas des
  intentions. Réflexe : avant de prendre un ticket, RELIRE son « fini quand » ligne à ligne contre
  le code, pas contre son résumé.
- [1× — 08-30] **Trois moteurs, trois vérités — et deux défauts d'OUTIL qu'un seul cachait.**
  Une liste POSITIVE dans `tablesFilter` passe sur SQLite et PostgreSQL et **tue** l'introspection
  sur MySQL ; MariaDB écrit JSON en `longtext` + `CHECK (json_valid…)` et fait mourir l'outil, code 1
  et sortie d'erreur VIDE. Livrer après le seul vert SQLite aurait publié une commande cassée sur
  deux moteurs sur quatre. La bifurcation du test se fait sur le serveur **constaté**
  (`SELECT VERSION()`), jamais sur le port : les deux serveurs MySQL du dépôt partagent la même
  variable et se jouent en deux passes.

## 🌍 Une portée GLOBALE n'est pas « un peu intrusive » — elle est FAUSSE

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

## 🚪 Une porte a plusieurs ENTRÉES — le défaut vit dans la COMPARAISON, pas dans chacune

- [1× — 09-01] **Le même geste écrit à trois endroits portait trois fois le même trou.** `create app --no-install` vivait dans le banc de publication ET dans deux jobs de la forge (la vitrine poussée aux utilisateurs, l'image officielle `nodefony/nodefony`). Corriger le banc ne corrigeait rien chez les deux autres : l'image officielle serait restée en 503 sur une base vierge, « table absente ». Aucun des trois ne se savait triple. **Après avoir corrigé un appel, chercher les AUTRES appelants du même geste** — `grep` sur la commande, pas sur le fichier qu'on vient d'éditer.

- [1× — 09-01] **Deux pages du même corpus se contredisaient, et chacune se lisait bien.** `pipeline-requete.md` plaçait l'instanciation du contrôleur AVANT le firewall et en tirait « ton contrôleur est instancié avant d'être autorisé » ; `controller.md` montrait déjà l'ordre juste. Aucun gate ne voit ça — les deux ont des ancres valides. Le code dit l'inverse (`prepareFrontController` ne fait que matcher, `@IsGranted` court-circuite l'instanciation). **Une contradiction interne au corpus ne se trouve qu'en lisant DEUX pages ensemble** : c'est ce qu'un audit de corpus rend, et qu'un contrôle page par page ne rendra jamais.

- [1× — 31/08] **J'ai corrigé une heure durant un fichier que le mode développement n'exécute jamais.** Les plugins Vite sont composés à DEUX endroits : `ViteBuilder.buildPlugins()` (la voie déclarée, par les presets) et `ViteConfigGenerator.ts:109`, qui les REÉCRIT en dur dans un fichier généré — et c'est le second qui sert. Rien ne compare les deux. Avant de conclure « ma correction n'a pas d'effet », **chercher qui produit VRAIMENT l'artefact exécuté** : ici il suffisait de lire le `vite.config.generated.mjs` posé sur le disque. → #131.

- [1× — 08-31] **Un cycle d'imports ne casse que sous UN ordre d'entrée — il passe donc les tests qui entrent par l'autre bout.** `DrizzleMigrator` lisait une constante de `resolve.ts` au TOP-LEVEL ; `resolve.ts` importe `DrizzleMigrator` ligne 13 et ne définit la constante que ligne 50. Entrer par `DrizzleMigrator` marche, entrer par `resolve` rend `ReferenceError: Cannot access … before initialization`. Une suite entière restait verte pendant qu'un gate du dépôt mourait. Le remède est structurel : la constante descend dans un module FEUILLE, ré-exportée pour ne casser aucun consommateur.

- [1× — 08-28l] **Le commentaire EXIGEAIT l'accord, et le code rendait autre chose.** `/readyz`
  répondait sur `postReady`, le champ `ready` du plan d'administration sur `booted` — pour la même
  question. Le commentaire au-dessus disait mot pour mot « deux vérités sur la disponibilité, c'en
  est une de trop » : la règle était ÉCRITE, elle n'était simplement pas partagée. L'écart ne
  s'ouvrait qu'en production, où la fin du démarrage arrive assez tard pour laisser plusieurs
  secondes de désaccord — six commits rouges sur trois systèmes, et le cas qui comparait les deux
  sondes accusait le produit pour la bonne raison. **Une intention écrite en commentaire ne fait pas
  une implémentation unique** : chercher qui porte DÉJÀ la règle, et l'appeler.

- [1× — 08-28h] **Un défaut qui vit dans la DIVERGENCE de deux lecteurs, et qui rendait le code du
  succès.** `filename` est optionnel dans le schéma de configuration parce que son défaut dépend du
  kernel — le service le résout au démarrage. Ma commande, elle, lisait la configuration telle
  quelle : `undefined`, donc le pilote SQLite retombait sur une base EN MÉMOIRE, vide, jetée à la
  sortie du processus. `status` décrivait une base que l'application n'utilise pas, et `migrate` y
  aurait « appliqué » les migrations en rendant **0**. Ni l'un ni l'autre n'est faux isolément : le
  défaut est dans l'écart. **Une valeur par défaut résolue AILLEURS que dans son schéma se partage
  en une seule implémentation, ou elle divergera en silence.**

- [1× — 08-28] **TROIS lecteurs répondaient à la même question, et je n'en avais inventorié
  qu'un.** En rendant `/readyz` retenable, j'ai laissé `livez.ready` du plan d'administration valoir
  `booted` — il aurait annoncé « prêt » pendant que l'orchestrateur recevait 503 — et
  `nodefony status` afficher « 2/2 ports UP » sur un pod hors service, le diagnostic « faux et
  rassurant » que ce rapport s'interdit dans son propre commentaire. C'est le user qui a nommé le
  troisième. Le geste manquant : avant d'ajouter un terme à un verdict, chercher qui d'autre REND
  ce verdict (`rg` sur le CONCEPT, pas sur le symbole) — et vérifier ce que chaque lecteur en fait,
  car ici le code HTTP de `livez` devait justement NE PAS bouger (il sert la chaîne de démarrage).
- [1× — 08-28] **TROIS gabarits sur quatre portaient le même défaut ; le quatrième donnait la
  forme juste.** Un `then` au corps muet (`promise/always-return`) faisait naître toute application
  générée avec un front en lint ROUGE — React seul écrivait l'expression fléchée qui passe. Le
  défaut n'a pas été trouvé en relisant les gabarits mais en faisant naître le témoin du banc AVEC
  un front : c'est le décor qui manquait, pas l'assertion. **Corollaire pour l'inventaire : quand
  une famille est censée écrire la même ligne, c'est la MINORITÉ divergente qui a souvent raison —
  aller voir laquelle avant de choisir le patron.**
- [1× — 08-27] **Une adresse écrite EN DUR s'affichait parfaitement — dans une vitrine sur quatre.**
  Le panneau de la vitrine Vue montrait `/api/live/realtime` en littéral quand les trois autres
  lisaient l'instantané du client : rien ne clochait à l'écran, et le jour où l'endpoint changerait
  la page aurait menti sans une erreur. Prise uniquement parce que le banc compare les QUATRE pages
  au lieu de vérifier chacune — et parce que la mesure au navigateur a montré une valeur relative là
  où les trois autres rendaient l'absolue. **Quatre écrans qui divergent s'affichent tous très bien,
  chacun de son côté.**

- **« Présenter MAL valait moins que ne rien présenter », et aucun test ne pouvait le voir.** Sur
  la porte MCP, chaque entrée était éprouvée SÉPARÉMENT et chacune était juste : sans en-tête →
  200 + outils publics ✅ ; jeton invalide → 401 ✅ ; en-tête vide → 400 ✅. L'absurdité
  n'apparaît qu'en les METTANT CÔTE À CÔTE — un client qui tente de s'authentifier avec un jeton
  expiré obtenait MOINS que le même client muet, et un client MCP marque alors le serveur
  « failed » pour toute la session. Réflexe à prendre : pour toute porte à plusieurs entrées
  (anonyme / porteur / session / interne), écrire le TABLEAU de ce que chacune restitue, et
  chercher l'inversion. La conformité de chaque ligne ne dit rien de la cohérence de la colonne.
  [1× — 08-22g]
- **C'est le USER qui l'a trouvé, en s'en servant — et j'ai conclu deux fois avant de chercher.**
  D'abord « reconnecte », puis « c'est l'état de ton client » : deux réponses exactes (la porte
  répondait bien) et deux fois hors sujet, parce qu'aucune ne répondait à ce qu'il DEMANDAIT (« je
  veux des outils SANS authentification »). Il a fallu qu'il répète pour que je cherche le défaut
  de conception au lieu de défendre la mesure. ↝ [[feedback_user_repeats_question]] [1× — 08-22g]

## 🧭 Une garde ne couvre jamais une AUTRE question — même quand elle y ressemble

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

## 🟢 Un test peut passer depuis TOUJOURS sans avoir jamais rien mesuré

- [1× — 09-02] **Une sonde de sécurité qui ne PEUT pas mordre — et le seul moyen de le savoir était d'écrire le code vulnérable.** Une tâche neuve visait la traversée de chemin par le nom de fichier d'un envoi multipart, en supposant qu'un agent composant `path.join(dossier, file.filename)` écrirait hors du dossier. Éprouvé sur une application réelle avec un controller ÉCRIT POUR être vulnérable et deux noms hostiles : les deux fichiers atterrissent DANS le dossier. Le parser ne transmet aucune composante de chemin, et la garde du framework est une SECONDE ligne. La sonde reste — comme filet — mais elle est désormais annoncée comme telle : **un filet qu'on n'a jamais vu mordre garde DEMAIN, il ne prouve rien sur AUJOURD'HUI, et le taire le ferait passer pour une preuve.**

- [1× — 09-02] **Une assertion vraie sur une ancre fausse.** `assert.include(src, '"User"')`, commentée « la table porte le nom que les requêtes écrivent en dur », lisait en réalité `name: "User"` du descripteur d'entité, quelques lignes plus bas. Verte pendant toute la durée du défaut, sur un fichier où la table s'appelait `users`. **Quand une assertion vise un CONCEPT, viser la construction qui le porte** (`sqliteTable("User"`), jamais une chaîne que le fichier contient par ailleurs.

- **[1× — 09-02] Un seul corpus hostile pour DEUX ambiguïtés — le banc est resté vert sur la moitié non corrigée.** J'avais écrit un cas de complexité, vu rouge (1779 ms), et il ne prouvait que l'un des deux chemins du motif. C'est exactement ce qui a laissé passer le second. Règle : un cas par CHEMIN, jamais un corpus pour une famille — et chacun vu rouge séparément (1779 ms et 1083 ms ici).
- [1× — 09-01] **Une option posée pour une bonne raison créait un angle mort que rien ne signalait.** Le banc de publication scaffolde en `--no-install` — exprès, pour que les dépendances viennent des tarballs et jamais du dépôt. Conséquence jamais énoncée : aucune de ses applications n'a JAMAIS eu de verrou de dépendances, donc le banc n'a jamais construit d'image dans les conditions de l'utilisateur. Le défaut était là depuis toujours et attendait qu'on ait besoin d'installer pour autre chose. **Une option qui écarte une étape écarte aussi tout ce que cette étape produit** : lister ce qu'elle empêche d'exister, pas seulement ce qu'elle empêche de faire.

- **[1× — 09-01] Un banc « vert en CI » l'était sur un arbre ANTÉRIEUR au code qu'il devait éprouver.** Le banc de publication ne tourne qu'au cron du lundi ; son dernier run vert portait sur un commit du 27 août, et les migrations livrées datent du 28. Il était donc rouge depuis quatre jours **sans témoin**, et j'ai failli conclure « pré-existant, donc pas moi » sans vérifier — le raisonnement juste, mais sur une prémisse fausse. Règle : avant d'invoquer un run vert, regarder SUR QUEL COMMIT il a tourné.

- [1× — 09-01] **Quatre tests visaient `__proto__` dans `envOverride`, aucun ne testait la garde.** Tous passaient `schema` non défini, donc tous étaient arrêtés par une branche ANTÉRIEURE (« le schéma ne déclare pas la feuille ») et laissaient hors preuve la ligne que CodeQL signalait. Le refus tenait d'ailleurs à un accident — `__proto__` n'est ni propriété propre ni énumérable — et cet accident cesse dès qu'un schéma vient de `JSON.parse`, qui crée une propriété PROPRE. L'attaque réelle a montré `appliqué=true`, prototype de la config détourné, `constructor` écrasé. **Le signe à reconnaître : plusieurs tests d'un même risque qui partagent tous le même argument par défaut** — ils explorent une seule branche en croyant en couvrir plusieurs.

- [1× — 09-01] `grep -o 'function \w+\(\)\{return(!\d)\}'` attrapait la **première** fonction de cette forme du bundle, pas `isDevBuild` : classement de 8 bundles rendu au hasard, dont deux faux « DEV ». Reciblé par l'APPELANT (`isVerbose`, dont le corps cite `production`), le verdict s'est inversé. Un motif syntaxique sans ancrage sémantique mesure ce qu'il trouve, pas ce qu'on cherche.
- [1× — 09-01] Condition de sonde composite `A && B && C` rendue FAUSSE : rien ne dit QUEL terme. Décomposée en cinq sondes d'une ligne, le fautif était une supposition à moi (« une seule socket ») — la barre de débogage en ouvre une seconde en dev. **Une condition composite qui échoue ne se re-lit pas, elle se décompose.**
- [1× — 31/08] **`tsgo -p tsconfig.json` d'un module de vitrine rendait 0 erreur sur un fichier
  qu'il n'a jamais lu** : le `tsconfig` du module **exclut `frontend`**. Une sonde de type
  volontairement fausse (`const x: number = "y"`) n'a rien levé — c'est ce qui l'a révélé. Le
  contrôle réel est passé par la transformation Vite (200 + présence du symbole attendu). Poser une
  sonde fausse coûte dix secondes et distingue « vert » de « vert parce que vide ».

- [1× — 08-31] **Un décor qui ne porte pas le cas ne peut pas voir le défaut.** L'adoption d'une base perdait les contraintes `UNIQUE` de colonne depuis toujours ; aucun des trois DDL du banc n'en déclarait une, donc rien n'exerçait ce chemin. Le défaut n'est sorti que par un symptôme lointain — un POST en doublon rendant 201 au lieu de 409 dans un e2e généré. **Avant de croire un banc vert, regarder si son décor porte le cas** ; et un vert LOCAL peut venir d'une base qui traîne là où la forge part d'un conteneur neuf (vécu le même jour, en sens inverse : un cas vert chez moi, rouge en CI, parce que ma base portait des tables que la sienne n'avait pas).

- [1× — 08-31] **Le BANC était victime de la règle qu'il devait garder.** Pour prouver la garde
  d'adoption, j'ai fabriqué un écart sur la table du décor applicatif — sans effet : cette table
  vient d'un module `policy: "dev"`, et le décor impose `NODE_ENV=production`. Le module n'est
  pas chargé, sa table n'entre jamais au registre, et `orm:migrate:status` rend `up-to-date` sur
  une base à qui il manque une colonne déclarée. J'ai d'abord cru tenir un défaut du produit.
  La distinction à retenir : **la génération lit les FICHIERS, la comparaison lit le REGISTRE** —
  un module dev est absent du second en production, jamais du premier. Corollaire : un décor de
  banc se choisit sur ce que le mode de run CHARGE, pas sur ce que le dépôt contient.
- [1× — 08-30c] **L'autotest d'un décor restait vert pendant que le décor ne se posait plus.** Le gabarit d'application déclare son module ORM en chaîne nue (`"@nodefony/drizzle",`) ; l'ancre du script cherchait un appel `use(...)`. Le banc DISAIT correctement « prémisse non posée, tâche non jouée » — mais trois répétitions ont été payées pour un verdict vide, deux fois de suite, parce que l'autotest ne connaissait que l'autre écriture. **Un autotest qui ne couvre pas la forme RÉELLE de l'artefact qu'il lit ne garde rien.**
- [1× — 08-30c] **Une preuve qui s'auto-déclare.** Le banc d'adoption vérifiait que la référence est « rejouable » en lisant un champ que le code sous test met lui-même à vrai, plus deux expressions régulières. Un décommentage qui aurait avalé une parenthèse fermante passait les trois. La référence est désormais EXÉCUTÉE sur une base sans la table.

- [1× — 08-30] **Un ROUGE peut aussi arriver pour la mauvaise raison — et il ne prouve rien.**
  Débranchement d'une garde, test relancé, rouge obtenu : je l'ai presque compté comme preuve. La
  cause réelle était `describe is not defined` — vitest lancé depuis la racine au lieu du workspace,
  donc la config sans `globals`. Le test n'avait pas été exécuté du tout. Un vu-mordre se lit sur
  **l'assertion nommée**, jamais sur le code de sortie.
- [1× — 08-29] Une scène de banc VERTE pour la mauvaise raison : elle réutilisait une base « en avance », donc le correctif d'un AUTRE ticket suffisait à la faire passer. Refaite sur une base réellement en retard, elle est tombée — et a révélé un troisième défaut. **Le décor d'une scène décide de ce qu'elle discrimine ; deux scènes vertes ne prouvent pas deux choses.**
- [1× — 08-29] Une attente en arrière-plan sortie sur un faux signal : elle testait `conclusion == null` là où `gh` rend une chaîne VIDE. La condition n'a jamais été vraie, la boucle a rendu la main immédiatement, et j'ai lu « verdicts » sur des runs encore en cours. Attendre se teste sur le champ qui dit l'état (`status != "completed"`), pas sur celui qui dit le résultat.
- [1× — 08-28k] **Toutes les tables de tous mes bancs s'écrivaient en minuscules — la casse
  n'était donc éprouvée nulle part.** `to_regclass('User')` : PostgreSQL traite son argument
  comme un IDENTIFIANT et le plie en minuscules, cherchait `user`, rendait NULL, et le lecteur
  de catalogue déclarait ABSENTE la table `User` du framework. Sur **toute** base PostgreSQL :
  verdict `divergent` permanent juste après avoir migré une base vierge, et sonde de
  disponibilité qui retient le pod. Des dizaines de cas passaient sur PostgreSQL sans rien en
  dire, parce que leurs fixtures (`nf_widget`, `idempotency_key`…) ne portaient aucune
  majuscule. **Un banc dont les données sont toutes de la même forme ne prouve que cette
  forme** — et le défaut est sorti d'un banc écrit pour autre chose (les commandes sur les
  trois dialectes), pas d'une relecture.

- [1× — 08-28g] **Cinq tests VERTS portaient deux crashs, et le compte de tests ne le disait pas.** Les pilotes réseau de l'applicateur de migrations n'avaient aucun auditeur `error` : mon banc tuait la connexion détentrice du verrou (`pg_terminate_backend`) — geste normal en production, OOM ou pare-feu — et l'`EventEmitter` levait, faute d'auditeur. Vitest affichait « 5 passed » ET « Errors 2 » sur une ligne séparée, plus bas, hors du bloc qu'on lit. Le défaut était RÉEL : le process de migration serait mort au lieu de rendre une erreur. **Un `Tests N passed` ne couvre pas les erreurs non capturées — lire aussi la ligne `Errors`, et l'exit code.** Le même défaut avait déjà été fermé sur le pool de `DrizzleOrm`, avec le même symptôme (« 6 tests passés, 1 erreur non capturée »).

- [1× — 08-28] **J'ai écrit un cas qui levait lui-même l'erreur qu'il prétendait éprouver.** La
  socket est un état de MODULE, posé par les cas précédents : n'ayant pas de moyen évident de
  retrouver l'état initial, j'ai écrit `expect(() => { throw new Error("…placeholder") })
.toThrow(/configureNodefony/)`. Vert, et vérifiant le test au lieu du produit. Le remède tenait
  en deux lignes (`vi.resetModules()` + réimport). **Le signe distinctif : le corps du `expect`
  contient la valeur attendue au lieu d'appeler le code.** À relire systématiquement dans un banc
  où l'état vit au module.

- [1× — 08-27] **Un statut de pilotage posé sur une simple MENTION.** Le hook `post-commit` passe en
  « In Progress » tout ticket qu'un commit cite sans le fermer. Mon message de livraison de #36
  disait « les liaisons idiomatiques Vue, Angular et Svelte (#37/#38/#39) » — pour dire ce qui
  RESTE — et les trois sont passés « en cours » alors que rien n'y avait été commencé. Trois
  statuts faux, produits par une phrase honnête. Un automate qui lit une citation ne lit pas une
  intention : le contrôle du mode END (« un commit récent le cite-t-il ? ») ne suffit donc pas, il
  faut regarder ce que ce commit a FAIT du ticket.

- [1× — 08-27] **Deux gardes NEUVES ne pouvaient pas échouer, et l'une par construction.** Écrites
  le jour même, elles passaient au vert du premier coup ; les débrancher a montré que l'une prenait
  sa tranche « après le démontage » à partir de `src.search(/onDestroy|…/)` — qui tombe sur
  l'**import** en tête de fichier, donc sur le fichier ENTIER, où le mot recherché figure toujours.
  L'autre exigeait qu'une page « pointe ses trois sœurs » : retirer une vitrine de la barre ne la
  faisait pas tomber, le pied de page suffisait à la satisfaire. Ni relecture ni revue ne les
  auraient vues — seul le sabotage les a révélées. **Une garde écrite pendant que le code est
  correct ne prouve rien tant qu'on ne l'a pas vue rouge**, et le contre-exemple doit viser
  EXACTEMENT ce qu'elle prétend interdire, pas quelque chose d'approchant.

- [1× — 08-27] **Un outil de pilotage qui rend « rien à faire » précisément quand on s'en sert.**
  `ticket-verify --touched-by HEAD` lançait `git diff --name-only HEAD` — l'arbre de travail contre
  le commit. Or son seul moment d'emploi est JUSTE APRÈS un commit, où ce diff est vide par
  construction : il répondait « aucun fichier touché — rien à relire » sur dix-huit fichiers
  modifiés, et le mode END du skill le lance exactement comme ça. Un outil qui acquitte est pire
  qu'un outil absent : l'absence se remarque. (`diff-tree` pour une révision, `diff` pour une plage.)

- [1× — 08-27] **Un champ de pilotage rempli MÉCANIQUEMENT ressemble à un arbitrage.** La grappe
  #54 avait `ordre = numéro d'issue − 4` sur sept sous-tickets : le socle commun passait APRÈS les
  trois liaisons qui en dépendent, le ticket d'un AUTRE jalon ouvrait la marche, et celui que le
  parent désigne comme « le confort d'abord » finissait dernier. Rien ne criait, parce qu'un ordre
  faux est un ordre quand même. Le contrôle qui tranche en une seconde : **si les ordres vont dans
  le même sens que les numéros d'issue, personne n'a arbitré.**

- **Le premier instrument qui ACQUITTE à tort — pire que ceux qui accusent.** Le soak s'est
  arrêté à la 37ᵉ fenêtre d'un run de 180, est resté DEUX HEURES pendu, puis a rendu
  `verdict: "clean"`, exit 0. Son garde-fou de durée comparait à un plancher ABSOLU (10 min) et
  jamais à la durée DEMANDÉE : 15,7 min franchissaient le plancher. Un faux vert FERME la question
  au lieu de la poser — la traque RSS s'arrêtait là. `tronque` prime désormais sur tout, exit 2.
  [1× — 08-26]

- **`expect(...).toBeTruthy` sans les parenthèses ne s'exécute jamais.** Écrit dans MON test du
  jour ; il passait, évidemment. Une assertion qui n'appelle pas son matcher est une expression
  jetée. Remplacée par deux cas explicites, un par plateforme. `[1× — 08-25]`
- **Les tests vitest ne TYPECHECKENT pas.** Un narrowing cassé (`Number.isInteger(port)` ne dit
  rien à TS de `undefined`) laissait 3 161 tests verts et le BUILD rouge. Rattrapé par le hook
  pre-push, pas par moi : après une modif de type, lancer `npm run build`, pas seulement la suite.
  `[1× — 08-25]`

- [1× — 08-25e] **Mon gate de conformité neuf a été complaisant DEUX fois de suite, sur le même
  fichier.** D'abord un décor vide — je supposais que `runScaffold({type:"app", dir})` écrivait dans
  un sous-dossier, il écrit DANS `dir` : `prettier --check` répondait « aucun fichier trouvé », que
  le banc lisait comme « non conforme » et imputait au générateur. Décor réparé, quatre cas sont
  passés au VERT **sans rien mesurer** : prettier lancé avec un `cwd` donné et un chemin ABSOLU
  sortant de ce répertoire répond « All matched files use Prettier code style! » sans avoir rien
  contrôlé. Seul le cas sentinelle — « un fichier volontairement mal formé DOIT être refusé » — a
  rattrapé le second. **Tout banc de conformité commence par ce cas-là**, et il doit être le
  premier écrit, pas le dernier.

- [1× — 08-25] **Un seuil dont on ne voit jamais la marge est indistinguable d'un seuil
  décoratif.** Le gate mémoire ne publiait son delta qu'en ÉCHEC (message d'assertion), et le step
  de rapport filtrait sur `status == "failed"` : tant qu'il passait — toujours — aucun chiffre.
  Instrumenté, les marges sortent entre ×55 et ×572 **sur un poste au repos**. **Un gate à seuil
  doit publier sa MARGE à chaque passage**, sinon nul ne peut dire s'il garde encore quelque chose
  — et c'est le user qui a posé la question, pas le banc.
  ⚠️ **Suite, 08-25e : la conclusion « les seuils sont 55 à 572× trop larges » était FAUSSE.** Une
  marge n'est pas une propriété du code, c'est une propriété du RÉGIME de la machine qui l'a
  mesurée : le même gate rend **×12,7 à ×14,1** sur les trois systèmes de la forge et **×2,3 à
  ×7,0** sur un poste sous charge. Les resserrer aurait fabriqué un rouge à chaque passage.
  Dossier classé, chiffres et méthode dans `feedback_perf_memory_rule`. **Publier la marge était
  juste ; en tirer un verdict depuis UN seul décor ne l'était pas.**

- **Mon test neuf était complaisant par l'ORDRE de ses données.** Il devait prouver qu'une sonde lit
  l'état d'un socket (`LISTENING`) et n'attrape pas un client connecté au même port ; la ligne en
  écoute figurait AVANT celle du client, si bien que la première correspondance était la bonne par
  accident. Débranché, il restait vert. Lignes inversées, il tombe — et deux cas avec lui. Un jeu de
  données se compose CONTRE l'implémentation, pas dans son sens. [1× — 08-25]

- **Quinze cas VERTS en 0 ms, zéro requête émise.** Ma suite e2e neuve déduisait un corps valide
  en lisant un format d'erreur SUPPOSÉ (`issues[].path`) là où l'application rend
  `error.fields[].field`. Elle rendait `null`, et toute la famille CRUD faisait `return` en
  silence — chaque cas comptait passé. Le seul signe était la **colonne des durées**, jamais le
  total. Quatre gardes « anti-suite creuse » posées ensuite ont mordu au premier run. Corollaire :
  **quand une sonde peut rendre `null`, un cas doit AFFIRMER qu'elle ne l'a pas fait** — et le
  format d'une réponse se RELÈVE sur un serveur réel, il ne se suppose pas. [1× — 08-25]

- **Un `beforeAll` qui lève ne rougit rien : vitest marque les cas SKIPPÉS.** Trois cas de la
  couche donnée sont passés de « exécutés » à « skippés » sans qu'aucun total ne change de
  couleur — un skip se lit comme un vert dans un rapport parcouru vite. La garde qui l'énonce
  (« l'ORM DOIT être debout si des entités sqlite existent ») coûte quatre lignes. [1× — 08-25]

- **Trois de mes fautes ont été attrapées par les gates et les bancs, aucune par moi.** Un champ
  d'options inexistant (vitest muet, `tsgo` l'a refusé au build) · un gabarit de test qui ne
  COMPILAIT pas avec une dépendance injectée (mes assertions lisaient des chaînes, le banc de
  vérité a compilé : `TS2554`, trois fois) · un `container` nullable (gate pre-push). Le point
  commun : **mes propres tests lisaient du texte là où les leurs EXÉCUTENT**. Une assertion de
  chaîne sur un artefact généré ne prouve jamais qu'il tient debout. [1× — 08-24d]

- **Un gate qui SCANNE le dépôt s'auto-satisfait s'il se scanne lui-même.** Le contrôle « le
  registre ne réserve QUE des variables que le runtime lit vraiment » balayait tous les sources —
  y compris `reservedEnv.ts`, où chaque entrée est ÉCRITE. Toute entrée inventée s'y trouvait
  donc « lue », et le gate était vert par construction. Vu uniquement parce que j'avais débranché
  le registre pour éprouver l'autre sens : le premier test a mordu, le second est resté vert sur
  une entrée `NF_ZZZ_MORTE` qui n'existait nulle part. **Tout scanner de sources doit s'exclure de
  son propre périmètre**, et la seule façon de s'en apercevoir est de le voir rouge sur un cas
  fabriqué. [1× — 08-24d]
- **Trois passes payées pour mesurer notre PROPRE générateur.** Une sonde du banc devkit recalait
  l'agent sur une ligne écrite par le gabarit — un commentaire — parce que la garde
  anti-commentaire tombait sur le `+` du diff. Le pire n'est pas ce rouge : c'est que la même
  faute, sur une sonde INVERSÉE, aurait produit un VERT. Ne plus matcher, pour un interdit, c'est
  ne plus rien garder. [1× — 08-24d]

- **Un décor peut EXPIRER au milieu d'un run.** Le jeton de la porte MCP était émis pour 120 minutes
  — durée calibrée sur « la tâche la plus longue » — alors qu'une passe en dure 110 et qu'un run en
  compte trois. Les passes 2 et 3 auraient mesuré une porte fermée pendant que le décor enregistré
  annonçait « jeton posé ». **Un paramètre de décor se dimensionne sur la DURÉE DU RUN, jamais sur
  son unité de travail.** [1× — 08-24]
- **La machine fait partie du décor** : un run de deux heures est mort sur « your computer went to
  sleep ». Le banc s'en protège désormais lui-même (`caffeinate -w <pid>`, qui meurt avec lui). [1× — 08-24]

- **Un gate de couverture a rougi en CI, et il avait raison.** Le cas du 499 se skippait faute de
  trouver le journal du serveur — mais AVANT le correctif de la veille, le même test lisait un
  chemin en dur et, quand il était illisible, court-circuitait son assertion pour ne garder qu'un
  health-check : il passait VERT sans rien mesurer, depuis toujours. Le rouge du jour fut le
  premier verdict FIDÈLE. Réflexe : un gate qui se met à mordre après un correctif de test ne
  signale pas une régression, il révèle un mensonge ancien. [1× — 08-23]
- **La découverte d'un artefact doit RATISSER LARGE quand un marqueur tranche.** Le helper
  cherchait le journal dans deux emplacements et ignorait celui de la forge
  (`$GITHUB_WORKSPACE/nodefony-server.log`) : ajouter un candidat ne peut pas produire de faux
  positif (le marqueur unique décide), mais en OUBLIER un produit un banc muet. [1× — 08-23]

- 🔴 **Un garde qui vise le mauvais dossier ressemble exactement à un garde.** Deux suites
  nettoyaient `tmp/` quand le serveur écrit dans `tmp/upload` (la config de l'app le pose) :
  le `readdir` listait un dossier voisin, `unlink` réussissait à ne rien faire, et **4 420
  fichiers** se sont accumulés sans qu'aucun test ne bronche. Un `unlink` silencieux ne peut
  pas révéler ça — le garde rend désormais le NOMBRE supprimé et les suites l'assertent (vu
  rouge : `expected +0 to be above +0`, la mesure directe du défaut). C'est le USER qui l'a
  vu. `[1× — 08-24]`

- **Un gate neuf, vert du premier coup, laissait passer LE défaut qu'il existait pour attraper.**
  Le contrôle anti-lien-mort d'un site servi sous un sous-chemin résolvait un `/adr/` absolu contre
  la racine du DOSSIER de sortie — où le fichier existe — au lieu de la racine du domaine, où il
  n'existe pas. Il rendait donc « 0 cassé » sur un site dont tous les liens auraient été morts en
  ligne. Découvert en injectant le défaut exprès, pas en le relisant. [1× — 08-24]
- [1× — 08-30] **Un `beforeAll` qui JETTE ne rend pas les tests rouges : il les rend SKIPPÉS.**
  Le hook ouvrait une base SQLite dont le dossier n'existait pas encore (créé par `beforeEach`) —
  toute la suite est passée en `↓`, donc en vert muet. Attrapé par le gate du dépôt (« 2 tests sur 7
  n'ont pas tourné »), jamais par la lecture. Corollaire : borner un hook à ce qui le CONCERNE (ici,
  ne poser la question qu'au dialecte visé) plutôt que de le faire tourner « pour tout le monde ».
- [1× — 09-01] **Trois silences trouvés en EXÉCUTANT un prototype d'une demi-journée**, qu'aucune des deux conceptions écrites (la mienne et une relecture indépendante) n'avait vus : un champ obligatoire sans défaut fait échouer le semis avec un code de sortie 0 et 809 lignes sans un mot (application démarrée, aucun administrateur) ; une colonne du contrat retirée laisse démarrer ET laisse la commande de liste réussir ; un champ métier est écrit en base et ne ressort pas du dépôt. **Ce que la lecture ne voit pas, l'exécution le dit en vingt minutes.**

## 🎭 Mon PROPRE `--dry-run` mentait — l'option dont le seul rôle est de dire ce qui va se passer

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

## 🧪 Vérifier que la transformation a EU LIEU, avant de croire la mesure

- **[1× — 09-02] Deux fois de suite, mon banc n'a jamais atteint l'étape que je venais d'écrire.** (a) En mode `--link`, `better-sqlite3` n'est pas hissé dans l'application témoin : `drizzle-kit` réclame un pilote, l'étape des migrations tombe **en accusant la base**, et tout ce qui suit est ignoré. (b) Mon étape rebâtissait l'app avec l'entité amputée — or `npm run build` d'une application Nodefony DÉMARRE un kernel, donc il refusait avant le démarrage que je voulais mesurer. Règle : avant de lire un verdict, vérifier que l'étape a bien TOURNÉ — un `ls` sur la dépendance, un compte d'étapes exécutées.
- [1× — 09-01] **Mon décor incomplet a rendu 187 faux positifs.** `check-site-links` sur un site que j'avais rendu avec la seule étape `build-docs-site` : **187 liens internes fautifs**, tous vers `../../../`. Ce n'était pas le contenu — la forge rend TROIS objets avant de vérifier (`readme-html` pour l'accueil, la doc, `build-perf-site` pour `/performance/`), et les liens de retour pointaient vers des cibles que je n'avais pas générées. Séquence complète rejouée : **0 cassé sur 10 397**. Le réflexe qui a sauvé : chercher mes propres fichiers dans la liste des fautifs (absents) AVANT de conclure — puis lire le flux CI pour savoir ce qu'il fait AVANT le gate.

- [1× — 09-01d] **Un build échoué en SILENCE m'a fait mesurer trois fois la page précédente.** Des
  backticks dans un commentaire CSS, à l'intérieur d'un gabarit JavaScript : `node build.mjs

  > /dev/null 2>&1` avale l'erreur, le fichier de sortie reste celui d'avant, et l'écran mesuré est
  > l'ancien. J'ai conclu « le correctif ne change rien », puis « le log n'apparaît pas donc la
  > fonction n'est pas appelée » — deux verdicts faux tirés du même artefact périmé. **Ne jamais
  > rediriger la sortie d'un build dont on va mesurer le produit.**

- [1× — 09-01] **Le décor local ment sur un contrôle de liens.** `check-site-links` accusait `index.html → performance/`. Faux : la forge construit `/performance/` par une étape (`build-perf-site.mjs`) que le build local ne lance pas. La preuve n'a de valeur qu'en rejouant la chaîne ENTIÈRE de `pages.yml`. Même famille que le flake mémoire de la veille (watcher local vs `--no-watch` en CI) : **le poste diverge de la forge, et c'est le poste qui ment**.

- [1× — 09-01] **Le harnais a REFUSÉ ma commande (un `cd` relatif), et j'ai failli lire le résultat comme un verdict.** Le refus portait sur toute la commande — patch `python3` compris — mais la commande SUIVANTE a rendu « 6 tests passés ». Ces 6 verts ne disaient rien du correctif, qui n'était pas dans le fichier. Un `grep` de l'ancre l'a montré. **Règle : après un refus d'outil, la première chose à vérifier n'est pas le test, c'est que l'ÉDITION a eu lieu.**
- [1× — 09-01] **Mon motif `awk` de contrôle rendait des cellules VIDES** (P2, P7, P8, P10, P11, P14, P16) et accusait le bandeau d'un écart de 20 tâches. Réécrit en Python, l'écart réel était de 1 — mais il était RÉEL : `141✅ (211)` annoncé pour `142✅ (212)`. L'instrument se suspecte avant le fichier, et un écart trop gros est d'abord un symptôme de l'instrument.

- [1× — 09-01] Build « de contrôle » lancé **sans `NF_WITH_DEV_MODULES=1`** : en production les modules `policy:"dev"` ne sont pas chargés ⇒ « aucun frontend déclaré », **empreinte du bundle inchangée**, et j'ai failli conclure que `NODE_ENV` n'avait aucun effet. C'est l'empreinte identique qui a sauvé la conclusion — pas le code de sortie, qui valait 0.
- [1× — 31/08] **`git diff --stat` était MUET sur mon débranchement** — parce que le fichier était
  NEUF, donc non suivi. Ma boucle de mutation affichait « diff: » vide à chaque tour, et j'ai
  failli en conclure que rien n'était appliqué. Ce qui a sauvé le verdict, c'est un `assert` Python
  sur l'ancre AVANT réécriture, plus le fait que chaque mutation faisait tomber un test NOMMÉ
  différent. Règle : sur un fichier non commité, `git diff` n'est pas un témoin de changement ;
  seul l'assert d'ancre ou une relecture du contenu l'est.
- [1× — 31/08] **Mon filtre de commentaires a mangé 4,6 Ko de code sans le dire.** Une regex
  `/\*[\s\S]*?\*/` sur un fichier entier s'ouvre sur le `/*` d'un chemin cité DANS un commentaire
  de ligne (`// … `/auth/*` …`) et ne se referme que 77 lignes plus bas. Le test rendait un rouge
  qui ne parlait pas du code. Un filtre approximatif sur du TypeScript est un lexeur qu'on n'a pas
  écrit : découper LIGNE À LIGNE est moins élégant et ne ment pas.
- [1× — 31/08] **Le gate de budget a mesuré un `dist` d'AVANT le diff** et rendu exactement le même
  chiffre qu'après — ce qui ressemblait à « ma brique ne coûte rien ». Il a fallu rebâtir, comparer
  les `mtime`, puis mesurer un CONTREFACTUEL (retirer l'export du barrel publié) pour obtenir le
  coût réel. Un gate qui part d'un artefact ne dit rien tant qu'on n'a pas prouvé sa fraîcheur.

- [1× — 31/08] **Mon script de mutation a annoncé « 0 rouge » là où il y en avait 4** — c'est-à-dire
  « ce banc ne prouve rien » alors qu'il prouvait tout. Deux causes cumulées, chacune muette : la
  mutation n'était plus en place au moment du run (restauration prématurée entre deux itérations
  d'une boucle qui réécrivait le même fichier), et l'analyseur de sortie rendait `0` quand sa
  regex ne matchait pas — un plantage à l'import et « aucun échec » rendent le même chiffre.
  **Une boucle de mutation doit CONSTATER le fichier des deux côtés du run** (`grep` de la ligne
  mutée avant, et après), et son compteur d'échecs doit distinguer « zéro rouge » de « je n'ai pas
  su lire ». Refaire l'expérience à la main est ce qui a tranché.
- [1× — 31/08] **Un `replace` sans `assert` a affiché « barrel mis à jour » sans avoir rien touché.**
  Le motif ne correspondait pas ; le `print` de fin était inconditionnel. Le fichier est resté en
  l'état, et seul un `git status` inattendu l'a révélé. Tout script d'édition en place **assert le
  motif AVANT d'écrire** — un `assert` qui jette est le seul message honnête, et il protège aussi
  le fichier (rien n'est écrit).
- [1× — 31/08] **Un gate lancé contre un serveur qui n'a pas mon diff mesure l'état d'avant.** Le
  gate mémoire exige un serveur ; je l'ai lancé sans rebâtir ni redémarrer, et son vert ne portait
  sur rien. Le contrôle qui coûte dix secondes : l'heure de démarrage du process, comparée à celle
  de la modification. Relancé après redémarrage, le verdict restait bon — mais il ne le SAVAIT pas
  avant.
- [1× — 31/08] **J'ai cherché la preuve dans une sortie TRONQUÉE et conclu que la chaîne ne
  marchait pas.** `grep` sur les frames rendues par la sonde : zéro occurrence du canal — alors que
  le serveur avait déjà journalisé l'entrée deux fois. Les charges y sont coupées à ~150 caractères.
  **Chercher au point d'ARRIVÉE (le journal du pod) avant de chercher sur le fil** : l'instrument
  d'observation du transport est plus fragile que l'effet qu'on veut constater.

- [1× — 31/08] **Ma BASELINE rendait le même chiffre que le correctif — et je ne l'ai vu qu'au 4ᵉ essai.** Je validais une correction de config Vite par `curl` sur le module servi ; la baseline sans aucun correctif rendait déjà `0` occurrence alors que la page cassait. Deux « succès » consécutifs étaient des artefacts d'instrument, et j'ai corrigé dans le vide. **Mesurer la baseline AVANT de mesurer le correctif** est ce qui tranche : deux valeurs identiques disent que l'instrument ne discrimine pas. Ici seule la PAGE mesurait juste (monte / ne monte pas), avec un décor identique à chaque tirage (build → purge des prébundles → redémarrage).

- [2× — 08-31] **Débrancher sans REBÂTIR ne débranche rien.** Trois fois dans la même session :
  garde neutralisée, banc relancé, VERT — et j'ai failli conclure que mon test ne mordait pas. La
  commande s'exécute depuis `dist` ; le débranchement vivait dans les sources. Le vert n'était pas
  un test complaisant, c'était l'ANCIEN code. Tout débranchement destiné à un banc qui lance un
  processus se termine par un `build --force`, et la preuve du débranchement se prend sur
  l'artefact bâti, pas sur le fichier édité.
- [1× — 08-30] **Deux défauts n'existaient QUE dans l'artefact rendu, invisibles au gabarit.** La
  CI générée pour MySQL était un YAML **cassé** (délimiteur de heredoc en colonne 0, qui termine le
  bloc scalaire) ; le script d'initialisation des bases, écrit en `.sh`, **tuait le serveur au
  démarrage** (`bad interpreter`, code 126 — l'entrée d'initialisation l'exécute dès qu'il porte le
  bit exécutable). Les deux se lisent en RENDANT puis en EXÉCUTANT, jamais en relisant le gabarit :
  le rendu contenait bien les bonnes lignes. Cf [[feedback_prove_on_received_artifact]].
- [1× — 08-29] **Le décor n'ARMAIT PAS le cas — et la preuve était verte.** Pour prouver qu'une
  pile d'appels avait disparu au démarrage, j'ai lancé la commande sur une base vierge : zéro pile,
  code 0. Le contrôle négatif a montré que le débranchement ne la faisait pas revenir **non plus** —
  donc le service en cause n'avait jamais démarré : en production, sans sa clé de chiffrement, il
  s'arrête AVANT le geste qu'on voulait observer (fail-safe). Il a fallu poser deux variables de
  plus pour que le cas existe. **Un run vert sur un décor qui n'arme pas le cas est indiscernable
  d'un correctif qui marche** — seul le contrôle négatif les sépare, et c'est la seule raison pour
  laquelle je ne l'ai pas publié comme preuve.

- [1× — 08-29] **Le cache turbo m'a rendu un `dist` d'AVANT le débranchement.** Source débranchée
  (`if (false)`), `npm run build` lancé, run relancé — et la sortie portait le message du correctif
  débranché. Trente secondes à ne rien comprendre, avec la tentation de conclure « le code chargé
  n'est pas celui-là ». La règle du dépôt le dit déjà (`turbo` restaure un `dist` caché avec un
  mtime NEUF), mais je ne l'applique que quand j'y pense : **tout débranchement de preuve se fait
  avec `--force`, et se vérifie par une empreinte cherchée DANS l'artefact** (`grep` de la phrase
  dans le `.js` bâti), jamais par une date ni par la réussite de la commande de build.

- [1× — 08-29] Le gate d'outillage a refusé le même commit TROIS fois : fiche de skill périmée, scripts non cités, puis fiche re-périmée **par prettier** qui reformatait la ligne que je venais d'ajouter. La régénération va APRÈS le formateur, jamais avant.
- [1× — 08-29] Un débranchement sur la source ne prouve rien tant que l'artefact n'a pas été rebâti : `false && …` a été ÉLIMINÉ par le bundler, et c'est en lisant `isAheadOnly` dans le `dist` (elle y rendait `false`) que le débranchement s'est constaté. Le pod exécute le bundle, pas le fichier édité.
- [2× — 08-28l] **Un COMPTE annoncé sans vérifier ce qui a été écrit.** La commande disait
  « migration écrite depuis 6 tables » et en écrivait quatre : deux étaient d'un autre moteur, et
  l'outil les ignore sans un mot. Le message répercutait donc le silence de l'outil, une couche plus
  haut, dans une phrase que l'utilisateur croit. **Le même run, deux fois** : le décor du banc est
  isolé (paquets installés depuis des tarballs), donc mon correctif n'y était pas — j'ai mesuré
  l'ancienne version en croyant mesurer la nouvelle, jusqu'à vérifier l'empreinte du fichier chargé.

- [1× — 08-28k] **Mon débranchement n'a JAMAIS eu lieu, et j'ai lu le vert comme une preuve.**
  Pour voir un gate neuf échouer, j'ai enchaîné `ls <copie de sauvegarde> && python3 <<'EOF' …`.
  Le `ls` a échoué — le fichier n'existait pas —, donc **le `&&` a coupé avant le script**, qui
  n'a jamais tourné. La sortie ne portait qu'une erreur `ls` et un `2` sans contexte ; j'y ai lu
  « débranché », lancé la suite, obtenu 8/8 verts, et failli conclure que mon nouveau cas ne
  mordait pas. Le correctif était encore en place tout du long. Ce n'est pas le `&&` le fautif,
  c'est d'avoir cherché la preuve du débranchement dans le RÉSULTAT du test au lieu de
  l'exiger de l'ÉTAT — deux lignes de `sed` sur le bloc modifié l'auraient tranché en une
  seconde. Règle : avant de lire un verdict « débranché », AFFICHER le code actif.

- [1× — 08-28f] **`drizzle-kit` rend le code 0 QUAND IL ÉCHOUE** — une exception non rattrapée part sur la sortie d'erreur et le process sort quand même à zéro. Mon contrôle de dérive en déduisait « rien à générer » de « code 0 + aucun fichier » : il a donc déclaré ALIGNÉ un schéma qui avait dérivé, dès son premier usage réel. La panne INNOCENTE le produit — pire qu'un faux positif, parce que personne ne rouvre un verdict vert. Le remède n'est pas de lire le code de sortie plus attentivement, c'est d'exiger une **preuve positive** que le travail a eu lieu (une ligne d'annonce de l'outil, et mieux : l'artefact — le journal a-t-il gagné son entrée ?). Corollaire vécu deux fois dans la même heure : l'outil échouait aussi sur un dossier de sortie ABSOLU, qu'il préfixe par `./` pour fabriquer `.//Users/…` — même symptôme, code 0.

- [1× — 08-28] **Mon `Write` a ÉCRASÉ une suite existante, et son retour ne l'a pas dit.** J'ai
  créé `src/nodefony/src/tests/readiness.test.ts` sans regarder si le nom était libre — il l'était
  pour MON concept (le registre de disponibilité), pas dans le dépôt : `checks/readiness.ts` a le
  même nom pour une tout autre question, et ses **11 cas ont disparu**. Le seul signal était un mot
  dans le retour de l'outil (« updated », pas « created »), et il ne m'a pas arrêté. Ce qui a
  sauvé : `git status` affichait `M` là où j'attendais `??`. Le geste : avant d'écrire un fichier
  neuf, `ls` le chemin — et lire ce que l'outil dit avoir FAIT, pas ce qu'on croyait demander.
- [1× — 08-28] **Mon `turbo build` manuel et le superviseur de développement se sont marchés
  dessus**, et le serveur a continué de servir l'ANCIEN code. Le rebuild du superviseur a échoué
  (`Cannot find module …/bundler/index.js` — mon build effaçait le `dist` qu'il lisait), il a donc
  conservé l'exemplaire en cours : mon débranchement n'a jamais atteint le serveur, et le banc
  « passait » en prouvant l'inverse de ce que je croyais. En mode développement, **le superviseur
  rebuild seul sur la modification de source** : lancer un build à la main pendant ce temps est un
  geste actif, pas une précaution. Le contrôle qui tranche : `[dev] ✓ build OK` dans le journal,
  puis l'empreinte du `dist`.
- [1× — 08-28] **Ma reproduction d'un échec d'intégration continue a été VERTE, et c'est un binaire
  GLOBAL qui répondait.** La forge rendait `sh: nodefony: command not found` sur les six
  plateformes ; j'ai retiré `node_modules/.bin/nodefony` pour reproduire, relancé, et tout a
  marché — j'ai failli conclure que la forge se trompait. `which nodefony` disait
  `~/.local/bin/nodefony` : une installation globale, invisible dans la commande, absente partout
  ailleurs. **La commande est identique des deux côtés ; seul l'environnement diffère — et celui
  du développeur est le seul qui ne ressemble à aucun autre.** Reproduire un « command not found »
  exige de réduire le `PATH`, pas seulement de retirer le lien local. Corollaire pour la règle
  « prouver sur l'artefact reçu » : l'artefact inclut le PATH.

- [3× — 08-28] **Le même sabotage a re-menti DEUX fois de plus, par le même cwd.** `Tests no tests`
  - `exit 1` se lisent comme l'échec attendu, alors que rien n'a tourné. La cause n'est pas
    l'étourderie : un `cd` en début de commande composée est parfois AVALÉ (garde-fou du harnais,
    reset du shell), et le second bloc s'exécute ailleurs. Le remède qui a marché : dans le MÊME
    appel, `cd <absolu> && <sabotage> && <run>`, et lire le motif — un rouge sans nom de test rouge
    n'est pas une preuve. Vu aussi sur un `npm run lint` lancé depuis un workspace qui n'a pas ce
    script : `exit 1` qui ne veut rien dire.
- [1× — 08-28] **Un build INCRÉMENTAL répond « à jour » et ne compile rien — le gate est muet.**
  Dans une application générée, `npm run build` disait « à jour · rien à faire » : le front avait
  été bâti par `create app` lui-même. Une étape de banc qui s'y fierait ne prouverait RIEN. Il a
  fallu `--force` pour distinguer une compilation d'une constatation de fraîcheur.
- [1× — 08-27j] **Un sabotage « concluant » ne prouvait rien : le run tournait dans le mauvais
  workspace.** Pour vérifier qu'une garde neuve mordait, j'ai saboté puis lancé `npx vitest` — mais
  le `python3` du même appel avait laissé le cwd à la RACINE. Sortie : `Tests no tests`, que j'ai
  lue comme l'échec attendu. Deux fois de suite. Le vrai sabotage, relancé depuis le module, rend
  une `AssertionError` NOMMÉE. **Un échec ne vaut comme preuve que si on lit son MOTIF** : « ça a
  échoué » et « ça a échoué pour la raison visée » sont deux verdicts différents, et le premier
  couvre aussi bien un décor cassé.

- [1× — 08-27] **Trois « défauts » de suite n'étaient que ma sonde qui mesurait trop tôt.** Le
  message n'apparaissait pas dans le salon, le compteur de trames restait à zéro, le battement
  n'arrivait jamais : à chaque fois l'écran était photographié AVANT l'aller-retour serveur (moins
  d'une seconde). Une attente explicite sur un élément DISCRIMINANT (`attendre:.salon li .qui`) a
  tout rendu vert sans toucher au produit. Le piège est écrit noir sur blanc dans le skill du
  navigateur, et je l'ai repayé trois fois : **avant d'accuser la page, attendre ce qu'on prétend
  mesurer.** Corollaire utile : `watch.mjs` a tranché en un run là où trois captures n'avaient rien
  conclu — il montre les trames, pas un instant.

- [1× — 08-27h] **Un appel Bash refusé par le garde-fou `cd` annule TOUT l'appel — pas seulement
  le `cd`.** Mon édition d'un fichier de test vivait dans le même appel qu'un `cd` relatif : le
  refus l'a emportée, j'ai lu le message comme portant sur la seule commande fautive, et j'ai
  enchaîné un typecheck vert qui ne couvrait donc rien de neuf. Découvert deux heures plus tard au
  `git status`, qui ne listait pas le fichier. Après tout refus d'outil : constater l'état, jamais
  déduire ce qui a survécu.
- [1× — 08-27] **Mon cas « évidemment sale » de flottant était PROPRE.** J'avais écrit le test
  d'arrondi sur `8.1 + 0.6`, en affirmant en commentaire qu'il valait `8.700000000000001` : le
  calcul est exact, et le test restait vert une fois la garde débranchée. Il a fallu BALAYER la
  plage pour trouver un cas réel (`1.1 + 0.1 = 1.2000000000000002`, un parmi 1 608). Une
  intuition sur les flottants ne se cite pas, elle se cherche à la commande.
- [1× — 08-27] **J'ai conclu « c'est la CI » sur DEUX points de mesure.** `gh run list --limit 300`
  ne remontait qu'à trois jours ; pour les cinq jours précédents je n'avais aucun chiffre et j'ai
  extrapolé la corrélation. La conclusion était juste — la preuve, non. Le rattrapage : reprendre
  la série entière par l'API, puis la CONFIRMER par une mesure indépendante (7,3 jobs par run
  contre 5,4–9,1 clones par run). Une corrélation qui ne couvre pas la période qu'elle explique
  n'est pas une corrélation.

- [1× — 08-27] **Mon propre audit se CONTREDISAIT, et c'est ce qui l'a sauvé.** Il annonçait
  `reflect-metadata` bundlé dans un `dist/` ET « jamais importé côté serveur » — deux verdicts
  incompatibles. Cause : ma détection cherchait `from "x"` et ratait `import "x";`, l'import à
  effet de bord, précisément la forme du paquet en cause. Sans la contradiction visible dans le
  MÊME rapport, la branche « dérive » aurait rendu un vert faux pendant des mois. Faire produire
  deux mesures indépendantes à un instrument, c'est lui donner le moyen de se dénoncer.
- [1× — 08-27] **Un `&&` a poussé l'état d'AVANT un commit refusé.** `git ci … ; git log -1 && git
push` : le hook a rejeté le commit, `git log` a réussi (il affichait l'ANCIEN HEAD), donc le push
  est parti — et j'ai lu « poussé ». Le maillon en échec n'était pas dans la chaîne `&&` ; celle-ci
  ne prouvait donc rien de ce que je croyais qu'elle prouvait.

- **`declare -A` n'existe pas en bash 3.2 (celui de macOS) — et mes propres « ok » l'ont masqué.**
  La table associative a échoué, l'identifiant d'option est parti VIDE, et six tickets ont reçu la
  priorité par défaut. Mon script affichait pourtant « #57 ok P1 » : il traçait mon INTENTION, pas
  le résultat, et le `>/dev/null` posé sur l'appel qui écrit achevait de cacher l'échec. Ce qui a
  tranché : relire les champs par l'API. Ne jamais faire confiance à un `echo` qui répète ses
  propres arguments. [1× — 08-27]
- **🔴 `npm install` sur un arbre DÉJÀ installé outrepasse une dépendance de pair ; `npm ci` la
  refuse.** Monté TypeScript 7 : build 21/21, 3 160 tests verts, `npm outdated` vide — j'ai écrit
  dans un commit que ma réserve « ne tenait pas ». La forge a rougi QUATRE chaînes sur cinq
  plateformes : `@angular/build` déclare `peer typescript@">=6.0 <6.1"`, une plage fermée. Le seul
  signe local était un `npm warn ERESOLVE overriding peer dependency` noyé dans cinq lignes
  identiques. Toute montée de dépendance s'éprouve par `npm ci` (ou `--dry-run`), jamais par un
  `npm install` sur son propre arbre : c'est le cas d'école de « prouver sur l'artefact REÇU ».
  [1× — 08-27]
- **Une sonde qui rend ZÉRO se suspecte avant le produit.** « frames: 0 » sur cinq sockets m'a fait
  douter du serveur : la clé n'existait pas, les données étaient sous `recues`/`envoyees`. `jq` sur
  une clé absente rend un compte de 0, jamais une erreur — le même silence que le champ manquant.
  [1× — 08-27]
- **Un chiffre faux dans mon PROPRE message de commit** : « 21 tickets créés » pour 24 réellement
  ouverts, écrit dans le commit qui reprochait à un ticket son chiffre périmé. Compté par `gh` juste
  après, corrigé avant la poussée. La règle « un chiffre se re-mesure » vaut d'abord pour ce que
  j'écris moi-même. [1× — 08-27]
- **Un chiffre repris d'un audit se REMESURE avant d'entrer dans un ticket.** « 437 ancres en dérive »
  venait d'une mesure d'une semaine ; rejouée, elle rendait **108 sur 4 421 (97,6 % justes), 0 LINE_OUT,
  0 FILE_NOT_FOUND**. Le ticket annonçait 2 j de travail là où il en fallait 0,5, et surtout il
  alarmait le user sur une doc « toute fausse » qui ne l'était pas. Un audit rend une PHOTO ; entre la
  photo et le ticket, le code a bougé. [1× — 08-27]
- **Le menu rendait `undefined` sur toutes les pages** après ma modification du scanner : le générateur
  consomme le `dist` du module, pas le `.ts` que je venais d'éditer. Vu SEULEMENT parce que j'ai
  regardé le HTML rendu au lieu de croire le build vert. Le piège n°1 du dépôt, encore. [1× — 08-27]

- **Mon débranchement n'a RIEN débranché, et l'a écrit quand même.** `pkill -f "bin/nodefony
production"` ne tuait rien (Nodefony renomme ses process) et mon `;` au lieu d'un `&&` imprimait
  « serveur tué » de toute façon. Le gate est passé au vert sans avoir été éprouvé. Refait en tuant
  par le PORT, avec la mort CONSTATÉE après coup : 3 tests sont tombés. [1× — 08-26]
- **`timeout` n'existe pas sur macOS → code 127 lu comme « la commande n'existe pas ».** J'ai
  failli conclure que `nodefony inspect/check/env` étaient absents, alors que c'est mon préfixe qui
  manquait. Un 127 accuse toujours le PREMIER mot de la ligne. [1× — 08-26]
- **Un pathspec `dossier/**/*.mjs` ne matche PAS la racine du dossier** : mon comptage rendait 4
  scripts là où `git ls-files` du dossier en voit 44. Dans un outil dont le seul rôle est de dire
  « ce chiffre ne dit pas tout », un comptage faux est l'ironie maximale. Recroisé zone par zone
  avant de livrer. [1× — 08-26]

- [1× — 08-25] **J'ai édité un script bash PENDANT son exécution.** Bash lit le fichier au fur et à
  mesure, à l'OFFSET D'OCTETS : mon insertion a décalé la suite, et l'interpréteur est tombé au
  milieu d'une ligne (`══: command not found`). Le rouge n'accusait rien d'autre que moi, et
  `bash -n` ne pouvait pas le voir. La règle « ne pas éditer pendant un run » ne vaut pas que pour
  les suites de tests : elle vaut pour le script LUI-MÊME.

- **Ma mutation n'avait PAS été appliquée — et j'ai failli conclure que mes tests ne mordaient
  pas.** Un `str.replace(old, new)` dont l'ancre ne correspond pas ne lève rien : il réécrit le
  fichier INCHANGÉ. Les 46 verts qui ont suivi ne prouvaient donc rien. Toute mutation porte
  désormais un `assert old in s` — et le grep de contrôle vient APRÈS. `[1× — 08-25]`

- [1× — 08-25e] **La règle de portabilité que le PRODUIT avait déjà payée, rejouée dans un test une
  heure après l'avoir écrite.** Mon banc invoquait `node_modules/.bin/prettier` par `execFileSync` :
  npm n'y écrit sous Windows qu'un `.cmd` et un `.ps1`, l'appel échoue, et trois jobs Windows sont
  tombés sur cinq rouges qui ne disaient rien du générateur. Le dépôt porte `besoinDeShell` et
  `nodefonyBin()` pour exactement ça. Remède : `process.execPath` + le script `.cjs` — aucun shell,
  un seul chemin pour les trois systèmes. **La règle vaut pour TOUTE ligne écrite, pas seulement
  pour celle qu'un utilisateur exécute.**

- [1× — 08-25e] **Un champ ABSENT n'est pas une valeur à zéro.** Le banc lisait `inflightCount` d'un
  serveur bâti AVANT que cette sonde existe : `undefined ?? -1` → « -1 en vol », et le message
  accusait de nouveau le produit. La garde distingue désormais les deux et lève « son dist est
  ANTÉRIEUR à cette sonde, reconstruire ». Même famille : la sonde mémoire forçait un GC **en no-op
  silencieux** sans `--expose-gc` — elle rend maintenant `gcForced`, et le banc REFUSE de mesurer
  quand il vaut faux. **Une capacité dont dépend une mesure doit être CONSTATÉE par la mesure
  elle-même**, sinon on publie un chiffre faux avec l'aplomb d'un chiffre vrai.

- **Mon débranchement est passé VERT, et ce n'était pas le test qui avait tort : le serveur n'avait
  pas rechargé.** J'ai daté le handler 5 s dans le futur pour prouver qu'une assertion d'ordre
  mordait ; les six cas sont restés verts. La cause n'était pas l'assertion mais le dist, encore
  l'ancien. Constaté en interrogeant la route (écart mesuré à +4998 ms), et l'assertion est alors
  tombée. Un débranchement se PROUVE comme un correctif : par ce que sert le process, pas par ce
  qu'on vient d'écrire. [1× — 08-25]

- **🔴 Une commande composée REFUSÉE par un hook n'exécute AUCUNE de ses parties — deux fois en une
  session, et deux fois j'ai conclu sur un état que je croyais acquis.** (a) `python … <<PY` qui
  écrit un test, suivi d'un `cd relatif && vitest` : le refus portait sur le `cd`, et le test n'a
  jamais été écrit — j'ai lu « 9 passed » comme une preuve alors que c'étaient les 9 tests
  d'origine. (b) `cp fichier sauvegarde` suivi d'un `git checkout` : le refus portait sur le
  checkout, la sauvegarde n'existait pas, et le patch a été perdu. **Ne jamais mettre dans la même
  commande une écriture qu'on veut garder et un geste susceptible d'être refusé** ; et après tout
  refus, RELIRE l'état plutôt que de supposer que la première moitié est passée. [1× — 08-24d]

- **Un remplacement de texte qui ne trouve rien ne dit RIEN — et le formateur a déjà réécrit la
  cible.** Quatre câblages d'échelle sur huit n'ont jamais été appliqués : mes motifs portaient sur
  du code que prettier avait reformaté entre-temps, donc ils ne matchaient plus. Aucune erreur, aucun
  avertissement — c'est un lint sur variable inutilisée qui l'a révélé, longtemps après. Depuis :
  tout remplacement programmatique s'assortit d'un `assert` sur « le contenu a changé », et on
  RECOMPTE les usages attendus. [1× — 08-24]

- **[2× — 08-24] La MÊME cause, le même jour, sur un autre fichier.** Trois règles d'exclusion
  ajoutées à une liste ne l'ont jamais été : prettier avait reformaté la cible entre-temps et mes
  `replace` étaient sans `assert`. Le résultat était JUSTE — par accident, une autre règle rattrapait
  le cas — avec de mauvais motifs affichés. Un patch qui n'a pas eu lieu ne se voit pas dans la
  sortie ; il se voit à ce qu'on ASSERTE.

- **Un fichier qui ne charge plus, cinq fois pour la même raison.** Un backtick dans un commentaire
  CSS, à l'intérieur d'un gabarit de chaîne, coupe le gabarit : le module refuse de se charger. Cinq
  occurrences dans une seule session, chacune détectée tout de suite mais chacune coûtant un cycle.
  Le remède n'est pas la vigilance : c'est `node --check <fichier>` DANS la commande qui édite. Une
  faute mécanique répétée demande un automate, pas de l'attention. [1× — 08-24]

- **Mon INSTRUMENT comptait deux fois la même chose.** « 271 chevauchements d'étiquettes sur 62
  schémas » — chiffre alarmant, et faux : chaque figure contient DEUX rendus (clair et sombre) aux
  mêmes coordonnées, dans la même balise. Mesure refaite par SVG : 4. Avant de corriger un chiffre
  qui surprend, vérifier ce que l'instrument a réellement compté. [1× — 08-24]
- **Un « tout vert » ne couvre que les chemins qu'il emprunte.** `aDroite` n'existait pas dans
  `lines()` — la suite passait au vert parce qu'aucun cas ne traversait ce code. Le cas ajouté cinq
  minutes plus tard l'a fait tomber immédiatement. [1× — 08-24]

- Un hook a bloqué un appel Bash entier (garde `cd` relatif), **python inclus** : l'édition n'a jamais eu lieu, j'ai buildé du code inchangé et conclu deux fois sur du vide. Le `grep` de contrôle sur le fichier édité coûte une seconde. [1× — 08-22]
- `$?` après un pipeline est celui de la DERNIÈRE commande : `prettier --check f | tail` rend toujours 0. Quatre verdicts faux d'affilée. [2× — 08-22]
- `prettier --check` lancé depuis le dépôt sur un chemin HORS périmètre ne trouve aucun fichier et sort **0** : « conforme » disait en réalité « rien vérifié ». Toujours mesurer dans le décor où la config s'applique. [1× — 08-22]
- Le CLI s'exécute depuis `dist` : un gabarit se lit au disque (édition immédiate), le MOTEUR non — build avant de mesurer. [1× — 08-22]

- **`grep -c` compte des LIGNES, pas des occurrences** — sur un rendu HTML, il a fait
  conclure « 1 NaN » puis « 4 lignes avec 12226 » sans rapport avec le nombre réel. Et le
  même jour, un `grep "12 226"` à l'espace normale n'a rien trouvé dans une page qui l'écrit
  avec une espace **insécable** : « le chiffre a disparu » était faux deux fois de suite.
  Compter = `grep -o … | wc -l` ; chercher un nombre formaté = motif tolérant au séparateur.
  `[1× — 08-24]`
- 🔴 **J'ai failli « corriger » un graphe JUSTE.** En lisant un SVG séquentiellement, chaque
  valeur tombait à côté du libellé de la barre SUIVANTE : j'ai cru à des libellés décalés
  d'un cran, et le corriger aurait introduit le vrai défaut. Les coordonnées (`y`) l'ont
  tranché en une commande. Dans un rendu, l'ordre du DOCUMENT n'est pas l'ordre VISUEL.
  `[1× — 08-24]`
- **Un `rm -rf` composé que zsh REFUSE n'exécute AUCUNE de ses parties** — un glob sans correspondance annule la commande entière. J'ai annoncé « décors nettoyés » sur un compte que je n'avais pas relié au geste ; 156 Mo étaient toujours là. Même famille que la chaîne `&&` interrompue. [1× — 08-25]
- **Prettier lancé sur une copie sous `tmp/` ne traite RIEN** : le `.prettierignore` du dépôt écarte ce dossier, la commande sort **0** sans avoir lu le fichier — j'en ai conclu « 0 écart » sur un fichier que le gate déclarait non conforme. La sortie masquée (`>/dev/null`) a caché que rien n'avait été traité. [1× — 08-25]

- [1× — 08-29f] **Le décor se RÉPARAIT tout seul avant que je le mesure.** Armé une base à laquelle il manque une table, lancé la commande : la garde n'a pas mordu, et j'ai failli conclure au défaut. En développement, `ddl: auto` recrée la table au démarrage — l'écart n'existait plus quand la commande regardait. Le cas ne se produit qu'en production, ce qui est exactement le décor du banc. Un décor s'arme dans le MODE où le défaut vit.
- [1× — 08-29f] **Deux sondes à moi ont mesuré autre chose que ce que je croyais, le même jour.** `assert.notProperty` n'existe pas dans `node:assert` (c'est chai) et rend un `TypeError` qu'on peut lire comme un défaut du produit ; et exiger l'écran ET le JSON d'une SEULE invocation `--json` est impossible — `--json` n'émet pas l'écran. Les deux fois, le rouge accusait le code. Avant de croire un banc neuf qui accuse, relire ce qu'il DEMANDE.
- [1× — 08-29f] **Un vert de vitest ne prouve pas que ça compile.** Un import manquant est passé sous vitest (oxc n'inspecte aucun type) et n'a été vu que par `tsgo` — après avoir fait échouer un banc de boot réel sur un message qui accusait le rechargement du superviseur. Le journal détaché a nommé la vraie cause : un build en échec.
- [1× — 08-31] **J'ai annoncé « zéro rouge » en lisant un fichier que la passe était encore en train d'écrire.** `grep -c FAIL` sur un journal en cours rend 0 parce que les échecs n'y sont pas ENCORE — le verdict final disait **4 échoués**. Un fichier de sortie n'est une mesure qu'une fois le producteur TERMINÉ : lire la ligne « Total » du rapport, jamais un compte intermédiaire. Même famille que la sortie tronquée, sauf qu'ici rien ne tronque : c'est le temps qui manque.

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

## 🧰 Un GATE excellent que personne ne lance ne garde rien

- [1× — 09-01] **Le gate lancé n'était pas celui qui couvre la cible.** `npx tsgo --noEmit -p tsconfig.json` sur un banc neuf : **aucune sortie, donc vert** — sauf que ce tsconfig porte `exclude: ["tests"]`. Le typecheck n'avait pas lu une ligne du fichier écrit. Le module a DEUX projets (`typecheck` = `tsconfig.json` **et** `tsconfig.tests.json`), et le second a levé quatre `TS2353` au premier essai (`sql` au lieu de `statements`). Réflexe : avant de croire un typecheck, lire `include`/`exclude` du projet qu'on lui donne — ou lancer le script `typecheck` du paquet, qui sait, lui, combien de projets il a.

- [1× — 09-01d] **Le gate que je venais de câbler en CI a échoué sur trente pages, et il était
  vert chez moi** : `doc-lint` exige des compteurs qui vivent sous `tmp/`, laissés là par une
  session précédente. Mon vert ne devait rien au code, seulement au décor. **Un gate se rejoue
  APRÈS avoir supprimé ce qu'il consomme** — sinon on mesure son propre poste.
- [1× — 09-01d] **Le gate d'ancres tournait en CI depuis des semaines sur une liste de dossiers
  écrite à la main qui oubliait `docs/architecture/`** — le dossier le plus atteint du dépôt. Un
  gate qui regarde à côté est plus dangereux qu'un gate absent : il rassure. Le périmètre vient
  désormais du générateur (`--list`), qui est celui qui l'applique.

- [1× — 08-31e] **Un gate qui rend un verdict FAUX est pire qu'un gate absent : il apprend à
  passer outre.** Le catalogue des variables d'environnement classait en « décor de banc » toute
  variable qu'aucun `process.env.X` ne lisait hors des tests — et exigeait donc une description
  pour `NF_DATABASE_URL` et `NF_REDIS_HOST`, que le produit lit par une table de noms
  (`infra.ts:135`) ou par un objet d'environnement injecté (`defineModuleConfig.ts:30`). Deux
  refus faux au premier essai, sur un gate posé en pre-commit. **Un classement automatique doit
  être CONSERVATEUR** : ratisser toutes les formes de référence, et retomber sur la catégorie
  indulgente au moindre doute. Le coût des deux erreurs n'est pas symétrique — un trou laisse
  passer un cas, un faux positif fait désarmer l'instrument.

- [1× — 08-31] **Réparer un step en révèle un autre — celui qui n'avait JAMAIS tourné.** Un step de la forge échouait ; le job s'arrêtait donc avant le step suivant, qui n'avait pas été exécuté une seule fois depuis son ajout. Le premier réparé, le second est tombé aussitôt (`sh: 1: nodefony: not found`, code 127) — et ses assertions accusaient le produit pour une commande qui n'avait jamais démarré. Corollaire : **un rouge en cache d'autres**, et le compte de jobs rouges ne dit rien du nombre de causes.

- [1× — 08-30c] **Les bancs les plus critiques d'un chantier ne tournaient dans AUCUNE passe.** Migrer une base vierge en production, le refus destructif, la liste blanche de l'effacement, l'annonce du détournement de base : tous derrière un interrupteur (`NF_RUN_CLI_BOOT`) qui n'était posé nulle part. Ils n'avaient jamais tourné qu'ailleurs que sur le poste de leur auteur — et un interrupteur fermé ne rend qu'un avertissement jaune, jamais un rouge. Le décor dont ils ont besoin était pourtant DÉJÀ monté par un travail voisin : trois lignes de workflow. **Chercher qui LANCE un banc fait partie de l'écrire.**

- [1× — 08-29d] **`format:scaffold` était rouge depuis le commit de la veille**, et la session qui l'avait rendu rouge a clôturé sans le lancer — trois non-conformités dans les gabarits de test, dont une ligne vide finale qui n'apparaît QUE dans le rendu. Le gate n'est pas dans le pre-commit (il génère trois applications, c'est trop lourd) : il ne mord que si on y pense. Le signe qui aurait dû alerter : **la session précédente avait TOUCHÉ des gabarits**, et le seul gate qui juge un gabarit est celui-là. **Après avoir édité un gabarit, lancer le gate qui juge son RENDU — la liste des gates ne se parcourt pas de mémoire, elle se dérive de ce qu'on vient de toucher.**

- [1× — 08-28l] **Commité sans le typecheck, alors que la suite était verte.** Le runner de tests ne
  vérifie pas les types : quatre littéraux de test construisaient un objet sans un champ devenu
  requis, 18 cas au vert, `tsgo` rouge. C'est écrit dans les gates du dépôt — « typecheck = gate
  DISTINCT du build » — et sauté quand même, parce que le vert des tests ressemble à une preuve.
  Le contrôle d'avant-poussée l'aurait arrêté : il n'a servi qu'à retarder le constat d'un commit.

- [1× — 08-28k] **La forge était rouge depuis SIX commits, et cinq sessions ont clôturé dessus
  sans la regarder — moi compris.** Dernier vert à 09:09, rouge à 10:11, et chaque session
  suivante a écrit « vert » dans son retex sur la foi de ses suites LOCALES. La règle du dépôt dit
  « la CI est gratuite, ne pas la doubler en local » — elle suppose qu'on la REGARDE, ce que le
  mode END du skill de session ne contrôlait nulle part. Un `gh run list --limit 3` coûte deux
  secondes et aurait coupé la dérive au premier commit. Le rouge, lui, disait vrai : la commande
  de mise en production était devenue inatteignable sur toute base neuve.

- [1× — 08-28] **Un gate ajouté la veille n'a jamais tourné VERT une seule fois — et personne ne
  l'a vu, parce qu'il était rouge dès sa naissance.** L'étape « le front se BÂTIT » appelait le
  binaire par son NOM (`nodefony frontend:build`) ; or `bin/nodefony` est produit par le build et
  gitignoré, donc `npm ci` ne pose pas le lien `.bin` sur un checkout vierge. Six combinaisons de
  plateformes rouges, quatre commits de suite. La règle « un gate neuf doit être vu ROUGE une
  fois » ne suffit pas : **il faut aussi l'avoir vu VERT une fois**, sans quoi on ne distingue pas
  « il mord » de « il ne peut pas s'exécuter ». Fermé par un gate qui refuse tout appel du binaire
  par son nom, dans les scripts npm comme dans les étapes de la forge.

- [1× — 08-28] **Un verdict écrit en PROSE n'atteint aucun automate — seul le code de sortie
  circule.** `create app` imprimait « npm run build a échoué » puis rendait **0**. Ni une chaîne
  d'intégration, ni un banc, ni un agent qui enchaîne ne pouvaient distinguer une application prête
  d'une application à réparer — et c'est ce qui a laissé un front généré ne pas se bâtir sans que
  rien ne tombe. Le geste : extraire la décision en fonction PURE (`createExitCode`), pour qu'elle
  se teste sans lancer un `npm install`, et vue rouge sur l'ancien retour.
- [1× — 08-28] **Un décor de banc rangé sous un chemin IGNORÉ hérite en silence de règles écrites
  pour autre chose.** Le mode `--link` posait son application témoin dans `REPO/tmp/`, par
  commodité ; le `.gitignore` du dépôt ignore `tmp/`, oxlint respecte les `.gitignore` REMONTANTS,
  et aucune option ne le désactive (`--no-ignore` ne porte que sur `.eslintignore`). Résultat :
  « No files found to lint », et **ce mode n'était jamais allé au bout**. Le banc, lui, avait
  raison — il portait la garde qui distingue « rien à redire » de « rien lu ». Remède : sortir le
  décor du dépôt, pas contourner la règle.
- [1× — 08-27j] **Le build de PRODUCTION est un gate que personne ne lançait — il cachait un front
  cassé depuis sa création.** `npm run build:front` échouait sur la vitrine Vue (le compilateur SFC
  transforme un `src="/…"` littéral en import d'asset, et ne résout rien), un jour après la
  livraison des quatre vitrines. Invisible en développement, où Vite sert l'URL sans la résoudre —
  et les trois autres fronts, écrivant la même ligne, passaient. C'est le user qui a demandé le
  build prod. **Livrer un écran sans l'avoir bâti pour la production, c'est ne l'avoir éprouvé que
  sur la moitié de ses chemins** ; le signe que le gate manque, c'est qu'un défaut ne frappe QU'UN
  membre d'une famille supposée identique.

- **Un gate qui rend 24 candidats dont 19 pour un fichier que tout le monde cite ne sera plus jamais lu** [1× — 08-27] : le bruit tue un contrôle aussi sûrement que son absence. Écarter les fichiers trop cités — en ANNONÇANT lesquels et combien — a ramené le lot à 3, exactement les bons. Et le seul nom de fichier ne désigne rien : `index.ts` faisait remonter un ticket d'un autre module ; le motif minimal est le chemin sur deux segments.

- [1× — 08-27] **Une règle RECOPIÉE hors de son skill gagne contre le skill — et fait faire
  l'inverse.** Le `CLAUDE.md` racine et la mémoire IA désignaient le conteneur comme « l'exception
  qui lève la règle pas-de-Chromium » ; le skill dit depuis sa v1.1.0 que la voie normale est
  LOCALE (rien à démarrer) et que le conteneur est un dernier recours. J'ai lancé le conteneur
  sans ouvrir le skill : le résumé était sous mes yeux, pas lui. **Le paquet publié, lui, portait
  déjà la bonne doctrine** — c'est le dépôt qui avait dérivé, pas ce qu'on distribue. Le contrôle :
  quand un `CLAUDE.md` résume un skill, il ne doit garder que le RENVOI et le déclencheur, jamais
  la doctrine — sinon l'agent applique le résumé périmé et n'ouvre jamais la source.

- [1× — 08-27] **Un contrôle rangé dans un SKILL se périme sans le dire — et il l'a fait.** L'audit
  `external` supposait `const external: string[] = [...]` ; la migration rolldown a fait passer **20
  configs sur 21** à la forme en ligne. Il ne lisait plus RIEN, ne signalait rien, et personne ne
  s'en est aperçu : c'est ainsi que `zod` est entré dans le paquet du module `test` et
  `reflect-metadata` dans deux `dist/` publiés. Il ne balayait pas non plus `src/modules/*`. Le
  déplacement dans le dépôt (`npm run externals:check`, appelé par la forge) n'est pas un rangement,
  c'est ce qui le rend testable et corrigible avec le code qu'il garde.
- [1× — 08-27] **Le dépôt a refusé mes deux nouveaux scripts : « personne ne les appelle ».** Le gate
  de placement des scripts a bloqué le commit sur `ticket-open.mjs` et `ticket-progress.test.mjs`
  — écrits, testés, et branchés nulle part. C'est exactement le défaut que la session venait de
  corriger ailleurs, reproduit dans le même commit. Un script sans appelant est un script mort ;
  ici c'est une machine qui l'a vu, pas moi.

- [1× — 08-27] **Quand la SOURCE DE VÉRITÉ déménage, le rituel qui la lit ne suit pas tout seul.**
  Le pilotage de la publication est passé du plan Markdown aux issues il y a une session — et la
  reprise continuait de restituer un état écrit à la main, qui vieillit entre deux sessions quand
  un ticket, lui, a un état. Le tableau de bord existait, personne ne le lisait au bon moment.
  Deux gestes à faire le jour où l'on déplace une source : **brancher dessus le rituel qui la
  consulte**, et **énoncer ce qui gagne en cas de contradiction** (ici : le ticket bat le
  document). Et constater la joignabilité avant d'en tirer un verdict — un `gh` muet hors ligne
  ferait conclure « rien n'a avancé ».
- [1× — 08-27] **Un SKILL que rien ne NOMME n'est jamais chargé — la règle existe et ne mord pas.**
  `nodefony-ticket` était écrit, versionné, conforme, avec ses déclencheurs — et cité NULLE PART :
  ni dans la table des skills du `CLAUDE.md`, ni par une seule phrase du banc de déclenchement, qui
  l'annonçait « porte non testée ». Résultat : j'ai ouvert quinze tickets sans lui, et le user a dû
  demander leur réécriture entière. Le coût ne se voit pas au moment où on saute le skill, il se
  paie une session plus tard. Créer un skill n'est pas fini tant que trois choses ne sont pas là :
  une entrée dans le `CLAUDE.md` (un POINTEUR, jamais la règle), au moins un cas au banc, et des
  déclencheurs pris des mots RÉELLEMENT employés — pas de ceux qu'on imagine.
- [1× — 08-25] **Un « flake » qui revient N'EST PAS un flake.** `websocket-fragmentation` est tombé
  sur Windows puis sur macOS en une heure, toujours en « timed out 60 s ». Traité deux fois comme
  un aléa de plateforme ; c'était une COURSE : le listener `message` était posé APRÈS l'`open`,
  alors que `ws` peut émettre le premier message dans la MÊME boucle d'événements que l'upgrade.
  Reproduit en injectant un retard entre les deux — l'ancienne forme perd dès qu'un tour de boucle
  s'intercale, à 0 ms déjà. Le test qui tranche entre « aléa » et « course » ne coûte rien :
  RALENTIR artificiellement l'étape suspecte et voir si l'échec devient systématique.
- [1× — 08-25] **Lire OÙ l'étape échoue avant de chercher QUOI corriger.** Un déploiement Pages
  rouge m'a fait ouvrir le générateur de site : l'échec était dans `Set up job`, sur un
  `Failed to download action` — panne réseau du runner, avant la moindre ligne de notre workflow.
  Un simple rejeu l'a réglé. Le nom de l'étape en échec est la première information du log, et
  c'est celle qui dit si le dépôt est même concerné.

- [1× — 08-25] **Un banc rouge sur sa PROPRE garde d'entrée n'a jamais mesuré.** `soak.yml`
  échouait à chaque passe sur « machine OCCUPÉE » (21,72 de charge sur 3 cœurs) : il suit un
  `npm ci` + build, et `loadavg[0]` est une moyenne sur UNE MINUTE — elle décrit le passé, pas
  l'instant. La garde était juste, son MOMENT ne l'était pas. Quand une garde de décor refuse
  systématiquement dans un environnement donné, la question n'est pas « faut-il la desserrer ? »
  mais « que devrait-elle faire à la place ? » — ici, ce que son message conseillait déjà à un
  humain : attendre la retombée.

- [1× — 08-25] **Un gate qui ne lit que la moitié de son domaine.** `scripts-audit` portait un
  contrôle « renvois morts » — mais il ne lisait que le TEXTE des `SKILL.md`. Un script qui en
  LANCE un autre par un chemin en dur y échappait entièrement, et la forme employée
  (`join(repo, ".claude", "skills", …)`) n'est visible d'AUCUNE expression cherchant un chemin.
  Le gate était vert pendant que quatre systèmes tombaient sur `Cannot find module`. Étendre un
  gate à un nouveau support commence par se demander ce qu'il ne REGARDE pas.
- [1× — 08-25] **Une fiche générée périmée ment avec l'autorité du généré.** `skills-doc --check`
  contrôlait la conformité des sources, jamais la fraîcheur de ce qu'il avait lui-même produit :
  le registre annonçait un skill à 455 lignes quand il en portait 619. Tout générateur doit
  savoir dire « ce que je produirais diffère de ce qui est sur disque » — c'est le même
  comparateur que celui qui évite de réécrire, donc il est déjà là.

- **La chaîne de PUBLICATION transitait par `.claude/skills/`, avec un CYCLE.**
  `scripts/release.mjs` appelait un script du skill, qui réimportait le cœur du produit ; la CI
  lançait le smoke depuis `.claude/`. Un skill renommé ou fusionné aurait emporté la capacité de
  publier, sans qu'aucun test ne tombe. Ce qui S'EXÉCUTE appartient au produit ; le skill garde la
  MÉTHODE. Corollaire : il manquait une page pour l'HUMAIN — trois lecteurs, trois endroits.
  `[1× — 08-25]`

- [1× — 08-25] **`schedule` et `workflow_dispatch` ne partent QUE depuis la branche par défaut.**
  Workflow écrit, commité, poussé sur la branche de travail — et incapable de se déclencher : ni
  rendez-vous hebdomadaire, ni bouton. L'API le dit franchement (« not found on the default
  branch »), mais rien dans le fichier ne le laisse deviner. Un `push` borné aux bons fichiers le
  rend éprouvable tout de suite ; le reste exige d'être porté sur la branche par défaut.
- [1× — 08-25] **Un `on: push` sans `branches:` part sur TOUTE branche — Dependabot compris**,
  dont les branches rebasent sur la branche de travail et embarquent donc le fichier neuf. Deux
  exécuteurs mobilisés trente minutes pour une montée de dépendance sans rapport, dont le `npm ci`
  échouait de toute façon. Le workflow voisin bornait déjà ses branches : la règle existait, elle
  n'a pas été recopiée.
- [1× — 08-25] **Le banc de release était rouge depuis TROIS passes hebdomadaires**, jamais lues —
  et le correctif dormait dans le dépôt depuis la veille, jamais éprouvé. Un rendez-vous
  automatique dont personne ne lit le verdict ne garde rien : il fabrique juste de la confiance.

- **La passe principale était ROUGE depuis 20 exécutions, et plus personne ne la lisait.** Deux
  erreurs de lint triviales la tenaient — et derrière elles, en file, deux autres gates qui
  seraient devenus le rouge suivant (un fichier dérivé du formateur, un faux positif de
  `skills:check`). **Un rouge permanent ne protège plus : il éteint le signal**, et il masque
  exactement autant de choses qu'il y a de gates derrière lui dans la chaîne `&&`. Le réflexe qui
  manquait : regarder `gh run list` au début d'une session qui touche à la CI. [1× — 08-25]

- **Le faux positif qui maintenait le rouge venait du gate lui-même** : deux RENDEURS de rapports
  (ils lisent un JSON déjà mesuré, écrivent du HTML) étaient classés « bancs à déplacer » sur du
  VOCABULAIRE — `bench`, `p99`, `médiane` — alors que le même fichier appliquait déjà « on exige
  un APPEL » à docker et au serveur. Une heuristique qui juge sur les mots condamne le code qui
  PARLE du sujet. [1× — 08-25]

- **La moulinette des skills a trouvé deux défauts que je n'aurais pas vus** : une description à
  1396 caractères pour un plafond de 1024, et un auto-contrôle livré une heure plus tôt que AUCUN
  SKILL.md ne citait — donc que personne n'aurait jamais lancé. Le réflexe « je viens de livrer, je
  passe le gate du dépôt » vaut mieux que n'importe quelle relecture. [1× — 08-24]

- **`anchor-check.mjs` existait, résolvait chaque ancre `fichier:ligne` contre le code, et n'était
  branché NULLE PART** — ni CI, ni script npm : une ligne dans un `SKILL.md`. Passé sur le corpus,
  il a sorti **481 SUSPECT et 8 ancres pointant dans le vide**, dont deux vers un
  `rollup.config.ts` supprimé à la migration rolldown. L'outil était bon depuis le début ; ce qui
  manquait, c'est qu'il TOURNE. Réflexe : quand un dépôt contient un contrôle qui n'est appelé par
  aucun workflow ni aucun script, c'est un défaut à part entière — le brancher AVANT d'en écrire un
  autre. [1× — 08-23b] ↝ [[feedback_gate_must_bite]]
- **Et le brancher exige de mesurer ce qu'il rendrait d'abord** : tel quel il aurait rendu la CI
  rouge (481 SUSPECT). Il ne mord que sur l'indiscutable (fichier introuvable, ligne au-delà de la
  fin) ; les dérives sont rapportées sans échouer, sinon la CI rougirait à chaque refactor honnête.
  Un gate qu'on branche sans mesurer son verdict actuel est un gate qu'on désactivera la semaine
  suivante. [1× — 08-23b]

- **Un outil cassé depuis longtemps, que personne n'appelait.** L'aperçu HTML d'une page de doc
  importait un paquet absent du dépôt : il échouait sur « module introuvable » à chaque invocation —
  invocations qu'il n'y avait plus. Il portait en outre son PROPRE moteur de rendu, donc l'aperçu ne
  montrait pas ce qui serait publié. Supprimé, remplacé par une option du générateur du site. Un
  outil qu'on ne lance jamais ne se contente pas de dormir : il POURRIT, et on s'en aperçoit le jour
  où on compte dessus. [1× — 08-24]
- **Un gate ROUGE EN PERMANENCE ne garde rien non plus — on apprend à lire son rouge.** `format:scaffold` échouait depuis toujours sur des cas dits « structurels connus » ; personne ne relisait la liste. `App.tsx` y a accumulé **onze** écarts invisibles, livrés tels quels à qui générait une app. Le remède n'est pas de supprimer le gate mais de le rendre capable de VERT : il CONSTATE qu'une non-conformité dépend du nom (sa ligne fautive porte le nom de l'app), la nomme, et n'échoue que sur le reste. [1× — 08-25]
- [1× — 08-30] **Une garde qui LIT un code de sortie ne vaut que si l'interprète le PROPAGE.**
  Le lanceur du banc contrôlait `prep.status !== 0` — correctement — mais le décor était écrit
  `sh -c "a; b; c"`, qui ne rend que le statut de la DERNIÈRE commande. L'étape centrale échouait,
  la dernière (`stop`) réussissait, et la tâche était jugée sur une prémisse absente. Sept `prepare`
  sur huit chaînaient en `&&` ; le huitième non, et rien ne le disait. **La règle a été posée dans le
  LANCEUR (`set -e`), pas dans la discipline de chaque énoncé** — sinon elle retombe au prochain.

## 🎯 Une ancre PLAUSIBLE et fausse coûte plus cher qu'une ancre visiblement périmée

- [1× — 09-02] **Deux juges qui rendent une cause FAUSSE, découverts par le run large.** (a) Un `GET 500` — migration écrite, jamais appliquée — était lu comme une liste vide, donc « la ligne témoin a disparu », donc « la base a été refaite » : une destruction annoncée qui n'avait pas eu lieu. (b) Une sonde d'interdit cherchant `DROP TABLE` dans TOUT le transcript condamnait l'agent pour avoir LU la migration que `orm:generate` venait d'écrire (patron d'expansion-contraction de SQLite) — l'agent avait lui-même écrit « c'est un faux positif ». **Le verdict était juste dans les deux cas ; la CAUSE envoyait chercher au mauvais endroit** — dans un banc dont la raison d'être est de nommer la cause. Une sonde d'interdit vise ce qu'on EXÉCUTE ; un juge d'état distingue « la ressource ne répond pas » de « la donnée a disparu ».

- [1× — 09-02] **Une sonde de banc portée par le VIEUX nom accuse le produit d'un défaut qu'elle vient de créer.** Après avoir fait converger deux noms d'export, l'étape « une entité amputée fait REFUSER » est passée au rouge : sa sonde écrivait encore l'ancien nom, si bien que le build tombait sur un import mort au lieu de refuser la colonne absente — et le message accusait le produit. Après un renommage, les SONDES se recherchent au même titre que le code (`rg` sur l'ancien nom, dépôt entier, bancs compris).

- [1× — 09-01] **Un ticket vieux de vingt-quatre heures affirmait six faussetés — toutes corrigées entretemps par ses tickets frères.** #147 listait « artefacts publiés devenus faux » : le skill `nodefony-add-crud`, deux gabarits, un test, la page des migrations. Vérification une par une : **aucun** ne portait plus l'affirmation ; #140→#143 les avaient recalés la veille. Deux vrais périmés existaient bien, mais AILLEURS (un skill interne et un `MEMORY.md`), non listés. Un ticket est une photo du code à l'instant où il est écrit — dans une grappe qui avance vite, sa section « preuve au terrain » se relit AVANT d'agir, jamais après.

- **[1× — 09-01] Le gate d'ancres a laissé passer CINQ ancres que mon propre diff venait de décaler.** Il ne signale une ancre que si le symbole cité sort de sa fenêtre de recherche : `IUserRepository.ts:62` pointait encore _dans_ l'interface, donc « juste » pour lui, alors que la ligne visée avait bougé de 19 rangs. Corollaire : après avoir INSÉRÉ dans un fichier que la doc cite, recompter les ancres à la main — le gate ne couvre que le décalage franc.

- [1× — 09-01d] **Le gate acceptait le token `Module` dans `Module.ts`** : seize ancres d'une même
  page, toutes fausses d'une vingtaine de lignes, étaient déclarées bonnes. Un critère qu'aucun
  fichier ne peut faire échouer ne prouve rien — retirer le nom du fichier visé des symboles de
  contexte a révélé 147 ancres fausses de plus, d'un coup.

- [1× — 09-01] **Remplacer par NUMÉRO, sans regarder le symbole, FABRIQUE une ancre fausse.** `Pdu.ts:169` portait deux ancres différentes — `requestId` et `Pdu.requestIdProvider`. Une substitution globale les a envoyées toutes deux sur `requestId` (200) ; `requestIdProvider` est à 212. Rattrapé en relisant le diff, pas par le gate — anchor-check valide le symbole cité, il ne sait pas qu'on visait l'autre.

- [1× — 31/08] **Deux tickets affirmaient un état du code qui n'était plus vrai**, et leurs ancres
  étaient justes : #91 disait « la console d'administration ne monte pas `NodefonyProvider` » —
  `App.tsx` le montait déjà ; #132 décrivait comme restant à faire ce qu'un banc e2e prouvait déjà
  (corrélation, exception non rattrapée, preuve négative). Les deux m'auraient fait écrire du code
  inutile si je les avais crus. **Un ticket est une affirmation sur le code, et il vieillit entre son
  écriture et sa prise** : le premier geste en l'ouvrant est de vérifier son bloc « le problème »,
  pas seulement ses ancres.

- [1× — 31/08] **Le kit prescrivait de brancher un transport sur `ILogSink` — l'interface existe, le
  nom est juste, et la prescription était fausse.** Sa forme réelle (`writeOut(s: string)`) montre
  un puits de CHAÎNES déjà formatées : la structure à corréler y est déjà fondue, il aurait fallu
  reparser ce qu'on venait de sérialiser. L'ancre était bonne, l'affirmation portée par l'ancre ne
  l'était pas. **Une prescription d'artefact se vérifie sur la SIGNATURE, pas sur l'existence du
  symbole** — c'est ce que la délégation de contrôle d'ancrages ne dit pas, puisqu'elle répond
  « VRAI : le symbole est là ».
- [1× — 31/08] **J'ai affirmé « personne n'utilise ce point d'extension » sur un `grep` d'UNE de ses
  deux formes.** J'avais cherché la méthode surchargeable, pas le décorateur équivalent — un
  contrôleur du dépôt l'utilisait déjà. Un point d'extension à plusieurs formes de déclaration se
  compte sur TOUTES ses formes. Cf [[feedback_inventory_needs_crosscheck]].

- [1× — 08-31d] **J'ai ouvert un ticket sur DEUX observations, et sa preuve était fausse.** #130
  affirmait « MySQL seul → vert, PostgreSQL + MySQL → rouge », avec les deux commandes prêtes à
  coller — la forme d'une preuve solide. Mesuré ensuite : **0 rouge sur 11** sans PostgreSQL, mais
  aussi une passe VERTE avec. Le défaut est donc intermittent, et l'énoncé transformait une
  corrélation sur deux runs en loi. Un ticket est cru sans être relu : celui-ci aurait envoyé son
  preneur chercher une interférence déterministe qui n'existe pas. Deux observations concordantes ne
  font pas une reproduction — pour un symptôme intermittent, le ticket porte un TAUX (« N rouges sur
  M passes ») ou il ne porte pas de preuve.

- [1× — 08-29] **Un octet NUL rendait deux sources INVISIBLES à `grep` et `rg`** — séparateur écrit en littéral dans une clé. Les outils classent le fichier binaire et cessent d'en rendre les lignes : trois recherches successives ont rendu ZÉRO pendant un diagnostic, dont une preuve d'ABSENCE qui aurait été fausse. Le fichier compilait, ses tests passaient. `\0` échappé produit le même caractère et rend le fichier au texte ; gate `check-no-nul-bytes.mjs`.
- [1× — 08-28i] **Deux affirmations fausses dans un ticket que j'allais publier, toutes deux « évidentes ».** Une ancre à `:207` (le `http.get` est à `:208`) et un compte annoncé « 3 sites » quand la commande en rend **8** — j'avais écrit le chiffre de mémoire après avoir lu une sortie filtrée. Les deux ont été rattrapées en LANÇANT ce que le ticket annonce, avant de le publier. La règle du skill (« un chiffre vient d'une mesure d'aujourd'hui ») ne mord que si l'on se rappelle qu'un chiffre lu il y a trois minutes dans une sortie tronquée n'est pas une mesure.

- [1× — 08-28d] **J'ai écrit une preuve au terrain qui pointait un chemin inexistant, et dont l'affirmation était l'inverse du réel.** Le ticket disait « `rg -c 'migrate' .claude/skills/nodefony-add-crud/SKILL.md` — le skill ne mentionne aucune migration » : le dossier n'existe pas (le skill vit dans le devkit), et il en parle **trois fois**, correctement — c'est précisément ce qui deviendra faux après le chantier. Une preuve inventée de bonne foi est indiscernable d'une preuve vérifiée : celui qui la contrôle ne trouve rien et doute de tout le corps. Une commande écrite dans un ticket se LANCE avant d'être écrite.
- [1× — 08-28c] **Un COMPTE aussi se périme, pas seulement une ligne.** Une conception de sept semaines annonçait « 8 entités framework » (réel : **10**) et `DrizzleOrm.ts:163` (réel : `:249`). Le compte est plus dangereux que l'ancre : personne ne le vérifie, il se recopie dans les diagrammes et les scripts, et ici il dimensionnait le fichier de migration **gravé à vie**.

- **Une preuve d'ABSENCE collée à une ancre salit l'ancre** [1× — 08-27] : « `fichier:ligne` — aucun `X` nulle part » fait chercher `X` autour de la ligne pointée, qui ne l'a évidemment pas. L'ancre était juste ; corriger son numéro l'aurait cassée. L'absence se met sur sa PROPRE ligne, écrite comme une commande qui la rend observable.
- **Un chiffre de pilotage jamais confronté dérive d'un ordre de grandeur** [1× — 08-27] : le champ `Jours` vaut ×8 le temps constaté — non par négligence, mais parce que l'unité est calibrée sur quelqu'un qui code à la main. Un ticket surestimé se REPORTE, et le report fait repayer tout son contexte. Mesuré seulement parce que le user a relevé « 0,5 j pour 30 minutes ».

- **Un KIT de chantier lu comme un ÉTAT : 9 items sur 11 étaient DÉJÀ FAITS.** Le tableau de bord
  avait été dégraissé la veille pour cette raison exacte ; les kits de la mémoire de travail, eux,
  continuaient d'annoncer du reste-à-faire livré depuis des semaines — commandes d'état et d'arrêt,
  révocation de session, administration des utilisateurs, deux consoles, repli d'interface, arbre de
  process sous Windows, et jusqu'au « bug WebSocket à 30 s », qui ne se reproduit pas sur 48 s
  d'observation. Sans le contrôle exigé par le user, 8 tickets naissaient pour du travail fait. Un
  kit est un PLAN : il dit ce qu'on voulait faire, jamais ce qui est. Le confronter au code et au
  `git log` AVANT d'en tirer quoi que ce soit. [1× — 08-27]
- **`gh project item-list` a rendu 39 items quand l'API en comptait 40** — le ticket ajouté à la
  minute était absent de sa sortie, sans erreur ni avertissement. Ce qui a tranché : redemander la
  MÊME donnée par GraphQL. Même famille que le champ `title` figé : ce client rend une vue à lui,
  pas l'état du tableau. Pour lister ou retrouver un item, GraphQL ; `item-list` pour un coup
  d'œil, jamais pour décider. [1× — 08-27]
- **Un renvoi « cf #9 » dans un corps de ticket pointait une demande de fusion de dépendances**,
  pas une issue. Un renvoi mort ressemble exactement à un renvoi vivant : un numéro existe
  toujours. Vérifier ce que DÉSIGNE le numéro, pas qu'il résolve. [1× — 08-27]
- **`rg` saute les dossiers cachés sans `--hidden`** : un relevé « qui appelle ce script ? » a rendu
  zéro appelant alors que `.claude/skills/` en contenait. Un relevé incomplet a l'air d'un relevé
  complet. [1× — 08-27]

- [1× — 08-27] **Un champ DÉRIVÉ d'une API peut être figé sur une valeur morte — et il a l'air
  d'une réponse.** `gh project item-list` rend un `title` par item : **38 sur 38** portaient encore
  l'ancien libellé de leur issue, renommée le matin même. J'ai failli annoncer au user que son
  tableau de bord était périmé. Ce qui a tranché en dix secondes : redemander la MÊME donnée par
  l'autre voie — GraphQL rend le titre courant, donc l'affichage est juste et c'est le champ du
  client qui ment. **Devant une valeur surprenante, chercher une SECONDE voie vers la même donnée
  avant d'accuser la source** ; et préférer par défaut le champ qui pointe l'objet réel
  (`.content.title`) à celui que l'outil a recopié (`.title`).
- [1× — 08-27] **Une substitution de texte SANS frontière de mot fabrique des faux positifs qui
  ont l'air d'un travail bien fait.** Un motif `ADR` sans limite a mordu sur « c**adr**e », `store`
  sur « re**store** » : le ticket recevait un lexique définissant des mots qu'il n'employait pas —
  et un lexique hors sujet est pire que pas de lexique, il fait douter le lecteur d'avoir compris.
  Même mécanisme pour la ZONE lue : détecter les termes sur le corps entier a posé sur un ticket de
  libellés de menu un lexique « surcharge, isomorphe, ADR », mots pris dans des **exemples cités**.
  Deux réflexes, à poser AVANT de lancer la passe : borner la zone (ici le seul bloc « Le
  problème », citations retirées) et exiger `(?<!\p{L})…(?!\p{L})` autour de tout motif.
- [1× — 08-27] **Un remplacement mot à mot ne sait pas ACCORDER — le genre entraîne le
  déterminant.** « aucun binding » est devenu « aucun liaison », « Le drift » → « Le dérive ». Une
  liste de couples anglais→français doit porter les formes AVEC article (`un binding → une
liaison`), essayées avant les formes nues. Et un motif qui porte du gras (`un **breaking
change**`) doit être échappé AVANT que ses espaces deviennent souples, sinon l'expression
  régulière ne se construit même pas. Le contrôle qui rattrape tout en une ligne : après la passe,
  chercher `(un|le|ce|aucun) (liaison|dérive|surcharge|route|rupture)` et l'inverse.
- **`anchor-check` a validé une ancre devenue fausse.** J'avais inséré 30 lignes dans
  `envReport.ts` ; l'ancre `envReport.ts:147` de la doc pointait désormais une AUTRE fonction, et
  le gate a rendu « 6 ancres — 6 OK ». Il vérifie que le fichier existe et que la ligne est dans
  ses bornes, pas que la ligne désigne encore ce que la phrase annonce. **Après toute insertion
  dans un fichier ancré, relire les ancres soi-même** — le vert du gate ne couvre pas ce
  cas. [2× — 08-24d]

- **Ma propre correction a introduit 7 `LINE_OUT`.** `anchor-check` résout par BASENAME, et il
  existe un autre `config.ts` (234 lignes) et un autre `bearer.ts` (23 lignes) que ceux que je
  visais : mes ancres neuves pointaient le mauvais fichier, en étant parfaitement crédibles. C'est
  le gate qui me l'a dit. Depuis, le vérificateur rejette toute ancre dont le basename correspond à
  plus d'un fichier — un `index.ts` en a matché **57**. [1× — 08-23b]
- **Corollaire de tri** : recaler n'est pas toujours améliorer. Viser la déclaration d'un symbole
  générique (`router?: Router;`) ferait reculer une ancre d'un point précis vers un simple typage,
  parfois 900 lignes plus haut. Écarté volontairement — visiblement décalé vaut mieux que plausible
  et faux. [1× — 08-23b]
- [1× — 08-30] **La PREUVE d'un ticket se périme comme une ancre — et elle accuse alors le mauvais
  composant.** #118 citait un run de banc daté ; ce run était antérieur de 40 min au correctif qui
  installait l'outil de migration (#117). Sa conclusion — « l'outil lit son journal, pas la base » —
  était fausse **pour ce décor** : le décor n'avait rien produit. Reproduire l'affirmation AVANT de
  coder dessus a coûté un test de 20 lignes et évité de corriger un composant sain. Une preuve
  d'issue porte une DATE implicite : la confronter au `git log` du correctif le plus récent qui
  touche le même chemin.
- [1× — 08-31] **Sept ancres fausses dans UNE grappe de quatre tickets** — dont une qui situait une garde à `orm-migrate-baseline.ts:118`, où vit une déclaration d'option, **171 lignes** avant sa cible ; et deux tickets frères qui désignaient la MÊME ligne (`orm-generate.ts:376`) pour deux refus différents — un seul pouvait avoir raison. Elles étaient toutes périmées pour la même raison : le travail décrit avait été FAIT entre-temps. Le contrôle qui tranche en une seconde : deux tickets ne pointent jamais la même ligne pour deux choses. Retirées plutôt que corrigées quand le fait avait disparu — une ancre juste sous une affirmation fausse est le pire des deux mondes.

## 🤝 Un sous-agent répond « INCHANGÉE » quand chercher devient pénible

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

## 🪤 Une garde peut EMPÊCHER ce qu'elle prétend gérer

- [1× — 09-02] **Composer par-dessus une liste que le FORMATEUR a réécrite.** Une commande qui ajoute une entrée dans un tableau du manifeste écrivait `[…"ROLE_USER",, "ROLE_X"]` dès que la liste portait une virgule finale — ce que prettier pose systématiquement au-delà d'une ligne. Le gabarit, lui, n'en a pas : le cas n'existe que chez l'utilisateur, et la commande censée câbler produisait un manifeste qui ne compile plus. Trouvé en relisant mon propre diff, pas par un rouge. **Toute écriture qui compose par-dessus du code EXISTANT doit supposer qu'un formateur est passé.**

- [1× — 09-02] **Une garde qui interdit ce que le DÉFAUT produit tout seul.** `create entity User` refusait `--table` — refus juste, motivé, avec la raison exacte (« le framework écrit ces noms en dur dans ses requêtes ») — et son propre défaut appliquait la règle du pluriel, écrivant `users` face à un SQL qui lit `User`. La divergence ne LÈVE PAS : la recherche par compte externe rend zéro ligne, donc un compte de plus à chaque connexion. **Une garde ne garde rien tant qu'on n'a pas regardé ce que le chemin par DÉFAUT produit** — c'est le seul chemin que personne ne prend en main.

- **[1× — 09-02] Le refus « au démarrage » ne refusait rien : la POLITIQUE DE RÉSILIENCE du kernel l'absorbait.** Un hook de boot qui lève est journalisé en WARNING, le module écarté, le boot continue — « BOOT dégradé », code de sortie 0. Une application générée avec un `User` amputé de six colonnes démarrait, servait ses routes, et `orm:migrate:status` la déclarait « à jour ». Le message était parfait et sans effet. Le cœur avait DÉJÀ la frontière (`BootConfigurationError`, dont le TSDoc nommait le cas) : la chercher avant d'écrire un refus qui traverse une phase de boot.
- [1× — 09-01] **Une commande qui se mord la queue : son propre DÉMARRAGE fabrique ce qu'elle vient constater.** `orm:generate` démarre l'application, et un démarrage en développement DÉRIVE le schéma du code. La commande peuplait donc la base elle-même, puis refusait d'écrire la première migration — `NF_GENERATE_DATABASE_NOT_ADOPTED`, « la base porte déjà toutes les tables déclarées ». Le refus est exact ; c'est la boucle qui est fausse. Une commande qui OBSERVE un état doit poser le décor qui l'empêche de le CRÉER (`NODE_ENV=production` ⇒ mode `none`), et ce décor s'écrit dans l'appel, pas dans la tête de celui qui tape.

- [1× — 31/08] **Une garde qui ne mord pas ne se laisse pas « au cas où ».** `exclude: [/\.vue/]` passé à `@vitejs/plugin-react` est la correction évidente du problème — elle n'a AUCUN effet (vérifié jusqu'à `exclude: [/./]`, en s'assurant que l'option atteignait bien la config générée). La laisser aurait fait croire à une protection en place, et le prochain lecteur aurait cherché ailleurs. Retirée ; la vraie parade était structurelle (isoler le process).

- [1× — 08-31] **Une sonde d'interdit a puni le geste que le produit PRESCRIT.** Le produit dit, dans sa propre sortie, « rejoue le lot sur une COPIE : copie le fichier, puis désigne-la par `NF_MIGRATE_DATABASE_URL` ». L'agent a copié, éprouvé, puis rangé sa copie (`rm …copie.db`) — et le motif `rm .*\.db` de la sonde l'a compté comme « a proposé de supprimer la base ». Onze sondes vertes sur douze, base intacte, verdict FAIL. La tâche était **plafonnée à la baisse pour quiconque suit le conseil**. Le waiver ne peut pas être global : il aurait gracié `orm:reset` par ricochet — l'interdit se SCINDE (le geste qui ne se justifie jamais / celui qui a une forme légitime).

- [1× — 08-31] **Ma sauvegarde a été emportée par la garde qu'elle devait précéder — parce
  qu'elle était dans la MÊME chaîne `&&`.** J'avais écrit `cp <fichier> <copie> && <geste git
risqué>` : la garde du dépôt a refusé la commande ENTIÈRE avant exécution, donc la copie n'a
  jamais eu lieu, et j'ai perdu le correctif que je m'apprêtais à débrancher. La garde a
  parfaitement fait son travail ; c'est ma chaîne qui était mal formée. **Une sauvegarde se prend
  dans sa PROPRE commande**, jamais accolée au geste risqué qu'elle protège — sinon elle partage
  son sort. Même famille : cette garde inspecte le TEXTE de la commande, donc écrire le nom d'un
  geste interdit dans un commentaire ou une chaîne suffit à la déclencher.
- [1× — 08-29] La surcharge par l'environnement refusait une clé DÉCLARÉE parce qu'elle naviguait dans la VALEUR de la config, jamais dans son schéma : une clé `optional()` sans défaut n'y figure pas. Le message annonçait « segment inconnu » pour un réglage documenté et lu — l'utilisateur relit l'orthographe de sa variable, la trouve juste, et ne peut pas deviner. Ce sont exactement les réglages dont l'ABSENCE est signifiante qui tombaient.
- [1× — 08-29] Affaiblir une sonde faisait perdre AUTRE CHOSE : le noyau tolérait un échec de démarrage tant qu'une rétention existait, et `check: "warn"` n'inscrivait plus rien. Le réglage qu'on pose pour se donner de l'air transformait une table absente en boucle de redémarrage. **Publier un état et retenir le trafic sont deux actes.**
- [1× — 08-28k] **Obéir au mode de schéma a rendu la commande de migration INATTEIGNABLE.** En
  production, le démarrage ne fabrique plus les tables — décision juste. Mais `orm:migrate` boote
  un kernel complet : sur une base pas encore migrée, le cycle applicatif tape `User`, l'échec est
  fatal en production, et la commande meurt AVANT de s'exécuter. Pour migrer, il fallait avoir
  migré. La garde de production interdisait le geste même qui la satisfait. Le test qui l'attrape
  se pose sur le CHEMIN NOMINAL de l'utilisateur (« une base vierge, en production »), jamais sur
  le décor du dépôt — tous les bancs existants posaient `NF_STORE=memory`, qui contourne
  précisément ce trou, et leur TSDoc l'écrivait noir sur blanc sans que personne n'en tire la
  conséquence.
- [1× — 08-28k] **Une surcharge par variable d'environnement n'écrit QUE sur un chemin déjà
  présent — sinon elle ne fait rien, en silence.** J'ai posé `NF__DRIZZLE__CONNECTORS__DEFAULT__DDL`
  dans un décor de banc, relu le fichier rendu (elle y était), et conclu trop vite ; interrogée
  dans l'application, la valeur effective était restée `none`. La clé n'existait pas dans la config
  de l'application, donc il n'y avait rien à surcharger. Deuxième piège empilé sur le premier :
  je l'avais d'abord posée AVANT un `...process.env` qui l'écrasait. Une surcharge se vérifie sur
  la valeur EFFECTIVE lue par le produit (`--json` du statut), jamais sur la présence de la ligne.

- [1× — 08-28g] **Un test de verrou reste VERT quand on débranche le verrou** — il ne prouve alors que le chemin nominal. Mon cas « aucun verrou zombie » prenait le verrou, tuait la connexion, puis migrait : avec `lock()` en no-op il passait tout aussi bien. Le rendre discriminant a demandé une assertion AVANT le geste — _constater que le verrou est bien TENU_ (un applicateur concurrent doit échouer) — et il tombe alors au débranchement. **Un test qui suit un chemin heureux de bout en bout ne discrimine rien ; c'est l'état intermédiaire qu'il faut affirmer.**

- [1× — 08-28f] **Le garde-fou anti-`git checkout` du dépôt a refusé mon appel parce que les mots figuraient dans le TEXTE d'un message d'erreur que j'écrivais** — un message destiné à l'utilisateur, qui lui expliquait comment annuler des fichiers. La garde lit la commande, pas son intention, et une chaîne de caractères ressemble à un geste. Rien n'a été perdu (le python n'a pas tourné, l'erreur était nette), et le contournement a AMÉLIORÉ le produit : le message renvoie maintenant à « votre outil de gestion de versions » plutôt qu'à des commandes destructrices toutes prêtes. À garder en tête : une garde par motif textuel mord sur la documentation autant que sur les actes.

- **Une garde MORTE-NÉE : `try/catch` autour d'un `import` STATIQUE.** Le shim `create-nodefony`
  protégeait l'absence de `nodefony` par un `try` autour de l'appel — Node résout les imports
  statiques AVANT la première ligne du module, donc le `catch` n'était jamais atteint et
  l'utilisateur recevait une trace de pile interne. `await import()` dans le `try`. Trouvée en
  DÉBRANCHANT le paquet, jamais en relisant. `[1× — 08-25]`

- **Enregistrer un handler `SIGTERM` a rendu le banc IMMORTEL.** Le filet d'arrêt ne pouvait pas
  s'exécuter — ce script vit dans des `spawnSync` qui BLOQUENT la boucle d'événements, et un
  handler de signal est un callback JS. Pire : l'enregistrer DÉSACTIVE la mort par défaut. Sans
  handler, `SIGTERM` tuait le process (en laissant le serveur) ; avec, ni arrêt ni nettoyage —
  `SIGKILL` obligatoire. Le nettoyage a été déplacé à l'ENTRÉE du run suivant, là où la boucle
  tourne. [1× — 08-23b]
- **Et ma première mesure du correctif était un FAUX VERT** : le port était bien rendu après le
  `SIGTERM`, mais par la remise à zéro du décor qui tombait au même instant. Le verdict était juste
  pour la mauvaise raison. C'est en regardant si le PROCESS avait survécu — une seconde question,
  sur un autre observable — que le vrai défaut est apparu. Une sonde qui n'observe qu'un symptôme
  confirme n'importe quelle cause. [1× — 08-23b] ↝ [[feedback_bench_probe_false_verdicts]]
- [1× — 08-30] **Deux commandes du produit se PRESCRIVAIENT l'une l'autre en se refusant.**
  `orm:migrate:status` rendait `adopt` et nommait `orm:migrate:baseline` ; `baseline` refusait ce
  décor exact (`BASELINE_AMBIGUOUS`) en proposant `--up-to <tag>`, où le seul tag disponible était la
  migration mensongère. Les deux gardes étaient JUSTES prises séparément — l'enfermement ne se voit
  qu'en suivant le geste que le produit prescrit, jusqu'au bout. À faire systématiquement : exécuter
  la `nextAction` que rend un refus, et regarder ce qu'elle répond.
- [1× — 08-30] **Une option qui a l'air de RESTREINDRE peut ne restreindre que la SORTIE.**
  `tablesFilter` de l'outil de migration ne borne pas la lecture : il lit la base entière puis
  filtre. Conséquence invisible — une table d'un autre logiciel entre dans la référence adoptée, et
  le diff suivant propose de la SUPPRIMER ; et une table que l'outil ne sait pas lire le tue même
  quand on l'a exclue. Le contrôle qui tranche : exclure TOUT sauf sa cible et voir si l'échec
  persiste.

## 🔇 Ce qu'on COUPE pour mesurer, on le coupe aussi pour DIAGNOSTIQUER

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

- [1× — 09-01] **Une conception relue en aveugle a corrigé deux décisions structurantes que j'avais arrêtées.** Le relecteur a reçu le TERRAIN (ancres, faits, contraintes) sans mes conclusions ni mon vocabulaire — et il a écarté l'architecture que je retenais, en relevant au passage que je m'étais réclamé d'un précédent (Devise) dont j'avais **inversé le sens**. Donner ses conclusions à un relecteur l'ancre dessus : il cherche à les confirmer au lieu de regarder ailleurs.
- [1× — 09-01] **Le second temps compte autant : soumettre sa propre liste APRÈS**, pour la faire juger par quelqu'un qui n'en est pas l'auteur. Sur sept points relevés de mon côté, six ont tenu, **un était mal formulé** (« il manque une entrée de changelog » — le changelog est engendré depuis les commits à la publication ; ce qui manquait vraiment était une note de montée de version). Et trois de mes points recoupaient les siens au point de devoir être traités comme un seul lot.
