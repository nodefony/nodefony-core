# Gotchas & diagnostic — règles durables (vérité courante)

> Chargé à la demande par `SKILL.md`. **Règles intemporelles** (symptôme → cause → fix), groupées par
> thème. **Pas de dates ni de hash** : l'historique vit dans `git log`. Une nouvelle leçon se **fond en
> règle ici** (édition en place), jamais en entrée datée. Détail d'un cas → `git log`/mémoires IA.

## Sommaire

- Hot path & perf
- Pipeline RFC (HTTP/WS)
- Idempotence (mutations rejouables)
- ALS & corrélation
- Boot & shutdown
- ORM
- Introspection / data plane admin
- Cluster & sondes realtime
- Build / process / git
- Méthode (avant de coder)
- Table condensée
- Recette : reproduire un bug de boot/shutdown/race

---

## Hot path & perf

- **Ne JAMAIS double-résoudre sur `callController`/`executeAction`** (chaque requête) : résoudre `meta`/`actionMeta` **1×** et le passer en argument, jamais le re-résoudre dans l'appelé. Gater le cold path par un champ nul (`idempotent === null` comme `security === null`) → 0 alloc/lookup au cas nominal.
- **Gater une sonde dépend de son COÛT UNITAIRE réel**, pas d'un réflexe : un **compteur entier O(1)** (incrément `publish`/`send`, compteur d'erreurs `sev 0..3`) reste **always-ON** (0 syscall/stringify/alloc) ; un **timer/serializer** (`performance.now()` + `toSQL()` sur CHAQUE requête) **doit être gaté** par le composant qui connaît l'env (ex. flux ORM `enabled` OFF par défaut, activé au boot par le driver `env!==production`).
- **Débit/s = dérivé** (delta `total`/`ts`, comme CPU%) → 0 état de lecture, robuste sous saturation event-loop. Une sonde **n'écrit jamais** dans la base qu'elle observe.
- **Toute promesse fire-and-forget dans le pipeline DOIT `.catch()`** (un GC de session/idempotence lancé sans `.catch()` = `unhandledRejection` qui casse le process).

## Pipeline RFC (HTTP/WS)

- **Allow-list de méthodes silencieuse = piège** : `Request.ts` gate le parsing du corps sur `method in parse`. `PATCH` doit y figurer (RFC 5789, corps comme POST/PUT) sinon `request.body` vide → `updateOne({})` → 500 « No values to set ». Un oubli ne casse qu'au runtime sur la méthode oubliée. **Défense en profondeur** : un handler de mutation refuse un patch vide (**400**, jamais un UPDATE vide = 500).
- **`application/json` SANS `; charset=utf-8`** (RFC 8259 §11). Auto-JSON gardé + WARN dev si retour pendant le « trap ».
- **WS** : codes close via helper pur (`toWsCloseCode` ; 4xx→4004, jamais un `4404` inventé). **Toute socket `ws` SANS `on("error")` peut crasher le process.** `maxPayload` doit être **câblé** (sinon 100 MiB implicite = DoS mémoire) → défaut 1 MiB → close 1009.
- **`redirect()` = whitelist RFC 9110 §15.4** `{301,302,303,307,308}` (Set module-level, 0 alloc), **défaut 302** (307/308 préservent méthode+corps, 303 force GET). Motif de bug récurrent : `else { force }` au lieu d'une whitelist écrase une valeur valide → chercher ce pattern.

## Idempotence (mutations rejouables)

- **Helper de VERDICT NEUTRE** pour partager une logique entre call-sites de format différent : extraire la DÉCISION (`evaluateIdempotency` → `execute|guarded|replay|reject`) du RENDU. Une source normative, N emballages (HTTP `AdminApiController` vs WS `Resolver._callWithIdempotency`).
- **Codes depuis la SPEC, jamais de mémoire** (`draft-ietf-httpapi-idempotency-key-header` §2.6/2.7) : clé absente → **400**, rejeu concurrent → **409**, rejeu après complétion → réponse mémorisée, **même clé + payload différent → 422** (RFC 9110 §15.5.21, via **fingerprint** SHA-256 du payload).
- **Match WS method-aware** : en WS `context.method` = "WEBSOCKET" toujours → seam `methodOverride` threadé `Router.resolve→Resolver.match→Route.match` (param optionnel, rétro-compat) ; mutation WS exige `has("WEBSOCKET") && has(method)`. Tout changement de signature du routing → passer `routing-nonregression.test.ts` à l'identique + ajouter l'invariant.
- **Scope du cache = IDENTITÉ** (anti-IDOR) : dériver de **`request.user`** (posé par les 2 transports dans l'ALS), PAS `RequestContext.getUserId()` (le firewall HTTP ne le pose pas toujours). Clé = `JSON.stringify([identity, clientKey])`.
- **Contrat partagé → le CORE** quand des modules hors framework l'implémentent : `IIdempotencyStore`/`ITokenStore` dans `nodefony` (`src/types/`), façade re-export framework → `@nodefony/redis`/`@nodefony/drizzle` branchent sans cycle.
- **Jamais un null byte LITTÉRAL** comme séparateur de clé composite (invisible, cassé par prettier) → `JSON.stringify([a,b])`.

## ALS & corrélation

- **Une corrélation (requestId/traceId) qui dépend d'un contexte async DOIT survivre au teardown** → la porter sur un objet **explicite** (`context`), jamais sur l'ALS qui se vide. Un log de FIN de cycle émis après le teardown ALS perd son `requestId`.
- **L'ordre chronologique d'un flux de logs = l'`uid` monotone du Pdu, PAS `Date.now()`** (deux Pdu de la même ms se départagent par uid).
- **Le driver de démo (console queryable) vit dans le MODULE TEST**, jamais dans le core : le core expose `ILogDriver`/`filterPdus`, l'app branche son driver.

## Boot & shutdown

- **Séparer MÉCANIQUE de POLITIQUE** : `Event.emitAsyncGuarded` (série + try/catch + timeout + `{results,errors,stopped}`) = mécanique pure ; `Kernel.fireLifecycle` = politique (tags owner/critical, fatal si `critical && prod` sinon fail-soft+WARNING). `Service` **COMPOSE** `Event` (`this.nc`), n'étend PAS EventEmitter → nouvelle méthode event = ajout à Event ET re-export Service.
- **`once()` wrappe le listener** → `rawListeners` rend le wrapper → déballer `.listener` pour lire les tags.
- **Gain `emitAsync` sans risque** : `if (listenerCount===0) return` AVANT `rawListeners` (évite l'alloc array du cas 0-listener dominant) + `await` conditionnel (skip microtask si non-thenable).
- **`Module.critical` = STATIC** (lue au ctor via `(this.constructor as typeof Module).critical`, AVANT les initializers de sous-classe).
- **Override `module-<name>` ≠ listener `onPreRegister`** (les modules sont construits PENDANT ce fire → un listener ajouté en cours n'est jamais rappelé) → `Kernel.applyModuleConfigOverrides()` centralisé APRÈS le fire, AVANT validation Zod.
- **Un service infra doit tolérer d'être sollicité pendant le shutdown** : ex. `SessionStorage` (Drizzle) dégrade quand `!orm.isConnected()` (read→vide, write/gc→no-op) — sinon une requête en vol retouche l'ORM déconnecté → crash.
- **Superviseur/serveur en background = single-instance obligatoire** (pidfile + SIGHUP + group-kill) sinon instances orphelines empilées.

## ORM

- **Un mapping `row → entité` qui oublie une colonne = champ `null` silencieux** dans les DTO. Quand un DTO expose un champ optionnel (`IUserSummary.createdAt`), vérifier que le mapping du repo le PORTE.
- **1 tx = 1 ORM** ; 2PC cross-ORM non garanti.

## Introspection / data plane admin

- **Introspection = projeter l'état RUNTIME, PAS re-parser la config** : une méthode `describe()` SUR le service lit ses structures déjà construites (vérité runtime ; un authenticator en typo n'est pas « monté ») — re-parser montrerait la config THÉORIQUE.
- **Redaction par construction** : le DTO n'a PAS de champ secret (présence `synchronizerToken`, jamais la valeur) ; un test asserte que `JSON.stringify(describe())` ne contient pas le secret sentinelle.
- **Un 401 via curl ne prouve PAS le handler** (le gate RBAC du broker répond AVANT) → test unitaire qui construit le service buildé + appelle `describe()` + l'endpoint via `container.set(...)`.

## Cluster & sondes realtime

- **Généraliser une agrégation cluster = enrichir le COLIS, pas l'agrégateur** : un agrégat opaque s'étend en ajoutant des champs **additifs** au report per-worker (le merge pod les somme), 0 ligne dans l'agrégateur.
- **Généraliser un drill @pid = ajouter une FACETTE** (`facet: "process"|"orm"`), pas un 2ᵉ flux. **1 canal = 1 enrich** (le hub dédoublonne par nom → pas de ref-count ; 2 canaux séparés → un unsub couperait l'autre).
- **Dépendance propre par seam CORE** : `framework` ne doit PAS importer `orm-core` → contrats + `setXProvider`/`readX` dans le core, le **driver** branche l'impl au boot (pattern `setClusterProbeClient`).
- **Porter un `IBackplane` AVANT toute impl** : séparer `publish` (local + cross-process) de `publishLocal` (local seul = ingress) ; prouver avec un Loopback no-op + un backing factice (drop-in garanti). **Anti-boucle = 2 barrières** (ingress→`publishLocal` ; backplane filtre son `originId`). `#backplane=null` par défaut (0 overhead mono-process).

## Build / process / git

- **turbo restaure du dist caché** : `clean && build` ne buste pas le cache → runtime sur vieux code. Avant test runtime d'un diff non commité : `npx turbo run build --force --filter=…`.
- **typecheck = gate DISTINCT du build** : le build (oxc, sans type-check) peut masquer un `tsgo --noEmit` rouge (ex. TS18036 sur `static #` + décorateur de classe → `private static`). Hook pre-push.
- **`.git/index.lock` orphelin** = `git stash pop`/commit échouent silencieusement (edits restent dans le stash, working tree = original → fausse impression de perte). Après un git qui « réussit » mais dont l'effet manque : vérifier `.git/index.lock` + `git stash list`.
- **Tests perf à seuil absolu flakent en CI** (runners non déterministes) → opt-in `RUN_PERF=1` / skip si `CI`.

## Méthode (avant de coder)

- **Confirmer chaque gotcha contre le SOURCE** avant de coder : un gotcha daté peut être déjà résolu (ne pas « re-fixer ») OU un vrai bug. La devise : le code ≠ le plan.
- **Citer la RFC EXACTE** (skill `nodefony-rfc` / `references/rfc/`) plutôt que trancher « raisonnable de mémoire ».

---
