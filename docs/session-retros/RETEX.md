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

## 🧭 Annoncer une NORME sans l'avoir lue jusqu'aux ÈRES

- `[1× — 08-09c]` 🔴 **Un serveur PARFAITEMENT conforme à la dernière révision peut ne parler à
  PERSONNE.** `initialize` annonçait notre révision préférée (`2026-07-28`) à tout client au lieu
  d'ÉCHOER celle qu'il demande — or aucun SDK déployé ne la connaît (`@modelcontextprotocol/sdk@1.30.0`
  plafonne à `LATEST = 2025-11-25`) : Claude Code raccrochait. **Aucun test ne pouvait le voir** —
  ils validaient la conformité, pas la joignabilité. C'est un VRAI client qui l'a montré, en une
  ligne d'erreur. Règle : **la conformité se mesure sur un client, pas sur une spec** ; et une
  liste de versions annoncées est une PROMESSE (un test exerce désormais chacune).
- `[1× — 08-09c]` 🔴 **Une justification d'écart NON VÉRIFIÉE devient une excuse, et se recopie.**
  « Authentifier exigerait que Nodefony soit un serveur d'autorisation OAuth 2.1 complet » —
  écrit dans le TSDoc, le README et la doc du module. **Faux** : la spec fait du serveur MCP un
  simple _resource server_, et place l'AS « beyond the scope […] or a separate entity ». Le reste
  à faire était donc un ordre de grandeur plus petit que ce qu'on s'était raconté. Une phrase qui
  justifie de NE PAS faire quelque chose mérite la même vérification qu'une phrase qui affirme.
- `[1× — 08-09c]` **Un catalogue filtré MENT PAR OMISSION si rien ne le dit.** Un outil retenu
  faute d'autorisation est indistinguable d'un outil inexistant — voulu (ne pas révéler), mais
  l'agent en conclut « rien de plus ici » et **ne demandera jamais de jeton**. Le remède est un
  NOMBRE sans les noms, et il n'a coûté que cinq lignes. Vaut pour tout filtrage par droits :
  décider ce qu'on cache est la moitié du travail, dire QU'ON cache est l'autre.
- `[1× — 08-09c]` **Le filtre par droits se pose à UN seul endroit, ou c'est un rideau.** Filtrer
  `tools/list` sans filtrer `tools/call` laisse l'outil appelable en le nommant. En filtrant à la
  COLLECTE (en amont du protocole), les deux sont couverts par construction — et l'invariant
  s'écrit au TSDoc de l'appelant : « ne jamais passer ici une liste non filtrée ».
- `[1× — 08-09c]` **La CI était rouge sur 6 jobs et je ne l'avais pas regardée** — le user me l'a
  signalé. Cause : un cas exécutant un scan de dépôt réel sous le timeout IMPLICITE de 5 s de
  vitest. Vert en local, rouge partout ailleurs. **Un timeout jamais choisi est un seuil quand
  même** ; tout test qui exécute un vrai balayage porte sa borne explicite.
- `[1× — 08-09b]` 🔴 **« La RFC MCP est respectée à la lettre ? »** — non, et j'avais écrit un
  serveur **legacy qui annonçait une révision moderne**. La spec `2026-07-28` définit deux ÈRES :
  _modern_ (capacités en `_meta` PAR REQUÊTE, `server/discover` obligatoire) et _legacy_ (handshake
  `initialize`, ≤ 2025-11-25). J'avais bâti sur `initialize` — donc l'ère legacy — tout en
  répondant `protocolVersion: 2026-07-28`. Le tableau de compatibilité de la spec classe ce couple
  « Fails ». J'avais lu le fichier `transports`, pas `versioning` : **les exigences qui comptaient
  n'étaient pas dans la page qui parlait de mon sujet.** Trois MUST manquaient (`server/discover`,
  `-32022`, `-32020`). Corrigé, et le dual-ère est désormais un CHOIX écrit, plus un accident.
- `[1× — 08-09b]` **Un livrable neuf change la SURFACE d'exposition d'un défaut ancien.** Le serveur
  MCP échappe à la zone du pare-feu (son pattern exige un segment `api`, que `/nodefony/mcp` n'a
  pas). En le sondant, j'ai trouvé `security.totp.encryptionKey` **en clair** — un défaut
  PRÉEXISTANT du producteur, que la console d'admin protégeait par un 401 et que ma route servait
  à tout venant. La leçon n'est pas « corriger la porte » mais **mesurer ce qu'une porte nouvelle
  rend accessible qui ne l'était pas** : la redaction vit dans le producteur, donc c'est là qu'on
  répare, et toutes les portes en profitent.
- `[1× — 08-09b]` **Deux définitions de « secret » cohabitaient** (`SECRET_KEY` du data plane vs
  `pathLooksSecret` des journaux) : `encryptionKey` tombait entre les deux. Et **la correction
  intuitive était pire que le mal** — élargir à `key` emportait `apiKeys.prefix`,
  `passkeys.timeoutMs` et `key: "app"`, l'identifiant dont la console indexe ses entrées. Mesuré
  sur les 565 clés d'une app réelle AVANT de choisir. Une règle qui rédige du non-secret finit par
  être retirée ; la garde qui manquait est générique : **un secret est une valeur SCALAIRE**.
- `[1× — 08-09b]` **Le user a demandé « et dans une app générée ? » — je n'y avais pas pensé.**
  L'`AGENTS.md` généré ne parlait pas du serveur MCP : la porte existait et personne ne pouvait
  l'apprendre. Une capacité livrée sans son point d'entrée dans le fichier que l'agent LIT n'existe
  pas. Même famille que « une capacité arrive AVEC sa tâche ».
- `[1× — 08-09b]` **Un choix d'URL est un choix d'ARCHITECTURE, et le user l'a vu avant moi.**
  J'avais posé `/nodefony/devkit/api/mcp` — nom du module dans une URL qui part dans le `.mcp.json`
  de chaque utilisateur. Un contrat public ne porte pas un détail d'implémentation qui déménagera.
  Corrigé en `/nodefony/mcp` ; effet de bord découvert ensuite : sans segment `api`, la route sort
  de la zone du pare-feu — ce qui était nécessaire, mais qu'il fallait CONSTATER, pas subir.

## 📌 Un chiffre publié sans son COMMIT n'est pas vérifiable

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

## 🔬 Quatre instruments faux d'affilée sur UNE seule question

- `[4× — 08-07]` 🔴 « Qui bloque la boucle d'événements ? » a produit : `setInterval`+`setTimeout(0)`
  (Node borne un délai de 0 à ~1 ms → on mesure le minuteur : « SQLite bloque 0,43 ms » pour 33 µs) ·
  `monitorEventLoopDelay` (résolution ~1 ms → rend son propre plancher pour les DEUX pilotes) ·
  une colonne **« bloque la boucle ? non »** qui AFFIRMAIT sans avoir mesuré · `process.cpuUsage()`
  lu comme « CPU du fil principal » alors qu'il compte tous les fils (110 % du temps mural observé).
  **Règle qui en sort : un banc qui n'a pas mesuré doit SE TAIRE, pas répondre « non ».**
- `[1× — 08-08d]` 🔴 **Un verdict de CI se lit avec son HORODATAGE et son SHA, sinon il parle du
  passé.** Après un rebase dependabot, `gh pr checks` rendait « 7 fail » — des runs de **08:20 UTC**,
  antérieurs à toute la session. J'allais annoncer « la PR échoue encore ». Le SHA n'avait pas bougé
  parce que le rebase avait CONCLU autre chose (« no longer updatable » → PR fermée d'elle-même).
  Un tableau de checks est un cache d'états, pas une mesure fraîche.
- `[1× — 08-08d]` 🔴 **`git diff A...B` (trois points) ne compare PAS deux branches** : il compare la
  BASE COMMUNE à `B`. J'en ai conclu que `main` était en avance sur `claude-ts` (`@v7` contre `@v5`)
  et j'ai failli annoncer une régression d'actions au merge — les deux branches étaient déjà en
  `@v7`. Pour l'écart réel entre deux têtes : deux points, ou lire chaque côté (`git show B:fichier`).
- `[1× — 08-08d]` **`ps -A | grep -c "motif"` se compte LUI-MÊME** (« 2 process résiduels » après un
  arrêt parfait). Ajouter `| grep -v grep`, ou mieux : afficher les lignes plutôt qu'un compte —
  un compte ne se relit pas, une liste vide se constate.
- `[1× — 08-07]` ⭐ **Ce qui a fini par trancher : chercher un effet MACROSCOPIQUE.** Armer un rappel
  avant la requête et regarder quand il part → SQLite retarde de 134 ms pour 133 ms de travail,
  PostgreSQL de 0,22 ms pour 503 ms d'attente. À cette échelle, aucun instrument fin n'intervient.
  Quand quatre mesures fines se contredisent, changer d'ORDRE DE GRANDEUR plutôt que d'instrument.
- `[1× — 08-07]` 🔴 **Deux explications successives réfutées, dont ma « correction »** : « le
  round-trip Docker est incompressible » (faux : l'attente ne consomme pas la boucle), puis « c'est
  PostgreSQL qui sature » (faux : coïncidence de deux erreurs — un `EXPLAIN ANALYZE` à froid et
  460 % de CPU lus comme une saturation alors que la VM a 8 vCPU). Le vrai coupable — le chemin
  réseau VIRTUALISÉ — ne s'est montré qu'en DEMANDANT à la base : `pg_stat_activity` pendant la
  charge (40 backends sur 40 en `ClientRead`) et `pgbench` dans le conteneur (11-12,9 k tps contre
  ~5 400 depuis l'hôte).

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

## 🔦 Une capacité qu'on n'ATTEINT pas n'existe pas

- `[1× — 08-07d]` 🔴 **J'ai fait jouer la sonde au user pendant des heures alors qu'un navigateur
  en conteneur était déclaré depuis longtemps.** Il a fallu qu'il s'énerve — « oui tu as un
  navigateur, j'arrête pas de le dire » — pour que je l'atteigne. La capacité vivait dans un
  `references/` d'un skill front, chargé à la demande, qui ne se déclenche que sur du dev front.
  **Une capacité TRANSVERSE rangée dans un artefact THÉMATIQUE est morte** : ses déclencheurs ne
  sont jamais ceux du contexte où on en a besoin. Réparé par un skill dédié (`nodefony-browser`)
  - un pointeur au `CLAUDE.md`. Test à s'appliquer : « si j'avais besoin de ça sans le savoir,
    quel mot de ma demande m'y amènerait ? » — s'il n'y en a aucun, la porte n'existe pas.
- `[1× — 08-07d]` **Et ce qu'elle apportait dépassait ce que j'en attendais** : pas seulement des
  captures — `getComputedStyle` rend les contrastes CALCULÉS, ce qui valide une correction de
  palette sans attendre un audit. On sous-estime un outil qu'on n'a jamais ouvert.

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

## 🧪 Un gate ne prouve rien tant qu'on ne l'a pas vu ROUGE — deux faux verts le même jour

- `[1× — 08-10]` 🔴 **LE DÉBRANCHEMENT LUI-MÊME PEUT NE PAS COMPILER — et un build masqué fait
  alors mesurer l'ANCIEN binaire.** `if (false) { … }` rend le bloc inatteignable : TypeScript y
  perd le narrowing, le build échoue (TS2345) — mais j'avais écrit `npx turbo build … >/dev/null
2>&1 && start.sh`, donc l'échec est passé inaperçu et le serveur a redémarré sur le binaire
  PRÉCÉDENT. J'ai lu « 5 rouges » là où j'en attendais 1, et j'ai failli conclure que ma garde ne
  mordait pas. Ce qui a sauvé : le compte de rouges annoncé AVANT de couper ne tombait pas juste →
  interroger le SERVEUR (l'`aud` réellement inscrit dans le jeton rendu) au lieu de relire mes
  tests. **Deux règles** : jamais `>/dev/null` sur un build dont dépend une mesure ; et un
  débranchement se CONSTATE sur le comportement observable, pas sur le fait qu'on a édité la ligne.
  Forme sûre quand un littéral `false` casse le typage : neutraliser la CONDITION
  (`[x].includes(x) === false`) plutôt que le `if`.
- `[1× — 08-10]` ⭐ **Le seul test qui discrimine est le cas POSITIF ; les tests de refus passent
  volontiers pour la mauvaise raison.** Blue d'une faille où un jeton tiers n'apportait aucune borne
  temporelle : sur cinq tests neufs, le débranchement de la correction n'en a fait tomber QU'UN —
  « reste valide tant que le jeton n'a pas expiré ». Les trois « tombe quand … » restaient verts
  parce que, sans borne, TOUT tombait en fail-closed. Sans le cas positif, j'aurais eu quatre verts
  et zéro preuve. Réflexe : dans une matrice de refus, toujours un cas qui doit RÉUSSIR — c'est lui
  qui distingue « la garde marche » de « rien ne passe ».
- `[1× — 08-09g]` 🔴 **Débrancher UNE garde ne prouve QUE celle-là — un débranchement partiel se
  lit comme un débranchement.** Six tests couvraient le refus de publier un émetteur ; j'ai coupé
  le drapeau (`jwt.jwks`) et **un seul** est tombé. Lu vite, « la garde mord » — en réalité les
  trois refus qui comptent (émetteur absent, non-URL, en clair) restaient verts parce que la
  VALIDATION, elle, n'était pas débranchée. Il a fallu un second débranchement (`canonicalIssuer`
  → identité) pour les voir rouges. **Compter les rouges attendus AVANT de couper** : un
  débranchement qui fait tomber moins de tests que prévu n'a pas prouvé les autres, il les a
  laissés dans l'ombre.
- `[1× — 08-09f]` ⭐ **Le TSDoc PROMETTAIT ce que le code ne faisait pas — et 26 unitaires verts
  n'y voyaient rien.** J'avais écrit, dans l'en-tête de l'erreur : « le message reste générique,
  la cause part au journal, jamais au client » — puis composé la cause DANS le message
  (`Token verification unavailable: ${error.message}`). Le banc live l'a sorti au premier coup :
  l'URL de l'émetteur défaillant dans le corps d'une 503, pile d'appels comprise. Une phrase
  d'intention n'est pas une garde ; elle rend même la relecture plus difficile, parce qu'on lit
  la promesse au lieu du code. Réflexe : quand un TSDoc affirme qu'une valeur NE fuite PAS,
  écrire le test qui le vérifie **dans le même geste** — sinon la phrase est un vœu.

- `[1× — 08-09f]` **Un test écrit contre l'ANCIEN comportement d'une brique de base est le seul
  qui prouve la cohabitation.** `jwt` et `external-jwt` reconnaissent le même `Bearer <jws>` ;
  débrancher la discrimination par `iss` a montré ce qui se serait passé en production — le
  premier listé capturant les deux familles, la moitié des jetons refusés, et l'ORDRE d'une liste
  de configuration promu au rang de décision de sécurité, sans qu'aucun test ne s'en plaigne.

- `[1× — 08-09e]` ⭐ **Un débranchement ne fait pas que valider un test : il peut DÉMONTRER qu'une
  conception était fausse.** Remettre ma liste noire des pannes (la version que j'allais livrer)
  a produit 3 rouges nommés — la preuve chiffrée que trois pannes d'infrastructure auraient été
  rendues comme des refus d'authentification. Débrancher la version ANTÉRIEURE d'un correctif,
  et pas seulement le correctif, transforme « j'ai corrigé » en « voici ce que ça coûtait ».

- `[1× — 08-07d]` 🔴 **Une chaîne passée à `waitForFunction` est évaluée comme une EXPRESSION** :
  donner `() => x` y DÉFINIT une fonction sans jamais l'appeler ; l'objet fonction est truthy,
  donc l'attente réussit **toujours**, même sur une condition impossible. Trouvé uniquement en
  testant une condition qui NE POUVAIT PAS être vraie. Toute condition d'arrêt se vérifie ainsi.
- `[1× — 08-07d]` **Un squelette de chargement plus court que ce qu'il remplace ne réserve rien**
  — il déplace le décalage au moment de la substitution (0,151 des 0,219 de CLS de la page).
  Et deviner « la bonne hauteur » ne tient pas : elle change avec le contenu. Le correctif est
  structurel — garder la MÊME enveloppe et n'en remplir que l'intérieur.
- `[1× — 08-09d]` 🔴 **LE DÉBRANCHEMENT LUI-MÊME PEUT NE RIEN DÉBRANCHER, et alors le vert ment
  DEUX fois.** Pour voir rouge un test de route, j'ai retiré le controller de
  `@controllers([...])` — la route a continué de répondre : c'est `@controller` qui appelle
  `Router.createRoute()` **à l'import**, `@controllers` ne fait que l'associer au module. J'ai
  failli en conclure « le test ne mord pas » alors que je n'avais rien coupé. Corollaire : avant de
  juger un test complaisant, **prouver que le débranchement a EU LIEU** — et le prouver autrement
  que par `git diff --stat`, qui rend **VIDE sur un fichier neuf non tracké** (symétrique du piège
  déjà connu du `git stash push` sur fichier commité). Ce jour-là, la seule preuve valable était
  les rouges eux-mêmes.
- `[1× — 08-09d]` 🔴 **Deux `404` qui se ressemblent font un test qui passerait aussi SI LE CODE
  N'EXISTAIT PAS.** Une route « rôle éteint » et une route jamais montée rendent le même statut :
  l'assertion `toBe(404)` ne prouve rien. Ce qui les sépare est le CORPS — objet minuscule du
  controller contre enveloppe du framework (`nodefony`, `requestId`, `stack`). Règle : quand la
  réponse ATTENDUE est aussi la réponse par DÉFAUT (404, `null`, tableau vide, `false`), le test
  doit exhiber le témoin qui distingue les deux — sinon il mesure l'absence de tout.

## ⏱️ Un test qui attend un DÉLAI FIXE mesure la machine, pas le code

- `[2× — 08-08b]` 🔴 **Trois rouges d'intégration d'affilée, trois SONDES fausses — jamais le code
  mesuré.** `bearer` (anti-ReDoS) reconstruisait une chaîne de plusieurs centaines de kilooctets
  DANS la fenêtre chronométrée, et comparait deux durées d'~1 ms sur un agent partagé où une
  préemption vaut 1,2 ms : ×4,05, puis ×3,03, puis ×3,23, sur trois cases différentes de la
  matrice. `LogSink` attendait 30 ms fixes que le pool de threads confirme une écriture, puis
  fermait — le secours synchrone réécrivait alors un chunk DÉJÀ sur le disque (`a\na\nb\nc\n`).
- `[1× — 08-08b]` ⭐ **Le remède n'est jamais de relâcher le seuil** — il grignote la marge du côté
  fautif. Deux formes, selon ce qu'on peut atteindre : porter le SIGNAL au-dessus du bruit quand la
  grandeur est libre (200 k→800 k : la préemption dilate alors les deux mesures proportionnellement
  et s'annule dans le rapport — vérifié, ratio inchangé à 0,01 près sous contention) ; ou rendre le
  FAIT observable quand il ne l'est pas (compter les écritures non confirmées via le `write`
  injectable que le sink exposait déjà).
- `[1× — 08-08b]` 🔴 **Le second cas du même fichier était plus gravement atteint et n'avait jamais
  rougi** : sous pool lent il rendait `err\nout\nout\n`, l'ordre causal INVERSÉ. Quand une sonde
  est convaincue de parier, relire ses VOISINES — la même hypothèse temporelle y dort.
- `[1× — 08-08b]` **Le fichier se contredisait à vingt lignes d'écart** : « le témoin fautif ne rend
  jamais la main sur 200 k » (l.91) et « contrôlé sur le témoin, ×3,88 aux mêmes conditions »
  (l.112) — mesuré, il quadruple dès 4 k et met 868 ms à 32 k, donc ~34 s à 200 k. Un commentaire
  chiffré qui n'a pas été REJOUÉ vieillit comme une donnée, pas comme une intention.
- `[1× — 08-08e]` 🔴 **Un budget de temps calibré sur mon poste tombe sur la plateforme la plus
  lente — celle qu'on éprouve le moins souvent.** Un lancement coûte ~0,2 s ici et 2 730 / 2 308 /
  2 697 ms sur l'exécuteur Windows : le défaut vitest (5 s) ne laissait qu'une marge de deux, et le
  seul cas enchaînant DEUX lancements a expiré à 5 041 ms. Le rouge n'accusait pas la portabilité
  du code mesuré, mais l'impatience du test. Chaque cas porte désormais son budget explicite.

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

## 🔎 Ce que le journal des commits CACHE

- `[1× — 2026-07-30]` 🔴 **Un correctif logé dans un commit au sujet étranger est invisible, et on
  le réécrit.** Deux trous « ouverts » d'un kit étaient corrigés depuis.

## 📦 npm : un arbre réparé à la MAIN n'est pas une garantie

- `[1× — 2026-07-30]` 🔴 **Un `node_modules` remis droit à la main tient jusqu'au prochain `npm
install`.** Et `npm run build` vert ne dit rien du chemin réel qu'emprunte l'utilisateur.
- `[2× — 08-08b]` 🔴 **`npm outdated --workspaces --include-workspace-root` ne montre PAS les
  dépendances de la RACINE** (« 0 périmé » alors que `turbo` et `typescript` attendaient ; `npm
outdated` NU les montre). Corollaire : **un sous-agent hérite de la cécité de la commande qu'on
  lui DICTE** — rapport exhaustif sur périmètre amputé, rien dans sa forme ne le signale.
  **Reproduit à l'identique, `turbo` compris** : la leçon était ÉCRITE ici et je ne l'avais pas lue
  au démarrage ; c'est le user qui a vu les manques. Le second manqué, `@angular/compiler-cli`,
  était pire qu'un oubli — j'avais monté `@angular/core` sans son compilateur, donc **créé** une
  incohérence de version qu'aucun outil ne signalait.
- `[1× — 08-08b]` ⭐ **La réponse n'est pas une meilleure invocation, c'est un AUTOMATE** : lire les
  pins exacts de tous les `package.json` versionnés et interroger le registre pour chacun (3 écarts
  sur 95, exhaustif, reproductible). Tant qu'on cherche le bon drapeau, on reste tributaire de ce
  que l'outil choisit de montrer. Script : `scratchpad/audit-pins.mjs` — mériterait `scripts/`.
- `[1× — 2026-08-02i]` **Une dépendance déclarée à N endroits ne se monte pas à N−1** (`tsx` dans
  3 workspaces ET à la racine). Relever TOUS les sites déclarants avant d'éditer le premier.
- `[1× — 08-08d]` 🔴 **`devDependencies` ne protège RIEN d'un paquet que le bundler INLINE.** J'avais
  qualifié une alerte de sécurité de « jamais embarquée en production » parce que `mermaid` est en
  devDep de Studio ; le user a corrigé. Studio publie son UI **pré-buildée** (`files: ["dist",
"public"]`), `MarkdownDoc.tsx` fait `await import("mermaid")`, et le bundle contient bien
  `mermaid.core-*.js` + un chunk `DOMPurify` — donc du code exécuté dans le navigateur d'un
  administrateur. **Le classement d'une dépendance dit ce que npm INSTALLE chez le consommateur, pas
  ce que Vite a mis dans l'artefact qu'on lui sert.** Ce qui protège ici est ailleurs : le `prepack`
  qui reconstruit le bundle — sans lui, `npm pack` embarquerait le bundle du DISQUE (gitignoré ou
  non, dès que `files` le liste), vieux de cinq semaines, sans qu'aucun `npm audit` ne le voie.

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

## 📚 La doc officielle périme la mémoire — deux fois dans la même session

- `[1× — 08-09e]` ⭐ **Lire la SOURCE de `jose` a INVERSÉ une décision de conception, pas seulement
  corrigé un détail.** J'avais classé refus/panne par liste NOIRE des pannes (`ERR_JWKS_TIMEOUT`…).
  La source montre qu'un JWKS répondant `500`, un corps non-JSON et un `fetch` qui rejette y lèvent
  une erreur **générique** (`ERR_JOSE_GENERIC`) ou **sans aucun code** : les trois pannes seraient
  devenues « jeton invalide », envoyant un client renouveler un jeton parfaitement bon. Liste
  BLANCHE des fautes du jeton, tout le reste = panne visible. **Le fait vérifié n'était pas une
  signature d'API — c'était une TAXONOMIE d'erreurs, que rien ne documente et qu'aucun type
  n'exprime.** Là où la doc suffit pour appeler, seule la source dit ce qui SORT quand ça rate.

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

- `[1× — 08-09d]` 🔴 **La même spécification a été RETÉLÉCHARGÉE trois fois dans la journée**, par
  trois sessions qui se posaient la même question — le user a dû le signaler. Une norme est le
  contraire d'une page volatile : elle ne bouge qu'à une révision. Elle est désormais figée hors
  ligne (`nodefony-rfc/references/`, 758 Ko : la révision MCP entière + `schema.ts` + RFC OAuth).
  Rangée là, et pas dans un skill « devkit », parce que **le déclencheur réel est « que dit la
  norme ? »** : un agent qui code le MCP n'ouvre pas un skill décrit comme éprouvant un scaffold,
  et la doc y serait restée inatteignable.
- `[1× — 08-09d]` ⚠️ **Deux exigences que j'aurais écrites FAUSSES de mémoire, sur un sujet que je
  croyais connaître** : `invalid_request` veut **400**, pas 401 (RFC 6750 §3.1) ; et une requête
  sans aucune information d'authentification se refuse **SANS code d'erreur** (§3) — un
  `invalid_token` y ferait renouveler en boucle un jeton qui n'existe pas. Les deux sont ancrées
  par un test citant la ligne. Le réflexe qui a payé : ouvrir la RFC pour les DÉTAILS aussi, pas
  seulement pour l'architecture.

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

## 🧰 Outillage : ce qui pend, ce qui ment, ce qui lance

- `[1× — 08-09g]` 🔴 **AJOUTER une ressource à un corpus sans inventorier les AUTRES corpus
  perpétue le doublon.** J'ai téléchargé la RFC 8414 dans `nodefony-framework-dev/references/rfc/`
  — le bon endroit, où sont ses 38 sœurs — sans regarder que `nodefony-rfc` hébergeait un second
  corpus. **C'est le user qui l'a vu**, à la seule lecture du chemin. Constat une fois cherché :
  `rfc6750` et `rfc8707` y existaient en DOUBLE, **byte-identiques**, ce que rien ne
  resynchronisait. Le réflexe manquant tient en une commande, et il ne coûte rien :
  `find .claude/skills -name "rfc*.txt" | sed 's|.*/||' | sort | uniq -d` — le poser AVANT
  d'ajouter, pas après. La règle graduée [[feedback_single_source_rule]] parlait de RÈGLES de
  code ; elle vaut aussi pour les RESSOURCES bundlées, qui n'ont ni test ni compilation pour
  révéler leur divergence.
- `[1× — 08-09g]` **Une variable d'environnement a un artefact DÉRIVÉ, et c'est un gate qui l'a
  rappelé.** `NF_JWT_ISSUER` ajoutée à `env.ts` → le pre-commit a refusé le commit
  (`.env.example désynchronisé`, `gen-env-example.ts --check`). Le gate a fait exactement son
  travail — mais il tombe APRÈS avoir rédigé le message de commit. Ajouter une variable = lancer
  `npx tsx scripts/gen-env-example.ts` dans le même geste que l'édition d'`env.ts`.
- `[1× — 08-09f]` 🔴 **`EXIT=0` d'un typecheck ne dit pas QUELS fichiers il a regardés.** Mon
  premier `npx tsc --noEmit` est sorti à 0 depuis un cwd qui avait dérivé (la bannière disait
  `nodefony-core@10.0.0`, soit la RACINE) — j'allais l'annoncer comme preuve, et c'est le user
  qui a demandé où étaient les régressions. Le geste qui tranche coûte une commande :
  `npx tsc --noEmit --listFiles | grep -c <mes fichiers>` — si le compte n'est pas celui du diff,
  le vert ne porte pas sur mon code. Vaut pour tout outil qui prend une racine implicite
  (typecheck, lint, couverture) : **prouver la CIBLE avant de croire le VERDICT.**

- `[1× — 08-09f]` **« Est-ce couvert par les bancs ? » est une question à `rg`, pas à
  l'intuition.** Le user a demandé si les e2e du skill de charge concernaient la sécurité :
  `rg -c "Bearer" scripts/*.mjs` a rendu **zéro sur ~40 scripts** en une seconde. Il y a bien
  des e2e de sécurité (`totp-mfa`, `ratelimit`, `webhooks-dataplane`), mais aucun n'exerce le
  chemin que je venais de modifier — donc aucun banc à rejouer, et un trou de couverture à
  ANNONCER plutôt qu'un « c'est couvert » plausible.

- `[1× — 08-06i]` **`timeout` n'existe pas sur macOS nu → rc 127 lu comme verdict, DEUX faux
  d'un coup** (boot nominal « mort » 000 + fail-loud « confirmé » rc 127). rc=127 = « command
  not found » : c'est l'INSTRUMENT qui manque, jamais un verdict du code — rejouer au spawn
  éprouvé avant de conclure quoi que ce soit.
- `[1× — 08-06i]` **L'agent qui pilote un banc fait partie du décor machine** : contrôle
  sandwich r0b refusé 3× (disp 4,9-8,5 %) — le pollueur était MON propre process (32 % CPU).
  Seules les marches CPU-bound le voient (les marches I/O-sérialisées restent à ≤ 3 %) ; filet
  de secours = l'additivité interne de l'escalier (vérifiée ici à ~1 %).
- `[1× — 08-08]` 🔴 **`docker cp <dossier> <cible>` IMBRIQUE quand la cible existe** — il ne
  remplace pas. La deuxième copie crée `cible/dossier`, et l'on exécute la version PRÉCÉDENTE
  du script en croyant l'avoir mise à jour, sans le moindre message : j'ai mesuré une sortie
  périmée et cru à un bug. La forme juste est `<dossier>/.` (copie le CONTENU). Corollaire du
  « prouver sur l'artefact REÇU » : vérifier que la transformation a EU LIEU (`grep` d'un
  marqueur du diff dans la copie) avant de mesurer.
- `[1× — 08-08]` **Un lint CIBLÉ ne voit pas ce que le lint GLOBAL voit** : j'ai lancé oxlint sur
  le seul fichier signalé par le hook, le user a lancé `npm run lint` et trouvé une erreur de
  plus dans un AUTRE fichier — le hook s'était arrêté au premier échec, laissant croire à une
  liste complète. Après un lot écrit par un sous-agent (qui n'a jamais déclenché le hook),
  passer le lint du DÉPÔT, pas celui du fichier.
- `[2× — 08-08]` **Le cwd persiste entre appels et fabrique des verdicts faux** : `skills:check`
  rendu « exit 1 » depuis un sous-dossier, puis `npx vitest run tests/` lancé depuis la racine
  ratissant tout le monorepo (« 437 fichiers en échec » — aucun rapport avec mon diff). Déjà
  gradué en [[feedback_bash_cwd_drift]] ; ce qui manque c'est le RÉFLEXE : un résultat surprenant
  se relit d'abord en se demandant « depuis OÙ ai-je lancé ça ? ».

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
