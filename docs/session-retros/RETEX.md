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

## 🎲 Ce qui varie d'un run à l'autre EST la mesure — pas le verdict

- `[1× — 2026-07-30]` 🔴 **Un banc à verdict binaire joué UNE fois ne dit rien.** T14 rejouée 4×,
  gabarit identique, même modèle, même décor : **2 PASS / 2 FAIL**, 68→98 tours. J'avais écrit le
  matin « la correction est prouvée » sur un seul PASS. Ce qui reste concluant sur un run unique,
  c'est une **sonde de contenu** (binaire, sans seuil) : façade employée 4/4 après vs 0/1 avant.
  Toute mesure d'effort = médiane ≥ 3 runs. Corollaire de coût : répondre à « un gros modèle
  tourne-t-il moins en rond ? » demande ~6 runs, pas 2 — l'estimation initiale était 3× trop basse.
- `[1× — 2026-07-30]` **Un chiffre qu'il faut aller chercher au `jq` n'agit pas.** Le harnais
  publiait déjà tours/durée/coût en fin de transcript ; personne ne les lisait. Même leçon que pour
  les agents, appliquée à moi : l'information doit être là où le regard passe déjà.

## 🔍 Un INVENTAIRE n'est exhaustif que par CROISEMENT — ni le modèle ni l'automate seul

- `[1× — 2026-07-30f]` 🔴 **Les deux sens d'erreur se sont produits sur le MÊME inventaire.** Un
  sous-agent `haiku` a dressé la surface de sécurité du framework ; le doute du user (« tu es sûr
  que tout est couvert ? ») a été tranché par les schémas Zod : **12 briques manquées**
  (`trustedHosts`, `maxBodySize`, `upload.*` côté http ; `csrf.checkOrigin`, `limits`,
  `slowConsumer` côté realtime ; `passkeys`, `totp`, `webhooks`, `audit`, `tokenStore` côté
  security). **Mais** `.ai/symbols.json` rate `@CsrfProtect`/`@CsrfExempt` — déclarés
  `const X = booleanMarkerDecorator(...)`, forme que le générateur ne capte pas — que le modèle,
  lui, avait vus. Le modèle SURVOLE, l'automate a des ANGLES MORTS de forme. Croiser les deux, et
  ne jamais présenter un inventaire de modèle comme une couverture.
- `[1× — 2026-07-30f]` **Le déclencheur n'est pas venu de moi mais du user.** J'avais relayé le
  tableau du sous-agent sans le recontrôler, alors que la règle « vérifier avant de répercuter »
  est écrite. Un inventaire rendu par un modèle se recontrôle par `jq`/`rg` **avant** d'entrer
  dans une synthèse — le coût est de deux commandes.

## 🛡️ Mesurer qu'on POSE une garde ne dit rien sur celle qu'on RETIRE

- `[1× — 2026-07-30f]` 🔴 **Six tâches de banc écrites, toutes aveugles au mode d'échec le plus
  grave.** Elles vérifiaient qu'un agent AJOUTE une protection ; aucune n'attrapait le geste
  inverse — `unsafe-inline` en CSP, `@CsrfExempt`, `@BypassFirewall`, `maxBodySize: 0` — qui fait
  marcher la fonctionnalité ET passe les tests. Toute mesure de sécurité a besoin de sa famille
  « ne pas affaiblir » : sondes INVERSÉES sur le diff, portes de sortie du framework énumérées.
  Vaut au-delà du banc : une revue qui ne cherche que l'ajout ne voit pas le retrait.
  **Traité** au banc (T22/T23/T24, `6d728c33`) ; la leçon reste pour toute revue.
- `[1× — 2026-07-31]` 🔴 **Le témoin d'un « ne pas affaiblir » doit être HORS de l'énoncé.** Un
  agent peut ouvrir la zone de firewall entière ET garder un `@IsGranted` sur SA route : celle
  qu'on mesure refuse alors correctement l'anonyme, pendant que tout le reste est devenu public.
  Ce qui tranche est une ressource que le générateur pose, que l'énoncé ne mentionne pas et que
  l'agent n'a aucune raison de toucher (`/api/secure/hello`) — elle ne peut s'ouvrir que par la
  garde COLLECTIVE. Généralisation : une garde partagée ne se mesure jamais sur l'objet qu'on
  vient de modifier ; il faut un témoin qui n'était pas dans le périmètre.
- `[1× — 2026-07-31]` 🔴 **L'échantillon VERTUEUX d'une sonde de sécurité se copie du DÉFAUT du
  produit.** La CSP servie par défaut porte `style-src 'self' 'unsafe-inline'` : une sonde qui
  cherche `unsafe-inline` dans l'en-tête entier recale TOUTE application, intacte comprise, avec
  un rouge parfaitement crédible (« l'agent a desserré la CSP »). Le réflexe : avant d'écrire un
  interdit, lire ce que la configuration par défaut contient DÉJÀ, et en faire l'échantillon qui
  doit passer.

## 🎚️ Une sonde de PROXIMITÉ se règle sur ce qu'elle traverse

- `[1× — 2026-07-30g]` 🔴 **Écrite à 200 caractères, la fenêtre franchissait une action entière.**
  La sonde « la garde est posée sur l'action destructrice » cherchait `@IsGranted` à moins de 200
  caractères d'un `@Delete` : un `@IsGranted` posé sur la LECTURE la satisfaisait — précisément le
  contournement qu'elle devait voir. Deux décorateurs empilés sont ADJACENTS (au plus un
  `@HttpCode` entre eux) : fenêtre ramenée à 60. C'est l'échantillon `fail` de l'auto-contrôle qui
  l'a montrée, pas la relecture. Généralisation : toute regex à fenêtre (`{0,N}`) doit justifier
  son N par ce qu'elle a le droit de FRANCHIR, jamais par « ça devrait suffire ».
- `[1× — 2026-07-30g]` **Le réflexe qui sauve : quand un échantillon recale la sonde, suspecter la
  SONDE.** La tentation immédiate a été d'allonger le remplissage de l'échantillon pour qu'il
  cesse de matcher — c'est-à-dire ajuster la preuve pour plaire à l'instrument.
- `[1× — 2026-07-31]` 🔴 **Une classe négative qui exclut les DÉLIMITEURS de la valeur cherchée
  rend la regex aveugle à sa cible.** `(?:script-src|default-src)[^;"'\n]*'unsafe-inline'` ne peut
  jamais aboutir : une valeur de directive CSP est FAITE d'apostrophes (`'self'`, `'nonce-…'`), et
  la classe s'arrête à la première. Seul le `;` devait borner (il sépare `script-src` de
  `style-src`). Trouvé par l'échantillon `fail`, pas par la relecture — comme la fenêtre de 200.

## 🔗 Deux gabarits rendus à des MOMENTS différents ne partagent rien tacitement

- `[1× — 2026-07-30g]` 🔴 **Le trou était dans le NOM de la clé, pas dans la logique.** Le décor
  e2e d'une app est rendu à sa création, le test e2e d'une entité des jours plus tard — et le
  second importe un helper du premier. `hasSecurity` n'était passé qu'au rendu de l'`AGENTS.md` ;
  le layer de base ne connaissait que `complete`. Résultat : garde émise côté entité, helper
  absent côté app, import mort. **Seul le typecheck du code GÉNÉRÉ l'a dit** — aucun test du
  dépôt, qui lit des chaînes dans des fichiers rendus, ne pouvait le voir. Corollaire : quand deux
  gabarits doivent s'accorder, ils lisent la MÊME clé, et le contrôle est la compilation du
  produit, pas la relecture du gabarit.

## 🧪 Suspecter son INSTRUMENT avant le sujet mesuré

- `[1× — 2026-07-31c]` 🔴 **La suggestion d'un linter peut INVERSER la sémantique — la lire, pas
  l'appliquer.** `filter(…).pop()` a déclenché `prefer-array-find`, dont l'aide propose `find()` :
  or le code veut le DERNIER élément, et `find` rend le premier. Le décor serait reparti du mauvais
  commit **en silence**, sans faire échouer un test. Le bon correctif (`findLast`) éteint la règle
  ET garde le sens. Un linter raisonne sur une forme, jamais sur l'intention — et l'intention était
  écrite juste au-dessus, en commentaire. Cf [[feedback_code_rewrite_mechanical_traps]].
- `[1× — 2026-07-31c]` 🔴 **Un contrôle VERT ne prouve rien s'il ne peut pas distinguer la faute.**
  Le contrôle de la remise à zéro rend 5/5 avec `find` comme avec `findLast` : restaurer depuis une
  remise à zéro produit le même arbre que depuis la création. Il fallait prouver sur le **hash
  choisi** (`ff38058` contre `c02b83c`), pas sur le résultat. Avant de s'appuyer sur un vert, se
  demander : _ce contrôle serait-il rouge si la faute était là ?_
- `[1× — 2026-07-31c]` 🔴 **Un échantillon qui ne reproduit pas la MATIÈRE réelle valide le
  contraire de ce qu'il croit.** L'auto-contrôle d'un waiver plaçait la commande attendue dans
  `content` (le contenu des fichiers) alors qu'en conditions réelles elle vit dans le
  **transcript**. Résultat : échantillon vert, sonde cassée — elle recalait un agent qui avait
  lancé le générateur **8 fois**. Le garde-fou qui surveille les sondes tombe dans le même piège
  qu'elles : écrire l'échantillon dans la matière qu'on IMAGINE, pas celle que le juge lira.
  Vérifier d'où vient réellement la matière avant d'écrire le cas.
- `[1× — 2026-07-31c]` 🔴 **Un correctif d'instrument crée ses propres angles morts — les
  chercher AVANT de conclure.** La remise à zéro du décor entre tâches (correction d'un vrai
  défaut de validité) a rendu FAUSSE la matière `content`, lue sur le disque au moment du
  jugement : l'arbre ne portait plus que la dernière tâche. **17 tâches sur 25** en dépendaient,
  dont toute la famille sécurité — et aucune n'était dans la campagne en cours, donc le défaut
  était SILENCIEUX. Il aurait éclaté au premier run complet. Après toute refonte d'un instrument,
  se demander quelles autres matières l'hypothèse changée alimentait.
- `[1× — 2026-07-31c]` ⭐ **Re-juger coûte ZÉRO agent — y penser avant de rejouer.** Deux runs
  invalidés par un faux rouge ont été récupérés par `--analyze-only` avec le juge corrigé : la
  médiane est revenue sans relancer une seule fois le modèle (≈ 2 $ et 40 min économisés). Le
  transcript et le diff git étant conservés, tout verdict est recalculable ; ce qui coûte, c'est
  l'agent, jamais le jugement. Corollaire : ne jamais rejouer une campagne pour corriger une sonde.

- `[1× — 2026-07-31]` 🔴 **Un énoncé qui DÉCRIT une situation doit la trouver VRAIE.** T23 affirme
  « ses envois sont rejetés en 403 » — donc route montée — alors que l'app générée ne la porte
  pas. L'agent devait fabriquer la prémisse et tombait LÀ : 404 puis 422 ×3, quatre rouges
  crédibles, **zéro information sur la défense CSRF** qu'on prétendait mesurer. Le signe qui
  aurait dû alerter dès le 2ᵉ run : l'échec ne parlait jamais du sujet de la tâche. Remède : la
  prémisse se POSE avant l'agent (crochet `prepare`, outils du framework) et se COMMITE à part —
  sinon les sondes sur les lignes ajoutées prennent le décor pour son travail.
- `[1× — 2026-07-31]` 🔴 **Une liste recopiée dans une sonde diverge en silence — elle reste
  VERTE.** L'interrupteur `enabled: false` gardait 5 briques écrites à la main quand le module en
  déclare 13 : `rateLimit`, `audit`, `jwt`, `apiKeys`, `totp`, `passkeys`, `cors`, `webhooks`
  pouvaient être éteints sans qu'aucune tâche ne bronche. Et la plus grave n'est pas un hasard :
  **le rate-limit est la seule défense qui GÊNE l'agent pendant son travail**, donc la seule qu'il
  ait une raison immédiate d'éteindre — la porte la plus large était celle que personne ne
  gardait. La liste se DÉDUIT de sa source (schéma Zod) à chaque run. Cf [[feedback_single_source_rule]].
- `[1× — 2026-07-31]` **On ne travaille pas lourdement sur la machine qui MESURE.** Builds,
  `create app` et suites vitest lancés pendant un run : le décor n'a pas bouté en 15 s et une
  tâche a rendu `aucune-reponse`. Le juge a correctement nommé la cause (décor, pas agent) — sans
  ses causes, j'aurais cherché un défaut de CSP inexistant.
- `[1× — 2026-07-30f]` 🔴 **Un banc qui MESURE DÉJÀ le sujet peut être le faux vert.** La tâche
  « protège une route » existait (`bench-discoverability.mjs:226`) : des sondes de présence de
  chaîne, et un seul gate `npm test` — les tests que l'agent a écrits lui-même. Un `@IsGranted`
  sur la mauvaise action PASSE. Chercher ce qui existe AVANT de concevoir n'a pas seulement évité
  une duplication : ça a désigné le défaut. Corollaire : « ce sujet est couvert » se vérifie sur
  la SONDE, jamais sur le titre de la tâche.
- `[1× — 2026-07-30f]` **Un commentaire de test dit ce qu'il ATTEND ; seul le code dit ce qu'il
  FAIT.** Soupçon de brèche CSWSH (`realtime.csrf.checkOrigin.enabled=false` par défaut) : faux.
  Le socle `http-kernel.ts:1586` valide l'Origin de tout handshake, same-origin, close 1008. La
  conclusion « brèche » aurait produit une tâche de banc exigeant une protection inutile.
- `[1× — 2026-07-30e]` 🔴 **Un daemon de dev qui tourne RÉÉCRIT l'artefact qu'on s'apprête à
  mesurer.** Un `nodefony-dev-supervisor` vieux de 2 h 16 rebâtissait le core à chaque `Edit` : ma
  mesure « AVANT le correctif » sur le binaire lisait déjà l'APRÈS, et allait me faire conclure
  « le trou annoncé n'existe pas ». Le réflexe qui a sauvé la mesure — chercher POURQUOI l'ancien
  code se comportait bien, au lieu de croire le verdict — est le même que pour une sonde. Avant
  toute mesure par contraste : `ps` sur les process du projet, et vérifier la date/empreinte de
  l'artefact, pas seulement celle de la source. Ici le contraste utile est venu d'ailleurs : le
  DÉBRANCHEMENT du code neuf, qui ne dépend d'aucun artefact bâti.
- `[2× — 2026-07-30e]` **7 regex `.{0,90}` sur une ligne de 34 448 caractères = commande expirée
  à 2 min ; et un simple `rg -n` multi-fichiers qui touche cette ligne rend 35 KB d'un coup.**
  `MIGRATION_STATUS.md:150` fait 34 KB sur UNE ligne. Ne jamais l'inclure dans un `rg` exploratoire :
  le cibler seul, ou `fold -w 200` d'abord.
- `[1× — 2026-07-30c]` 🔴 **Un `trap … EXIT INT TERM` en zsh restaure PUIS REPREND la boucle.**
  Le script de banc a reçu son SIGTERM, remis le gabarit à HEAD… et continué à mesurer l'état
  BEFORE — c'est-à-dire à mesurer AFTER en croyant l'inverse. Il manquait `exit` : `trap restore
EXIT` d'un côté, `trap 'restore; exit 130' INT TERM` de l'autre. Un banc qui survit à son
  arrêt rend des chiffres, et ils sont faux.
- `[2× — 2026-07-30c]` **La sonde a lu le décor de la veille.** `ls -t <runRoot>/*/transcript`
  a rendu le run de 10 h (haiku) pendant que celui de 15 h montait encore son décor : « le modèle
  n'est pas le bon » — faux. Toute sonde qui cherche « le plus récent » se borne au run COURANT
  (`find -newer <marqueur du lancement>`).
- `[1× — 2026-07-30]` **Comparer une heure UTC à une heure locale fait conclure à un run bloqué
  depuis deux heures.** Les décors du banc s'horodatent en UTC ; `ELAPSED` de `ps` disait 9 minutes.
  Avant d'annoncer un blocage : lire un compteur, pas une soustraction de fuseaux.

## 🎯 Isoler UNE variable, sinon la mesure ne répond pas à la question posée

- `[1× — 2026-07-30c]` 🔴 **`git checkout <sha>~1 -- <fichier>` emporte TOUT ce qui a changé
  depuis, pas seulement le hunk visé.** Pour comparer deux états du gabarit `AGENTS.md`, revenir
  au fichier entier ramenait aussi un commit sans rapport (l'alias `doctor`) → deux variables au
  lieu d'une. Le geste juste : appliquer l'INVERSE du seul diff — `git show <sha> -- <f> | git
apply -R` — et **prouver que le geste a eu lieu** (ici : 0 façade dans les 30 premières lignes,
  3 ailleurs) avant de lancer quoi que ce soit.
- `[1× — 2026-07-30c]` **Le décor est une variable de la mesure : le prouver, pas l'espérer.**
  Empreinte `md5` de `git status --porcelain` relevée au DÉPART et à la FIN de la série de runs,
  identique → la comparaison tient. Sans ce relevé, « j'ai fait attention » n'est pas une preuve.
- `[1× — 2026-07-30c]` **Un `npm outdated` ne dit pas si la déclaration est un intervalle ou une
  version EXACTE — et ça change tout.** Ici les `peerDependencies` sont épinglées au patch près :
  monter `vite` à la racine seule aurait produit un conflit sur six paquets. Avant de planifier un
  bump : lire la FORME des déclarations, pas seulement les versions.
- `[2× — 2026-07-30b]` 🔴 **Un juge qui PRÉSUME un trajet recale une réponse juste.** Le juge de
  T16 frappait la route de LECTURE pour récolter le jeton CSRF ; le mécanisme est « une requête
  sûre vers une route **protégée** sème le cookie », et l'agent avait exposé une route dédiée —
  réponse juste, recalée. Remède général : **un juge DEMANDE à l'application** (`inspect routes
--json`) au lieu de supposer un chemin. Et la correction ne vaut que prouvée sur le **décor
  CONSERVÉ du run recalé** — un serveur jouet montre que le juge sait faire, pas qu'il a cessé de
  se tromper sur CE code.
- `[1× — 2026-07-30b]` **`spawnSync` BLOQUE la boucle du parent** : un banc d'épreuve qui lance un
  juge pendant qu'il sert lui-même les requêtes rend « aucune réponse » sur TOUTES les causes —
  rouge uniforme qui accuse le juge, alors que l'instrument est seul en cause.

## 📏 Une règle de contrôle se juge sur le CODE EXISTANT, avant d'y croire

- `[1× — 2026-07-30b]` 🔴 **Une garde « nom réservé » écrite puis retirée : 37 signalements, tous
  sur du code qui COMPILE.** Croyance : redéfinir `get`/`log` d'une classe de base casse.
  Réalité TypeScript : c'est légal tant que la **signature reste assignable** — le framework
  lui-même fait `override log(`. Le vrai défaut (TS2416) exige de résoudre l'héritage, les types
  et l'assignabilité : le travail d'un vérificateur de types, hors de portée d'une lecture PURE
  par regex, et **déjà fait par la compilation**. Ce qui manquait n'était pas un détecteur mais
  un TRADUCTEUR (l'erreur s'affiche sur la méthode, la classe casse sur `@services([X])`).
  Réflexe : avant de croire une règle neuve, la **lancer sur le dépôt entier** — 100 % de faux
  positifs ne s'affine pas, ça s'abandonne.

## 🤖 Piloter un agent TIERS : ce qui BLOQUE, et ce qui MENT

- `[1× — 2026-07-29]` 🔴 **Sans TTY, un CLI agentique peut LIRE stdin jusqu'à EOF.** `vibe`
  (`cli/cli.py:53`) : `if sys.stdin.isatty(): return None` — sinon `read()`, pour accepter un
  prompt en pipe. Lancé par un agent ou un CI, stdin n'est pas un TTY **et reste ouvert** → il ne
  rend jamais la main. Vécu : **9 min 33 d'horloge pour 1,07 s de CPU**, aucune session créée — le
  symptôme se lit comme « le modèle réfléchit ». Remède : `< /dev/null` sur toute automatisation.
- `[1× — 2026-07-29]` **Une sonde de banc encode un HARNAIS, pas un comportement.** `vibe` charge
  `AGENTS.md` **nativement** (walk-up « le plus proche gagne ») : aucun appel d'outil ne montre la
  lecture, donc la sonde « a lu AGENTS.md », écrite pour Claude Code, rend un **FAUX rouge**.
  Généraliser un banc à un autre agent, c'est revoir les SONDES — pas seulement le lecteur de
  transcript.

## 🟢 Un test NON EXÉCUTÉ doit être ROUGE, jamais vert

- `[1× — 2026-07-27]` 🔴🔴 **Le vert par défaut est un SILENCE, pas une preuve.** Trois formes du
  même défaut, toutes rencontrées le même jour : `npm test` sur drizzle sort **exit 0 avec 517
  tests sautés sur 901** (les deux dialectes de PRODUCTION) ; deux cas anti-bruteforce passés en
  `skipIf` comptent **verts** ; une vingtaine de preuves e2e ne sont **jamais lancées**, donc
  jamais rouges. **Position du user, à graver : s'ils ne sont pas lancés, c'est ROUGE.**
  ✅ **Fermé depuis** : `gateReporter` (`vitest.gates.ts:540`) est BLOQUANT quand `CI` est posé
  (`process.exitCode = 1`), branché dans 6 configs, avec `NF_GATES_ALLOW` pour énoncer une absence
  voulue au lieu de l'oublier. Ce qui reste vrai, c'est la règle : un skip compte comme vert, donc
  toute cible déclarée doit être exercée ou l'absence nommée.
- `[1× — 2026-07-27]` **`--reporter=json` REMPLACE la sortie lisible** → un gate tombe sans dire
  quel cas ni de combien. Reproduit **trois fois dans la même session** (banc mémoire, stores,
  realtime) après l'avoir corrigé le matin même sur `turbo --continue`. Toujours
  `--reporter=default --reporter=json`.

## 📦 Ce qui est COPIÉ à la création ne se met jamais à jour

- `[1× — 2026-07-28c]` 🔴 **Corriger la DOC sans corriger les GABARITS laisse le mensonge exactement là où il fait mal.** La veille : le hook d'un service s'appelle `init`, pas `initialize` — 4 docs IA + la page de référence corrigées. Les **deux gabarits** avaient été oubliés, et ce sont EUX qui atterrissent dans le code des utilisateurs : ils rendaient `async initialize()` sous le commentaire « appelé une fois par le conteneur, au démarrage ». Le kernel ne cherche que `init` → méthode morte, abonnements kernel qui dorment, **rien ne le signale**. Règle : quand une correction porte sur un FAIT du framework, la liste des cibles inclut les gabarits — et le gabarit prime, puisqu'il se recopie dans chaque app créée.
- `[1× — 2026-07-24]` ⭐ **Mon étagement release contredisait ma propre gate — le user l'a attrapé.** J'avais mis « entity bout-en-bout » APRÈS la release alors que le banc des 3 tâches (gate de 10.0.0) mord précisément sur ces trous. Deux leçons : (a) **vérifier qu'une gate définie ne mord pas sur ce qu'on reporte** ; (b) le critère de placement release pour tout artefact scaffold est l'**asymétrie de support** — le code généré est FIGÉ dans l'app à sa création (un fix 10.1 ne répare AUCUNE app née en 10.0.0), un module npm (Studio) se met à jour. Trancher par le support, pas par l'envie de sortir vite.

## 🧷 Un run vert ne typecheck rien — et tous les typechecks ne se valent pas

- `[2× — 2026-07-24]` **Des erreurs de type dans mes propres tests, invisibles en vert.** Vitest efface les types à la transpilation. 1ʳᵉ fois : un import pointait un type non exporté (TS2459), une conversion sautait `unknown` (TS2352) — c'est le **pre-push** qui a mordu. 2ᵉ fois : élargir le retour de `send` en `boolean | void` a cassé **6 stubs** `send: (f) => sent.push(f)` (une flèche concise renvoie le `number` de `push`) — suites 100 % vertes, `npm run typecheck` racine rouge. Pire piège : `npx tsc --noEmit` lancé DANS le module est vert, il ne couvre pas les mêmes fichiers. **Avant un push : `npm run typecheck` à la racine, pas le tsc du module.** Et **élargir un type de retour de callback casse les stubs concis**, jamais les tests.

## 🔇 Un mode machine qui coupe le journal coupe aussi les erreurs

- `[1× — 2026-07-26]` ⭐ **`--json` rendait une commande MUETTE sur échec** : `inspect <sujet> --json` sortait 0 octet, stderr vide, code 1, quand la base configurée était injoignable — l'appelant en concluait que l'app n'avait ni routes ni services (un agent a préféré inventer un chiffre plutôt que constater la panne). `initSyslog` retournait sans brancher AUCUN transport dès que `--json` était passé, alors que son propre commentaire promettait que « les erreurs partent sur la sortie d'erreur ». **Un commentaire n'est pas une garantie** : celui-ci décrivait un comportement que le code ne faisait pas, et le test qui gardait l'endroit affirmait « aucun listener ajouté » — il VERROUILLAIT le défaut, d'où son vert. Règle : `stdout` appartient aux données, `stderr` aux erreurs ; couper l'un ne doit jamais couper l'autre. (Cause racine du silence de boot : non trouvée → BUG-1.)

## 📖 L'API d'une bibliothèque maison se LIT — la supposer produit un vide silencieux

- `[2× — 2026-07-25]` ⭐ **Deux erreurs de suite sur la même lib de rapports, faute d'avoir ouvert le source.** `tabs()` attend `body`, j'ai passé `html` → les trois onglets sont sortis **vides**, sans une erreur : 35 Ko de page, zéro tableau, et le script « réussissait ». Puis `table()` s'est révélé **ne PAS échapper** ses cellules (elle accepte du HTML) alors que mes libellés contenaient des `<module>`/`<sujet>`. Le tell commun : un livrable qui se génère sans broncher mais dont le CONTENU manque. **Compter ce qu'on vient de produire** (`grep -c "<table"`) vaut mieux que faire confiance à un code de sortie — et la signature se lit dans la lib, elle ne se devine pas depuis un tableau de doc.

## 🗣️ Quand le user REPOSE la question, c'est ma réponse qui est fausse

- `[1× — 2026-07-27i]` ⭐⭐ **Trois fois la même question — « comment tu fais pour que le code s'améliore ? », « tu ajoutes quoi à chaque run ? », « il appelle pas create entity, comment tu fais ? »** — et trois fois j'ai répondu par la MÉTHODE (le protocole, l'isolation des variables, la boucle) alors qu'il demandait le **GESTE** : _qu'est-ce que tu écris, concrètement, entre deux runs ?_ La réponse qui a pris tenait en un tableau à deux colonnes — « ce que le banc a mesuré » → « ce que J'AJOUTE dans le framework » — avec la ligne de commande qui n'existe pas encore (`create entity --table account`). **Une question reformulée n'est pas une incompréhension du user : c'est le signal que je réponds à côté.** Réflexe : à la 2ᵉ occurrence, changer de REGISTRE (du pourquoi au quoi, de la prose au tableau, de l'abstrait à la commande exacte) au lieu de re-détailler la même chose.

## 📦 Surface npm & publication (chantier release en cours)

- `[2× — 2026-07-24]` **Le seul consommateur qu'on exerce n'est jamais celui qui a le problème.** Six paquets publiaient `exports["."].types → ./index.ts`, absent du tarball (`files:`) : invisible dans le repo self-hosted, cassé pour tout installeur npm. Vérifier une surface publiée = **dépaqueter le tarball** (`npm pack` + lire le manifeste), jamais lire le `package.json` du dépôt. Revécu via `--link` : le `node_modules` symlinké montre les SOURCES complètes (CLAUDE.md, `.ts`) — conclure de là ce qu'un installeur verra est faux ; raisonner sur `files:`.
- `[1× — 2026-07-23]` **`publishConfig.exports` n'est PAS appliqué par npm** (c'est pnpm/yarn). Testé avant de le proposer.
- `[1× — 2026-07-23]` **Un import non déclaré ne casse rien ICI et deux choses AILLEURS** : turbo ne peut pas ordonner le build, et le consommateur npm n'installe pas la dépendance. Auditer les imports de **valeur** (pas seulement de types) contre les `dependencies`.
- `[1× — 2026-07-23]` **Un contournement documenté peut cacher une contrainte RÉELLE — la vérifier avant de le retirer.** `exports.types → ./index.ts` avait l'air d'une paresse ; c'était l'anti-race du CLAUDE.md. 4 `clean && build` complets pour le prouver (le `dist` d'avant masque exactement cette panne).
- `[1× — 2026-07-27]` **Un scan de secrets saute les fichiers « binaires » sans un mot** (`rg` sans `-a`), et les fichiers publics doivent être vérifiés sur la **branche par défaut**, pas seulement sur celle où l'on travaille.

## 🗄️ Concurrence & atomicité (ce que le dialecte ne dit pas) — utile pour l'ORM S5

- `[1× — 2026-07-17]` **Un pool FROID masque les races** : le 1ᵉʳ écrivain (seule connexion chaude) finit avant que les autres aient leur TCP+auth → vert 3/3 sans le fix, structurellement. Chauffer (`Promise.all` de `count()`) avant de mesurer.
- `[1× — 2026-07-17]` **`ON CONFLICT (x)` n'arbitre QU'UN index** ; **MySQL n'a ni `RETURNING` ni `WHERE` sur ODKU** (tout upsert conditionnel y coûte 2-3 requêtes, donc une course) ; **un upsert reste un INSERT qui bascule** (colonnes `NOT NULL` obligatoires même quand la ligne existe).
- `[1× — 2026-07-17]` **La concurrence est un angle mort structurel des bancs** (séquentiels) : `Promise.allSettled` + tenir le travail ouvert, sinon les tâches se sérialisent et le bug ne sort jamais.
- `[1× — 2026-07-17]` **Les valeurs JOUETS ne prouvent rien sur le type d'une colonne** : `1000` passe partout ; `1_775_000_000_123` prouve le bigint, `INT32_MAX` trouve la borne.

## 🧨 Une commande composée refusée n'exécute RIEN — et le run suivant ment

- `[2× — 2026-07-25]` **Un maillon en échec dans une chaîne `&&` fait mentir la mesure d'après.** (1) Un `cd` relatif refusé a emporté le `cat >>` suivant : tests jamais écrits, « 12 passed » = le compte d'AVANT. (2) Ma contre-preuve dedupe : le `npm run build` du module échouait (tsgo refusait la valeur hors union) DANS la chaîne — le banc d'après mesurait l'ANCIEN dist et « prouvait » que le fix ne changeait rien. **Après tout échec dans une commande composée, considérer que RIEN d'aval n'a tourné** ; vérifier que l'artefact mesuré a bien été RÉGÉNÉRÉ (hash/mtime), pas seulement relancer la mesure.

## ⌨️ Un drapeau inconnu n'est pas une aide — il lance le run

- `[1× — 2026-07-31]` **`node bench-discoverability.mjs --help` a démarré un run COMPLET** (décor
  monté hors dépôt, tarballs installés, agent lancé sur la tâche 1) — le script n'a pas de
  `--help`, et tout argument non reconnu le laisse démarrer. Avant d'interroger un script coûteux :
  lire sa tête (`sed -n '1,40p'`), pas lui parler. Et un script qui monte un décor devrait refuser
  un drapeau qu'il ne connaît pas plutôt que l'ignorer.

## 🔎 Ce que le journal des commits CACHE

- `[1× — 2026-07-30]` 🔴 **Un correctif logé dans un commit au sujet étranger est invisible, et on le réécrit.** Le kill d'arbre Vite (chantier Windows) voyageait dans `2af71c0d`, dont le sujet annonce `fix(syslog)` : le kit a annoncé le trou OUVERT trois jours après sa fermeture, et une délégation entière est partie le refaire. Avant de reprendre un item de « RESTE » : `git log -S <symbole> -- <chemin>` — il retrouve ce que le sujet du commit ne dit pas. Corollaire : un kit décrit ce qu'on CROYAIT au moment de l'écrire, jamais l'état courant.
- `[1× — 2026-07-30]` **Deux trous « ouverts » d'un kit étaient corrigés depuis** (TSDoc `streamFile`/Range, exemple `@inject` du gabarit). Deux `rg` l'ont établi en une commande. Vérifier AVANT de planifier coûte moins cher que planifier puis découvrir.

## 📦 npm : un arbre réparé à la MAIN n'est pas une garantie

- `[1× — 2026-07-30]` 🔴 **Un `node_modules` remis droit à la main tient jusqu'au prochain `npm install`.** Le hissage `@angular/*` a été refait par déplacement de dossiers + rebasage du lock ; le patch suivant (22.1.1→22.1.2) l'a immédiatement ré-imbriqué et cassé `vite build`. La seule preuve qu'un lock TIENT est `npm ci` (rase `node_modules`, réinstalle strictement) suivi du build réel — `npm ls` propre ne prouve rien.
- `[1× — 2026-07-30]` **La cause était que le dépôt ne reproduisait pas la configuration que son PROPRE générateur produit** : le plugin déclaré à la racine, ses `peerDependencies` dans le module. npm ne les faisait coïncider que tant que les versions coïncidaient. Quand un défaut de résolution résiste, comparer avec ce que `create app` écrit — c'est la configuration de référence.
- `[1× — 2026-07-30]` **`npm run build` vert ne dit rien du chemin réel** : le script du module passait pendant que `npx vite build` (le chemin qu'emprunte le serveur de développement) échouait en `ERR_MODULE_NOT_FOUND`. Éprouver la commande que le RUNTIME lance, pas celle du `package.json`.

---

## 🗄️ Archivé au CONSOLIDATE du 2026-07-30 — 59 thèmes, 190 frictions

Texte intégral : **`archive/RETEX-snapshot-2026-07-30.md`** (805 lignes). Rien n'est perdu ; ce qui
suit dit seulement où la leçon vit désormais.

**Gradué en mémoire durable** — 9 frictions ≥ 3× promues, puis retirées d'ici :

| Leçon                                                         | Vit désormais dans                       |
| ------------------------------------------------------------- | ---------------------------------------- |
| exemple de CODE > prose > TSDoc ; tête de fichier = rare      | `feedback_agent_example_over_prose`      |
| la sonde du banc est le premier suspect ; faux vert = pire    | `feedback_bench_probe_false_verdicts`    |
| un fichier gitignoré ne tient que chez soi                    | `feedback_gitignored_breaks_clone`       |
| instruments faux · câblage débranché · contrôle non déclenché | `feedback_gate_must_bite` (3 volets)     |
| preuve négative sur une règle NORMATIVE                       | `feedback_gate_must_bite` (How to apply) |
| une capacité se CONSTATE, jamais depuis `process.platform`    | `feedback_cross_platform_axioms`         |

**Chantiers clos, leçon intégrée au code / aux skills** : CI assainie (lint câblé et verrouillé,
analyse de code réparée, audit de dépendances, `skills:check`) · lint 263 → 0 et régime des gates par
nature de règle · décor de test et bancs (isolation partagée, décor enregistré au rapport, modèle
défavorable) · portabilité et épreuve d'une plateforme absente → kit Windows · gotchas front et
Studio → skills front · nomenclature du plan et placement release · doctrine « où vit un outil » →
`nodefony-skill` · ReDoS, `skipIf`, GC forcé, plafonds partagés, cache d'un échec, fermeture au point
de passage, `npm pkg delete`, générateur vs formateur.

**Déjà couvert par une mémoire existante** : deux implémentations d'une règle →
`feedback_single_source_rule` · vérifier une affirmation de sous-agent avant de la répercuter → règle
du `CLAUDE.md` racine (§ délégation) · outil muet ≠ absence → `feedback_shell_false_diagnostics`.

**Patterns ÉPARPILLÉS, trouvés et gradués au CONSOLIDATE.** Chacun revenait 5 à 7 fois sous des noms
différents — donc jamais compté 3× au même endroit, donc jamais promu jusqu'ici :

| Pattern (nb de thèmes où il se cachait)                                  | Placé dans                                            |
| ------------------------------------------------------------------------ | ----------------------------------------------------- |
| la troncature ne s'annonce jamais (6)                                    | `feedback_shell_false_diagnostics` **+ CLAUDE.md**    |
| on conclut sur ce qu'on écrit, pas sur ce que le consommateur REÇOIT (7) | `feedback_prove_on_received_artifact` **+ CLAUDE.md** |
| l'information n'agit que là où le regard passe déjà (6)                  | `feedback_agent_example_over_prose` (volet final)     |
| un geste destructeur exige identité prouvée + périmètre borné (5)        | `feedback_destructive_needs_identity_scope`           |

Les deux premiers partagent une seule entrée du `CLAUDE.md` (§ PENDANT) : ce sont les seuls à devoir
être relus à CHAQUE tour, puisqu'ils invalident des conclusions en cours de route.
