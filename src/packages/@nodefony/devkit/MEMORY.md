# MEMORY.md — @nodefony/devkit

> Internals pour une IA en cours de session. Ultra-concis, zéro prose, zéro
> date : ce fichier décrit la vérité COURANTE du code — l'historique est dans
> `git log`. Mettre à jour = éditer la section concernée EN PLACE.

## Purpose

Trois choses. (1) Porte **HTTP** de la carte de visite d'une application (qui
répond, ce qui est chargé, où lire, quoi lancer). (2) **Le CONTENU des skills
d'agent** livrés par npm (`skills/`). (3) **Le serveur MCP** de l'application
(`POST /nodefony/mcp`) — les mêmes réponses, pour un agent qui appelle des
outils. Module `policy: "dev"` — absent en prod, ces trois portes avec.

Ligne de partage, elle tranche chaque cas : **le CŒUR porte ce qui doit marcher
sans rien installer et application cassée** (`card`, `check`, `inspect`,
`create`, `ai:sync`) ; **ce paquet porte ce qui doit se mettre à jour par npm**
(les skills). D'où `nodefony card` au cœur et `skills/` ici.

## Core Components

| Symbole                   | Fichier                                 | Rôle                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ------------------------- | --------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DevkitModule`            | `index.ts`                              | `@services` + `@controllers` — AUCUNE commande CLI                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `buildCard`               | `nodefony/src/card.ts`                  | ré-export du cœur (`nodefony` → `cli/cardReport.ts`)                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `DevkitService`           | `nodefony/service/DevkitService.ts`     | `getCard()` — dérive du Kernel, `source: "runtime"`                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `DevkitController`        | `nodefony/controllers/DevkitController` | `GET /nodefony/devkit/api/card` — mince, délègue                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `McpController`           | `nodefony/controllers/McpController.ts` | `POST /nodefony/mcp` — SEULE pièce MCP de ce paquet : traduit HTTP ↔ JSON-RPC, ramasse les outils (`collectMcpTools`) et fournit ce que lui seul connaît (service, broker, racine). Le protocole vient de `nodefony`                                                                                                                                                                                                                                                                          |
| `devkitConfigSchema`      | `nodefony/config/config.ts`             | `{ enabled, mcp }` — source unique des défauts                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `defineDevkitConfig`      | `nodefony/config/defineModuleConfig.ts` | parse + freeze au boot                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `DevkitError`             | `nodefony/src/errors/DevkitError.ts`    | erreurs typées du module                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| 5 skills                  | `skills/<nom>/SKILL.md`                 | `nodefony-add-crud`, `nodefony-add-service`, `nodefony-protect-route`, `nodefony-add-realtime-channel`, `nodefony-browser` — publiés (`files`)                                                                                                                                                                                                                                                                                                                                                |
| Sondes `nodefony-browser` | `skills/nodefony-browser/scripts/`      | `inspect.mjs` (socle + 6 familles par `NF_BROWSER_FAMILIES` — a11y, rendu, reseau, perf, stockage, responsive ; verdict par famille, nom inconnu REFUSÉ en 64) · `watch.mjs` (frames WS, réponses ≥ 400) · `socket.mjs` (socket A→Z : accueil, abonnement, action, latence médiane, `api.request`, reconnexion — joué DANS la page, donc cookies et Origin réels) · `lib/{browser,wcag,probes}.mjs`. Exécutés DANS le conteneur `<app>-browser` — chemins POSIX, aucun problème de plateforme |
| Doc des sondes            | `skills/nodefony-browser/references/`   | `sondes.md` (chaque champ, lecture des verdicts, QUAND chaque famille se trompe) · `socket.md` (grammaire des frames, verdicts dont `SILENCIEUX` ≠ cassé). Chargées à la demande — le `SKILL.md` reste un index                                                                                                                                                                                                                                                                               |
| Tests des sondes          | `tests/browser-*.test.ts`               | logique PURE sans navigateur (`wcag`, `probes`, importés via `browser-outils.ts`) + banc fonctionnel paramétré `NF_BROWSER_TEST_*` qui SKIPPE en DISANT pourquoi quand le décor manque — visable sur ce dépôt comme sur une app générée                                                                                                                                                                                                                                                       |

## Config

- `enabled: boolean = true` — interrupteur.
- `mcp.enabled = true` · `mcp.allowedOrigins = []` · `mcp.allowRemote = false` ·
  `mcp.tools = ["inspect","check","symbols","card"]`.
- ⚠️ **Piège Zod 4** : `mcpSchema.default(() => mcpSchema.parse({}))` — un
  `.default({})` plat ne ré-applique AUCUN sous-défaut.
- Surcharge par l'app : `use("@nodefony/devkit", { … })` · par l'environnement :
  `NF__DEVKIT__<CHEMIN>`.
- Défauts matérialisés par `devkitConfigSchema.parse({})` — ne jamais les retaper.

## Behaviors

- `onKernelRegister` valide la config et réassigne `this.options` AVANT que les
  `@services` ne soient instanciés (`onBoot`).
- `getCard()` ne CACHE rien : recalcul à chaque appel (route de dev appelée à la
  main — un cache mentirait au premier module ajouté).
- Portes conditionnelles : `/nodefony` si le module `studio` est chargé ;
  `/nodefony/documentation/api/tree` si `documentation` l'est. La condition porte
  sur les modules RÉELLEMENT chargés, pas sur le manifeste.
- Deux versions distinctes : `kernel.version` = celle de l'APP,
  `Nodefony.version` = celle du FRAMEWORK.
- **Les outils MCP sont ramassés à CHAQUE requête** (`collectMcpTools`), jamais
  mémorisés : intégrés autorisés par `mcp.tools`, puis `getMcpTools()` de chaque
  module de `kernel.modules`. Un module ajouté ou rechargé apparaît sans cache à
  invalider. Un écart (nom hors forme, collision, déclaration en échec) part en
  `WARNING` — jamais en silence.

## Gotchas

- **La CLI ne passe PAS par ce module** : `nodefony card` (alias `devkit:card`)
  est un fast-path standalone du cœur (`CliKernel.start`), 0 boot. Motif : porté
  ici, il n'existait pas hors développement (`policy: "dev"` ⇒ « unknown
  command ») et le Kernel refusait de démarrer sur une app non construite — les
  deux situations où l'on cherche justement la carte.
- **Cette porte-ci est la SEULE qui connaisse les modules CHARGÉS**
  (`source: "runtime"`). La CLI répond à froid : modules INSTALLÉS, et elle le
  dit.
- **La route de la CARTE est derrière le pare-feu** dans toute app portant
  `@nodefony/security` → 401 sans session. Le pattern de la zone admin est
  `^/nodefony/[^/]+/api(/|$)` (`framework/config.ts:143`) : c'est le segment
  `api` qui déclenche la protection. C'est voulu ; la porte utilisable par un
  agent est la CLI (`nodefony card`).
- 🔴 **`/nodefony/mcp` n'a PAS de segment `api` → il échappe à cette zone.** Ce
  n'est pas un oubli : un client MCP ne sait pas présenter une session Nodefony
  (il ne connaît qu'un jeton OAuth), donc derrière le pare-feu la porte serait
  inutilisable. **Conséquence : `checkMcpAccess` (Origin + localité) et
  `policy: "dev"` sont la SEULE protection de cette route.** Toute donnée
  ajoutée à un outil MCP doit être jugée à cette aune.
- 🔴 **Le PROTOCOLE MCP n'est pas ici, il est au CŒUR** (`nodefony` →
  `src/mcp/`) : `handleMcpMessage`, `checkMcpAccess`, `collectMcpTools`,
  `builtinMcpTools`, `mcpText`, `IMcpTool`. Ce paquet n'en ré-exporte RIEN — deux
  surfaces pour une brique divergent en silence. Motif : un module `policy:"dev"`
  disparaît en production, donc y loger le protocole obligerait tout autre
  serveur MCP (celui de P12, ou une porte authentifiée de production) à le
  redéclarer.
- 🔴 **L'appelant vient de `mcp.authorization`, et le rôle est ÉTEINT par
  défaut.** `authorizationServers` vide → appelant anonyme
  (`{authenticated:false, scopes:[]}`), donc tout outil déclarant `scopes`/
  `requiresAuth` est retenu (fail-closed), absent de `tools/list` et
  inappelable. Non vide → `authorizeProtectedResource` (cœur) tranche :
  `anonymous` · `authenticated` · `challenge` (401 sans code d'erreur si rien
  n'a été présenté, 400 `invalid_request` si l'en-tête est mal formé, 401
  `invalid_token`) · `unverifiable`. La rétention part en `DEBUG`
  (`onWithheld`), pas en `WARNING` : c'est un catalogue filtré qui fonctionne.
- 🔴 **La vérification du jeton est un service du CONTENEUR, `accessTokenVerifier`**
  (contrat `IAccessTokenVerifier`, cœur). Ce module est `policy:"dev"` et ne peut
  pas dépendre de `@nodefony/security`. Rôle déclaré + service absent = `503` +
  `CRITIC`, jamais un porteur accepté sans lecture. **Aucune implémentation n'est
  livrée à ce jour** : `JwtAuthenticator` ne valide que les JWT émis par Nodefony
  (`createLocalJWKSet`), pas ceux d'un émetteur tiers — il manque un JWKS
  distant.
- **`resource` (l'audience) s'ÉCRIT, ne se dérive JAMAIS du `Host`.** Sinon URI
  publiée et audience attendue viennent toutes deux de la requête : un `Host`
  forgé obtient un jeton d'audience arbitraire ET passe la vérification — la
  liaison d'audience (RFC 8707) ne protège plus rien. Validée au boot par
  `canonicalResourceUri`, la fonction qui composera le document.
- **Métadonnées = `OAuthMetadataController`, préfixe VIDE** : le chemin
  `/.well-known/…` vit hors de `/nodefony`, le document est PUBLIC (lisible
  avant tout jeton, donc sans garde `Origin`/localité) et répond en `GET`. Son
  chemin est **dérivé** de `MCP_ENDPOINT_PATH` par
  `protectedResourceMetadataPath` — un littéral deviendrait faux au premier
  déménagement, sans que rien ne le signale (404 → « pas d'autorisation ici »).
  Rôle éteint → `404`, jamais un document sans `authorization_servers`.
- **`mcp.tools` ne filtre QUE les outils intégrés.** Un outil déclaré par un
  module est publié sans condition : exiger qu'il soit AUSSI nommé en config en
  ferait un outil accepté puis jeté — présent dans le code, absent de
  `tools/list`, sans un message. Les intégrés passent en TÊTE de la collecte,
  donc aucun module ne peut se substituer à `nodefony_inspect`.
- **La redaction des secrets vit dans le PRODUCTEUR, pas dans la porte**
  (`KernelAdminApi.safeConfig`). C'est ce qui fait qu'un outil MCP ne révèle
  rien de plus que la console d'administration. Vécu : `encryptionKey` sortait
  en clair parce que le motif du data plane et `pathLooksSecret` avaient
  divergé — corriger la porte n'aurait rien réglé pour la CLI ni pour Studio.
- **Aucune garde `@IsGranted`** sur le controller : l'ajouter imposerait
  `@nodefony/security` à toute app qui installe le devkit, y compris celles sans
  firewall. C'est la `policy` qui protège, pas un rôle.
- Une porte de plus se branche sur `buildCard` (dans le cœur, exporté par
  `nodefony`), jamais sur le service : la brique pure est le point de
  réutilisation.
- La clé de CONTENEUR (`super("devkit", …)`) n'est pas le nom de la CLASSE :
  `container.get("devkit")`.
- **Les skills sont du CONTENU, pas du code** : ni import, ni build, ni test
  d'exécution — `files` les publie tels quels. Un skill se corrige ICI et la
  correction part par `npm update`. Ne JAMAIS le recopier dans une app.
  Exception d'un `scripts/` : il n'entre ni au build ni au `tsconfig` (`.mjs`,
  hors `include`), et s'éprouve en l'EXÉCUTANT dans le conteneur — c'est sa
  seule preuve.
- **Ce que le skill décrit doit valoir pour une app QUELCONQUE**, jamais pour ce
  dépôt : pas de sélecteur d'une bibliothèque de composants, pas de route de
  Studio, aucun chemin de connexion deviné (`NF_BROWSER_LOGIN` n'a **pas** de
  défaut — deviner enverrait la sonde mesurer une page d'erreur en croyant
  s'être authentifiée). Les skills du dépôt (`.claude/skills/`) sont un AUTRE
  public : ils restent à eux, on ne les fusionne pas avec ceux-ci.
- **Les commandes d'un skill s'écrivent pour les TROIS plateformes** : une ligne
  chacune, sans substitution `$(…)`, sans tube, sans continuation `\`, sans
  `grep`, **sans enchaînement `&&` / `||`** — rien de tout cela n'existe dans
  `cmd.exe`, et `&&` est une ERREUR DE SYNTAXE pour Windows PowerShell 5.1, le
  shell préinstallé. Ce qui doit être extrait d'une page l'est par la sonde
  elle-même (champ `scripts`), pas par un `curl | grep` que Windows ne sait pas
  exécuter. Le gate ne contrôle que les blocs SHELL : `&&` est légitime dans un
  bloc `ts`, c'est l'opérateur du langage.
- **Les sondes s'exécutent aussi HORS conteneur** — `browser-demarrage.test.ts`
  lance les quatre scripts avec le Node de la suite et éprouve leurs chemins de
  REFUS (codes 64), qui ne demandent ni serveur, ni docker, ni navigateur. C'est
  la seule exécution réelle de ce code sous **Windows** et macOS : le banc
  fonctionnel, lui, mesure toujours du Linux puisqu'il passe par le conteneur.
- **Un état d'authentification appartient à un COMPTE** — le fichier porte
  l'identifiant (`nomEtatAuth`, `lib/probes.mjs`). Un nom unique le faisait
  reprendre quel que soit l'utilisateur demandé : on réclamait une mesure sous un
  compte de moindre privilège et l'on obtenait celle de l'administrateur, sans un
  mot — un canal pourtant refusé s'ouvrait. Mesuré, puis gardé par les deux
  passes du test de refus de canal.
- **Le refus de canal se MESURE aussi sur une app générée — en deux gestes, pas
  en le sautant.** Une application fraîche n'a qu'un compte et aucun canal fermé,
  d'où la tentation de neutraliser le cas. `security:user:add <id> -r ROLE_USER`
  donne le second compte, et `@RealtimeChannel(nom, { roles })` ferme un canal —
  posé sur le MÊME endpoint que le canal ouvert, sinon les deux passes ne portent
  pas sur des canaux comparables. Décor complet en tête de
  `tests/browser-fonctionnel.test.ts`.
- **`docker cp <dossier>/. <cible>` — le `/.` est OBLIGATOIRE** : sans lui, une
  seconde copie IMBRIQUE un dossier de plus au lieu de remplacer, et l'on
  exécute une version périmée sans aucun message. Vécu en écrivant ce skill.
- **Le verbe qui les pose vit au CŒUR** (`nodefony ai:sync` →
  `src/nodefony/src/cli/aiSync.ts`, fast-path standalone). Même motif que
  `card` : porté ici (`policy: "dev"`), il répondrait « unknown command » dans un
  terminal sans `NODE_ENV`. `create app` appelle `syncSkillPointers` après
  l'install et avant `git init`.
- **🔴 Tout skill publié se PRÉFIXE `nodefony-`** — dossier ET `name:` du
  frontmatter (les deux, sinon la découverte l'écarte). Le motif n'est pas
  l'esthétique : les pointeurs atterrissent dans le `.agents/skills/` de
  l'application, **le même dossier où l'utilisateur écrit les SIENS**. Sans
  namespace, son `add-crud` métier et le nôtre se disputent un nom — et c'est
  `ai:sync` qui écraserait le sien à la prochaine synchronisation. Le préfixe dit
  à qui appartient le skill ; c'est sa seule raison d'être, et elle suffit.
  Même convention que les skills du dépôt, pour la même raison de namespace.
- **La découverte ne connaît PAS ce paquet** : elle scanne tout
  `node_modules/@nodefony/*` **et** `modules/*` de l'app, et retient tout dossier
  portant un `SKILL.md`. Un module tiers livre ses skills sans qu'on touche au
  cœur. Un `name:` de frontmatter différent du dossier fait ÉCARTER le skill.
- **`files` doit contenir `skills`** — un `files` qui désigne un dossier absent
  ne fait pas échouer `npm pack`, il publie sans (même piège que `dist/`).
- **Aucun `postinstall`** : `--ignore-scripts` est courant, c'est un vecteur
  d'attaque npm connu, et écrire dans un dossier versionné à chaque installation
  produit des diffs surprises.
