# MEMORY.md — @nodefony/core workspace

> Pour IA uniquement. Ultra-concis. 0 redondance. Complémentaire au README.md.

## Docs liées

- [`../../CLAUDE.md`](../../CLAUDE.md) — règles projet globales + index complet des MEMORY/CLAUDE
- Sous-modules core : [`src/syslog/MEMORY.md`](src/syslog/MEMORY.md) (Syslog/Pdu) | [`src/kernel/MEMORY.md`](src/kernel/MEMORY.md) (Kernel/Module/CliKernel) | [`src/kernel/injector/MEMORY.md`](src/kernel/injector/MEMORY.md) (DI) | [`src/cli/MEMORY.md`](src/cli/MEMORY.md) (Cli/Command) | [`src/finder/MEMORY.md`](src/finder/MEMORY.md) (FileClass/Finder)
- Consommateurs : [`../packages/@nodefony/http/MEMORY.md`](../packages/@nodefony/http/MEMORY.md) | [`../packages/@nodefony/framework/MEMORY.md`](../packages/@nodefony/framework/MEMORY.md)

---

## Service (`src/Service.ts`) — clé de voûte du framework

**Purpose** : Classe de base de tout service Nodefony. Kernel, Module, Controller, adapters ORM en héritent tous.

**Core Components**

- `name: string` — identifiant du service
- `container: Container | null` — DI container (injection)
- `kernel: IKernel | null` — récupéré depuis `container.get("kernel")`
- `syslog: Syslog | null` — logger structuré (auto-créé si absent du container)
- `#nc: Event | undefined` — EventEmitter privé (notificationsCenter)

**Constructeur**

```
Service(name, container?, notificationsCenter?, options?)
```

- `container` absent → `new Container()` créé automatiquement
- `notificationsCenter=false` → pas d'Event (mode silencieux)
- `notificationsCenter=null` → traité comme absent → nouveau Event créé
- `notificationsCenter=Event` → Event partagé (cross-services) → `#sharedNc=true`
- Syslog réutilisé depuis container si présent, sinon auto-créé (variable locale, pas champ)
- `options.events.nbListeners` : bus AUTO-CRÉÉ → appliqué tel quel ; bus PARTAGÉ → ne peut que
  RELEVER le plafond (`wanted > shared`, `Service.ts:128`), jamais l'abaisser. Le Kernel
  dimensionne le sien à 60 ; chaque Service qui y réécrivait son défaut 20 faisait crier
  `MaxListenersExceededWarning` au boot sans qu'il fuie quoi que ce soit — le dernier arrivé
  décidait. **Règle : un plafond posé sur une ressource qu'on ne possède pas ne se restreint
  jamais.**
- `options.events` supprimé de `this.options` après construction
- `notificationsCenter` mis dans container seulement si PAS de kernel (intentionnel)

**Events — délégation vers `#nc` via getter privé `nc`**

- Getter privé `nc` : lance `Error: notificationsCenter not initialized` si `#nc undefined` — élimine le if/throw ×18
- Tous les EventEmitter standard : `on/off/once/emit/addListener/removeListener/removeAllListeners/prependListener/prependOnceListener/listeners/rawListeners/listenerCount/eventNames/setMaxListeners/getMaxListeners`
- `fire()` = alias `emit()` | `fireAsync()`/`emitAsync()` = async
- `listen(eventName, fn)` → bind le listener → pas traçable → non retiré à `clean()`
- `settingsToListen(opts, ctx)` → auto-wire clés `onFoo` comme listeners (non traçable)
- **Tracking** : `#trackedListeners: Map<event, listeners[]>` — tout ce qui passe par `on/once/addListener/prependListener/prependOnceListener` est tracé
- `off/removeListener` → détrace | `removeAllListeners` → vide la map
- **clean() avec Event partagé** : retire uniquement les listeners traçés de ce service → pas de fuite mémoire inter-services

**Logging**

- `log(pci, severity?, msgid?, msg?)` → `Pdu`
- `pdu.severity` = numérique (enum `SysLogSeverity`), `pdu.severityName` = string
- Severités : `EMERGENCY(0) ALERT(1) CRITIC(2) ERROR(3) WARNING(4) NOTICE(5) INFO(6) DEBUG(7) SPINNER(-1)`
- Attention : c'est "CRITIC" pas "CRITICAL"
- `spinlog(msg)` = `log(msg, "SPINNER")`
- `logger(pci)` = `console.debug` | `trace(pci)` = `console.trace`
- Fallback si `syslog null` : `new Pdu(pci, severity, this.name, msgid, msg)` — moduleName = nom du service

**Container delegation**

- `get<T>(name)` → `null` si container null (no throw)
- `set<T>(name, obj)` → **throw** si container null
- `has(name)` → `false` si container null (no throw)
- `getParameters(name)` → `null` si container null (no throw)
- `setParameters(name, val)` → **throw** si container null
- `remove(name)` → **toujours `false`** (bug connu — Container.remove() retourne true mais Service l'ignore)
- `remove()` appelle `clean()` sur les enfants `instanceof Service`

**Cycle de vie**

- `initSyslog(env, debug, options?)` → initialise le syslog (dev/prod/test)
- `clean(syslog=false)` → null toutes les refs. `clean(true)` appelle `syslog.reset()`
- `clean()` idempotent

**Héritage**

- Étendre avec `class MyService extends Service`
- `super(name, container, notificationsCenter, options)` dans le constructeur
- `remove()` appelle `clean()` sur toute sous-classe `instanceof Service`

**Deps** : `Container`, `Event` (node:events), `Syslog`, `Pdu`, `IService`, `IKernel`

**Gotchas**

- `Service.remove()` retourne `true` si trouvé/supprimé, `false` sinon (propagé depuis Container)
- `options.events.nbListeners` sur un bus PARTAGÉ ne fait que RELEVER le plafond (cf § Service)
- `settingsToListen()` et `listen()` → listeners non traçés → PAS retirés à `clean()`
- `settingsToListen()` matche regex `^on(.*)$` — event name = la clé complète (`onFoo`)
- `pdu.severity` = number, `pdu.severityName` = string — ne pas confondre
- "CRITICAL" n'existe pas — c'est "CRITIC" dans SysLogSeverity
- NC dans container seulement si pas de kernel → intentionnel (kernel expose son propre NC)

---

## Container (`src/Container.ts`) — `implements IContainer`

**Purpose** : DI Container — registry de services + paramètres dot-notation + scopes hiérarchiques.

**Interfaces** : `src/types/IContainer.ts` — `IContainer` + `IScope`

- `Container implements IContainer`
- `Scope extends Container implements IScope`
- `IService.container` typé `IContainer | null` (pas la classe concrète)

**Core**

- `id: string` — compteur monotone base36 (plus d'uuid : 0 crypto/scope, clé locale)
- `services: DynamicService | null` — map des services (hérite de `protoService.prototype`)
- `parameters: DynamicParam | null` — map dot-notation
- `scopes: Scopes | null` — `Map<name, Map<id, Scope>>` LAZY (null tant que 0 addScope ; un Scope est un Container → pas d'alloc morte/req)

**Services API**

- `set(name, obj)` — stocke dans `services[name]` ET `protoService.prototype[name]` (héritage scopes)
- `get<T>(name)` → `T | null` — utilise `name in this.services` (inclut prototype chain)
- `has(name)` → `boolean` — utilise `name in this.services` (pas `!!value` — supporte valeurs falsy)
- `remove(name)` → `true` si trouvé/supprimé — utilise `name in this.services` (pas `!!get()`)
  → propage récursivement aux scopes ouverts
- `keys()` / `entries()` — liste les services propres

**Paramètres**

- `setParameters(name, val)` — dot-notation, crée les nœuds intermédiaires automatiquement
- `getParameters(name)` → `DynamicParam | null`
- Erreur si name non-string, value undefined, ou descente dans un nœud non-objet

**Scopes**

- `addScope(name)` — déclare un scope (idempotent), retourne le bucket `Map<id, Scope>`
- `enterScope(name)` → `IScope` — crée une instance Scope héritant du proto du parent
- `leaveScope(scope: IScope)` — nettoie le scope, `bucket.delete(id)`
- `removeScope(name)` — nettoie tous les sous-scopes d'un nom
- `scopeCount(name)` → number — instances vivantes (sondes fuite/Studio ; NE PAS fouiller `.scopes` à la main)
- `Scope extends Container implements IScope` — `name: string` + `getParameters(name, merge=true, deep=true)`
- `Scope.getParameters(name, merge=true, deep=true)` — merge local + parent si les deux sont des objets
- ⚠️ `Scope` ADOPTE les protos parents (+6 % RPS A/B) : `Scope.set`/`remove`
  overridés **own-property only** — `Container.set` (écriture prototype) polluerait le proto PARTAGÉ
  du parent → service per-request visible cross-requêtes (data race). Ne pas « simplifier » ces overrides.

**Cycle de vie**

- `clean()` — `services=null`, `parameters=null`, nettoie tous les scopes
- `reset()` — `clean()` + recrée protoService/protoParameters → utilisable à nouveau

**Constructeur clone**

- `new Container(parent)` — shallow clone (services et params partagés via proto)
- `new Container(parent, true)` — deep clone des paramètres (`structuredClone` avec fallback)

**Gotchas**

- `has()` et `remove()` utilisent `name in services` (pas `!!value`) — valeurs falsy (0, false, "") correctement gérées
- `set()` après `clean()` → throw "Container bad argument name" (message trompeur — vraie cause : services=null)
- `get(name)` retourne `null` si value est `null` (null stocké → `services[name] = null` → retourne null comme "absent")
- Service ajouté au parent APRÈS `enterScope()` → visible dans le scope (late binding via proto)
- `remove()` dans parent → propagé aux scopes ouverts

---

## Nodefony (`src/Nodefony.ts`) — classe statique singleton

**Purpose** : Point d'entrée unique au kernel. Remplace l'ancien objet `nodefony` global.

```typescript
import { Nodefony } from "nodefony";
Nodefony.version           // string — depuis package.json
Nodefony.getKernel()       // Kernel | null — avant boot = null
Nodefony.setKernel(k)      // appelé dans Kernel constructor
Nodefony.generateId()      // uuidv4 string — IMPRÉVISIBLE (requestId, jeton)
Nodefony.generateSortableId() // uuidv7 string — ORDONNÉ (clé primaire d'entité)
Nodefony.generateV5Id(name, ns?) // uuidv5 string
```

**Règle** : `private constructor()` — jamais instancier. `#kernel` est un champ privé statique.

**Gotchas**

- `getKernel()` retourne `null` avant `Kernel.start()` — toujours utiliser `?.`
- Ancienne API supprimée : `nodefony.kernel`, `nodefony.generateId()`, default export
- **UUIDv7 = `crypto.randomUUIDv7()` NATIF** (Node ≥ 24 = `engines` min) → 0 dep, pas de générateur maison.
  ⚠️ `randomUUID({version: 7})` **ne fait PAS un v7** : option ignorée en silence → v4 (nibble `4`).
- **v7 : PAS de monotonie intra-ms** (Node n'a pas le compteur RFC §6.2 ; mesuré ~50 % d'inversions sur
  20 000 tirages, 0 collision). Localité d'index acquise (préfixe 48 bits) mais **jamais trier par id**
  pour ordonner des créations → trier par `createdAt`. v7 **n'est pas un secret** (RFC : « MUST NOT be
  used as security capabilities ») → jeton imprévisible = `generateId()` (v4).

---

## index.ts — barrel ESM (`src/index.ts`)

**Règle** : zéro default export — tout est nommé. `import { X } from "nodefony"` uniquement.

**Exports clés** :

```typescript
// Classes
(Nodefony, Kernel, Module, CliKernel, Service, Container, Event, Syslog, Pdu);
// Erreurs
nodefonyError; // ← anciennement exporté comme "Error" (cassant)
// ORM
(Orm, Entity, Connector);
// DI
(inject, injectable, services, entities, modules);
// Utils
(extend, typeOf, isArray, isPromise, isPlainObject, isFunction, isContainer);
// Types (import type)
(IKernel, IService, IContainer, IScope, IModule, ISyslog);
(DynamicParam, DynamicService, ProtoService, ProtoParameters);
```

**Migration `nodefony` default → named** :

```typescript
// Avant (cassé)
import nodefony, { Kernel } from "nodefony";
nodefony.kernel; //  ← undefined
// Après
import { Nodefony, Kernel } from "nodefony";
Nodefony.getKernel();
```

**Types path** : `dist/types/src/index.d.ts` (après `npm run clean && npm run build` dans `src/nodefony`)

---

## Model Context Protocol (`src/mcp/`) — le protocole, pas la porte

Tout est PUR : aucun socket, aucun conteneur, aucune horloge. La PORTE HTTP vit
dans un module (`@nodefony/devkit` → `POST /nodefony/mcp`) ; le protocole vit ici
pour qu'une seconde porte (P12, ou une porte authentifiée de production) n'ait
rien à redéclarer.

<!-- prettier-ignore -->
| Symbole | Fichier | Rôle |
| --- | --- | --- |
| `handleMcpMessage` | `src/mcp/server.ts` | 1 message JSON-RPC → `{status, body}`. Reçoit des outils **déjà résolus** (`IMcpTool[]`), jamais un catalogue |
| `checkMcpAccess`/`isLocalAddress` | `src/mcp/guard.ts` | `Origin` (**absent = client natif → passe**) + localité. Localité jugée AVANT l'origine |
| `builtinMcpTools(deps)` | `src/mcp/tools.ts` | 4 intégrés (`inspect`, `check`, `symbols`, `card`) → briques existantes (`readAdminSubject`, `collectCheckReport`, `lookupSymbol`, `getCard`) |
| `collectMcpTools(opts)` | `src/mcp/tools.ts` | intégrés filtrés par allowlist **puis** `getMcpTools()` de chaque module. Écarts → `onSkip` |
| `publishMcpTools`/`callMcpTool` | `src/mcp/tools.ts` | projection sans `handler` / exécution par nom |
| `mcpText` | `src/mcp/tools.ts` | enveloppe `content[]` — une app en a besoin pour ses propres outils. **BORNÉ** (voir ci-dessous) |
| `IMcpTool` | `types/IMcpTool.ts` | contrat producteur (comme `IAdminApi`) ; `IModule.getMcpTools?()` |

- **Collecte, PAS registre** — rien n'est alloué au boot, rien n'est mémorisé :
  la liste se ramasse au moment de servir `tools/list`. Un registre serait
  nécessaire s'il fallait MONTER quelque chose au boot (c'est le cas de
  `IAdminRegistry`, qui crée des routes) ; un outil MCP ne monte rien.
  Conséquences : coût nul en production, aucun ordre de `register()`, fraîcheur
  gratuite.
- **Ordre = intégrés d'abord** → un module ne peut pas se substituer à
  `nodefony_inspect` et répondre à sa place.
- 🔴 **Un résultat est une RÉPONSE, pas un déversement** — `mcpText` borne à
  `MCP_TEXT_MAX_CHARS` (32 000). Au-delà : un tableau rend son `count` EXACT puis
  ses entrées en SURFACE (`surfaceDe` : scalaires courts gardés, objets/tableaux
  imbriqués et longues chaînes jetés) ; un objet rend ses `keys`. **En deçà, la
  donnée part TELLE QUELLE** — aucun consommateur à retoucher, et la garde n'est
  pas payée sur le cas courant. Garder TOUTES les entrées en surface, jamais un
  échantillon des N premières : une question portant sur la 100ᵉ recevrait
  sinon une réponse fausse, sans moyen de le savoir. La garde vit dans `mcpText`
  (pas dans les 4 intégrés) → un outil d'application en hérite sans le savoir.
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
  `caller` absent = `{authenticated:false, scopes:[]}` — **fail-closed**. Le
  handler reçoit `(args, caller)` pour borner ce qu'il REND. Rétention →
  `onWithheld` (DEBUG, c'est normal), distinct d'`onSkip` (WARNING, c'est une
  faute d'auteur).
  ⚠️ La porte du devkit câble un caller ANONYME (aucun jeton validé) : tout
  outil à scopes y est invisible pour toujours. Conforme à la spec, qui autorise
  le catalogue à varier « by the authorization presented on the request » mais
  l'interdit « per-connection » — d'où la collecte par requête.
  Ce qui manque pour l'activer = rôle _resource server_ (P6.9) : valider le
  Bearer (`JwtAuthenticator` existe), publier RFC 9728, `401`+`WWW-Authenticate`
  (RFC 6750), audience (RFC 8707). ⚠️ L'AS peut être TIERS — « beyond the scope
  of this specification » ; croire qu'il fallait écrire un AS OAuth 2.1 complet
  a servi de justification à l'écart, et c'était faux.
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
- ⚠️ `check` scanne le dépôt réel (~4 s) : tout test qui l'exerce doit porter un
  `timeout` explicite — le défaut vitest de 5 s tombait en CI et passait en local.

---

## OAuth (`src/oauth/`) — protocole PUR, deux rôles symétriques

Aucune crypto, aucun socket : composer des URL, juger un document, en composer un.
Au cœur parce que **deux couches qui ne se voient pas** partagent chaque règle —
`@nodefony/security` (qui LIT) et `@nodefony/framework` (qui SERT), lequel
n'importe JAMAIS security. Hors de `mcp/` : le MCP n'en est qu'un consommateur.

| Fichier                  | Rôle                   | Symboles                                                                                                                                                                     |
| ------------------------ | ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `protectedResource.ts`   | serveur de RESSOURCE   | `canonicalResourceUri`, `protectedResourceMetadataPath/Url`, `buildProtectedResourceMetadata`, `buildBearerChallenge`, `authorizeProtectedResource`, `ACCESS_TOKEN_VERIFIER` |
| `authorizationServer.ts` | serveur d'AUTORISATION | `canonicalIssuer`, `authorizationServerMetadataPath`, `issuerMetadataUrls`, `validateIssuerMetadata`, `buildAuthorizationServerMetadata`, `extractScopes`, `JWKS_PATH`       |

- 🔴 **La PUBLICATION fait autorité, la LECTURE en dérive** :
  `issuerMetadataUrls()[0]` est composée par `authorizationServerMetadataPath()`,
  jamais par un littéral. Deux copies du chemin bien connu produiraient un `404`
  que chacun interpréterait comme « pas d'autorisation ici ». Verrouillé par la
  suite « la boucle » (`tests/authorizationServer.test.ts`).
- **Insertion, pas concaténation** (RFC 8414 §3.1 / 9728 §3.1) : le suffixe se
  place ENTRE l'hôte et le chemin. Un émetteur `https://h/tenant1` publie sous
  `/.well-known/oauth-authorization-server/tenant1`.
- **Égalité STRICTE de l'émetteur** (§3.3) = la garde centrale de la lecture :
  sans elle, un document servi par `attaquant` se déclarant `honnête` ferait
  vérifier des jetons avec SES clés.
- **Ce qu'on publie est réduit à ce qui est VRAI** : `response_types_supported`
  et `grant_types_supported` **vides** — Nodefony n'a pas de flux OAuth. Omettre
  le second annoncerait `["authorization_code","implicit"]` par défaut (§2).
  `jwks_uri` en https obligatoire, des deux côtés.
- `canonicalIssuer` **lève** sur tout ce qui n'est pas une URL https sans requête
  ni fragment → ne jamais l'appeler dans un `supports()` d'authenticator
  (le firewall l'appelle HORS de son bloc de rattrapage).

---

## Event (`src/Event.ts`)

→ Étend `node:events` EventEmitter. Ajoute : `fire()`, `fireAsync()`, `emitAsync()`, `listen()`, `settingsToListen()`.

---

## Syslog

→ Voir [`src/syslog/MEMORY.md`](src/syslog/MEMORY.md)

---

## `nodefony/bundler` (`src/bundler/`) — socle de build publiable

Source UNIQUE de la config rolldown (packages du repo ET apps `create app`). TOUTES les configs
importent le subpath publié `nodefony/bundler` (dogfooding — l'app dev racine = template vivant),
SAUF le core qui importe sa SOURCE en relatif (`./src/bundler/index` — œuf-poule : pas de dist
avant son propre build). Prérequis des consommateurs = core buildé (ordre turbo ; un build isolé
après clean TOTAL échoue au chargement de config → builder le core d'abord). Une app utilise :
`import { defineNodefonyRolldownConfig } from "nodefony/bundler"` + `externalDeps: true`
(externalise `dependencies`+`peerDependencies` de SON package.json — les packages du repo gardent
leur liste explicite auditée par `nodefony-check-externals`). Entrée rolldown SÉPARÉE
(`dist/node/bundler/index.js`), JAMAIS réexportée par `src/index.ts` (elle importe `rolldown`,
peerDep OPTIONNELLE). Invariants gravés : nom propre toujours externe (anti self-import),
side-effect `reflect-metadata` préservé, `nodefony` exact-match only. Tests `tests/bundler.test.ts`.

## Client isomorphe (`src/client/`) — subpaths navigateur

Build rolldown dédié (`createClientConfig`, `tsconfigClient.json` `types:[]`), shims `node:util/events/cli-color`, sortie `dist/client/`.

- **`nodefony`** (cond. `browser`) + **`nodefony/client`** : barrel browser (RealtimeClient, Pdu, Syslog, Tools…). Bundle ~25 KB gz. **Ne JAMAIS** réexporter sip/media/debugbar depuis `client/index.ts` (exploserait le barrel).
- **RealtimeClient (lib cliente réutilisable)** : pub/sub (`on/off/subscribe` ref-compté) + `request(method,params,timeoutMs=30000)` (req→rép JSON-RPC, Promise id-matchée) + `callStream` (LLM). Helper `ping(timeoutMs=5000)` → `{...nodefony:kernel:ping, rtt}` (RTT mesuré client ; type `KernelPingResult`). RÈGLE : le générique realtime vit ICI (Studio/debugbar/apps partagent), pas dupliqué par front. Test `tests/RealtimeClientPing.test.ts`.
- **`nodefony/debugbar`** : subpath debug bar (entry rolldown séparée, RealtimeClient/Pdu **partagés** via preserveModules → 0 duplication). `mountDebugBar(opts?)` + `DebugBar`. Vanilla TS + **Shadow DOM**, 0 dep UI.
- **`nodefony/debugbar.js`** : bundle **standalone mono-fichier** (`createDebugbarStandaloneConfig` → `dist/client/debugbar.standalone.js`, deps inlinées) pour `<script type="module" src>` sur page rendue serveur (EJS/Twig, hors Vite).

### Debug bar — internals

- `debugbar/{DebugBar,model,format,hmr,index}.ts`. **model/format = purs** (testés `tests/DebugBar.test.ts`, 12). DOM = vérif navigateur.
- Données via `RealtimeClient` (canaux `nodefony:dashboard` + `nodefony:syslog`, endpoint défaut `/nodefony/studio/api/realtime`). Logs **réhydratés en `new Pdu()`** (champs `payload`/`moduleName`/`severity`, PAS `pci`/`msgid`).
- Pouls realtime = `client.framesReceived` (msg/s + VU). Sonde HMR Vite = `connectViteHmr` (2ᵉ client WS `vite-hmr`, dev). Sparklines = SVG maison (pas recharts).
- Env + branche git viennent du bloc `app` de `nodefony:dashboard` (poussé serveur, cf studio providers).
- Chrome persisté localStorage : `nf.debugbar.{visible,min,side,tab,h}`. Handle global `window.__NODEFONY_DEBUGBAR__` (show/hide/minimize) → bridge app (Studio).
- Gotcha : le conteneur `.minbar` (chip réduit) n'a pas de `[data-el]` → ref stockée à la main (sinon barre réduite invisible).

### Network panel + profiler

- `network.ts` : intercepteur **fetch + XHR** dev-only — **header-only** (jamais le body), défensif (try/catch, relaie l'original), réversible (`uninstall`), chain-safe, opt-out (`network:false`), **filtre les appels Vite** (cross-origin 5173). Lit `x-request-id` (clé profiler) + `traceparent` (W3C) des réponses.
- `profile.ts` : **purs** — `NetworkModel` (ring buffer 80 + compteurs + cache profils), `computeWaterfall(phases)` (layout %), types `ProfileEntry`/`ProfilePhase`/`ProfileQuery`. **Réexportés du subpath** `nodefony/debugbar` → réutilisés par Studio (page Profiler). Tests `tests/Profiler.client.test.ts` (11).
- Clic ligne → fetch `/nodefony/profiler/api/{requestId}` (ignoré par l'intercepteur) → **waterfall** des phases serveur + méta (route/user/trace). Bouton ✕ ferme.
- **UI** : onglets (Realtime/Network/Perf/Logs/Runtime, **1 seul pane rendu**). Liste Network en **MAJ incrémentale** (noeuds stables via `Map<id,node>`, jamais d'`innerHTML` global → clic non perdu + scroll ne saute pas). Hauteur panneau **responsive** ≈48vh (55vh à l'ouverture profil), resize persisté, re-clamp au resize fenêtre. **Strip responsive** `clamp(12→16px)` + tout en `em`. Fond panneau **OPAQUE** (le `backdrop-filter:blur` recompositait à chaque frame de scroll → lag ; blur gardé sur la strip seule).
- **Sync→hôte** : clic dispatch `window` CustomEvent `nodefony:debugbar:select {requestId}` (no-op si pas de listener). Studio écoute → page Profiler.
