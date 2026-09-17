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

## 🪞 Le remède écrit pour corriger un message trompeur était lui-même FAUX

- [1× — 09-13e] 🔴 **J'ai failli livrer, dans le correctif d'un diagnostic menteur, une
  affirmation fausse du même genre.** Le défaut corrigé : un boot qui échoue en accusant
  `nodefony.config`, alors que ce fichier est juste. Mon nouveau message expliquait la vraie cause
  — « un fichier JavaScript vide est valide et son export par défaut vaut `undefined` ». Mesuré
  juste avant de commiter : c'est FAUX. Un fichier réellement vide fait lever ESM
  (`does not provide an export named 'default'`) ; le silence vient d'un export PRÉSENT mais vide
  (`export default {}`). Le message aurait envoyé chercher un `dist` tronqué qui n'existe pas —
  exactement le défaut que le correctif existe pour supprimer. **Une explication écrite dans un
  message d'erreur est une AFFIRMATION sur le runtime : elle se vérifie en l'exécutant, au même
  titre que le code.** Voisin gradué : [[feedback_fix_the_family_not_the_instance]] (le remède
  exposé au défaut qu'il corrige).
- [1× — 09-17d] 🔴 **Le plafond posé pour qu'un banc de 90 min ne soit plus tué à 60 a fait qu'il
  n'a plus jamais démarré.** Le plafond du job avait été rendu dynamique, en lisant
  `github.event.inputs.minutes` — or ce contexte n'existe ni sur `push` ni sur `schedule`, et
  l'expression est évaluée à la COMPILATION du job. Résultat mesuré sur neuf runs : **zéro job**,
  un rouge à chaque poussée, et le banc muet pendant neuf heures. Le symptôme ne ressemble pas à
  sa cause — un workflow rouge se lit « la mesure a échoué », jamais « le fichier ne compile
  plus ». **Ce qui tranche en une commande** :

  ```bash
  gh api "repos/<o>/<r>/actions/runs/<id>/jobs" --jq '.total_count'   # 0 → erreur d'évaluation
  gh api "repos/<o>/<r>/actions/runs/<id>" --jq '.run_started_at, .updated_at'  # égaux à la seconde
  ```

  Zéro job et deux horodatages identiques : personne n'a consommé d'exécuteur, ce n'est pas un
  échec de mesure. Corollaire : **une expression qui lit le contexte d'un déclencheur doit être
  valide sous TOUS les déclencheurs du fichier**, ou redevenir une constante.

- [1× — 09-17d] **Un filtre `paths` n'est pas une borne : GitHub l'évalue sur TOUT le push.** Un
  banc de 30 à 150 minutes borné à ses deux fichiers est parti sur un commit de documentation —
  il suffit qu'un autre commit du même lot touche un fichier visé. Une garde dont le verdict
  dépend de la COMPOSITION d'un lot ne garde rien qu'on puisse énoncer ; la borne qui tient est
  la branche. Même famille : [[feedback_prove_the_target_not_the_verdict]] (l'outil rend un
  verdict sur SON périmètre, qui n'est pas celui qu'on croit).

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

## 🪤 Ajouter un CAS à une table réveille les hypothèses que ses lecteurs n'avaient jamais écrites

- [1× — 09-12c] **Une garde rangée dans une branche ne garde que cette branche.** Le banc
  refuse (exit 78) un canal `local` qui exigerait un registre interposé — mais ce refus
  vivait dans la fonction de montage du décor. En ajoutant un décor VIDE qui saute ce
  montage, j'ai rendu la garde inatteignable **sans la toucher** : `--task 0` partait jouer
  sur un canal que npm ne sert pas. Un chemin neuf ne contourne pas seulement du code, il
  contourne les gardes que ce code portait ; la garde remonte donc dans le lanceur, où elle
  vaut pour tous les chemins. Vue mordre après coup.

- [1× — 09-11] **Un test prenait un NOM RÉEL comme contre-exemple, et le nom est devenu réel.**
  `agentTargets.test.ts` vérifiait le refus d'une clé inconnue avec `requestedAgents("claude,cursor")`.
  Le jour où `cursor` est entré dans la table, le test est passé au VERT en prouvant l'exact
  contraire de ce qu'il affirme — aucun signal, il ne rougit pas. Un contre-exemple se choisit
  parmi ce qui ne peut PAS exister (`agent-qui-nexiste-pas`), jamais parmi ce qui n'existe pas
  ENCORE.

- [1× — 09-11] **`flag: "wx"` lève ENOENT — qui n'est pas EEXIST — quand le dossier parent manque.**
  Tous les pointeurs d'instructions vivaient à la racine ; le premier posé en SOUS-DOSSIER
  (`.github/copilot-instructions.md`) sortait du `catch (EEXIST)` et faisait échouer la création de
  l'application ENTIÈRE pour un fichier d'appoint. La forme d'une valeur (un chemin à un segment)
  était une hypothèse tacite du code qui la consommait.

- [1× — 09-11] **Une garde inoffensive le reste tant que personne n'ÉCRIT.** `targetsToDeclare`
  faisait entrer tout agent détecté dont le canal n'était pas `cli` — sans danger, ces agents-là
  n'écrivaient rien. Le canal neuf, lui, ÉCRIT : la même ligne aurait posé un fichier chez un outil
  que personne n'a nommé, sur la seule foi d'un `.vscode/` présent. Élargir un ensemble, c'est
  relire ce que chacun de ses lecteurs en FAIT — pas seulement ce qu'il en lit.

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

## 🔗 Une DÉPENDANCE peut être encodée ailleurs que dans le champ « dépend de »

- [1× — 09-10] **Retirer un mécanisme oblige à corriger ce qui le PRESCRIT et ce qui le
  DÉCRIT — et ni l'un ni l'autre ne vit dans son fichier.** Le `prepack` de `@nodefony/studio`
  était rattaché au reste par deux liens qu'aucun `grep package.json` ne visite : un message du
  préflight de release qui annonçait « s'exécutera PENDANT le pack » (faux depuis que le pack
  passe `--ignore-scripts`, donc un message exact-mais-périmé qui envoie chercher là où il n'y a
  rien), et un gabarit de skill qui le PRESCRIVAIT « en filet ». Le contrôle qui les trouve n'est
  pas de chercher le nom du mécanisme dans le code, c'est de le chercher dans la PROSE exécutable
  et dans les gabarits — là où il est recommandé, pas là où il est déclaré.

- [1× — 09-09] **J'allais extraire un bloc de config et casser le générateur EN SILENCE ; c'est une
  question du user qui m'a arrêté, pas ma lecture du ticket.** #285 portait « Dépend de : rien », et
  j'ai pris ça pour un feu vert. La dépendance était pourtant écrite à DEUX endroits que je n'avais
  pas croisés : le champ `Ordre` du tableau (16.1 pour #284, 16.2 pour #285 — l'ordre encode les
  dépendances, c'est sa définition), et une section du corps intitulée « Ce qui n'est PAS dans ce
  ticket », qui nommait la raison exacte (« rendrait `doctor` aveugle tant que les lecteurs textuels
  du manifeste ne partagent pas une fonction unique »). Le terrain a confirmé : `roleHierarchy`
  vivait l.352, en plein dans le bloc que je déplaçais, et le scaffold l'ancre à l'expression
  régulière — zéro erreur, zéro constat, un rapport de surface qui se lit « tout va bien ».
  Le contrôle qui l'attrape avant d'écrire une ligne : **lire le champ `Ordre` ET la section « ce
  qui n'est pas dans ce ticket » du ticket VOISIN**, pas seulement `Dépend de` du sien.

- [1× — 09-09] **Un ticket peut partir de prémisses devenues fausses, et sa taille change alors du
  tout au tout.** #287 affirmait « seuls deux modules exposent leur schéma » et « aucune description
  n'est atteignable » : mesuré avant d'écrire, **neuf modules sur dix** le rendaient déjà, avec
  429 descriptions, et la provenance par champ existait. Le travail n'était pas la plomberie
  annoncée mais un RENDU. Mesurer les trois affirmations a coûté deux commandes ; les croire aurait
  coûté une refonte inutile. ↝ [[feedback_anchor_expires_silently]]

## 🧊 Un banc qui s'arrête au premier échec CACHE tout ce qui vient après

- [1× — 09-11d] **Le défaut corrigé a révélé le suivant, au même endroit.** Le banc de publication
  refusait l'image du scénario à frontend (clé privée). Corrigé, le scénario va PLUS LOIN et tombe
  sur une étape qui n'avait jamais pu s'exécuter : elle efface `public/dist` dans le conteneur, ce
  que le durcissement des droits a rendu impossible — le code appartient à `root`, le processus
  tourne en 1000, le `rm` échoue, la chaîne `&&` coupe, le serveur n'est jamais lancé. Le banc
  attendait alors 90 s un `/readyz` qui ne viendrait pas. Corollaire : après avoir réparé un banc
  rouge, ne jamais annoncer « c'est vert » — annoncer « il va plus loin », et relancer.

- [1× — 09-11d] **Un durcissement légitime du produit casse un banc, et rien ne le dit tant que le
  banc n'est pas rejoué.** Les droits ont été durcis quatre jours plus tôt ; le banc n'avait pas
  tourné depuis, et sa dernière passe verte datait d'une autre branche. Un banc hebdomadaire vert
  sur `main` ne dit RIEN du travail en cours sur `dev` — et c'est précisément quand on durcit
  quelque chose qu'il faut le rejouer.

- [1× — 09-11d] **La dernière passe verte d'un banc portait sur une autre branche, et je l'ai
  d'abord lue comme un acquittement.** « Verte le 07-09 » — sur `main`, donc sans quatre jours de
  travail. La date d'une passe ne dit pas ce qu'elle a exercé ; la BRANCHE, si.

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

- **`admin:read admin:write` par défaut n'avait aucun effet** — le plan d'administration n'a qu'un
  rôle, les deux scopes ouvrent la même chose. Précisément pour ça, personne ne l'aurait remarqué ;
  et le jour où la séparation lecture/écriture deviendrait réelle, tous les jetons émis d'office
  porteraient le pouvoir d'écrire sans qu'aucune décision ne l'ait accordé. Un défaut se choisit sur
  ce qu'il vaudra APRÈS le durcissement prévu, pas sur ce qu'il vaut pendant qu'il est inerte —
  le plus étroit se durcit tout seul dans le bon sens. [1× — 08-22e]

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

## 🧪 Ce qu'on PUBLIE est une affirmation — GRADUÉ

→ [[feedback_agent_example_over_prose]] (8 frictions) : une phrase de rapport écrite en dur dément
sa propre donnée, une preuve d'absence se formule en COMMANDE pour obliger à la lancer, et les
surfaces périphériques gardent l'ancien chiffre après un recalage.

## 🗄️ 🧨 DÉCLARATION qui désarme + 💾 CACHE à demi écrit — VERSÉS

> Versés le 2026-09-10 dans **`feedback_destructive_needs_identity_scope`** (§ « Détruire SANS EN AVOIR L'AIR ») : une déclaration, un nettoyage de décor ou une écriture de cache détruisent sans l'annoncer. Ne PAS réécrire ici.

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

## 🖥️ L'interactif se prouve au PTY — et chaque couche peut salir la sortie

- [1× — 09-13] **Les couleurs de MES commandes ont rendu le terminal du user illisible,
  deux fois dans la séance — et aucune commande lancée depuis l'agent ne peut le réparer.**
  `turbo`, `vitest` et `npm` émettent leurs séquences ANSI ; le harnais CAPTURE cette sortie,
  si bien qu'un `reset`, un `clear` ou un `printf '\033c'` lancé par l'agent s'affiche en
  TEXTE au lieu d'agir (et `reset` échoue en plus sur « Inappropriate ioctl for device »,
  faute de TTY). Deux gestes, dans cet ordre : **couper l'émission** (`NO_COLOR=1`,
  `FORCE_COLOR=0`, `TURBO_UI=false` — posés dans `env` de `.claude/settings.json`, effectifs
  au prochain démarrage), et si l'écran est déjà abîmé, écrire directement sur le terminal du
  process : `ps -o tty= -p $PPID` donne `ttysNNN`, puis `printf … > /dev/ttysNNN`. Ce qui a
  manqué au premier essai : le soft reset (`\033[!p`) répare le CORPS mais pas l'interface,
  qui se redessine depuis la palette — il faut `OSC 104` (palette) et `OSC 110/111/112`
  (couleurs par défaut). ⚠️ Ne JAMAIS enchaîner sur un `RIS` (`\033c`) sans accord : il
  efface le défilement, et c'est ce geste qui avait « mis la panique » une première fois.

- [1× — 09-09c] **Le défaut vécu par le user (jeton MCP tenté sur une base morte, trois stacks)
  n'existe QU'EN TTY — et mon e2e ne pose aucune question.** `planTokenChaining` rend `null` hors
  terminal : la voie qui a cassé est précisément celle que le banc ne peut pas emprunter. J'ai
  fermé #302 en le disant (« prouvé qu'en non-TTY »), mais la preuve du chemin réel attend un PTY
  ou la génération de l'alpha.4 par un humain. Un e2e qui passe là où le bug ne peut pas se
  produire ne prouve rien du bug.

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

## 👻 Un process qui n'écoute AUCUN port échappe à toute purge par port

- [1× — 08-29] `process.exit()` posé dans un `try` ne déroule AUCUN `finally` : les pods déjà levés survivaient au banc avec leur port ET leur connexion à la base, et le run suivant échouait sur un `DROP DATABASE` refusé — pour une raison qui n'était pas la sienne. Pire dans un cas : le pod fautif n'était pas encore rangé dans la variable que le `finally` inspecte, donc personne ne l'aurait arrêté. Abandonner se fait par une sentinelle qu'on JETTE.
- [1× — 08-23e] Un superviseur de développement orphelin (son enfant tué en `-9`) survit sans tenir
  le moindre port : invisible à `lsof`, absent d'un `pkill -f bin/nodefony` (son titre de process est
  autre), et pourtant bien vivant. Deux conséquences opposées le même soir — il **interdisait** tout
  démarrage en production (garde qui déduisait la collision d'une présence au lieu de la constater),
  et il **ressuscitait** le serveur au milieu d'une mesure. Un décor de banc se remet à zéro par
  l'arrêt PROPRE de l'outil (`nodefony stop`), la purge par port n'étant que le filet.

- [1× — 09-14d] 🔴 **Tuer un process ne tue pas son arbre : un `wrk` orphelin à 308 % de CPU.**
  J'ai arrêté un banc de tenue par un signal à SON process ; le générateur de charge qu'il avait
  lancé a survécu et a continué de saturer trois cœurs. Découvert par hasard en lisant un `ps`
  pour autre chose — rien ne le signalait, et toute mesure lancée ensuite aurait été fausse sans
  qu'aucun compteur ne bronche. Même famille que le superviseur sans port : ce qui échappe au
  critère d'arrêt continue de tourner. Le contrôle d'un décor propre doit énumérer les ENFANTS,
  pas seulement les écouteurs.

- [1× — 09-14e] 🔴 **Le symétrique : il ÉCOUTE, mais son NOM a changé — et c'est lui qui répondait
  à mes mesures.** Nodefony renomme son process (`setProcessTitle` → `nodefony server`), si bien
  que mes `pkill -f "bin/nodefony production"` échouaient **en silence** depuis une heure. Un
  serveur résiduel orphelin (`PPID 1`) tenait le port 5151 et servait toutes mes vérifications
  manuelles — trois instruments l'ont dit sans que je l'entende : une sonde SQL muette, un profil
  CPU ne contenant que du boot, et zéro `prepare()` pendant une requête. Le banc VERSIONNÉ, lui,
  était sain : il purge **par port** (`kill_listeners`), ce qui attrape un process renommé, puis
  attend la libération. Le geste : avant toute mesure à la main, reprendre la purge de l'outil —
  et **vérifier que le PID qu'on a lancé est celui qui écoute** (`lsof -t` comparé à `$!`).

## 🧱 Remplacer un mécanisme du NAVIGATEUR par du code à soi, c'est en devenir responsable

- [1× — 09-01d] Pour rendre le titre d'une section cliquable, j'ai troqué `<details>/<summary>` —
  dont le pliage est NATIF et ne peut pas tomber — contre un en-tête à deux commandes plié en
  JavaScript. Le pliage est tombé : l'écouteur était bien attaché (vérifié au protocole de débogage
  du navigateur), sans aucun effet, et le user a trouvé le menu bloqué avant moi. Revert. **Ce qui
  marche sans JavaScript ne se remplace pas pour un confort ; on AJOUTE à côté.**

## 🗄️ Gradué aux CONSOLIDATE (retiré d'ici — règle anti-doublon)

Ces thèmes ont quitté le sas pour des mémoires durables. Ne pas les réécrire ici.

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

## 📏 Le CHANGELOG résume, le titre approxime — seul le SOURCE dit ce que le code fait

- [1× — 09-14c] 🔴 **Trois lectures, trois vérités, et j'allais conclure sur la mauvaise.** Le
  changelog de Node annonçait « improve performance with known-length calls to `end()` » ; le titre
  du PR disait « known-length **string** », d'où ma crainte que notre `Buffer` soit exclu ; le
  **code** dit `typeof chunk === 'string' || isUint8Array(chunk)`, donc Buffer accepté. Le détour
  par `gh api repos/nodejs/node/pulls/<n>/files` coûte dix secondes et a renversé la conclusion.
  Voisin gradué : [[feedback_source_over_memory]] — ici la MÊME règle, appliquée à une dépendance
  externe et non à notre code.

- [1× — 09-17b] **Un fait sur un client TIERS se périme sans prévenir, et rien dans le dépôt ne le
  signale.** Notre table affirmait « codex : pas de skills », sourcée « rien dans son paquet
  (0.149.0) » — exact à la date de l'écriture, faux deux versions plus tard : le binaire 0.154 porte
  191 occurrences de `SKILL.md`, un validateur de frontmatter, et les chemins `~/.codex/skills` ET
  `.agents/skills`. Ces lignes se relisent quand on met un agent à jour, **jamais quand on édite le
  fichier qui les porte** — donc jamais. Le user l'a flairé sur une intuition (« c'est bizarre »),
  pas moi sur une relecture.

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

## 🎚️ Une méthode ÉCRITE et non IMPOSÉE ne s'applique pas — même quand on vient de la lire

- [1× — 09-14c] 🔴 **J'ai mesuré cinq camps en séries séquentielles alors que les paires alternées
  sont documentées** dans l'en-tête de `bench-ab-mono.sh` ET dans le skill que je venais de
  charger. Rien ne les imposait : il fallait taper `A1 ; B1 ; A2 ; B2` soi-même. Chaque série était
  propre (dispersion ≤ 3 %) et le RAPPORT entre deux camps ne valait rien — c'est l'audit délégué
  qui me l'a fait remarquer, pas moi. Même famille que [[feedback_gate_must_run]], côté mesure :
  ce qu'aucun script n'orchestre n'est pas appliqué.
- [1× — 09-17] **Une consigne qu'on ne peut pas tenir se REFUSE au départ.** `soak.yml` acceptait `minutes=90`
  sur un job plafonné en dur à 60 : le run partait, mourait à 60 min 17 s, et ne rendait AUCUN artefact — la
  seule trace était un job tué sans explication. Le plafond dérive maintenant de l'entrée, et une garde refuse
  au-delà de ce que la forge tient. Un défaut par ACCEPTATION est plus coûteux qu'un refus.

- [1× — 09-17b] 🔴 **J'ai REPRODUIT, le lendemain, le faux vert que j'avais corrigé la veille.** La
  sonde « a ouvert une annexe » avait été réparée le 09-17 pour exiger un APPEL D'OUTIL, avec le
  motif écrit en quinze lignes de commentaire juste au-dessus. Le jour suivant, j'ai écrit la sonde
  voisine (`docs.mjs`) sur le CHEMIN NU — elle a rendu vert sur deux runs où le script n'avait jamais
  tourné, les correspondances venant de la ligne d'`AGENTS.md` que l'agent venait de lire. Avoir
  NOMMÉ le piège, et l'avoir nommé à cet endroit précis, n'a pas protégé : seul un cas de contrôle
  l'aurait fait. C'est l'argument entier du selftest — il a d'ailleurs refusé le motif dès qu'on
  le lui a donné.

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
