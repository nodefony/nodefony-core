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

## 🔗 « Valider la chaîne » = EXÉCUTER la chaîne, pas recomposer son résultat

- [1× — 08-05] Le skill `create-frontend-module` prescrivait `getCspDirectives()` — API SUPPRIMÉE
  du code : un skill jamais rejoué depuis un refactor ment avec assurance. Corrigé (nonce). Rejouer
  un skill = le seul test qu'il ait.
- [1× — 08-05] Page blanche Vite « Failed to resolve ./App.svelte » : le fichier a été créé APRÈS
  le boot du dev-server (optimisation figée au démarrage) — restart Vite AVANT tout diagnostic
  quand un fichier neuf n'est pas vu.

## 🧬 Appliquer un patron N fois n'est PAS le factoriser

- `[1× — 2026-08-03b]` 🔴 **J'ai répliqué « le store déclare, le data plane demande » sur quatre
  ressources en croyant appliquer « 1 règle = 1 implémentation » — et j'ai produit 15 concepts
  pour un.** Le critère qui tranche : **l'ALGORITHME se factorise (un exemplaire), la FORME
  s'impose par une interface, la DONNÉE se déclare par ressource.** Le signe distinctif d'une
  règle dupliquée dans un fichier de vocabulaire : il contient une FONCTION au lieu d'une liste.
- `[1× — 2026-08-03b]` **Le refactor a trouvé ce que la réplication avait caché** : quatre stores
  ne filtraient pas l'ordre du tout, et le queryKit portait DEUX fonctions `ORDER BY` — dont celle
  que je venais d'écrire. Factoriser n'est pas cosmétique : c'est ce qui met les divergences côte
  à côte.

## 🛡️ Mesurer qu'on POSE une garde ne dit rien sur celle qu'on RETIRE

- `[1× — 08-05g]` ⭐ **La garde anti-stash du dépôt a mordu sur l'agent principal — et le
  contournement PROPRE existait.** Backup `cp` au scratchpad + `git show HEAD:<fichier> >` pour
  poser l'ancien contenu, rebuild après CHAQUE flip, et grep d'un MARQUEUR du diff dans le dist
  avant chaque mesure. Protocole noté dans le kit perf.
- `[1× — 2026-07-31]` 🔴 **Le témoin d'un « ne pas affaiblir » doit être HORS de l'énoncé** — et
  **l'échantillon vertueux d'une sonde de sécurité se copie du DÉFAUT du produit**, jamais réécrit
  à la main.
- `[1× — 2026-07-31d]` 🔴 **Poser un exemple ACTIF crée une surface d'affaiblissement neuve** :
  chaque garde qu'on montre est une garde que quelqu'un saura retirer.

## 🧩 Une capacité arrive AVEC sa tâche, sinon son absence de mesure ressemble à un rejet

- `[1× — 2026-08-02]` 🔴 **La règle du banc enfreinte par ses propres auteurs** : trois verbes
  livrés sans aucune tâche pour les mesurer. **Concevoir la tâche a trouvé un défaut que la
  relecture n'avait pas vu.**
- `[1× — 2026-08-03]` 🔴 **Une capacité se PERD dans un décorateur** (`RevocationGuardStorage`
  relayait tout sauf le `sortableFields` neuf) — motif gradué dans
  [[feedback_param_accepted_then_dropped]] ; gardé ici pour son angle « banc de contrat partagé =
  le seul filet d'un wrapper ».

## ⚙️ Une montée d'OUTIL change le verdict sans qu'une ligne du dépôt bouge

- `[1× — 2026-08-05b]` 🔴 **Un linter en plage `^` rougit un dépôt inchangé** (oxlint 1.77 apporte
  `no-map-spread` : CI rouge 6 runs sur un fichier de plusieurs semaines ; le commit déclencheur ne
  touchait que le verrou). Linter en version EXACTE + `oxlint` dans `lint-staged`.
- `[1× — 2026-08-05b]` 🔴 **Un réglage de MESURE qui n'est plus lu ne dit rien — et son banc reste
  vert.** `execArgv` déplacé en Vitest 4, ignoré SANS échouer : `globalThis.gc` = `undefined`, la
  sonde mesurait les déchets en attente → « fuite 47,5 MB » sur dépôt sain ; corrigé : 0,3 MB
  (facteur 158). Seul indice : une ligne `DEPRECATED` noyée. Après une montée majeure de runner,
  relire les options de MESURE une par une.

## ⚖️ Documenter un geste que l'OUTIL punit ne change rien

- `[1× — 2026-08-01]` 🔴 **Trois correctifs, un seul a compté — et ce n'était pas le mieux écrit.**
  Un geste que la chaîne d'outils sanctionne ne se rattrape pas par de la prose.
- `[1× — 2026-08-01]` **Un test qui pousse à désarmer une garde est pire qu'un test absent.**

## 🔇 Un mode machine qui coupe le journal coupe aussi les erreurs

- `[1× — 2026-07-26]` ⭐ **`--json` rendait une commande MUETTE sur échec** : 0 octet, stderr vide,
  code 1. Un mode machine doit garder un canal d'erreur.
- `[1× — 08-07]` **`NF_LOG_DRIVER=null` a rendu MUET un crash au boot** (banc PG : seed en échec,
  2 lignes de log, process mort sans un mot) — diagnostic = rebooter SANS le driver null. Un décor
  de banc se boote d'abord AVEC journal ; on ne coupe le log qu'au moment de mesurer.

## 🚦 Un contrôle de cible ROUGE arrête la série — il ne se commente pas

- `[1× — 08-07]` 🔴 **« cible: 401 » affiché, puis 6 runs wrk lancés quand même** : un escalier
  entier a mesuré ~5 500 réponses 401 par run (cookie de session expiré par le timeout d'inactivité
  NIST pendant la campagne Express intercalée). Le check de cible doit faire `exit`, pas imprimer.
  Corollaire : campagne longue + route authentifiée = **re-login au début de CHAQUE phase**.

## 🔎 Ce que le journal des commits CACHE

- `[1× — 2026-07-30]` 🔴 **Un correctif logé dans un commit au sujet étranger est invisible, et on
  le réécrit.** Deux trous « ouverts » d'un kit étaient corrigés depuis.

## 📦 npm : un arbre réparé à la MAIN n'est pas une garantie

- `[1× — 2026-07-30]` 🔴 **Un `node_modules` remis droit à la main tient jusqu'au prochain `npm
install`.** Et `npm run build` vert ne dit rien du chemin réel qu'emprunte l'utilisateur.
- `[1× — 2026-08-02i]` 🔴 **`npm outdated --workspaces --include-workspace-root` ne montre PAS les
  dépendances de la RACINE** (« 0 périmé » alors que `turbo` et `typescript` attendaient ; `npm
outdated` NU les montre). Corollaire : **un sous-agent hérite de la cécité de la commande qu'on
  lui DICTE** — rapport exhaustif sur périmètre amputé, rien dans sa forme ne le signale.
- `[1× — 2026-08-02i]` **Une dépendance déclarée à N endroits ne se monte pas à N−1** (`tsx` dans
  3 workspaces ET à la racine). Relever TOUS les sites déclarants avant d'éditer le premier.

## 🧭 La PRÉMISSE d'une question se vérifie avant d'en chercher la cause

- `[1× — 2026-08-01f]` 🔴 **« Depuis les derniers changements, les agents ne sont plus appelés »** —
  la prémisse était fausse ; chercher la cause d'un fait inexistant coûte une séance.
- `[1× — 08-05e]` 🔴 **La « Priorité 1 » d'un `_state` était un diagnostic jamais reproduit** —
  reproduire (5 min) a évité un chantier. Un constat de session sous pression entre au `_state`
  comme un FAIT — le RESUME suivant le traite comme une hypothèse à reproduire.

## 📖 L'API d'une bibliothèque maison se LIT — la supposer produit un vide silencieux

- `[2× — 2026-07-25]` ⭐ **Deux erreurs de suite sur la même lib**, faute d'avoir ouvert le source.

## 🗣️ Quand le user REPOSE la question, c'est ma réponse qui est fausse

- `[1× — 08-05h]` **« Tu es sûr de ton calcul de RPS ? »** — médianes séparées mais runs
  chevauchés, une paire SOUS le seuil de bruit. L'audit demandé a requalifié le verdict. Un chiffre
  publié se re-audite volontiers — le défendre n'est pas une option.
- `[1× — 2026-08-02j]` 🔴 **« kit en 8 étapes !!! »** — un plan dont plusieurs « lots » sont la
  MANIÈRE d'écrire les autres n'est pas un plan. Le test avant d'écrire un lot : **est-ce un
  RÉSULTAT, ou la façon d'en atteindre un ?**
- `[1× — 2026-07-27i]` ⭐⭐ **Trois fois la même question** — une reformulation n'est pas une
  demande de précision : c'est un signal que la réponse n'a pas répondu.
- `[1× — 08-06j]` **« C'est donc du CACHE ?! » — l'inquiétude était légitime et évitable** : au
  moment d'ANNONCER une mémoïsation, dire d'emblée ce qu'elle ne cache PAS (forme de requête,
  jamais les données ; valeurs re-bindées, résultats toujours lus en base) et livrer le test
  anti-staleness AVEC le lot, pas après la question. Le mot « cache » sans son périmètre déclenche
  à raison la peur des effets de bord.
- `[1× — 08-06j]` **Un refus de garde de banc ≠ un chiffre faux, = un chiffre non PROUVABLE** :
  old2 refusé 5× (dispersion 3,2-4,9 %, rampe thermique) avec des médianes à ±1 % des retenues —
  ne pas négocier la garde ni publier « quand même » ; la fenêtre s'est stabilisée seule plus
  tard dans la soirée. Bonus observé : les fenêtres du code RAPIDE sont plus stables (moins de
  chauffe par requête) — l'instabilité asymétrique old/new est un artefact thermique, pas un
  signal.

## 🪞 Un serveur TOLÉRANT rend VERT ce qu'un serveur STRICT refuse

- `[1× — 08-06j]` 🔴 **La table `session` stale (user TEXT d'avant le fix colKit) était VERTE sur
  MariaDB — qui créait l'index en auto-préfixant `user(768)` — et ROUGE sur MySQL 8.4, qui refuse.**
  Pas un rouge de décor : un VERT menteur, durable, sur le serveur quotidien. C'est la passe
  séparée MYSQL_COMMUNITY (serveur de preuve, volume plus jeune) qui l'a révélé. Angle neuf de
  [[feedback_stale_decor_poisons_verdicts]] : le décor sale peut aussi fabriquer du VERT.

## 📚 La doc officielle périme la mémoire — deux fois dans la même session

- `[1× — 2026-08-05]` 🔴 **« Prends un token npm Automation » : ces jetons N'EXISTENT PLUS** (doc
  npm : granular seulement, et elle pousse au trusted publishing OIDC). J'aurais écrit le contraire
  de mémoire, avec aplomb.
- `[1× — 2026-08-05]` 🔴 **Une matrice dynamique GitHub sans parenthèses rend `true`, pas une
  liste** (`&&` prioritaire sur `||`). Trouvé en TÉLÉCHARGEANT la doc ; éprouvé sans pousser, en
  simulant la sémantique, avec la preuve négative.
- `[1× — 2026-08-05]` ⚠️ **Deux étapes de CI écrites « au bon sens » étaient fausses** (`npm run
check:externals --if-present` sur un script qui n'existe pas → contrôle imaginaire vert pour
  toujours ; `paths-ignore: ['**/*.md']` aurait désactivé `skills:check` dont la matière EST des
  `SKILL.md`).
- `[1× — 08-06j]` ⭐ **Lire le SOURCE de la lib (node_modules) pour CHAQUE méthode du chemin
  neuf — exigé par le user — a rendu 2 découvertes que la doc web ne dit pas** :
  `bindIfParam` drizzle EXCLUT les Placeholder (→ `eq(col, placeholder)` nu saute
  `mapToDriverValue`, RangeError sur json — d'où `sql.param(placeholder, col)`) ; et
  drizzle+mysql2 passe par `client.query()`, JAMAIS `execute()` → « prepared » mysql =
  gain JS seul, aucun prepare protocole. La doc officielle (perf-queries) montre l'API,
  pas ces deux contrats.

## 🔴 Un gate rouge en PERMANENCE est un gate mort

- `[1× — 2026-08-05]` **CI rouge depuis 7 runs, ~15 h, invisible** (1 job sur 17, noyé dans les
  verts). La contradiction était lisible au premier rapport (même cas vert en `development` dans le
  même run) : quand deux sondes du même run se contredisent, on ouvre l'instrument en premier.

## 🕳️ Un import qui compile chez MOI peut casser TOUT clone

- `[1× — 08-06i]` 🔴 **Le décor de banc importait statiquement le corpus dolibarr GITIGNORÉ** :
  build et CI verts sur ma machine, TS2307 garanti sur tout clone frais. Le signal qui a sauvé :
  `git add <dossier>` n'a PAS stagé le nouveau fichier — un fichier qui manque au `git status`
  après un add se qualifie par `git check-ignore -v` AVANT de forcer. Remède : import dynamique
  par URL construite (hors graphe statique rolldown/tsgo) + fail-loud, et la preuve dans les
  DEUX mondes (corpus masqué : build vert, boot nominal vert, flag banc rouge exit 1 ; corpus
  rendu : banc vert). Angle neuf de [[feedback_gitignored_breaks_clone]] : le danger n'est pas
  seulement CONSOMMER un fichier ignoré, c'est en faire la CIBLE d'un import qu'on committe.

## 🧰 Outillage : ce qui pend, ce qui ment, ce qui lance

- `[1× — 08-06i]` **`timeout` n'existe pas sur macOS nu → rc 127 lu comme verdict, DEUX faux
  d'un coup** (boot nominal « mort » 000 + fail-loud « confirmé » rc 127). rc=127 = « command
  not found » : c'est l'INSTRUMENT qui manque, jamais un verdict du code — rejouer au spawn
  éprouvé avant de conclure quoi que ce soit.
- `[1× — 08-06i]` **L'agent qui pilote un banc fait partie du décor machine** : contrôle
  sandwich r0b refusé 3× (disp 4,9-8,5 %) — le pollueur était MON propre process (32 % CPU).
  Seules les marches CPU-bound le voient (les marches I/O-sérialisées restent à ≤ 3 %) ; filet
  de secours = l'additivité interne de l'escalier (vérifiée ici à ~1 %).

- `[1× — 08-06]` 🔴 **Une leçon gravée dans UN artefact ne protège pas le script NEUF** : la garde
  locale-fr (`awk printf` → `0,0`) était écrite au kit perf ET dans `bench-ab-mono.sh` — et j'ai
  reproduit le bug à l'identique dans une garde de banc écrite from scratch (boucle infinie
  d'attente sur décor parfait). `export LC_ALL=C` en tête de TOUT script de banc, réflexe
  d'ouverture, pas correctif.
- `[1× — 08-06]` **Un `.mjs` posé au scratchpad ne résout aucun paquet npm** (résolution ESM depuis
  l'URL du module, pas le cwd) — un harnais qui importe `ws` se pose dans `tmp/` du repo, qui
  remonte vers les node_modules racine.
- `[1× — 08-06]` **Prouver « 0 écriture en base » = `PRAGMA data_version` depuis une connexion
  readonly ouverte PENDANT toute la fenêtre** (bouge à chaque commit d'une AUTRE connexion, toutes
  tables — là où les counts par table ne couvrent que ce qu'on a pensé à compter). Deux invocations
  sqlite3 CLI ne se comparent PAS (valeur par connexion). Ajouter une fenêtre de repos témoin pour
  discriminer un écrivain périodique. Instrument utilisé : `express-fair-proof.mjs` (catalogué).

- `[1× — 2026-08-05c]` ⭐ **Un serveur MCP peut TUER la session parce que le CLIENT ne répond pas à
  ses pings** (heartbeat sur le flux GET SSE : sans canal retour ouvert ET lu, le serveur ferme —
  `404 Session not found` à t+5,7 s, qui ressemble à un quota). Un protocole bidirectionnel impose
  des DEVOIRS au client. Diagnostic obtenu en lisant le code du serveur DANS le conteneur.
- `[1× — 2026-08-05c]` 🔴 **RÉIMPLÉMENTER UN CLIENT DE PROTOCOLE À LA MAIN COÛTE PLUS QUE LA TÂCHE
  QU'IL SERT** (six clients HTTP écrits au lieu d'un `claude mcp add`). Le signal : **quand on
  débogue le TRANSPORT et non le sujet, on a pris le mauvais chemin.**
- `[1× — 2026-08-05c]` 🔴 **Une capture d'écran NE S'ÉCRASE PAS** : nom réutilisé = image PÉRIMÉE
  relue pendant que l'appel répond « OK ». Nom neuf à chaque prise, ou vérifier le `mtime` AVANT.
- `[1× — 2026-08-05c]` 🔴 **Une sonde qui attend un texte présent dans DEUX états ne discrimine
  rien** (« Nodefony Studio » s'affiche aussi sur l'écran de connexion). Se repérer sur ce qui
  DIFFÈRE.
- `[1× — 2026-08-05c]` 🔴 **Pire qu'une sonde fausse : une sonde qui RÉPOND alors qu'elle n'a rien
  mesuré** (trois lignes de verdict imprimées session morte, zéro capture). Sans `result` NI
  `error`, afficher le brut, jamais « non ».
- `[1× — 2026-08-03i]` 🔴 **Un hook qui refuse une commande la refuse ENTIÈREMENT — et le heredoc
  qu'elle portait n'a jamais été écrit** (banc inchangé, 14 verts qui ne testaient rien). Écrire un
  fichier passe par l'OUTIL d'édition ; un compte de tests qui ne BOUGE PAS après un ajout est un
  signal.
- `[1× — 2026-08-03i]` 🔴 **Vitest TRANSPILE, il ne vérifie pas les types** : suite verte,
  `typecheck` rouge deux commits plus tard. Le typecheck global appartient à la MÊME passe que la
  suite du module touché.
- `[1× — 2026-08-03i]` 🔴 **Un run lancé depuis la racine au lieu du module** a rejoué l'ancien
  fichier par résolution de motif, sans rien dire. Vérifier le `cwd` d'un run avant d'en tirer un
  verdict.
- `[1× — 2026-08-03h]` **Commiter pendant qu'un watch reconstruit** fait échouer le hook sur un
  `ENOENT` de `dist` — relancer après le build, pas chercher la cause dans le diff.
- `[1× — 2026-08-02b]` **Un script maison ne connaît pas `--help` : il LANCE le travail.** Les
  options se lisent au source.
- `[1× — 2026-07-30b]` **`spawnSync` BLOQUE la boucle du parent** — mortel dans un harnais qui
  lance des agents.
- `[1× — 2026-07-31e]` **La garde anti-geste-git du dépôt mord aussi sur l'agent PRINCIPAL** — et
  elle a eu raison à chaque fois.

---

## 🗄️ Gradué aux CONSOLIDATE (retiré d'ici — règle anti-doublon)

Ces thèmes ont quitté le sas pour des mémoires durables. Ne pas les réécrire ici.

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

## 🗄️ Archivé au CONSOLIDATE du 2026-07-30 — 59 thèmes, 190 frictions

Snapshot : `archive/RETEX-snapshot-2026-07-30.md`.
