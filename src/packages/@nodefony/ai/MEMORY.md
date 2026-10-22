# MEMORY.md — @nodefony/ai

> Internals pour une IA en cours de session. Ultra-concis, zéro prose, zéro
> date : ce fichier décrit la vérité COURANTE du code — l'historique est dans
> `git log`. Mettre à jour = éditer la section concernée EN PLACE.

## Purpose

La boîte à outils IA de Nodefony : serveur MCP, puis les services de la couche agentique

## Core Components

| Symbole           | Fichier                                 | Rôle                                                  |
| ----------------- | --------------------------------------- | ----------------------------------------------------- |
| `Ai`              | `index.ts`                              | classe Module — déclare `@services`, valide la config |
| `mcpConfigSchema` | `nodefony/config/config.ts`             | schéma `mcp.*` — SOURCE UNIQUE, importé par devkit    |
| `aiConfigSchema`  | `nodefony/config/config.ts`             | schéma Zod = source unique des défauts                |
| `defineAiConfig`  | `nodefony/config/defineModuleConfig.ts` | parse + freeze au boot                                |
| `AiError`         | `nodefony/src/errors/AiError.ts`        | erreurs typées du module                              |

## Model Context Protocol (`nodefony/mcp/`) — le protocole et la collecte

Tout est PUR : aucun socket, aucun conteneur, aucune horloge. Une porte (HTTP,
stdio, appel en process) n'apporte que le transport. Imports du cœur : barrel
`nodefony` uniquement (`jsonrpc`, `rolesFromScopes`, `ADMIN_DEFAULT_ROLE`, types
`IMcpTool*`, ré-exportés ici). Le catalogue `nodefony_*` vit dans `@nodefony/devkit`
(`nodefony/mcp/tools.ts`), déclaré par `DevkitModule.getMcpTools()`.

<!-- prettier-ignore -->
| Symbole | Fichier | Rôle |
| --- | --- | --- |
| `handleMcpMessage` | `nodefony/mcp/server.ts` | 1 message JSON-RPC → `{status, body}`. Reçoit des outils **déjà résolus** (`IMcpTool[]`), jamais un catalogue. STRICT : `classifyJsonRpcFrame` ≠ request/notification → `400`+`-32600` `id:null` ; `params` primitif → `-32600`, tableau → `-32602` ; `id` non entier → `-32600` (MCP : « string or integer ») ; une réponse postée → `400` |
| `checkMcpAccess`/`isLocalAddress` | `nodefony/mcp/guard.ts` | `Origin` (**absent = client natif → passe**) + localité + **appel relayé refusé** sur porte locale (`relayed` : `Forwarded`/`X-Forwarded-For`/`X-Real-IP`/`Via`, posé par `serve` — un relais sur la même machine arrive du loopback). Localité jugée AVANT l'origine |
| `declareMcpTools(opts)` | `nodefony/mcp/tools.ts` | `getMcpTools()` de chaque module, dans l'ordre de `kernel.modules`. Écarts → `onSkip` (nom hors forme, préfixe réservé, forme fausse `mcpToolFault` — handler/description/inputSchema/annotations/`scopes` non tableau de chaînes/`requiresAuth` non booléen, collision, déclaration qui lève). Forme fausse = REFUS, jamais interprétée : `requiresAuth: "oui"` servait l'outil à l'anonyme. **Non servable tel quel** : contient les réservés |
| `collectMcpTools(opts)` | `nodefony/mcp/tools.ts` | `declareMcpTools` **puis** filtre par `caller` (`scopes`/`requiresAuth`) → rétentions par `onWithheld`. C'est ce que TOUTE porte sert |
| `mcpDeclaredScopes(opts)` | `nodefony/mcp/tools.ts` | union triée des `IMcpTool.scopes` DÉCLARÉS. Source unique de `scopes_supported` (RFC 9728) et du `scope` du défi — **jamais** une liste de config. Indépendant du `caller` : le document se lit sans jeton. N'inclut PAS `scopesFor` : `scopes_supported` est MINIMAL (spec MCP, Scope Selection Strategy) |
| `mcpCallScopes(tool, args)` | `nodefony/mcp/tools.ts` | scopes d'UN appel = `scopes` ∪ `scopesFor(args)` ; `null` si `scopesFor` lève / forme fausse → appel refusé. SEULE règle de l'élévation : porte protégée → `requiredElevation` (gate.ts) AVANT tout flux → `403 insufficient_scope` (anonyme toléré : `401` sans code), défi = TOUS les scopes de l'opération, `error_description` ASCII (`missing scope: …`, RFC 6750 §3 ; le message français part dans le corps) ; sans porte protégée → `callMcpTool` rend `isError` (`insufficientScopeMessage`). Un outil RETENU n'est jamais jugé (existence non révélée) |
| `publishMcpTools`/`callMcpTool` | `nodefony/mcp/tools.ts` | projection sans `handler` / exécution par nom |
| `defineMcpGate` | `nodefony/mcp/gate.ts` | la PORTE sans la route. Définition validée (`mcpGateSchema` strict → `BootConfigurationError`), figée ; outils d'une liste vérifiés UNE fois (forme, doublon, `nodefony_` refusé). `gate.respond(req, runtime)` PUR : garde → corps → appelant (jeton, 401 `resource_metadata`, 503 sans vérificateur) → collecte → flux/JSON, réponse DÉCRITE (`json`/`empty`/`stream`). `gate.serve(controller, body)` : GET/DELETE → 405, sinon lit la requête, résout le vérificateur PAR NOM (porte protégée seulement), écrit. `gate.protectedResources()` → entrée RFC 9728. `protocol.versions` → liste passée au moteur (-32022 avec LA liste de la porte) ; `cache` → `ttlMs`/`cacheScope` sur `tools/list` MODERNE seulement ; `instructions` → ouverture du texte (défaut NEUTRE) |
| `gate.respondStdio` | `nodefony/mcp/gate.ts` | pendant de `respond` pour stdio : 1 LIGNE → réponse décrite. Ni garde réseau, ni origine, ni jeton : appelant anonyme + `unprotectedRoles` (aucun par défaut), clé d'annulation unique `stdio`, `challenge: false` (scope manquant → `isError`). Tronc commun `dispatch` partagé avec `respond` (collecte, élévation, flux, moteur). 🔴 Appel annulé → `CANCELLED_SILENCE` + puits fermé (`closed` = annulé) : PLUS RIEN écrit (spec stdio § Cancellation) — en HTTP la réponse part quand même |
| `serveMcpStdio` | `nodefony/mcp/stdio.ts` | boucle `readline` : chaque ligne servie SANS attendre la précédente (sinon l'annulation arrive trop tard), ligne vide ignorée, `-32700` sans arrêt ; entrée fermée → signal abattu, attend les appels en cours. `write(line)` reçoit `\n` compris |
| `StdioCommand` | `nodefony/command/StdioCommand.ts` | `nodefony ai:stdio`, `onPostReady` (après `Framework.onKernelReady`), `quietBoot`. Porte `tools: "modules"`, `unprotectedRoles` = `localOperatorCaller().roles` (posture de toute commande locale ; n'ouvre que `admin:*`, un scope applicatif reste retenu — `withholdReason`), tous environnements. 🔴 `Syslog.setLogSink(STDERR_LOG_SINK)` + `process.stdout.write` DÉTOURNÉ vers stderr, protocole écrit par la fonction d'origine capturée ; EPIPE ignoré |
| `actingTools`/`runAsAccount` | `nodefony/mcp/gate.ts` | outil `actsForUser` : compte retrouvé AVANT le handler par `accessAccountResolver` (par NOM, porte protégée seulement), bulle `RequestContext.run({...parent, token, user})` + `release` en `finally`, `onAccount` → `context.userIdentifier`, signal abattu à `expiresAt`. Enveloppé pour tout message SAUF `tools/list`. Sans résolveur → `isError` + CRITIC ; compte `null` → `isError` uniforme ; panne → `-32603` opaque. En process (sans porte) : AUCUNE bulle |
| `defineTicketSessionGate` | `nodefony/mcp/ticketSession.ts` | niveau 2 : session HTTP RÉELLE au nom d'un compte, pour un outil qui tire des requêtes vers l'app. Schéma strict `{factor, localOnly=true}` → `BootConfigurationError`. `issue(id)` (magasin `SessionTicketStore` alloué au 1ᵉʳ ticket), `serve(controller)` (route déclarée par le controller, chemin LITTÉRAL ; `authFlow`/`sessions` par NOM), `close(sessions, ref)`. Décision pure `openTicketSession` : localité → flux → rachat, 403 uniforme `TICKET_SESSION_REFUSED`, 503 sans flux. Format lu côté outil : `readTicketSessionVerdict` (même fichier que le producteur) |
| `SessionTicketStore` | `nodefony/mcp/sessionTicket.ts` | ticket à usage unique, 256 bits base64url, TTL 10 s, ≤ 8 en attente, rangé par empreinte sha256 (jamais brut), forme contrôlée AVANT hachage, purge sans minuterie. En-tête `x-nodefony-session-ticket` |
| `mcpText` | `nodefony/mcp/tools.ts` | enveloppe `content[]` — une app en a besoin pour ses propres outils. **BORNÉ** (voir ci-dessous) |
| `IMcpTool` | cœur `types/IMcpTool.ts` (ré-exporté) | contrat producteur (comme `IAdminApi`) ; `IModule.getMcpTools?()` |

- **Collecte, PAS registre** — rien n'est alloué au boot, rien n'est mémorisé :
  la liste se ramasse au moment de servir `tools/list`. Un registre serait
  nécessaire s'il fallait MONTER quelque chose au boot (c'est le cas de
  `IAdminRegistry`, qui crée des routes) ; un outil MCP ne monte rien.
  Conséquences : coût nul en production, aucun ordre de `register()`, fraîcheur
  gratuite.
- 🔴 **Préfixe `nodefony_` RÉSERVÉ** (`MCP_RESERVED_PREFIX`) aux modules dont
  `getModuleName()` commence par `@nodefony/` — jugé AVANT la réservation du nom.
  Un module d'application ne peut donc pas répondre à la place de
  `nodefony_inspect`, quel que soit l'ordre de chargement (qui suit le manifeste).
  Absence de `getModuleName` = refus.
- 🔴 **Un résultat est une RÉPONSE, pas un déversement** — `mcpText` borne à
  `MCP_TEXT_MAX_CHARS` (32 000). Au-delà : un tableau rend son `count` EXACT puis
  ses entrées en SURFACE (`surfaceOf` : scalaires courts gardés, objets/tableaux
  imbriqués et longues chaînes jetés) ; un objet rend ses `keys`. **En deçà, la
  donnée part TELLE QUELLE** — aucun consommateur à retoucher, et la garde n'est
  pas payée sur le cas courant. Garder TOUTES les entrées en surface, jamais un
  échantillon des N premières : une question portant sur la 100ᵉ recevrait
  sinon une réponse fausse, sans moyen de le savoir. La garde vit dans `mcpText`
  (pas dans chaque outil) → un outil d'application en hérite sans le savoir.
  _Pourquoi_ : `inspect routes` rendait 47 138 caractères et l'agent, à qui on
  demandait le NOMBRE de routes, recopiait la liste dans un script pour la
  compter avant d'abandonner ; `inspect config` rendait 190 730 caractères,
  au-delà de ce que le client accepte → déporté sur disque, vingt tours perdus.
  L'outil était moins bon que la CLI qu'il expose (`renderHuman` affiche
  « 119 routes » depuis toujours).
- 🔴 **Outils RÉSERVÉS** : `IMcpTool.scopes` (TOUS exigés, `every` pas `some`) et
  `requiresAuth`, filtrés par `collectMcpTools({caller})` — donc **au seul point
  de collecte**, ce qui couvre `tools/list` ET `tools/call` : le protocole ne
  reçoit que les outils servis, un outil retenu lui est « inconnu » (son
  existence n'est pas révélée). Filtrer la liste sans filtrer l'appel = rideau.
  Le nom d'un outil retenu reste RÉSERVÉ (sinon un homonyme public le double).
  `caller` absent = `{authenticated:false, scopes:[]}` — **fail-closed**.
  `actsForUser` EXIGE des `scopes` (refus à la déclaration : dans la bulle, les rôles du compte ne
  sont pas bornés par le jeton) ET un appelant authentifié — le rôle d'opérateur ne s'y substitue pas. Le
  handler reçoit `(args, caller)` pour borner ce qu'il REND. Rétention →
  `onWithheld` (DEBUG, c'est normal), distinct d'`onSkip` (WARNING, c'est une
  faute d'auteur).
  Porte NON protégée (aucun `authorizationServers`) → caller sans rôle :
  tout outil à scopes y est RETENU (`operatorRoles` vide par défaut). Seule la
  porte de devkit (`policy: "dev"`) passe `[ADMIN_DEFAULT_ROLE]`. Porte protégée
  → rôles dérivés des scopes du jeton. Catalogue variable « by the authorization
  presented on the request », jamais « per-connection » : collecte par requête.
- **Nom d'outil** : `^[a-zA-Z0-9_-]{1,64}$`. Il voyage dans le contexte du
  modèle ; hors forme, il produit des appels que rien ne résout.
- **Dual-ère assumé** : `initialize` (legacy) ET `server/discover` +
  `params._meta` (moderne). En-tête ≠ `_meta` → `400`/`-32020` ; révision
  inconnue dans `_meta`/en-tête → `400`/`-32022` **avec la liste servie**.
  Notification → `202` SANS corps. Méthode inconnue → `404`/`-32601`.
- 🔴 **`initialize` ÉCHOTE la révision du client** (`negotiateVersion`), il
  n'annonce PAS la préférée. Annoncer `2026-07-28` à tout le monde rendait la
  porte injoignable : `@modelcontextprotocol/sdk@1.30.0` porte
  `LATEST = 2025-11-25` et raccroche sur toute réponse hors de sa liste
  (`SUPPORTED = 2025-11-25, 2025-06-18, 2025-03-26, 2024-11-05, 2024-10-07`).
  Client muet → `MCP_DEFAULT_NEGOTIATED_VERSION` (`2025-03-26`, ce que la spec
  impose de supposer). Révision inconnue en `initialize` → notre préférée, au
  client de raccrocher (pas un refus : `initialize` PROPOSE).
  **`MCP_SUPPORTED_VERSIONS` est une PROMESSE** — un test exerce chacune.
  ⚠️ Défaut trouvé par un VRAI client, jamais par la suite : conforme à la
  dernière norme et injoignable par tout le monde.

---

## Config

- Surcharge par l'app : `use("@nodefony/ai", { … })` dans son `nodefony.config.ts`.
- Surcharge par l'environnement : `NF__AI__<CHEMIN>`.
- Défauts matérialisés par `aiConfigSchema.parse({})` — ne jamais les retaper.

## Behaviors

- `onKernelRegister` valide la config et réassigne `this.options` AVANT que les
  `@services` ne soient instanciés (`onBoot`).

## Gotchas

- **Délai de grâce du flux** (`stream.ts#MCP_STREAM_GRACE_MS`, 5 s) : un appel encore en cours ouvre le flux SANS rien y écrire (le flux bat seul), même sans `progressToken`. Sinon la réponse JSON d'un outil long tombe en `408` (délai d'inactivité 30 s), et le SDK n'ajoute `progressToken` que si l'appelant passe `onprogress`. Minuteur `unref`, libéré dans `finish`, rien d'ouvert si le client est parti.

- **Annulation à deux voies** (`server.ts#IMcpCancellation`) : fermeture du flux (révision courante, LA voie HTTP, à ne jamais retirer) + `notifications/cancelled` (révision précédente, celle du SDK officiel, envoyée dans un AUTRE `POST`). Table `inflight` dans la porte, allouée au 1ᵉʳ `tools/call`, entrée retirée en `finally`. 🔴 Clé = appelant (`sub` émetteur+sujet si jeton valide, sinon adresse distante) + type et valeur de l'id — l'id est choisi par le CLIENT. Annulation inconnue, tardive ou mal formée → `202`, ignorée. La réponse de l'appel annulé part quand même (le POST doit se clore ; le client qui a annulé l'ignore).
- `@nodefony/devkit` étend `mcpConfigSchema` de `tools` (son allowlist) : le schéma de la porte n'existe qu'ici.
- Ne jamais déréférencer le Kernel au top-level d'un fichier chargé à l'import
  (`Nodefony.getKernel()` rend `null` avant le boot) — passer par un getter.
- **Annonce des outils retenus** (`server.ts#discoverInstructions`) : RFC 9728 et le défi ne sont cités que si `IMcpServerContext.authorizable` (posé par la porte = `admitted.challenge`, porte HTTP PROTÉGÉE). Porte non protégée ou stdio → « servis par une porte HTTP protégée » : jamais renvoyer à un document qu'on ne publie pas.
