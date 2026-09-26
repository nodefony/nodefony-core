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

## 🪞 Le remède porte le défaut qu'il corrige — GRADUÉ

- Les 5 frictions sont versées dans **`feedback_fix_the_family_not_the_instance`** (§ « Le REMÈDE porte le même défaut que ce qu'il corrige »).

## 🤝 Le terrain qu'on donne — GRADUÉ

→ [[feedback_stale_decor_poisons_verdicts]] (17 frictions versées) : se salir soi-même en éditant
pendant son propre run, le worktree qui isole les fichiers mais pas le SUJET, et le périmètre
décrit de travers à un délégué — qui affirme avoir balayé, extrapole, ou invente des URL.
Les deux frictions de sonde et de remplacement mécanique de cette même séance vivent ailleurs :
[[feedback_scope_wider_than_intended]] et [[feedback_bench_probe_false_verdicts]].

## 🔭🌍 Périmètre plus large que l'intention — GRADUÉ

→ [[feedback_scope_wider_than_intended]] (19 frictions versées, deux thèmes FUSIONNÉS : le
contrôle qui ratisse trop large et crie faux, et le geste dont la portée dépasse l'intention).
Séparés, aucun des deux n'atteignait son vrai poids.

## 🪤 Ajouter un CAS réveille des hypothèses jamais écrites — GRADUÉ

- Les 7 frictions sont versées dans **`feedback_prove_the_target_not_the_verdict`** (§ « Ajouter un CAS réveille les hypothèses… »).

## ⚙️ Réutiliser un script, c'est le RELANCER — GRADUÉ

→ [[feedback_script_import_executes]] (7 frictions) : l'import d'un script l'EXÉCUTE, une capacité
enfouie dans un fichier de 6 300 lignes est inatteignable donc réécrite, déplacer une règle rend
muettes les mutations qui la visaient, et un `grep` sans correspondance tue un script sous `set -e`.

## 🙈 L'outil ALTÈRE sa propre sortie — GRADUÉ

→ [[feedback_shell_false_diagnostics]] (21 frictions versées). Y compris ce qui n'est PAS du
shell : la notification de tâche de fond qui annonce « exit code 0 » sur un run rouge, l'empreinte
calculée sur un extrait, `awk` qui compte des octets, la mesure lancée en fond qui date de son
exécution.

- [3× — 09-17b] 🔴 **Cinq instruments faux en une séance, et quatre fois le même geste : une sortie
  tronquée ou une erreur masquée, lue comme une réponse.** (1) `grep -l $(liste de 1020 fichiers)`
  dépassait `ARG_MAX` et `2>/dev/null` avalait « argument list too long » → « 0 transcript »
  parfaitement faux ; (2) `xargs -a` n'existe pas sur BSD, même masque, même zéro ; (3) `grep -E`
  avec `\|` cherche le PIPE littéral → quatre comptages à 0 sur un corpus plein ; (4) `timeout`
  n'existe pas sur macOS → trois modèles déclarés « sans réponse » sans qu'aucun appel ait eu lieu ;
  (5) `head -6` a coupé la sortie d'un agent juste après ses avertissements → conclusion « il ne
  répond pas » démentie par le user. **La règle qui les couvre tous : ne jamais rediriger stderr
  quand on interprète un compte, et ne jamais conclure sur une sortie qu'on a tronquée soi-même.**

## 🗄️ 🧑‍⚖️ Un AUDIT + 🕶️ relire EN AVEUGLE — GRADUÉ

> Gradué le 2026-09-10 — 7 frictions RÉUNIES → **`feedback_outside_look_finds_what_green_hides`** : le regard extérieur (audit des jointures, USAGE réel, relecture en aveugle privée de mes conclusions) trouve ce qu'une suite verte ne peut pas voir. Ne PAS réécrire ici.

## 🧾 Un TEST porte une MESURE — le lire avant de trancher une conception — GRADUÉ

→ [[feedback_test_carries_a_measure]] (7 frictions : le test est le seul domicile d'un fait mesuré ;
rouge post-renversement = corriger l'ACTEUR puis ajouter le fait neuf ; exister ≠ servir, symptôme ≠
cause) et [[feedback_test_discriminant_or_dead]] (§ « Le test mesure une ENTRÉE que le runtime ne produit
jamais », 5 frictions).

## 🏷️ Un NOM qui a survécu à ce qu'il désignait envoie chercher ce qui n'existe plus — GRADUÉ

→ [[feedback_anchor_expires_silently]] (§ « Le NOM qui a survécu… ou qui promet », 5 frictions : nommer
par le GESTE, relire les noms après un retrait, notation contre réflexe universel, clé non unique),
[[feedback_agent_example_over_prose]] (un exemple se TESTE comme du code, 2), [[feedback_refactor_grep_consumers]]
(un renommage n'atteint pas CLAUDE.md/MEMORY.md, 2), [[feedback_capability_unreachable_is_absent]]
(patron lu comme primitive · drapeau que rien ne nomme, 2).

## 🔗 Une DÉPENDANCE peut être encodée ailleurs que dans le champ « dépend de » — GRADUÉ

→ [[feedback_dependency_encoded_elsewhere]] (5 frictions : `Ordre`, « pas dans ce ticket » du voisin,
`parent`/`subIssues`, dépendants à la fermeture, prose exécutable) ; #287 (prémisses périmées) versé dans
[[feedback_anchor_expires_silently]] § « La PREUVE ».

## 🧊 Un banc meurt à chaque étage de son cycle — GRADUÉ

- Les 7 frictions sont versées dans **`feedback_bench_probe_false_verdicts`** (§ « Un banc meurt à chaque étage de son cycle »).

## ⌨️ Une commande que je fais TAPER au user s'exécute dans SON terminal, pas dans le mien

- [1× — 09-13e] 🔴 **La variable qui expliquait TOUT était dans la commande du user, et je ne la
  lui ai demandée qu'au bout de deux heures.** Son serveur de dev ne démarrait pas (« manifeste :
  0 module(s) déclaré(s) », sortie 69) ; le mien démarrait, même dossier, même `dist`, même
  environnement. J'ai successivement accusé un `dist` en cours d'écriture, une course entre le
  build et le boot, des instances concurrentes, puis son environnement — quatre causes annoncées
  avec assurance, quatre fois fausses. Il lançait `nodefony dev` (binaire du PATH, lié vers le
  dépôt) ; je lançais `npm run dev` (binaire local). C'était TOUTE la différence, et elle n'était
  écrite nulle part dans le code. **Quand un symptôme n'est pas reproductible, la première
  question n'est pas "qu'est-ce qui diffère dans le code ?" mais "quelle commande EXACTE
  tapes-tu ?"** — la réponse tient en une ligne et elle a coûté une session.

- [2× — 09-11d] **Deux commandes proposées au user ont BLOQUÉ son terminal, pour deux causes
  différentes.** D'abord un `read -rsp` — une saisie interactive dont le stdin n'est pas branché :
  il attend indéfiniment, et `-s` masque même l'absence d'écho, donc rien ne signale l'attente.
  Ensuite une boucle `for` dont le `;` est arrivé échappé (`\;`) au collage : le shell ne voit
  jamais la fin de la commande et reste en attente de la suite (`for>`). Dans les deux cas le user
  a dû interrompre, et dans les deux cas j'avais écrit une commande que je n'avais PAS exécutée.
  Règles qui en sortent : jamais d'interactif (`read`, un éditeur, une invite) dans une commande
  destinée à un autre terminal ; jamais de boucle ni de `;` quand trois lignes indépendantes font
  le même travail — une ligne qui échoue se rejoue seule, et rien ne peut rester ouvert.

- [1× — 09-11d] **Et le mauvais identifiant.** Le namespace du dépôt d'images (`nodefony`) n'est
  pas le compte qui s'y authentifie (`ccamensuli`). J'avais pris le premier pour le second. Un
  identifiant se DEMANDE ou se CONSTATE — `docker login` l'affiche —, il ne se déduit pas du nom
  de l'organisation.

## 📐 Composer un chemin avec la MÊME opération — GRADUÉ

→ [[feedback_cross_platform_axioms]] (7 frictions) : composer des deux côtés ne suffit pas si ce
n'est pas la même opération (`resolve` contre enraciné), un attendu littéralisé de tête est faux,
et la frontière d'un format structuré se compose avec sa grammaire.

## ⏳ Un défaut « pratique » grave un pouvoir pour le jour où la distinction deviendra réelle

- [1× — 09-21b] ⚖️ **Le défaut d'un générateur est choisi pour UN public, et l'autre le subit sans
  recours.** `create app` posait `"license": "UNLICENSED"` et un « Tous droits réservés » écrits en
  dur — le bon défaut pour une application privée, et assumé en toutes lettres dans le gabarit.
  Mais le MÊME gabarit produit la vitrine publique `nodefony/nodefony` (93 ★ contre 0 pour le
  dépôt du framework) : un projet libre y montrait une démonstration que personne n'avait le droit
  de copier, classée `NOASSERTION` par GitHub — donc hors de tout filtre de recherche par licence
  et écartée d'office par une politique d'entreprise. **Et rien ne pouvait le corriger sur place** :
  ce dépôt est écrasé à chaque publication, donc l'option devait exister dans le générateur ou
  nulle part. Le contrôle qui tranche : **qui d'autre reçoit ce défaut ?** — un générateur dont la
  sortie est publiée a toujours au moins deux publics.

- **`admin:read admin:write` par défaut n'avait aucun effet** — le plan d'administration n'a qu'un
  rôle, les deux scopes ouvrent la même chose. Précisément pour ça, personne ne l'aurait remarqué ;
  et le jour où la séparation lecture/écriture deviendrait réelle, tous les jetons émis d'office
  porteraient le pouvoir d'écrire sans qu'aucune décision ne l'ait accordé. Un défaut se choisit sur
  ce qu'il vaudra APRÈS le durcissement prévu, pas sur ce qu'il vaut pendant qu'il est inerte —
  le plus étroit se durcit tout seul dans le bon sens. [1× — 08-22e]

- [1× — 09-26i] **Un `undefined` OBSERVABLE est devenu un contrat, même si le type le nie.**
  `Command.prompts!` vaut `undefined` avant `loadPrompts()` ; pour rendre le type vrai je l'ai
  changé en accesseur qui LÈVE avant chargement — typecheck vert, lint vert. Seul un test existant
  (« prompts est LAZY : undefined avant loadPrompts ») a montré qu'un appelant peut tester
  `cmd.prompts` : rupture pure, à types identiques pour qui l'écrivait. Rendre un type honnête en
  changeant ce que le code FAIT n'est pas un nettoyage de lint. Contrôle : avant de durcir un champ
  public, `rg` sur ses LECTURES (tests compris) — une lecture qui tolère l'absence fige l'absence.

## 🔑 Un secret écrit là où personne ne le lit — et la question « qui le lit ? » qu'on ne pose pas

- [1× — 09-11] **Une clé privée ne restait hors de l'image que par COÏNCIDENCE de chemins.** Le
  trousseau JWT vit sous `var/keys` et le Dockerfile généré efface `var/` : rien n'attachait la
  sécurité à la configuration. Un utilisateur écrivant `keystore: { dir: "nodefony/config/keys" }`
  — chemin parfaitement raisonnable — publiait sa clé privée, sans aucun signal. Quand une garantie
  tient à deux valeurs posées dans deux fichiers différents, ce n'est pas une garantie : c'est une
  coïncidence, et elle se contrôle par un test qui CONFRONTE les deux.

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
- [1× — 09-25h] **Le rapport `fable` qui a TRANCHÉ la conception de #484 ne vivait que dans la
  conversation** — c'est le user qui a demandé « tu as mis le résultat de l'audit dans le ticket ? ».
  Un rapport de sous-agent qui FONDE une décision se poste sur le ticket de la décision au moment
  où il tombe, avec ce qui en est appliqué ou non : la conversation meurt au `/clear`, et la
  décision redevient discutable sans son raisonnement.

## 🧪 Ce qu'on PUBLIE est une affirmation — GRADUÉ

→ [[feedback_agent_example_over_prose]] (8 frictions) : une phrase de rapport écrite en dur dément
sa propre donnée, une preuve d'absence se formule en COMMANDE pour obliger à la lancer, et les
surfaces périphériques gardent l'ancien chiffre après un recalage.

## 🗄️ 🧨 DÉCLARATION qui désarme + 💾 CACHE à demi écrit — VERSÉS

> Versés le 2026-09-10 dans **`feedback_destructive_needs_identity_scope`** (§ « Détruire SANS EN AVOIR L'AIR ») : une déclaration, un nettoyage de décor ou une écriture de cache détruisent sans l'annoncer. Ne PAS réécrire ici.

## 🧵 Trois choses ne suivent PAS d'un process à l'autre — GRADUÉ

- Versé dans **`feedback_shell_false_diagnostics`** (§ « Trois choses ne suivent PAS d'un process à l'autre »).

## 🖥️ Piloter un TTY par `expect` prouve mal — préférer rendre le câblage testable

- Cinq tentatives pour valider un choix de menu : filtres qui ne mordent pas, `\r` qui valide le
  premier item, prompt masqué impilotable, serveur de dev lancé par erreur **deux fois** (qu'il a
  fallu arrêter). Le prompt `search` d'inquirer ne se pilote pas de façon fiable. Quand un câblage a
  échoué en silence, l'exposer (méthode publique) et l'ÉPROUVER coûte moins cher qu'un pty.
  `[1× — 08-21e]`

## 🖥️ L'interactif se prouve au PTY — GRADUÉ

- Les 5 frictions sont versées dans **`feedback_shell_false_diagnostics`** (§ « L'interactif ne se prouve qu'au PTY »).

## 👻 Un process qui n'écoute AUCUN port échappe à toute purge — GRADUÉ

- Versé dans **`feedback_stale_decor_poisons_verdicts`** (§ « Un process qui n'écoute AUCUN port »).

## 🧱 Remplacer un mécanisme du NAVIGATEUR par du code à soi, c'est en devenir responsable

- [1× — 09-01d] Pour rendre le titre d'une section cliquable, j'ai troqué `<details>/<summary>` —
  dont le pliage est NATIF et ne peut pas tomber — contre un en-tête à deux commandes plié en
  JavaScript. Le pliage est tombé : l'écouteur était bien attaché (vérifié au protocole de débogage
  du navigateur), sans aucun effet, et le user a trouvé le menu bloqué avant moi. Revert. **Ce qui
  marche sans JavaScript ne se remplace pas pour un confort ; on AJOUTE à côté.**

## 🛡️ Toucher à ses PROPRES garde-fous se demande avant d'écrire, pas au commit

- [1× — 09-24c] **Le classifieur a refusé deux fois un geste sur les barrières de l'agent** — l'enregistrement d'un hook dans `.claude/settings.json`, puis le commit d'un changement de `.githooks/pre-commit` — alors que le code était écrit, testé, vu rouge. Une heure de travail est restée en attente jusqu'à l'accord explicite du user. Le geste juste : dès que la conception touche un hook, un pre-commit ou des réglages de l'agent, le NOMMER au user et obtenir son accord AVANT d'écrire — et lui présenter ce qui empêche la barrière de bloquer par surprise (ici : processus mort ignoré, âge maximal, sortie de secours nommée), c'est ce qu'il a demandé en premier.
- [1× — 09-25h] **Une route de TEST était aussi la cible du banc comparatif** : `/als-test/state`,
  dont `bench-frameworks/payload.mjs` recopie la réponse pour Express et Fastify. Y ajouter un
  champ de test faussait l'égalité des camps sans qu'aucun test ne le dise — vu en lisant
  `payload.mjs` par hasard. Avant d'étendre une route de test, `rg` son chemin dans `.claude/skills`
  (les bancs) : un jumeau ignoré est un instrument faussé. → [[feedback_twin_alignment_unproven]]
- [1× — 09-25h] **Le seuil mémoire publiait sa marge pour qu'on le resserre, et personne ne l'a
  fait** : ×14 à ×678, 1 043 scopes épinglés passés inaperçus (#483). Un seuil dont la marge est
  affichée mais jamais exploitée reste décoratif — c'est le user qui l'a relevé ; ticket #490.

## 🎯 Une règle vérifiée sur UN décor n'est pas une règle — GRADUÉ

- 54 frictions réparties au CONSOLIDATE du 2026-09-26 (table ci-dessous).

## 🗄️ Gradué aux CONSOLIDATE (retiré d'ici — règle anti-doublon)

Ces thèmes ont quitté le sas pour des mémoires durables. Ne pas les réécrire ici.

**CONSOLIDATE 2026-09-26 :**

| Thème / famille (frictions)                                         | Destination                                  |
| ------------------------------------------------------------------- | -------------------------------------------- |
| 🎯 Un vert valable sur UN décor — moteur, thème, backend (10)       | `feedback_green_holds_for_its_decor` (neuve) |
| 🎯 Un automate d'édition se borne et se relit (9)                   | `feedback_destructive_needs_identity_scope`  |
| 🎯 Un gate qui ne prouve rien — tolérance, skip, bouchon (10)       | `feedback_gate_must_bite`                    |
| 🎯 Un écart se juge dans le régime où il sera jugé (7)              | `feedback_bench_machine_regime`              |
| 🎯 Une affirmation se re-mesure avant d'être dite (8)               | `feedback_suspect_instrument_and_own_diff`   |
| 🎯 Jumeaux et règle écrite deux fois (5)                            | `feedback_twin_alignment_unproven`           |
| 🎯 Décor d'outillage — superviseur, client MCP, worktree, forge (6) | `feedback_stale_decor_poisons_verdicts`      |
| 🎯 Délégation `haiku`, couverture d'un lot (3)                      | `feedback_delegation_balance`                |
| 🧵 Trois choses ne suivent pas d'un process à l'autre (5)           | `feedback_shell_false_diagnostics`           |
| 👻 Un process sans port, ou renommé, échappe à la purge (5)         | `feedback_stale_decor_poisons_verdicts`      |

Snapshot : `archive/RETEX-snapshot-2026-09-26.md`.

**Gradué au fil de l'eau, jusqu'au CONSOLIDATE 2026-09-11 :**

| Thème (frictions)                                             | Destination                                  |
| ------------------------------------------------------------- | -------------------------------------------- |
| 🏭 Ce que le PRODUIT construit ≠ ce que la CONFIG demande     | `feedback_prove_on_received_artifact`        |
| 🧭 Un identifiant dans la MAUVAISE LANGUE (renommage) (14)    | `feedback_code_rewrite_mechanical_traps`     |
| 🤖 Un agent LIT l’interdit et le transgresse (6)              | `feedback_destructive_needs_identity_scope`  |
| 📖 Ce qui est ÉCRIT ne protège que si on le relit (10)        | `feedback_written_rule_needs_reread`         |
| 🧭 La voie FIABLE reléguée en repli (10)                      | `feedback_reliable_path_demoted_to_fallback` |
| 🧪 Un test qui ne parle jamais au serveur (9)                 | `feedback_prove_on_received_artifact`        |
| 🩺 Une correction qui ne couvre qu’un cas (28)                | `feedback_fix_the_family_not_the_instance`   |
| 🎯 Un PORT qui répond ne dit pas À QUI (9)                    | `feedback_stale_decor_poisons_verdicts`      |
| 🧭 La doc qui AFFIRME une automatisation inexistante (7)      | `feedback_capability_unreachable_is_absent`  |
| ⏳ Un symptôme qui ressemble à un DÉLAI (5)                   | `feedback_test_no_fixed_delay`               |
| 🚪 Une porte a plusieurs ENTRÉES (21)                         | `feedback_single_source_rule`                |
| 🧭 Une garde ne couvre jamais une AUTRE question (10)         | `feedback_prove_the_target_not_the_verdict`  |
| 🚧 Ajouter une EXIGENCE sans regarder qui PRODUIT             | `feedback_capability_unreachable_is_absent`  |
| 🟢 Un test peut passer depuis TOUJOURS sans rien mesurer (61) | `feedback_prove_the_target_not_the_verdict`  |
| 🎭 Mon PROPRE `--dry-run` mentait (12)                        | `feedback_suspect_instrument_and_own_diff`   |
| 🪟 Un message d’erreur qui n’énonce QU’UNE cause (9)          | `feedback_error_message_names_all_causes`    |
| 🕳️ Un gate rend un verdict RASSURANT sur son angle mort (10)  | `feedback_prove_the_target_not_the_verdict`  |
| 📐 Le verdict BINAIRE d'un banc (5)                           | `feedback_verdict_discards_its_evidence`     |
| 🎭 Un test de CARACTÉRISATION grave un défaut (9)             | `feedback_test_discriminant_or_dead`         |
| 🪟 Un contrôle VERT qui ne POUVAIT rien voir (21)             | `feedback_gate_must_bite`                    |
| 🧾 Un RITUEL de pilotage qui coûte plus qu'il ne rend (5)     | `feedback_ritual_must_earn_its_keep`         |
| 🚪 Un fast-path standalone n'hérite de RIEN (2)               | `feedback_single_source_rule`                |
| 🕳️ Déclarer ABSENT ce qu'on n'a pas cherché (5)               | `feedback_capability_unreachable_is_absent`  |
| 🧪 Vérifier que la transformation a EU LIEU (57)              | `feedback_prove_on_received_artifact`        |
| 🧰 Un GATE excellent que personne ne lance ne garde rien (47) | `feedback_gate_must_run`                     |
| 🎯 Une ancre PLAUSIBLE et fausse (27)                         | `feedback_anchor_expires_silently`           |
| 🤝 Un sous-agent répond « INCHANGÉE » (9)                     | `feedback_delegation_balance`                |
| 🪤 Une garde peut EMPÊCHER ce qu’elle prétend gérer (20)      | `feedback_gate_must_bite`                    |
| 🔇 Ce qu’on COUPE pour mesurer (6)                            | `feedback_shell_false_diagnostics`           |
| 👯 Un JUMEAU non vérifié (6)                                  | `feedback_twin_alignment_unproven`           |
| 🎪 Le DÉCOR d’un banc est un état PARTAGÉ                     | `feedback_stale_decor_poisons_verdicts`      |
| 📖 Une DOC qui enseigne un geste dangereux (9)                | `feedback_agent_example_over_prose`          |

Snapshot : `archive/RETEX-snapshot-2026-09-10.md`.

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

## 🗄️ Archivé au CONSOLIDATE du 2026-07-30 — 59 thèmes, 190 frictions

Snapshot : `archive/RETEX-snapshot-2026-07-30.md`.

## 🩹 Un repli qui rend une ESPÉRANCE pour un FAIT — GRADUÉ

- Les 5 frictions sont versées dans **`feedback_reliable_path_demoted_to_fallback`** (§ « Un repli qui rend une ESPÉRANCE pour un FAIT »).

## 📏 Le CHANGELOG résume, le titre approxime — GRADUÉ

- Les 9 frictions sont versées dans **`feedback_source_over_memory`** (§ « Toute affirmation ÉCRITE est crue sans être relue »). Règle anti-doublon : ne plus rien ajouter ici, verser là-bas.

## 🧪 Un banc comparatif dont les camps dérivent — GRADUÉ

→ [[feedback_measure_method]] (7 frictions) : contrôler ce que chaque camp CHARGE et pas seulement
ce qu'il écrit (deux instances du même ORM = +46 % faux), et se demander si la grandeur mesurée est
celle que le DÉCIDEUR regarde (`rss` contre `phys_footprint`).

- [1× — 09-17b] 🔴 **J'ai comparé deux mécanismes qui n'avaient pas la même FENÊTRE D'EXISTENCE, et
  j'ai failli en tirer une décision d'architecture.** « Les `references/` et les annexes sont à zéro
  sur 1020 transcripts » : vrai pour les premières (présentes depuis le 08-08), vide de sens pour les
  secondes, créées la VEILLE — elles n'avaient que 2 transcripts pour exister. C'est le user qui l'a
  relevé. Le contrôle qui manquait tient en une commande : `git log --diff-filter=A` sur chaque
  brique comparée, AVANT de mettre deux chiffres dans la même colonne. Corollaire : trois tâches
  plus tard, les trois mécanismes avaient servi au moins une fois chacun.

## 🎚️ Une méthode ÉCRITE et non IMPOSÉE ne s'applique pas — même quand on vient de la lire — GRADUÉ

→ [[feedback_written_rule_needs_reread]] (§ « 25 frictions de plus — la méthode ÉCRITE ne s'impose pas,
l'AUTOMATE si » : Face 1 dix cas, Face 2 cinq, le contre-exemple du gate qui REFUSE et enseigne) ; les
huit doublons ont chacun une ligne de rappel dans leur maison (repo_command, stale_decor,
suspect_instrument, shell_false, agent_example, single_source, green_covers).

## 🚨 Un contrôle qu'on ne peut pas SATISFAIRE finit désarmé — comme celui qui crie faux — GRADUÉ

→ [[feedback_gate_must_run]] (§ « 6. Il ne PEUT PAS être satisfait » + « un vert ÉNONCE ce qu'il a
lancé »), [[feedback_scope_wider_than_intended]] (Face A : juger un fait STRUCTUREL sur du TEXTE — trop
large crie, trop étroit se tait), [[feedback_prove_the_target_not_the_verdict]] (« je n'ai rien vu » ≠
« il n'y a rien ») — 29 frictions versées ; rappels d'une ligne dans gate_must_bite, stale_decor,
repo_command, npm_tree, agent_example, written_rule.

## 🧹 Entretenir le SAS est un geste qui se rate comme un autre

- [1× — 09-17] **Mes propres frictions du jour ont été versées dans le MAUVAIS thème.** Le script
  d'insertion les a placées AVANT le titre visé — donc à la fin du thème PRÉCÉDENT. Deux d'entre
  elles seraient parties dans une mémoire qui ne les concernait pas ; attrapé en graduant, parce
  que la lecture du thème a montré des bullets étrangers à son titre. **Insérer « avant le titre
  suivant » et « à la fin du thème visé » sont deux gestes différents**, et rien ne les distingue à
  l'exécution. Le contrôle qui tranche : relire le thème APRÈS écriture, pas le diff.
- [1× — 09-17] **L'index `MEMORY.md` dépassait sa limite, donc des entrées n'étaient PLUS
  chargées** — 27 Ko pour 24,4 autorisés, sept lignes coupées en silence. Le fichier grossit d'une
  ligne d'état par session, et personne ne regarde son poids. Ramené à 23,2 Ko en groupant cinq
  états anciens. **Le CONSOLIDATE doit contrôler la TAILLE de l'index, pas seulement celle du
  sas** : un index tronqué fait perdre exactement ce qu'il existe pour rendre atteignable.

## 🧷 Une commande REFUSÉE emporte TOUT ce qu'elle portait, y compris ce qui n'était pas visé

- [1× — 09-26j] **Un `git stash` refusé par la garde du dépôt a emporté l'écriture d'un test
  placée dans la MÊME commande.** Le refus ne porte que sur le geste git, mais le hook bloque
  l'appel entier : le test n'a jamais été écrit, et la passe suivante a « vu vert » 4/4 sans lui.
  Rattrapé au compte (4 au lieu de 5). Le geste : une écriture et un geste risqué ne partagent
  JAMAIS un appel ; après un refus, recompter ce qui devait exister avant de conclure.
- [2× — 09-26i/j] **Faux kernel casté (`as unknown as`) + garde retirée parce que le type la dit
  morte = rouge chez un CONSOMMATEUR que le typecheck ne voit pas** (realtime e2e en CI, puis
  `CliKernel.test` au cliquet kernel). Déjà gradué → [[feedback_green_covers_only_its_diff]]
  (corollaire « durcir un helper du cœur = lancer les suites de ses appelants »).
