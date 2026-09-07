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

## 🗄️ 🏭 Ce que le PRODUIT construit ≠ ce que la CONFIG demande — GRADUÉ

> Gradué au CONSOLIDATE du 2026-09-07 — versé avec le thème du test au substitut → **`feedback_prove_on_received_artifact`**. Ne PAS réécrire ici.

## 🗄️ 🧭 Un identifiant dans la MAUVAISE LANGUE (renommage) — GRADUÉ

> Gradué au CONSOLIDATE du 2026-09-07 — 14 frictions → **`feedback_code_rewrite_mechanical_traps`** (§ « Le RENOMMAGE ») : l’outil est juste sur ce qu’il comprend, muet sur les gabarits, JSON, docs et scripts. Ne PAS réécrire ici.

## 🗄️ 🤖 Un agent LIT l’interdit et le transgresse — GRADUÉ

> Gradué au CONSOLIDATE du 2026-09-07 — 6 frictions → **`feedback_destructive_needs_identity_scope`** : un refus doit nommer le GESTE de remplacement, pas le drapeau qui force. Ne PAS réécrire ici.

## 📖 Ce qui est ÉCRIT ne protège que si on le relit AU MOMENT du geste

- [1× — 09-07f] **J'ai redéclaré une règle que le `MEMORY.md` du module INTERDIT en toutes lettres.**
  Écrit un module de découverte RFC 8414 dans `@nodefony/security` alors que `security/MEMORY.md:119`
  dit « RFC 8414 vit au CŒUR — security l'IMPORTE, **ne le redéclare pas** ». J'avais ÉDITÉ ce
  fichier une heure plus tôt, deux zones ciblées, sans lire le reste. Les deux copies divergeaient
  déjà sur quatre points (ordre des URL, canonisation de l'émetteur, schéma toléré, redirections) —
  et c'est un audit délégué qui l'a vu, pas moi. Éditer un fichier n'est pas le lire.
- [1× — 09-07f] **Un script violait la règle écrite dans son PROPRE skill.** `ticket-open.mjs`
  dérivait l'ordre d'un sous-ticket par `gh project item-list`, que le SKILL.md du même skill
  interdit explicitement pour décider. Le remède n'est pas d'écrire la règle une troisième fois :
  c'est le gate qui la relit (test qui refuse l'appel dans tous les scripts du dossier).
- [1× — 09-07f] **Un outil disponible mais nommé NULLE PART n'est jamais employé.** Le serveur MCP
  du dépôt : 0 occurrence dans `CLAUDE.md`, `AGENTS.md` et les skills `nodefony-inspect`/`-debug`,
  contre 17 mentions de la commande équivalente — et 0 invocation, y compris pour des questions
  auxquelles il répondait mieux (j'ai fait un `curl` sur le plan d'administration à la place). Même
  mécanique que « un sous-agent n'ouvre jamais un skill de lui-même » : la disponibilité ne
  déclenche rien, seule la mention à l'endroit où la règle vit le fait.
- [1× — 09-07e] **Je suis tombé dans un piège que le skill du dépôt DOCUMENTE, à la ligne près.**
  `items(first:100)` sur le tableau de bord tronque à 100 sans le dire ; le tableau en comptait 101,
  et ma requête a rendu **1 ticket sur 7** avec toutes les apparences d'un inventaire complet. Le
  skill `nodefony-ticket` porte ce piège en toutes lettres, avec son remède. Je l'avais chargé une
  heure plus tôt — et je ne l'ai pas relu au moment d'écrire la requête. Un piège documenté ne
  protège pas de l'avoir lu : il protège d'être relu quand on pose le geste qu'il vise.

- [1× — 09-07e] **J'ai proposé trois remèdes AVANT d'avoir le message d'erreur.** `npm dist-tag`
  échouait ; j'ai supposé une session absente, puis une clé mal enregistrée, puis envoyé chercher un
  QR code qui n'existe pas dans cette configuration de compte. La cause tenait en une capture
  d'écran que le user a fini par envoyer : sa 2FA était une clé de sécurité, qui ne produit AUCUN
  code. Demander le message exact coûte un tour ; supposer en coûte trois, et fait chercher au
  mauvais endroit — le symptôme est qu'on propose des remèdes qui s'excluent.

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

## 🗄️ 🧪 Un test qui ne parle jamais au serveur — GRADUÉ

> Gradué au CONSOLIDATE du 2026-09-07 — 13 + 9 frictions → **`feedback_prove_on_received_artifact`** : le test parle à un substitut, et ce que le produit CONSTRUIT n’est pas ce que la config demande. Ne PAS réécrire ici.

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

## 🗄️ 🎯 Un PORT qui répond ne dit pas À QUI — GRADUÉ

> Gradué au CONSOLIDATE du 2026-09-07 — 9 + 9 frictions → **`feedback_stale_decor_poisons_verdicts`**, avec « le décor d’un banc est un état PARTAGÉ ». Ne PAS réécrire ici.

## 🗄️ 🧭 La doc qui AFFIRME une automatisation inexistante — GRADUÉ

> Gradué au CONSOLIDATE du 2026-09-07 — 14 + 7 frictions → **`feedback_capability_unreachable_is_absent`** : le miroir de la règle, plus « exiger un artefact sans regarder qui le PRODUIT ». Ne PAS réécrire ici.

## 🗄️ ⏳ Un symptôme qui ressemble à un DÉLAI — GRADUÉ

> Gradué au CONSOLIDATE du 2026-09-07 — 5 frictions → **`feedback_test_no_fixed_delay`** : et le symétrique, ce qui n’y ressemblait pas en était un. Ne PAS réécrire ici.

## 🗄️ 🚪 Une porte a plusieurs ENTRÉES — GRADUÉ

> Gradué au CONSOLIDATE du 2026-09-07 — 21 frictions versées dans
> **`feedback_single_source_rule`** (§ « Une porte a plusieurs ENTRÉES ») : le défaut vit dans
> la COMPARAISON des copies, jamais dans l’une d’elles. Ne PAS réécrire ici.

## 🗄️ 🧭 Une garde ne couvre jamais une AUTRE question — GRADUÉ

> Gradué au CONSOLIDATE du 2026-09-07 — 10 frictions → **`feedback_prove_the_target_not_the_verdict`** : la garde répond à SA question, pas à la voisine. Ne PAS réécrire ici.

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

## 🗄️ 🚧 Ajouter une EXIGENCE sans regarder qui PRODUIT — GRADUÉ

> Gradué au CONSOLIDATE du 2026-09-07 — versé avec la doc qui affirme → **`feedback_capability_unreachable_is_absent`**. Ne PAS réécrire ici.

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

## 🗄️ 🎭 Mon PROPRE `--dry-run` mentait — GRADUÉ

> Gradué au CONSOLIDATE du 2026-09-07 — 12 frictions → **`feedback_suspect_instrument_and_own_diff`** : l’outil fautif est celui que je viens de livrer. Ne PAS réécrire ici.

## 🗄️ 🪟 Un message d’erreur qui n’énonce QU’UNE cause — GRADUÉ

> Gradué au CONSOLIDATE du 2026-09-07 — 9 frictions → **`feedback_error_message_names_all_causes`**, mémoire neuve : dire ce qu’on a CONSTATÉ, pas ce qu’on en déduit. Ne PAS réécrire ici.

## 🕳️ Un gate rend un verdict RASSURANT sur son angle mort

- [1× — 09-07f] **`anchor-check` a classé « ce n'est pas un défaut » une ancre FAUSSE.** Son verdict
  `INDÉCIS` — « littéral, ou symbole prouvé par une ancre voisine », avec la consigne de ne pas la
  corriger — portait sur une ancre qui pointait une ligne interne au lieu de la classe annoncée.
  Le même run laissait passer 3 ancres périmées qu'un audit a trouvées ensuite. Un gate qui ne sait
  pas conclure doit le DIRE comme un trou à combler à la main, pas comme une absence de défaut :
  la formulation rassurante est ce qui empêche de vérifier.

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

- [1× — 09-07] **Le contrôle GRAVAIT le défaut comme résultat attendu.** Le cas de test de
  `expliquerEchec` donnait une sortie portant `✗ 1 PROBLÈME 4 angles morts` — la ligne qui NOMME
  le manquement — et son attendu écrit était `"nodefony doctor · bench-app 0.1.0"`, la bannière.
  Le correctif précédent avait déplacé le défaut d’un cran (du bruit npm à la présentation de
  l’outil) et le test avait figé le nouvel état comme correct. Dix rouges d’une nuit entière sans
  cause exploitable. **Après un correctif, relire le TEST : il a peut-être appris le défaut.**
- [1× — 09-07] **Ma preuve du correctif était VIDE, et son vert venait d’ailleurs.** Pour prouver
  que la reconstruction du décor réparait le gate, j’ai lancé `--task 30 --runs 1` : vert. Or avec
  UNE seule tâche la remise à zéro n’est jamais appelée — le `dist` venait du montage, mon code
  n’avait pas tourné. Il a fallu `--runs 2` pour l’exercer. **Un vert ne prouve un correctif que
  si le chemin corrigé a été EMPRUNTÉ** : le vérifier par une trace du code (ici la ligne
  « application reconstruite »), jamais par le seul verdict.

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

## 🗄️ 🤝 Un sous-agent répond « INCHANGÉE » — GRADUÉ

> Gradué au CONSOLIDATE du 2026-09-07 — 9 frictions → **`feedback_delegation_balance`** : il ÉCHANTILLONNE si on demande la rigueur, il BALAIE si on nomme les unités. Ne PAS réécrire ici.

## 🗄️ 🪤 Une garde peut EMPÊCHER ce qu’elle prétend gérer — GRADUÉ

> Gradué au CONSOLIDATE du 2026-09-07 — 20 frictions versées dans
> **`feedback_gate_must_bite`** (§ « Le RETOURNEMENT ») : un gate qui mord à l’envers, punit la
> bonne conduite, ou mange son propre témoin. Ne PAS réécrire ici.

## 🗄️ 🔇 Ce qu’on COUPE pour mesurer — GRADUÉ

> Gradué au CONSOLIDATE du 2026-09-07 — 6 frictions → **`feedback_shell_false_diagnostics`** : le réglage qui rend la mesure propre rend le diagnostic aveugle. Ne PAS réécrire ici.

## 👯 Un JUMEAU non vérifié n'est pas vérifié — « aligné » n'est pas « prouvé »

- [1× — 08-29c] **J'ai écrit un gabarit de test avec la convention du DÉPÔT, pas celle d'une application générée.** Le dépôt tourne en `globals: true` ; une application générée, non — ses tests importent leurs primitives. Le fichier a échoué sur `beforeAll is not defined`, dans l'application, à l'exécution. Même famille au cas suivant : le banc visait la base de DÉVELOPPEMENT et non celle de la suite, donc il rendait « en retard » — un verdict juste, sur la mauvaise base. **Un gabarit ne se relit pas, il se GÉNÈRE puis se LANCE** : les deux défauts étaient invisibles à la lecture et évidents à la première exécution.

- [1× — 08-28d] **Mes tickets contredisaient la conception sur DEUX contrats publics, et je les croyais dérivés d'elle.** J'exigeais quatre codes de sortie distincts là où elle en fige trois ; j'écrivais `orm:status` là où elle écrit `orm:migrate:status` — un nom de commande gelé à la publication, cité par ses propres messages d'erreur testés comme contrats. Écrire « d'après le document » n'est pas l'avoir relu : ce qu'on dérive de mémoire diverge silencieusement de sa source, et un contrat gravé faux ne se répare plus qu'en rupture majeure. La confrontation ligne à ligne coûte deux minutes, et c'est le seul geste qui l'attrape.
- [1× — 08-23e] Deux scripts de banc portent en en-tête « à garder alignés ». J'ai appliqué le même
  correctif aux deux, puis validé la sortie JSON **d'un seul**. L'autre ajoutait cinq `%s` au format
  sans les arguments correspondants et produisait du JSON invalide (`"warmupSec":,"durSec":,`) —
  découvert seulement parce qu'un consommateur a refusé de le lire, plusieurs heures après.
  **Prouver sur un artefact ne prouve rien sur son jumeau**, et un `printf` mal alimenté ne lève
  jamais : il écrit un trou. ↝ [[feedback_prove_on_received_artifact]]

## 🗄️ 🎪 Le DÉCOR d’un banc est un état PARTAGÉ — GRADUÉ

> Gradué au CONSOLIDATE du 2026-09-07 — versé avec « un PORT qui répond » → **`feedback_stale_decor_poisons_verdicts`**. Ne PAS réécrire ici.

## 🗄️ 📖 Une DOC qui enseigne un geste dangereux — GRADUÉ

> Gradué au CONSOLIDATE du 2026-09-07 — 9 frictions → **`feedback_agent_example_over_prose`** (§ « Le revers ») : un mauvais exemple AGIT et survit à la correction du code. Ne PAS réécrire ici.

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
