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

## 🎯 La commande du DÉPÔT est l'autorité — la mienne, ciblée, a un périmètre plus étroit

- **Mon typecheck ciblé était vert, le gate du dépôt sortait 3 erreurs.** `tsgo -p
src/nodefony/tsconfig.json --noEmit` ne couvre pas les tests ; `npm run typecheck` (turbo, config
  du workspace) si. J'ai livré deux fois « typecheck OK » sur un périmètre amputé, et c'est le
  **user** qui a dit « il y a des problèmes de type ». Corollaire : quand un dépôt possède un gate,
  c'est LUI qu'on lance avant d'annoncer — une invocation à la main n'est qu'un raccourci de boucle
  courte. [1× — 08-22e] ↝ [[feedback_prove_the_target_not_the_verdict]]
- **`vitest run --root <dir>` depuis la racine ≠ `cd <dir> && vitest run`.** `--root` change la
  racine de configuration, PAS le cwd du process : 48 tests `finder`/`bundler` qui composent des
  chemins relatifs sont tombés d'un coup. J'ai failli les qualifier de régression avant de voir que
  l'erreur citait `<repo>/src/tests/...` au lieu de `<repo>/src/nodefony/src/tests/...` — le chemin
  de l'erreur était le seul indice. [1× — 08-22e]

## 🚧 Ajouter une EXIGENCE sans regarder qui PRODUIT l'artefact exigé

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

## 🧪 Le DÉCOR du banc n'est pas celui qu'on livre — et il masque le défaut

- **Un banc qui ÉCHOUAIT s'est mis à SKIPPER — et un skip compte comme vert.** Le banc sur serveur
  réel se saute lui-même quand son grant ne rend pas de jeton ; mon durcissement pouvait donc
  transformer un rouge en silence. Lu trop vite, le total (« 8 passed | 1 skipped ») disait
  l'inverse de la vérité. Le réflexe : quand un fichier passe de rouge à absent, exiger la LISTE
  des fichiers joués (`--reporter=verbose`), jamais le total. [1× — 08-22e]

- **Une capacité ne marchait que sous `start.sh`.** L'auto-vérification d'un jeton MCP exigeait
  `NODE_EXTRA_CA_CERTS`, que seul le script du skill posait — jamais `nodefony development`, la
  commande que tape un utilisateur. Le banc était vert, la fonctionnalité inutilisable ; le
  commentaire du code assumait même le 503 comme « fidèle ». `[1× — 08-22]`
- **Trois variables séparaient mon décor du sien**, pas une : le CA de dev, `RATELIMIT=false`, et
  `--expose-gc`. Un banc qui pose des variables que le produit ne pose pas mesure autre chose que le
  produit. `[1× — 08-22]`
- **Un test rouge attribué à mon diff ne l'était pas** : `client-abort-499` lisait
  `/tmp/nodefony-server.log`, figé à 07:55 — le serveur en marche (DevSupervisor) n'écrit pas dedans.
  Même motif, deuxième occurrence du jour. `[1× — 08-22]`

## 🔎 Une ABSENCE de trace n'est pas une preuve — et la doc officielle ment aussi

- **J'ai conclu « Codex ne lit aucun `.env` » en ne trouvant pas la chaîne dans un binaire.** Faux :
  il lit `$CODEX_HOME/.env`. C'est une sonde comportementale (`codex doctor` signale une variable
  manquante), montrée discriminante d'abord — témoin 1, variable exportée 0 — qui a tranché.
  L'utilisateur a dû insister deux fois. `[1× — 08-22]`
- **La doc officielle Mistral ne documente pas son fichier `.env` — le SOURCE installé, si**
  (`load_dotenv_values`). Sur quatre agents, deux emplacements ne sont écrits nulle part ailleurs que
  dans leur code. Corollaire : installer l'outil pour lire son source vaut mieux que citer un blog.
  `[1× — 08-22]`
- **Un test peut passer pour une raison qui n'est pas la sienne.** Ma garde « nom hors forme » ne
  mordait pas : un pré-filtre `includes` écartait déjà le cas. Le test le DIT maintenant plutôt que
  de prétendre garder quelque chose. `[1× — 08-22]`
- **🔴 Deuxième occurrence, MÊME agent, même faute** : j'ai écrit « Codex n'a AUCUNE notion de
  projet » sur la foi d'un `codex mcp list` muet dans un dossier avec `.codex/config.toml`. FAUX —
  sa config projet n'est lue que dans un dépôt **de confiance**, ce que le binaire dit en toutes
  lettres (« Project `.codex/config.toml`: settings for a trusted repository, including […] MCP »).
  Ma sonde était discriminante sur la MAUVAISE variable : elle mesurait la confiance, pas la portée.
  L'utilisateur a dit « c'est bizarre » — c'est lui qui a rattrapé. `[2× — 08-22]`
- **Le `--help` d'un outil dit ce qu'il ÉCRIT, pas ce qu'il LIT.** J'ai déduit de « Add an MCP
  server to the user configuration » que Vibe n'avait pas de portée projet. Son source dit
  l'inverse (`_harness_manager.py:69-73` : `<projet>/.vibe/config.toml` d'abord, si le dossier est
  de confiance). Deux questions distinctes qu'un seul mot d'aide ne tranche jamais. `[1× — 08-22]`

## 🔑 Un secret écrit là où personne ne le lit — et la question « qui le lit ? » qu'on ne pose pas

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

## 🚦 Un code de sortie 0 ne prouve RIEN — le geste se CONSTATE, pas se croit

- **`gemini mcp remove nodefony` répond « not found », sort en 0, et laisse l'entrée en place** —
  celle que `gemini mcp add` venait d'écrire. Notre commande relayait donc « déclaration retirée »
  sur une déclaration toujours là. Le verdict se prend en RELISANT par la commande de lecture de
  l'agent, jamais sur son code de retour. `[1× — 08-22]`
- **Une CLI tierce écrit relativement à SON répertoire courant.** Lancée depuis `src/nodefony/`,
  elle a créé un second `.gemini/` que personne ne lira jamais — invisible au code de sortie,
  visible d'un `ls`. Toute CLI d'agent se lance depuis la RACINE du projet. `[1× — 08-22]`
- **Une CLI tierce peut cracher 20 lignes de bruit sur stderr à chaque appel** (avertissements
  d'interpréteur). Hériter de sa sortie ferait lire un succès comme une panne : capturer, et ne
  montrer qu'en cas d'échec. `[1× — 08-22]`

## 🎭 Mon PROPRE `--dry-run` mentait — l'option dont le seul rôle est de dire ce qui va se passer

- **La même URL recomposée à trois endroits, et l'un avait gardé l'origine nue** : `--dry-run`
  annonçait `http://localhost:5151` là où l'exécution visait `…/nodefony/mcp`. On croit un dry-run
  sur parole — c'est précisément pour ça qu'on le lance. Une valeur, calculée une fois.
  `[1× — 08-22]`
- **Un texte de sortie PÉRIME sans que rien ne le signale** : le rendu disait encore « écrit
  `NF_MCP_TOKEN` dans `.env` » le lendemain du jour où ce comportement avait été retiré. Un message
  qui envoie chercher un secret dans un fichier qui ne le porte pas, c'est le diagnostic d'une heure
  qu'on vient de payer, offert au suivant. `[1× — 08-22]`

## 🩹 Corriger une OCCURRENCE n'est pas corriger le MOTIF — et on se recontamine soi-même

- **Le même défaut est revenu par la porte d'à côté le soir même.** Un gate du banc parsait un JSON
  sans garde ; corrigé sur UN gate le matin, laissé sur les quatre autres — le soir, la meilleure
  passe de la tâche 13 (46 tours, travail juste) sortait FAIL sur « <anonymous_script>:1 ».
  `[1× — 08-22]`
- **Pire : je me suis recontaminé.** J'ai posé des timeouts sur six tests qui spawnent un process le
  matin, puis écrit DEUX tests neufs qui spawnent `git`… sans timeout. L'un tombait sur le budget du
  HOOK vitest (`hookTimeout`, 10 s), que le `timeout` du `describe` ne couvre pas. Corriger un motif
  n'a de valeur que si on l'applique à ce qu'on écrit ENSUITE. `[1× — 08-22]`

## 🧭 Une RÈGLE écrite à N endroits a déjà divergé — le compter AVANT de la changer

- « Quel mode quand rien ne le dit » vivait à **SEPT** endroits (`Kernel` ×3 dont
  `buildConfigContext`, `Cli` ×3, le lanceur). Et elle avait déjà divergé : le kernel se déclarait
  en `production` pendant que la cascade `.env` ne chargeait NI `.env.production` NI
  `.env.development` — l'application tournait dans un mode dont elle n'avait pas la configuration.
  Chercher les copies AVANT de trancher a évité de corriger une seule d'entre elles. `[1× — 08-22]`
- **Un défaut posé « par commodité » court-circuite la règle** : mettre la valeur dans
  `CliDefaultOptions` la faisait passer AVANT la seule fonction qui distingue « absent » de « posé
  mais non-moteur » → `NODE_ENV=staging` partait en développement. `[1× — 08-22]`

## 🪟 Un message d'erreur qui n'énonce QU'UNE cause envoie chercher là où il n'y a rien

- Trois jobs Windows rouges deux jours durant sur « man/nodefony.1 est PÉRIMÉE — node
  scripts/generate-man.mjs ». La page n'était pas périmée : git la convertissait en CRLF au checkout
  (`core.autocrlf`), le générateur écrit du LF, le gate compare octet pour octet. **Régénérer n'y
  changeait rien.** Le message nomme désormais les DEUX causes. Corollaire : un dépôt Node
  multiplateforme sans `.gitattributes` a ce piège en dormance. `[1× — 08-22]`

## 📐 Le verdict BINAIRE d'un banc gaspille ce qu'il a déjà mesuré

- L'unanimité sur 3 runs a une résolution catastrophique : une tâche réussie 4 fois sur 5 sort
  « instable » **une fois sur deux** (P(3/3 | p=0,8) = 0,51). Vérifié dans le fichier : la tâche 13
  était à `2/3` le 2 août ; trois runs rejoués trois semaines plus tard ont rendu `2/3`. Deux
  mesures payées, zéro information. Les TOURS, eux, séparaient nettement (52·54 contre 69·88) —
  et le banc les jetait à la décision. `[1× — 08-22]`
- **Ne pas contourner à la main le refus d'un outil** : le dépistage a REFUSÉ de comparer (décor
  différent), je l'ai refait au `jq` et j'ai lu trois « chutes » qu'aucun changement n'expliquait.
  Refaire le calcul qu'une garde interdit, c'est reproduire l'erreur qu'elle empêche. `[1× — 08-22]`

## 🔍 Une SONDE trop large invente des défauts — et fait corriger ce qui va bien

- **Trois fois dans la même journée.** (1) Un test comparant options acceptées et publiées lisait
  tous les littéraux `"--x"` d'un fichier : il a accusé `git:hooks` de cacher `--get` et
  `--show-toplevel`, qui sont des arguments passés à **git**. (2) Un test du gabarit de commande
  cherchait `stdio: "inherit"` n'importe où dans le rendu : le **commentaire** qui met en garde
  contre `this.log` le satisfaisait. (3) Le même, version silencieuse : deux occurrences existaient
  (exemple + prose), en retirer une laissait le test **vert** — il gardait la mauvaise. Écrire la
  sonde sur ce qui AGIT (une comparaison à un mot de la ligne de commande, le bloc d'exemple), pas
  sur la présence d'une chaîne. `[1× — 08-21e]`
- **Une preuve manquée compte double** : mon `grep -c "MODULE ADD"` a rendu `0` et j'ai conclu au
  succès — la commande n'avait simplement jamais tourné (le filtre du pty avait raté). Un zéro peut
  être un faux négatif : vérifier que la CHOSE a eu lieu avant de lire son résultat. `[1× — 08-21e]`

## 🎭 Un test de CARACTÉRISATION grave un défaut au lieu de le décrire

- « initSyslog 2x avec kernel → 2 listeners (**pas de deduplication**) » — aucune justification, un
  simple constat figé. Il gardait un vrai bug : `listenWithConditions` AJOUTE un abonné, donc
  reconfigurer le filtre ne servait à rien (l'ancien écrivait toujours) et chaque ligne acceptée par
  plusieurs abonnés était écrite plusieurs fois. Signal à reconnaître : un intitulé qui **décrit un
  comportement sans dire pourquoi il serait souhaitable**. `[1× — 08-21e]`

## 🚪 Un fast-path standalone ne vaut QUE pour l'invocation directe

- `card`, `check`, `env`, `symbols`, `ai:sync`, `ai:mcp`, `git:hooks` : lancées depuis le MENU, le
  kernel tourne déjà, elles passent par commander et **BOOTENT** — leur sortie arrivait sous dix à
  trente lignes de « MODULE ADD ». Même piège pour les capacités déclarées : `CliKernel.start()` les
  applique d'après la commande DEMANDÉE, or depuis le menu c'est `menu`. Toute règle posée « au
  démarrage d'après argv » a un angle mort : le choix différé. `[1× — 08-21e]`

## 🧨 Une commande de DÉCLARATION ne doit jamais désarmer ce qu'elle trouve

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

## 🧾 Le COMPTE ne dit rien du CONTENU — ni pour des commits, ni pour des tests

- `[1× — 08-20c]` 🔴 **« main a 6 commits d'avance » a alarmé, et son contenu tenait en UNE LIGNE
  d'un fichier généré.** Cinq de ces commits étaient des merges de `claude-ts` (leur contenu venait
  d'ici), le sixième un bump dependabot **déjà présent** — les `uses:` étaient identiques des deux
  côtés. Le geste qui tranche en une commande : `git diff --stat base...autre` pour le contenu, et
  `%p` (nombre de parents) pour distinguer un merge d'un vrai commit. Reproduction exacte du piège
  du 08-08d (`A...B` mal lu ⇒ régression annoncée à tort) : **c'est le user qui a demandé « d'où
  viennent ces commits ? »**, et la question était la bonne.
- `[2× — 08-21]` **Un exit code de PIPELINE n'est pas celui de la commande.** (Rejoué le 08-21 : `npm run check | tail` → `RC=0` sur un check à 2 manquements — reconnu à temps, le banc lisait le vrai exit.) `npm run test:all >
log 2>&1; echo "EXIT=$?" | tee -a log` : le harnais a rapporté **exit 0** — celui de `tee`. Le
  journal, lui, portait `EXIT=1` et **648 échecs**. J'ai failli lire l'inverse de la vérité. Variante
  directe de la règle « jamais `>/dev/null` sur une commande dont dépend la mesure », déjà graduée le
  matin même. Forme sûre : capturer `RC=$?` puis `exit $RC`, jamais derrière un pipe.

## 🧪 Un test neuf peut FIGER sans DISCRIMINER — et le débranchement seul le dit

- `[4× — 08-21b]` 🔴 **Un débranchement prouvé ne vaut rien si le JUGE n'a pas tourné.** Quatre
  fois dans la même session : sabotage posé et prouvé (`grep` = 1), puis `vitest` lancé depuis le
  MAUVAIS cwd → « no tests » — et un juge qui ne tourne pas ressemble à un débranchement vert.
  Le geste qui manque : lire le COMPTE de tests exécutés (> 0) avant de lire un verdict de
  débranchement. (La dérive de cwd elle-même est graduée [[feedback_bash_cwd_drift]] — la nuance
  neuve est côté PREUVE.)
- `[1× — 08-21b]` **Une sonde MANUELLE se voit mordre comme un test.** Sonde source-fresh écrite à
  la va-vite (`export const` HORS de `defineEnv`) : elle ne changeait pas le catalogue, donc RC=0
  prouvait… rien. Une sonde à main a exactement les défauts qu'on reproche aux tests écrits face
  au code — la faire discriminer AVANT de croire son verdict.

- `[1× — 08-20c]` 🔴 **Annoncé 3 rouges, obtenu 1 — et les deux explications sont différentes.**
  (a) « force réécrit » passe aussi avec un écrasement naïf : il fige un comportement, il ne prouve
  pas le correctif. (b) « 0600 après force » passait DÉBRANCHÉ : la garantie venait d'un
  `restrictPrivateKey()` (chmod explicite) **qui existait déjà**, et mon commentaire de code
  l'attribuait au `mode` du `writeFile`. **J'ai écrit une preuve qui prouvait le travail d'un
  autre.** Le geste qui l'a montré : saboter l'assertion (`to.equal(0o111)`) pour que le message
  d'erreur RENDE la valeur réelle — plus rapide qu'un `console.log`, que vitest intercepte.
- `[1× — 08-20c]` **Un témoin manquait, et le test comparait une chose à elle-même** : « n'écrase
  pas sans force » lisait le fichier avant/après — or `writeCertificates` réécrit le MÊME contenu.
  Sans une SENTINELLE, « sauté » et « réécrit à l'identique » sont indiscernables. C'est le témoin
  qui fait le test, pas l'assertion.
- `[1× — 08-20c]` **Quand un test ne discrimine pas, l'écrire dans le test.** Le bandeau du bloc dit
  désormais lequel des trois mord et pourquoi les autres non — sinon le prochain lecteur les croira
  plus probants qu'ils ne sont, et c'est ainsi qu'on hérite d'une couverture imaginaire.

## 🧰 Un outil frère existe déjà — et il est meilleur que celui qu'on va écrire

- `[1× — 08-20c]` 🔴 **J'ai écrit `scripts/audit-pins.mjs` alors que `deps:check`
  (`check-deps-latest.mjs`) faisait déjà le travail, en mieux** : il lit le VERROU, donc il
  distingue un pin en retard d'une plage `^19.2.7` que le lock a déjà hissée. Le mien comptait ces
  plages comme des retards. Pire : la mémoire graduée le matin même citait « `audit-pins.mjs` —
  mériterait `scripts/` » sans que je vérifie qu'il avait DÉJÀ été versé sous un autre nom. Le
  réflexe manquant coûte une commande : `node -e 'Object.keys(require("./package.json").scripts)'`.
- `[1× — 08-20c]` **La seule idée neuve du doublon valait d'être portée** — et le frère avait déjà
  la matière (`nom → spec → sites`), il ne la LISAIT pas. Retirer un doublon ne veut pas dire jeter
  ce qu'il apportait. Vu ROUGE avant d'y croire : peer `vite` remis à `"8.2.1"`, le contrôle a nommé
  le fichier fautif.

## 🔌 Le décor d'un banc se LIT à sa source, jamais ne se devine

- `[1× — 08-21b]` **Le tarball d'un run LONG fige le code du LANCEMENT.** Le miroir
  `.claude/skills` a été codé PENDANT que le run large tournait : `skills: (aucun)` sur les 30
  tâches — le run mesurait un levier mort de plus, et seul le `ls` de l'app du run l'a dit.
  Coder pendant un run est sain ; CONCLURE sur ce run à propos de ce qu'on vient de coder ne
  l'est pas — dater le tarball avant d'imputer.
- `[1× — 08-21c]` 🔴 **La limite de quota coupe AUSSI l'agent du banc — et l'agrégat a compté
  le transcript tronqué comme un run valide.** Run large interrompu à la T30 (« session
  limit ») : le garde-fou du run a bien refusé le verdict, mais `--analyze-only` a ensuite
  retenu la T30 coupée → « 1 PASS → FAIL (instable) » sur un rouge NON OPPOSABLE (la règle 4
  du dépistage existe, ce mode ne l'applique pas — défaut de banc à corriger). Et le quota est
  PARTAGÉ : un gros run sérialisé avec du travail interactif le mange des deux côtés.
- `[1× — 08-21c]` **Un juge lisait `git status` pour dire « le disque »** : aveugle au travail
  COMMITTÉ (l'agent T28 committait), la cause rendue passait de « fait mais pas chargé » à
  « rien fait » et l'instruction partait du mauvais côté. Corrigé (`144e3dac`) — la famille
  « la sonde est le premier suspect » a une variante : la sonde qui lit un PROXY de l'état
  (l'index git) au lieu de l'état (le disque).

- `[1× — 08-21]` 🔴 **Le serveur du dépôt laissé UP a rougi le banc devkit du VOISIN** : le
  `nodefony check` de l'app témoin sonde les ports de sa CONFIG (5151/5152) — tenus par le dépôt —
  et chaque tâche se fermait AVANT l'agent, sur un manquement d'un autre runtime. Symétrique exact
  du bullet suivant (éteint = 642 rouges d'intégration ; allumé = banc voisin rouge) : le serveur
  de dev n'est ni un défaut ni un dû — c'est une VARIABLE DE DÉCOR que chaque banc doit constater.
  Dette inscrite (`9ce0e9fc`).
- `[1× — 08-21]` **La contention, je l'ai fabriquée moi-même** : `--setup-only` (pack + npm install)
  lancé EN PARALLÈLE de `test:all` opt-in → 12 rouges, tous requalifiés verts en isolation. Les
  runs lourds se SÉRIALISENT — le wall-clock gagné se repaie en diagnostics.
- `[1× — 08-20d]` 🔴 **648 rouges de `test:all`, DEUX jours de suite, pour la même cause jamais
  instruite : le serveur d'intégration était ÉTEINT.** 642 `ECONNREFUSED :5152` + 6 flakes de
  contention — zéro régression. `test:all` pose l'infra docker mais PAS le serveur que les suites
  live exigent, et son rapport « CE QUI A ÉTÉ TESTÉ » ne nomme pas ce prérequis (dette inscrite au
  dashboard). Serveur UP → 9 443 verts, 0 échec, load et dialects compris.
- `[1× — 08-20c]` 🔴 **J'ai deviné le mot de passe Redis (`nodefony` au lieu de `nodefony-dev`) et,
  en l'exportant, je l'ai IMPOSÉ au serveur que je venais de lancer** — sa connexion est tombée en
  `WRONGPASS`, et le banc a rendu des 500 que j'ai failli instruire comme un défaut de code.
  `vitest.gates.ts` est la source unique DÉSIGNÉE par le `CLAUDE.md` ; la lire coûtait dix secondes.
  Une variable d'infra exportée ne sert pas que la commande visée : elle contamine tout ce qu'on
  lance ensuite.
- `[1× — 08-20c]` **Le classement d'un banc dans un catalogue n'est pas une preuve** :
  `graceful-shutdown-e2e` y est « autonome » et exige en fait un serveur en marche — deuxième
  entrée fausse du même tableau (après `idempotency-cluster`, déjà signalée). Le classement se
  vérifie en LANÇANT.
- `[1× — 08-20c]` **Un cluster est un runtime de PRODUCTION** : les modules `policy:"dev"` n'y sont
  pas, donc les routes de banc rendent 404. `NF_WITH_DEV_MODULES=1` est la dérogation prévue, et le
  skill le disait — je l'ai lu après avoir cherché.

## 🖥️ L'interactif se prouve au PTY — et chaque couche peut salir la sortie

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

## 🩺 Une montée de version RÉVÈLE des défauts qu'elle n'a pas créés

- `[1× — 08-20c]` **Un PATCH peut rompre des types** : `@fastify/busboy` 3.2.0 → 3.2.1 renomme le
  type d'instance (`Busboy` → `BusboyInstance`). Invisible à l'install, invisible aux tests, visible
  au seul `build:types`. Une montée se valide sur la compilation des DÉCLARATIONS, pas sur un vert
  de suite.
- `[1× — 08-20c]` 🔴 **Une dépendance FANTÔME ne se voit que le jour où l'arbre bouge** :
  `fast-glob`, importé par `scripts/generate-symbols.ts`, déclaré NULLE PART, présent par simple
  hoisting transitif. Le `npm install` l'a fait disparaître et le hook pre-commit du dépôt est tombé
  avec. Un clone frais aurait échoué pareil : la montée n'a pas cassé ce défaut, elle l'a découvert.
- `[1× — 08-20c]` **Un `peerDependency` EXACT est un piège à retardement** : cinq modules figeaient
  `vite: "8.2.1"`, et la montée en 8.2.2 a bloqué net `npm install` (ERESOLVE). Un peer exprime un
  PLANCHER. Le signe que c'était une incohérence de FORME et non un choix tenait dans le même
  fichier : `@vitejs/plugin-vue` y était déjà en `>=6.0.0`.

## 🚧 Une donnée qui s'ARRÊTE à la frontière d'un vérificateur — deux failles, un seul motif

- `[2× — 08-20]` 🔴 **La même classe de bug a produit DEUX failles en deux sessions**, sur le même
  contrat `IAccessPrincipal`. (1) La **borne d'expiration** ne traversait pas ⇒ une socket WS
  adossée à un jeton tiers ne mourait jamais. (2) L'**émetteur** ne traversait pas ⇒ le `sub` d'un
  annuaire tiers était cherché tel quel dans l'annuaire local, donc s'inscrire sous « admin »
  chez un émetteur reconnu donnait le compte `admin`. Chaque fois : le vérificateur SAIT, l'appelant
  ne reçoit qu'un extrait, et l'extrait suffit pour le cas nominal. **Le réflexe à prendre** : devant
  un contrat qui traverse une frontière de confiance, ne pas se demander « qu'est-ce que l'appelant
  utilise ? » mais « qu'est-ce que le vérificateur SAIT et que l'appelant ne saura plus ? ». Ce qui
  reste derrière ne manque jamais tout de suite — il manque le jour d'une attaque.
- `[1× — 08-20]` **Le champ neuf se met REQUIS, pas optionnel** : le typecheck a nommé les 11 sites
  d'un coup. En optionnel, chaque appelant décide de s'en passer — ce qui est exactement la façon
  dont ce trou est né la première fois.
- `[1× — 08-20]` ⚠️ **Ajouter un champ ne suffit pas : il faut UNE seule forme.** Le vérificateur
  rendait d'abord `trusted.issuer` (valeur BRUTE de la config) là où la table consommatrice est
  indexée en forme CANONIQUE : une barre oblique terminale en configuration aurait suffi à
  provoquer un 503 systématique. Quand une valeur devient une CLÉ, les deux côtés doivent la
  normaliser au même endroit — sinon on a transporté la donnée sans transporter sa forme.

## 🕳️ Un pointeur CONFORME peut ne mener nulle part — la conformité n'est pas la promesse

- `[1× — 08-20]` 🔴 **Le défi RFC 9728 posé, et l'URL qu'il annonce rend 404.** L'en-tête est
  syntaxiquement juste, le client le lit, le suit… et trouve une erreur : seul un module monte un
  document de ressource protégée, pour SA porte. Aucun test unitaire ne pouvait le voir — ils
  vérifient la CHAÎNE composée, pas ce qui se trouve au bout. **Vu uniquement en `curl`ant l'URL
  qu'on vient de publier.** Règle : quand un livrable ÉMET une référence (URL, chemin, identifiant
  de document), la déréférencer une fois en réel fait partie de la livraison — sinon on livre une
  promesse dont on n'a vérifié que la grammaire.
  **Fermé le 08-20b** (`fde3d850`, `71228441`) : montage générique, source unique avec le défi.
- `[1× — 08-20b]` 🔴 **La SONDE DE DÉCOR d'un banc ne doit jamais interroger CE QU'IL TESTE.**
  Écrite naïvement, la mienne demandait le document ; montage débranché ⇒ 404 ⇒ « décor manquant »
  ⇒ suite SAUTÉE ⇒ **vert**. Le banc se serait éteint exactement le jour où il devait mordre —
  reproduction à l'identique du piège du 08-10 (sonde lisant un 401 ⇒ « serveur absent », 13 tests
  muets), à un code de statut près. Le décor et l'objet du test doivent s'observer sur DEUX
  surfaces différentes : ici la PORTE (401 = la zone existe) et le DOCUMENT (ce qu'on juge).
- `[1× — 08-20b]` **Le MONTAGE et la LECTURE doivent avoir la même source.** J'ai basculé le
  montage des routes en multi-sources et laissé la lecture par requête sur un seul service : les
  routes existaient, le controller n'appariait rien, et le 404 portait MON corps d'erreur — pas
  celui du routeur. C'est ce détail qui a nommé le coupable en une seconde. Un 404 n'est pas un
  404 : lire QUI le rend.

## 🕸️ Implémenter une interface sans lire OÙ l'appelant l'appelle

- `[1× — 08-09f]` 🔴 **`supports()` d'un authenticator est appelé HORS du bloc de rattrapage du
  pare-feu** (`if (!authenticator.supports(ctx))`, avant le `try` qui protège `authenticate()`).
  Ma première version y appelait `canonicalIssuer()`, qui LÈVE sur tout ce qui n'est pas une URL
  https — un `iss: "ftp://x"` dans un jeton non signé donnait donc une **500 provoquée par un
  anonyme**, avec une simple chaîne. Le contrat de l'interface ne dit rien de tout ça : ni « ne
  lève pas », ni « appelé hors rattrapage ». **Avant d'implémenter une méthode d'interface, lire
  son SITE D'APPEL** — dans quel bloc, avec quelle protection, à quelle fréquence. Ce que le
  contrat ne dit pas, l'appelant le décide, et c'est lui qui a raison.

## 🎲 Un banc d'agent mesure AUSSI sa propre variance

- `[1× — 08-09c]` 🔴 **3 tâches sur 4 rejouées se révèlent INSTABLES** (T17 2/3, T25 1/3, T28 1/3) —
  même gabarit, même décor, même modèle. Une seule était un vrai signal (T16, 0/3). Conséquence
  qui dépasse ce run : la référence antérieure ayant été écrite sur des runs UNIQUES, une part de
  ses futures « chutes » et « remontées » est du BRUIT, pas une dérive. Le dépistage nomme des
  suspects ; il ne prononce rien. Corollaire adopté : enregistrer `passes/runs` et pas seulement
  le verdict, pour que l'instabilité soit INSCRITE au lieu d'être perdue.
- `[1× — 08-09c]` **Le coût d'une même tâche varie d'un facteur 2,7** (87 tours / 1,14 $ contre
  32 tours / 0,45 $). C'est la source de l'instabilité, et c'est ce que le second but du banc
  (« y arriver en un minimum de TOURS ») mesure sans qu'on ait à l'instrumenter.
- `[1× — 08-09c]` 🔴 **Un « 0 sur 9 » partout ne dit rien de ce qu'on croit mesurer.** Le banc de
  schéma rendait 0 colonne sur 6 tables : lu vite, « la grammaire ne sait pas exprimer umami ».
  En réalité l'application n'avait jamais démarré — donc rien n'avait atteint la base. Un verdict
  UNIFORMÉMENT nul est le signe d'un décor ou d'un boot cassé, pas d'un défaut de capacité :
  vérifier que la chaîne a EU LIEU avant d'interpréter ce qu'elle rend.
- `[1× — 08-09c]` **Un banc qui monte son décor peut ÉCRIRE dans le dépôt.** `packTarballs` re-packe
  dès qu'une source publiable a bougé, et `pack-all.mjs` bascule les `exports.types` des
  `package.json` du dépôt avant de les restaurer. Lancé pendant qu'une autre session code, il
  écrase une édition concurrente. Parade employée : dater le manifeste des tarballs (gitignoré)
  pour figer le décor — ce qui protège l'arbre ET garde la comparaison valide, puisqu'un rejeu
  dans un décor différent ne confirme plus le run qu'il doit confirmer.

## 📌 Un chiffre publié sans son COMMIT n'est pas vérifiable

- `[1× — 08-21d]` 🔴 **Une MESURE se date du commit PACKÉ, pas de celui qu'on a sous la main en la
  lisant.** Le banc lisait `HEAD` au moment d'écrire son rapport : un run empaqueté à 12h32 s'est
  vu daté d'un commit de **14h39** — six commits plus tard, dont aucun n'était dans les tarballs
  mesurés. Enregistrée telle quelle, la référence aurait daté la mesure d'un code JAMAIS mesuré, et
  tout dépistage ultérieur aurait comparé contre ce faux repère. Le geste : figer l'identité du code
  à l'instant où l'artefact naît, jamais à l'instant où on le juge. (Variante du hash cité de tête,
  par une autre porte : ici c'est l'OUTIL qui se trompe de moment, pas la main.)
- `[1× — 08-21d]` **Corollaire vécu le même jour** : un correctif commité 8 minutes APRÈS le
  `--repack` n'est pas dans le run — la T9 mesurait donc un code d'avant son propre fix. Avant de
  lire un verdict, comparer l'heure du pack à celle du dernier commit qui compte.

- `[1× — 08-20d]` **Un hash cité AVANT le commit définitif meurt en silence** : une mémoire écrite
  43 s AVANT son commit citait `da13d51` (réel : `1b46723a`), et un `--amend` a tué `0f8ad7cd`
  (réel : `4af035e2`) — les 2 seuls hashes morts sur 1 614 candidats du corpus mémoire, retrouvés
  par automate (`git cat-file -e` sur tout). Piège jumeau : un ID de SESSION (`1fa6ebae`,
  `41ca4a89`) a exactement la forme d'un hash court. Un hash se cite APRÈS `git log -1`, jamais
  de tête.
- `[1× — 08-07b]` 🔴 **Rendu REFUSÉ par le user, et à raison : « les données sont assemblées de
  manière aléatoire ».** J'ai publié un dossier de perf entier — 9 pages + un rapport HTML — en
  portant scrupuleusement machine, protocole, dispersion et gardes… **sans jamais dire à quel état
  du CODE chaque bloc correspondait.** Or les mesures venaient de 6 fenêtres et d'autant de
  commits : le comparatif de frameworks datait d'avant les lots F, l'escalier ORM d'avant le lot
  prepared. Côte à côte, ces tableaux **suggèrent** une comparaison qu'aucun d'eux ne permet.
  Le décor ne suffit pas : **machine + protocole + COMMIT**, sinon un « avant/après » n'est pas
  réfutable. Corrigé par une table de chronologie (fenêtre → état du code → où c'est publié) et
  retour du dossier en `draft`. Coût de l'omission : la confiance dans tout le livrable.
- `[1× — 08-07b]` **Un livrable dérivé DIVERGE de sa source sans prévenir** : le HTML généré et le
  Markdown disaient 0,98 % et 0,93 % du même poste (deux instruments différents). Trouvé en
  comparant mécaniquement les 35 chiffres structurants des deux côtés — pas à la relecture.
- `[1× — 08-07b]` **Un générateur de rapport n'est PAS une photo** : le mien vivait dans `tmp/`,
  qu'on s'apprêtait à vider — le ménage aurait emporté la seule façon de reproduire la page. La
  sortie va dans `tmp/`, le code qui la produit se versionne. Même piège pour 4 micro-bancs que le
  kit perf référençait dans `tmp/`. Et vider `tmp/` a cassé les compteurs de `doc-lint` : un
  dossier « temporaire » peut porter un état dont un gate dépend (régénérables ici).

## 🤖 `haiku` s'est trompé DEUX fois sur DEUX runs — le recontrôle n'est pas optionnel

- `[2× — 08-07b]` 🔴 **Deux délégations, deux erreurs, toutes deux invisibles dans la forme du
  rendu** : (1) « `bench-frameworks/` ne contient que des node_modules, aucun script » — le dossier
  contient 8 bancs, il ne les avait pas ouverts ; (2) verdict **FAUX** sur une affirmation vraie,
  parce qu'il a lu le test _unitaire_ (`urlFastPath.test.ts`) au lieu du banc d'_attaque_
  (`url-fastpath.attack.test.ts`) — deux fichiers, un seul porte les 401. Le recontrôle par `rg` a
  tranché en deux commandes. **Ce qu'un sous-agent affirme ne devient un fait qu'après vérification
  — a fortiori quand ça part en publication.** Et quand le user conteste le choix du modèle sur un
  livrable public, il a raison de le faire : la QUESTION ZÉRO (un `rg` répond-il ?) valait mieux
  que la délégation ici.

## 🔗 « Valider la chaîne » = EXÉCUTER la chaîne, pas recomposer son résultat

- [1× — 08-05] Le skill `create-frontend-module` prescrivait `getCspDirectives()` — API SUPPRIMÉE
  du code : un skill jamais rejoué depuis un refactor ment avec assurance. Corrigé (nonce). Rejouer
  un skill = le seul test qu'il ait.
- [1× — 08-05] Page blanche Vite « Failed to resolve ./App.svelte » : le fichier a été créé APRÈS
  le boot du dev-server (optimisation figée au démarrage) — restart Vite AVANT tout diagnostic
  quand un fichier neuf n'est pas vu.
- `[1× — 08-09]` 🔴 **« Tu es sûr de tout ça ??? »** — j'avais annoncé un comportement corrigé en
  m'appuyant sur UN rendu à l'écran, sans test. Le user a demandé les tests ; trois étaient rouges
  à cet instant, cassés par mes propres changements. Un écran montre un cas, un test garde une
  règle : tant que le second n'existe pas, « ça marche » ne vaut que pour la fois où on a regardé.
- `[1× — 08-09]` **Un cas SAUTÉ faute de décor était un décor qu'on n'avait pas monté.** Le banc
  désactivait son refus de canal (« une app fraîche n'a qu'un seul compte ») : vrai, et pas une
  raison — deux gestes d'utilisateur suffisaient (`security:user:add`, puis `@RealtimeChannel(…,
{ roles })`). 10 verts, 0 sauté. Avant de neutraliser un cas, se demander ce que coûterait de
  MONTER ce qui lui manque.
- `[1× — 08-08e]` 🔴 **Aucun script PUBLIÉ n'avait jamais été exécuté ailleurs que dans le
  conteneur** — donc toujours sous Linux, pendant que la portabilité était « vérifiée » par
  lecture. Le remède ne coûte rien : lancer les scripts sur leurs **chemins de REFUS** (codes de
  sortie attendus) avec le Node de la suite — ni serveur, ni docker, ni navigateur — pour qu'ils
  tournent dans le job `windows-latest`. Vu rouge en cassant un import. Même session : le gate de
  portabilité laissait passer `&&` / `||` dans les blocs SHELL publiés, que PowerShell 5.1 — le
  shell PRÉINSTALLÉ de Windows — refuse comme erreur de syntaxe.

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

## 📐 Un POURCENTAGE de profil n'est pas un pourcentage de budget

- `[3× — 08-07]` 🔴 **Trois pistes ouvertes sur le même malentendu, écart ×25-30 à chaque fois** :
  le profil imputait 18 µs à `Tools.extend` (réel : 1,3 µs), 31 µs à `Route.match` (réel : 1,15 µs),
  21,6 % au scope DI (réel : 0,7 %). Un % de CPU **busy** n'est pas un % du budget de requête quand
  le temps part en attente I/O, et le % d'une fonction agrège TOUS ses sites (boot compris) plus ses
  frames enfants. **Conduite : convertir tout % de profil en ns par un micro-bench AVANT d'ouvrir un
  lot.** Trois lots l'auraient été pour rien.
- `[1× — 08-07]` **Le compte, lui, ne ment pas** : 43 `Route.match` par requête sur `auth/me` est
  exact et déterministe (aucune mesure de temps). Quand un diagnostic peut se poser en COMPTE plutôt
  qu'en durée, le préférer — il survit au bruit, à la machine et à l'instrument.

## 🧾 Le contrôle de la RACINE n'est pas celui du PAQUET

- `[1× — 08-08c]` 🔴 **« Typecheck propre » annoncé deux fois, faux les deux fois.** `npx tsgo
--noEmit` à la racine n'ouvre NI `tsconfig.tests.json` NI `frontend/tsconfig.json` ; le script
  `typecheck` d'un espace de travail enchaîne les trois. C'est le hook de PUSH qui a tranché, après
  que le travail a été annoncé fini — deux fois de suite, sur deux paquets différents.
  **La commande qui fait autorité est `npm run typecheck` DANS le paquet touché.** Même famille que
  « prouver sur l'artefact reçu » : le contrôle le plus large n'est pas le plus couvrant, il est
  seulement le plus commode.
- `[1× — 08-08c]` **Un correctif qui change de MÉCANISME se re-mesure.** Le typage a forcé de passer
  de `vars` à `styles` pour la même correction de couleur ; la mesure a été rejouée plutôt que
  supposée conservée (7,39 AAA dans les deux thèmes). Un correctif réécrit est un correctif neuf.

## 🧰 Réécrire ce dont c'est le MÉTIER d'un outil — 41 faux positifs contre 7 vrais

- `[1× — 08-08c]` 🔴 **Sonde de contraste écrite à la main : trois bugs en vingt lignes**, et le
  défaut qu'on CHERCHAIT noyé dessous. (a) les couleurs CSS modernes comptent en 0–1
  (`color(srgb 0 0.4 0.73 / .13)`) et la même expression régulière que `rgb(0, 87, 156)` les lit
  comme du 0–255 → un bleu rendu presque noir ; (b) un fond semi-transparent doit être COMPOSÉ sur
  ce qu'il y a dessous, sinon on mesure une couleur que personne ne voit ; (c) les emoji sont
  peints par une police EN COULEURS — leur `color` calculée (noire, héritée) ne décrit rien, et les
  juger fabrique des échecs à 1:1. Résultat : **41 signalements, 7 réels**. Remplacée par
  `axe-core` — le moteur qu'embarque Lighthouse pour ce volet. Le user avait raison avant la
  mesure : « il y a des outils dont c'est le métier ; le nôtre c'est de voir et corriger ».
- `[1× — 08-08c]` **La QUESTION ZÉRO a une deuxième face.** Elle dit « un automate plutôt qu'un
  modèle » ; elle vaut aussi **« une dépendance de référence plutôt que du code maison »** dès que
  le domaine a des cas particuliers qu'on ne devine pas avant de les avoir vus. Le critère n'est
  pas la difficulté apparente (un rapport de contraste tient en trois lignes) mais le nombre de cas
  limites que dix ans d'usage ont révélés à quelqu'un d'autre.
- `[1× — 08-08c]` 🔴 **J'ai affirmé de mémoire qu'un outil externe n'avait pas telle fonction** —
  « Lighthouse n'a pas d'audit agentic ». Faux : la catégorie `agentic-browsing` existe depuis la
  13, et les rapports du user la contenaient. Sur une capacité d'un outil TIERS, la connaissance
  se périme sans prévenir : vérifier au source, ou dire qu'on ne sait pas.

## 🏭 Le GABARIT n'est pas ce qu'il PRODUIT — six défauts invisibles à la lecture

- `[1× — 08-08c]` 🔴 **Première application réellement générée et regardée : six défauts**, dont
  aucun ne se voyait en lisant les gabarits. Le pire : un lien « console d'administration :
  `/nodefony` » en pied de page ET dans le message de fin de création, alors que la console n'est
  installée QUE par le préset complet — une application minimale envoyait donc son auteur sur un
  **404 dès sa première minute**. Puis un `<input>` sans nom accessible (manquement critique,
  poids 10, qui faisait aussi tomber le score `agentic-browsing` à 50), deux contrastes sous le
  seuil, `lang="en"` sur du contenu français, et deux `<h1>` par page.
- `[1× — 08-08c]` **Un test de scaffold vert ne prouve que le RENDU.** 179 tests passaient : ils
  lisent des chaînes dans des fichiers rendus, ils ne démarrent pas l'application et ne regardent
  pas son écran. Ce que le gabarit PROMET (une route, une console) n'est vérifié par personne.
- `[1× — 08-08c]` 🔴 **Propager un gabarit à la main le CASSE.** Pour montrer l'après sans
  régénérer, j'ai rendu les `<% %>` par une expression régulière : une variable a disparu au milieu
  d'un appel (`JSON.stringify(, null, 2)`), et l'application ne compilait plus. La seule
  propagation juste est de RE-GÉNÉRER — « prouver sur l'artefact reçu » s'applique aussi aux
  raccourcis qu'on s'accorde pour aller vite.
- `[1× — 08-08c]` **Le port n'est pas prévisible** : `portPolicy: "auto"` prend le suivant libre.
  Cinq applications ont démarré sur 5154, 5156, 5158, 5160, 5162 — et le défaut codé en dur de la
  sonde (`5152`) a mesuré **une autre application**, en rendant un résultat parfaitement crédible.
  Un défaut commode sur une valeur non déterministe est un générateur de faux verdicts.

## 🏷️ Un nom de variable DÉJÀ pris ne lève aucune erreur — il change le sens

- `[1× — 08-08c]` 🔴 J'ai nommé `NF_BROWSER_CHANNEL` un réglage de NAVIGATEUR ; le nom désignait
  déjà le CANAL d'un socket applicatif dans un script voisin. Le banc fonctionnel a passé
  `nodefony:supervision` et le script l'a cherché comme un navigateur. Aucune erreur de
  compilation, aucun avertissement : juste un test rouge et un message absurde. Renommé
  `NF_BROWSER_ENGINE`. **Avant de poser une variable, `rg` son nom dans le paquet** — le vocabulaire
  se recoupe (« canal » sert au socket ET au navigateur), et c'est justement là que ça mord.

## ⛓️ Un gate en CHAÎNE ne dit pas combien de défauts restent DERRIÈRE le premier

- `[1× — 08-08d]` 🔴 **La forge était rouge sur `skills:check` ; corriger le défaut annoncé en a
  révélé DEUX autres** — l'étape enchaîne ses trois contrôles par `&&`, donc le premier échec
  masquait un renvoi mort et un recouvrement de déclencheurs. Un rapport de gate se lit comme « le
  premier défaut rencontré », jamais comme un inventaire. **Corollaire opératoire** : après avoir
  corrigé le défaut nommé, RELANCER avant de conclure — et considérer que l'étape suivante du job
  (ici les 4 auto-contrôles du banc devkit) n'a peut-être JAMAIS tourné, donc n'a jamais rien prouvé.
- `[1× — 08-08d]` ⭐ **Le premier réflexe sur un recouvrement était de le DÉCLARER accepté** — écrire
  une dérogation coûte une ligne, retirer le déclencheur en trop demande de trancher. Le user a
  tranché : `frontend-dev` ne porte aucun outil de mesure a11y, seulement la spec. Une demande qui
  n'a qu'une réponse n'a besoin que d'une porte. **Une table de dérogations qui grossit est le
  symptôme d'arbitrages qu'on n'a pas faits.**

## 🪦 Une phrase qui JUSTIFIE une absence devient un mensonge le jour de la livraison

- `[1× — 08-09d]` **« Nous ne faisons pas X, et voici pourquoi » s'était recopié dans CINQ
  fichiers** (TSDoc de classe, `README`, `docs/index.md`, `MEMORY.md`, `CLAUDE.md`) — livrer X les
  a tous rendus faux d'un coup, et aucun gate ne le voit : ce sont des phrases justes hier,
  parfaitement bien écrites, qui décrivent maintenant l'inverse du code. Le motif est propre à ce
  type de phrase : une doc de CAPACITÉ vieillit quand le code change, une doc d'ABSENCE vieillit
  quand le code **arrive**. Réflexe à prendre : au moment de livrer une capacité, `rg` sur la
  justification de son absence AVANT d'écrire la nouvelle doc — la formulation est reconnaissable
  (« écart assumé », « pas encore », « reste à faire »).

## 🧭 Une leçon gravée dans UN artefact ne protège pas le suivant

- `[2× — 08-07d]` 🔴 **J'ai écrit la règle, puis je l'ai enfreinte dans l'heure — et c'est le user
  qui l'a payé.** Le skill que je venais de rédiger disait, en toutes lettres, que
  `NF_FRONTEND_PUBLIC_ORIGIN` est un _décor d'observation, pas un réglage_ : « la poser, c'est
  prévoir de la retirer ». Posée pour observer Studio depuis le conteneur, oubliée en sortant →
  **Studio mort sur le poste du user**, sans la moindre erreur côté serveur (la page annonce ses
  assets sur un nom que seul un conteneur résout). **Une variable dont l'oubli casse
  l'environnement n'a pas besoin d'un rappel écrit : elle a besoin de DISPARAÎTRE** — d'où le lot
  B (dériver l'origine du `Host` de la requête). Corollaire général : quand une consigne dit
  « pense à défaire X », c'est le signe que X ne devrait pas exister.
- `[1× — 08-07]` 🔴 **Le script portait les quatre pièges dans son en-tête ; le `SKILL.md` n'en
  disait rien** — donc invisible à qui lit le skill sans ouvrir le dossier `scripts/`. Et sa ligne
  de catalogue portait encore l'affirmation qui venait d'être réfutée. **Après toute correction
  d'un artefact, chercher les AUTRES endroits qui répètent la même affirmation** (même motif que
  `feedback_single_source_rule`, mais côté documentation d'outil).

## 🕵️ Deux symptômes sans rapport ⇒ soupçonner une cause TEMPORELLE commune

- `[1× — 08-07d]` 🔴 **« Le `fetch` tue la session » et « le formulaire React résiste au
  pilotage » : deux fausses pistes, une seule cause.** Le serveur MCP envoie un `ping` au CLIENT
  toutes les 3 s et ferme la session s'il ne répond pas en 5 s ; un `curl` one-shot ne lit pas le
  flux et ne répond jamais. Tout appel un peu long franchissait l'échéance que les appels rapides
  passaient de justesse — **c'était le temps, pas le code**. Symptômes trompeurs : `HTTP 200` au
  corps VIDE, puis `404 Session not found`, qu'on impute à l'inactivité alors que c'est
  l'INVERSE. Deux heures perdues. **Quand deux symptômes sans lien apparent surgissent ensemble,
  chercher d'abord ce qui court en arrière-plan.**

## 🖼️ Un RENDU s'ajoute en REMPLAÇANT ce qu'il double — sinon il embrouille

- `[1× — 08-09]` 🔴 **Rendu REFUSÉ par le user : « je comprends rien, c'était mieux avant ».** J'avais
  ajouté une table des projets à `nodefony status` sans retirer les deux blocs qu'elle remplaçait :
  la ligne « ports 5151 occupé par <racine> », le bloc « 4 runtime(s) d'un AUTRE projet » avec ses
  pids, PUIS ma table. Trois endroits à recouper pour répondre à « qui tient mon port ? ». Chaque
  bloc était juste ; c'est leur SOMME qui était illisible. Un ajout de rendu se conçoit en disant
  d'abord **ce qu'il rend inutile** — sinon on empile des vérités.
- `[1× — 08-09]` 🔴 **Le rapport MENTAIT sur lui-même** : il annonçait « 5153 5154 (déclarés par le
  projet, non sondés) » pour une app dont le superviseur ET le serveur vivaient — deux lignes après
  avoir donné 5151 « occupé par », donc sondé. Je n'avais sondé que MES ports par habitude, alors
  qu'une sonde TCP locale coûte quasi rien. **Ne jamais afficher un doute sur ce qu'on peut
  vérifier** : le lecteur en conclut que le service est mort.
- `[1× — 08-09]` **Une formulation présuppose son contexte** : « aucune instance de CE PROJET »
  s'affichait dans un dossier qui n'est pas un projet, juste avant la ligne qui l'annonçait — deux
  phrases contradictoires dans le même écran. La supposition était à QUATRE endroits (titre, résumé,
  le mot « voisins », et une ligne de ports sondés « par convention »). Corriger le premier ne suffit
  pas : le vocabulaire d'un rendu se relit ENTIER sous chaque situation qu'il peut rencontrer.

## 🪟 WINDOWS ne se vérifie pas « après » — le user a dû le demander

- `[1× — 08-09]` 🔴 **J'ai livré `stop <projet>` sans avoir regardé Windows ; c'est la question du
  user qui a révélé le trou.** Le rattachement d'un pid à son projet passe par `lsof` — absent
  là-bas — donc la table est VIDE, et la commande répondait « aucun projet ne s'appelle X » :
  affirmer une absence là où l'on n'a rien pu regarder. Un dev Windows en conclut que son app est
  éteinte. La règle existe pourtant ([[feedback_cross_platform_axioms]]) ; ce qui a manqué, c'est de
  l'appliquer **pendant** l'écriture, pas de la connaître.
- `[1× — 08-09]` ⭐ **La grammaire de chemins INJECTABLE (`path.win32`) transforme une intention en
  preuve** — et le test doit DISCRIMINER : rejoué avec la grammaire posix, il tombe. Sans ce
  contrôle, deux de mes trois assertions Windows passaient par accident depuis macOS.

## 🤝 Un NOM partagé entre deux paquets est un contrat — et RIEN ne le teste

- `[1× — 08-09e]` 🔴 **Le point de rendez-vous d'un service DI existait en deux exemplaires** : une
  constante côté fournisseur (`security`), un littéral `"…"` côté consommateur (`devkit`, qui ne
  peut pas dépendre de lui). Un renommage d'un seul côté ne casse **aucune compilation** et
  **aucun test** — la porte cherche simplement un service que personne ne pose, en silence. Le
  remède n'est pas un test : c'est de faire vivre la constante **avec le contrat qu'elle nomme**
  (ici au cœur, à côté de `IAccessTokenVerifier`), et les deux paquets l'importent. **Le
  compilateur remplace alors le test qui manquait.** Vaut pour tout nom de service, d'événement ou
  de clé qui traverse une frontière de paquets. [[feedback_single_source_rule]]
- `[1× — 08-09e]` **C'est la question du user — « qu'est-ce qui teste ce renommage ? » — qui l'a
  révélé**, après que j'aie annoncé 969 + 117 + 2711 verts. Aucun de ces verts ne touchait la
  chaîne renommée. Un total impressionnant ne dit rien sur le SEUL geste qu'on vient de faire.
  [[feedback_green_covers_only_its_diff]]

## 📏 Une CELLULE obèse coûte × le nombre de LIGNES — le formateur propage la dépense

- `[1× — 08-20b]` 🔴 **Prettier aligne un tableau markdown sur sa cellule la plus longue.** Une
  cellule de 19 600 caractères paddait donc de blancs les 36 autres lignes de la phase : le
  tableau pesait 512 Ko pour 98 Ko de contenu, et le fichier 888 Ko dont **81 % d'espaces**. Sur
  tout le dépôt : **451 Ko de blanc** dans 176 tableaux. Ce n'est pas cosmétique — `CLAUDE.md`,
  `MEMORY.md` et `MIGRATION_STATUS.md` sont relus à CHAQUE tour, donc ces espaces se repayaient
  indéfiniment. Remède : `<!-- prettier-ignore -->` sur les tableaux **déséquilibrés** (> 40 % de
  remplissage) ; les tableaux réguliers gardent leur alignement, qui aide à lire la source.
- `[1× — 08-20b]` **Le vrai défaut se voyait à la longueur ÉGALE de lignes sans rapport** : cinq
  cellules à 18 966–19 002 caractères. J'ai d'abord soupçonné une duplication de texte — c'était
  le padding. **Une régularité suspecte se vérifie avant d'être expliquée.**
- `[1× — 08-20b]` **Trois lignes n'avaient qu'UNE colonne sur trois** dans un tableau à 3 colonnes :
  leur rendu markdown était cassé depuis toujours, et personne ne l'avait vu — parce qu'on lit le
  fichier en source, jamais rendu.

## 🎭 Un état SAUVEGARDÉ sans identité répond pour quelqu'un d'autre

- `[1× — 08-08e]` 🔴 **On réclame une mesure sous un compte de moindre privilège, on obtient celle
  de l'administrateur — sans un mot, et le canal censé être refusé s'ouvre.** L'état
  d'authentification réutilisé était repris quel que soit le compte DEMANDÉ : un fichier unique
  pour N identités. Correctif : l'identifiant entre dans le NOM du fichier (fragment lisible +
  empreinte anti-collision), effet de bord bienvenu — deux comptes gardent chacun leur session.
  Le test qui gardait ce décor était complaisant : il passait **sans que l'état soit jamais lu**.
- `[1× — 08-08e]` ⭐ **Une seule passe ne discrimine RIEN sur un refus** : un canal fermé à tout le
  monde rendrait le verdict attendu. Deux passes sur le MÊME canal (autorisé, puis refusé), qui
  s'enchaînent sans rien effacer — elles gardent du même coup le cloisonnement.

## 🎚️ Une valeur par DÉFAUT cache une hypothèse jusqu'au premier décor étranger

- `[1× — 08-08e]` **Premier passage d'un banc ailleurs que sur ce dépôt : le rouge n'accusait pas
  l'application testée, il accusait mon défaut.** Le scénario exigeait `api.request` — une capacité
  du plan d'ADMINISTRATION qu'un contrôleur temps réel d'application n'expose pas. L'hypothèse
  n'était écrite nulle part : elle vivait dans une valeur par défaut. Rendue désactivable, avec un
  relais déclaré par le contrôleur ; sans l'un ni l'autre, le banc n'exige plus un chiffre qu'il
  faudrait inventer. **Un paramètre par défaut qui n'a jamais changé de valeur n'est pas un
  paramètre — c'est une hypothèse non dite.**

## 🪞 Un serveur TOLÉRANT rend VERT ce qu'un serveur STRICT refuse

- `[1× — 08-10]` ⭐ **Un VRAI client tiers a trouvé en une tentative ce qu'aucun banc ne cherchait —
  et mon banc de la veille testait le SYMPTÔME en le prenant pour une garantie.** Le client MCP de
  Claude Code a refusé de se connecter : il sondait `/.well-known/oauth-authorization-server` sur
  `http://localhost:5151` et y recevait le document qui se réclame de `https://localhost:5152`. Les
  routes de publication étaient montées sans AUCUNE contrainte d'autorité, donc servies sur toutes
  celles que le serveur écoute. Or mon test de la veille — « il déclare l'émetteur configuré, jamais
  l'hôte par lequel on entre » — VÉRIFIAIT cette situation en la considérant comme correcte. La
  question qu'il fallait poser n'était pas « quel émetteur déclare-t-il ? » mais « **a-t-il le droit
  de répondre ici ?** ». Réflexe : pour tout document normatif servi à un chemin bien connu, se
  demander sur quelle ORIGINE il fait autorité — et faire 404 partout ailleurs.

- `[1× — 08-06j]` 🔴 **La table `session` stale (user TEXT d'avant le fix colKit) était VERTE sur
  MariaDB — qui créait l'index en auto-préfixant `user(768)` — et ROUGE sur MySQL 8.4, qui refuse.**
  Pas un rouge de décor : un VERT menteur, durable, sur le serveur quotidien. C'est la passe
  séparée MYSQL_COMMUNITY (serveur de preuve, volume plus jeune) qui l'a révélé. Angle neuf de
  [[feedback_stale_decor_poisons_verdicts]] : le décor sale peut aussi fabriquer du VERT.

## 🚚 Déménager un artefact vers un AUTRE public révèle ce qu'il supposait

- `[1× — 08-08]` 🔴 **Le user a attrapé à l'œil ce qu'aucun de mes contrôles ne voyait** : une
  sonde promue « générique » et distribuée par npm lisait encore l'attribut de thème d'une
  bibliothèque que seule notre console d'administration emploie, et devinait une route de
  connexion qui n'existe que chez elle. Rien ne pouvait le signaler — un skill part sur npm
  **sans compilation ni exécution**, et le code « marche » : il marche ICI. En cherchant les
  frères du défaut signalé, j'en ai trouvé un pire (le chemin de connexion deviné faisait
  mesurer une page d'erreur en croyant s'être authentifié). **Un artefact qui change de public
  se relit ligne à ligne en se demandant « qu'est-ce que ça suppose de MON décor ? »** — et la
  réponse se grave en gate, sinon elle se reperd.
- `[1× — 08-08]` **Ce qui est HORS du périmètre d'un sous-agent reste à faire, et c'est le user
  qui l'a vu.** J'avais bien borné la délégation (deux dossiers, interdiction du reste) ; l'agent
  a respecté, et signalé lui-même ce qu'il n'avait pas pu toucher. Mais je suis passé à la
  vérification sans traiter cette liste. **Un périmètre strict CRÉE une dette de répercussion :
  elle se traite au retour de l'agent, pas « plus tard ».**
- `[1× — 08-08]` **La précision doit vivre dans l'ARGUMENT, pas dans le code.** Le correctif
  n'était pas de retirer la mesure spécifique mais de la sortir en paramètre (`NF_BROWSER_PROBES`,
  `NF_BROWSER_LOGIN` sans défaut). Le dépôt retrouve son comportement exact en passant ses
  valeurs ; le code, lui, ne suppose plus rien.
- `[1× — 08-09g]` 🔴 **Une liste NOIRE tient tant que l'artefact est privé ; le jour où il est
  PUBLIÉ, elle fuit.** `JwtKeystore` retirait explicitement `d` du JWKS puis répandait le reste du
  keyset stocké (`{...pub}`) — correct tant que ce document servait à vérifier nos propres jetons
  EN MÉMOIRE. Exposé sur `/.well-known/jwks.json`, le même spread publiait `createdAt` (âge des
  clés), et publierait demain tout champ interne ajouté, **sans que rien ne le signale**. Ce n'est
  pas une inattention : la garde était juste POUR SON ANCIEN PUBLIC. Corollaire : **au moment où un
  artefact devient public, ses filtres se relisent à l'envers** — non pas « qu'est-ce que je retire
  ? » mais « qu'est-ce que j'autorise ? ». Trouvé par le banc LIVE (3ᵉ session d'affilée), invisible
  aux 989 unitaires qui n'exercent pas la sérialisation de bout en bout.

## 🗣️ Un juge qui exige une SORTIE VIDE meurt au premier bavardage d'un outil amont

- `[1× — 08-20d]` 🔴 **`code-check` déclarait ROUGE les 63 pages dont les 124 blocs COMPILAIENT** :
  son verdict était `status === 0 && sortie vide`, et npm s'est mis à écrire `npm notice run …` sur
  stderr autour de chaque `npx` — un changement d'outil AMONT a inversé un juge local. Second bug du
  même run : nom de dossier = concat des 63 pages → `ENAMETOOLONG` (l'outil n'avait jamais vu le
  corpus entier). Réparé + vu MORDRE (sabotage TS2322 → rouge, restauration → vert, diff vide).
  Règle : juger sur l'EXIT CODE + un filtre NOMMÉ du bruit connu, jamais sur « rien ne s'est
  affiché » ; et le seul autre juge-sur-sortie-vide du dépôt a été cherché (aucun).

## 🖨️ La SOURCE et le RENDU sont deux textes — formater l'un ne dit rien de l'autre

- Le formateur d'une application refusait **7 fichiers** qu'elle venait de recevoir de son propre générateur : le dépôt ne formate pas les `.tpl` (prettier ignore les extensions inconnues) et les assertions lisent des chaînes, pas une mise en forme. [1× — 08-22]
- Formater un gabarit À BALISES **dégrade** son rendu : prettier voit les balises masquées, une fois remplacées les lignes changent de longueur et la forme canonique n'est plus la même. Constaté au premier usage de mon propre script — deux fichiers acceptés par le gate en sont ressortis refusés. [1× — 08-22]
- Prettier **impose** l'alignement canonique d'une table markdown, calculé sur la cellule la plus large — donc sur un contenu qui n'existe que dans certaines variantes. Une table à lignes conditionnelles ne peut PAS être juste : elle devient une **liste**. [1× — 08-22]
- Certaines formes dépendent d'une valeur **interpolée** : `content="<nom> — …"` tient sur une ligne pour un nom court et doit être éclatée pour un nom long. Un gabarit rend UNE forme — d'où une variante « nom long » dans le gate, sans quoi on livre un rendu conforme aux noms courts seulement. [1× — 08-22]
- Un `prettier --write` sur un `.tpl` markdown lit une balise suivie d'une barre verticale comme une CELLULE et en **injecte** d'autres — le gabarit est corrompu sans un mot. [1× — 08-22]

## 🎯 Une sonde qui mesure le CHEMIN sanctionne un résultat juste

- La tâche 13 du banc décidait sur « a-t-il lancé `create service` ? » alors que son énoncé demande un service correct. Un service se MODIFIE toujours après génération : « généré » et « écrit à la main » ne sont ni distinguables ni pertinents. La mesure garde sa valeur — en **observation**, pas en verdict. [1× — 08-22]
- Ce que l'énoncé exigeait et que rien ne regardait : « chaque responsabilité testable séparément ». Un agent qui n'éprouve que la route obtient un test vert sans avoir rien séparé. Lire l'énoncé phrase à phrase et demander « qui juge cela ? » trouve les trous plus vite que relire les sondes. [1× — 08-22]
- Un périmètre d'exclusion en cache un besoin : `addedTs` exclut les tests (pour ne pas confondre fixture et config en dur), ce qui rendait **injugeable** tout ce qu'une tâche demande de prouver PAR un test. Le complément (`addedTests`) manquait. [1× — 08-22]

## 🧪 Vérifier que la transformation a EU LIEU, avant de croire la mesure

- Un hook a bloqué un appel Bash entier (garde `cd` relatif), **python inclus** : l'édition n'a jamais eu lieu, j'ai buildé du code inchangé et conclu deux fois sur du vide. Le `grep` de contrôle sur le fichier édité coûte une seconde. [1× — 08-22]
- `$?` après un pipeline est celui de la DERNIÈRE commande : `prettier --check f | tail` rend toujours 0. Quatre verdicts faux d'affilée. [2× — 08-22]
- `prettier --check` lancé depuis le dépôt sur un chemin HORS périmètre ne trouve aucun fichier et sort **0** : « conforme » disait en réalité « rien vérifié ». Toujours mesurer dans le décor où la config s'applique. [1× — 08-22]
- Le CLI s'exécute depuis `dist` : un gabarit se lit au disque (édition immédiate), le MOTEUR non — build avant de mesurer. [1× — 08-22]

## 🗄️ Gradué aux CONSOLIDATE (retiré d'ici — règle anti-doublon)

Ces thèmes ont quitté le sas pour des mémoires durables. Ne pas les réécrire ici.

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
