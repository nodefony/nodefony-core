---
title: ClientKernel isomorphe & debug runtime — brainstorming
audience: dev
status: brainstorming
since: 2026-06-29
---

# ClientKernel isomorphe & debug runtime (brainstorming)

> **Statut : brainstorming / vision.** Pas une décision figée, pas une roadmap engagée. Capture d'une
> discussion née de la chasse au bug « déconnexion Studio aléatoire » (2026-06-29). À reprendre quand
> le moment sera venu (**après la migration TS**, qui stabilise d'abord les primitives isomorphes).

## 0. D'où ça vient

Un bug de déconnexion Studio « aléatoire » a été chassé sur ~6 sessions. Cause réelle = **côté client**
(`ApiClient.onUnauthorized` appelait `logout()` — un POST destructif qui efface session + cookie — sur
**tout** 401, y compris la sonde d'auth `/auth/me` dont un 401 est la réponse _normale_ « pas connecté »).

Deux constats ont émergé :

1. **L'info de diagnostic existait déjà** (logs `gc`/`destroy` en `DEBUG`) mais **invisible**, et **aucun
   moyen de la rallumer à chaud** → chaque tentative de diagnostic = rebuild + restart (~4 min) qui vide
   les sessions et force à re-reproduire un bug aléatoire. La **friction d'instrumentation** a prolongé
   la chasse, pas l'analyse.
2. **La décision fautive était côté front**, donc **invisible côté serveur**. Sans observabilité front
   unifiée avec le back, on debugge à l'aveugle.

→ D'où deux chantiers complémentaires : un **debug runtime** (back, à chaud) et, plus loin, un
**ClientKernel** isomorphe qui unifie l'observabilité (et plus) côté navigateur.

---

## 1. Chantier court terme — Debug runtime par-module (back)

**But** : un utilisateur du framework (prod OU dev) doit pouvoir débugger un incident critique **sans
redéploiement**, en allumant le DEBUG ciblé d'un module, à chaud, puis en l'éteignant.

**La brique existe déjà** — ne pas réinventer :

- `Syslog.setSeverityThreshold()` (`src/nodefony/src/syslog/Syslog.ts`) = levier « audit à chaud »
  documenté, **ré-résoluble à chaud** (gate d'entrée par sévérité).
- `Syslog.setConditions()` = filtrage par module / sévérité.
- Config `log.debug` (`nodefony.config.ts`, `"*"` dev / `[]` prod), `kernel.debug` (`-d`).

**Manques à combler** :

- C'est **global** → le rendre **par-module / par-msgid**.
- **Pas exposé à chaud** → l'exposer.
- En dev `log.debug:"*"` mais les `DEBUG` ne sortaient pas dans le log runtime → **vérifier la chaîne
  threshold ↔ conditions ↔ transport** (pourquoi DEBUG était gaté).

**Design proposé** :

- **`NF__DEBUG=sessions,firewall,realtime`** (env, catégories par module) — lu au boot.
- **Endpoint admin** `PATCH /nodefony/kernel/api/log/level` (ROLE_NODEFONY_ADMIN) `{ module?, level }`
  → `setSeverityThreshold` / `setConditions` **à chaud**, **auto-extinction après N min** (jamais
  laisser DEBUG ON), **audité**. Calquer le PATCH `config/{module}` (dev-only, validé, audité).
- **Toggle Studio** (page Logs / Config) : module + niveau + minuterie.
- **Prod headless** : signal `SIGUSR2` = bascule DEBUG global temporisé.
- **Sécurité** : gated, secrets toujours redactés (un `DEBUG` ne doit jamais logger un secret).

**Logs utiles à (re)poser proprement, gated par le toggle** (identifiés pendant la chasse) :

- store session : `read MISS`, `read/write EMPTY-USER`, `destroy`, `gc DELETED` **+ cutoffs** ;
- realtime : échec du `buildSessionRevalidator` (raison) + rejet 401 du pont (path) ;
- firewall : sur 401 zone protégée → cookie présent ? id de session ? identité résolue ?

---

## 2. Vision long terme — `ClientKernel` isomorphe (front)

> ⚠️ **Pas** un kernel back dans le navigateur. **Exclut** : routeur, firewall, ORM, serveurs HTTP,
> tout ce qui est propre au back ou déréférence un secret/service serveur.

### 2.1 L'idée

Le Core `nodefony` est **déjà isomorphe** sur ses primitives transverses : `Service`, `Container`/DI,
`Syslog`/`Pdu`, `Event`, `RequestContext`, `RealtimeClient` tournent (ou peuvent tourner) dans le
navigateur (bundle `src/client/`, `tsconfigClient.json`, la debug bar consomme déjà `Pdu`).

Un **`ClientKernel`** = un **composition root + lifecycle navigateur** qui assemble ces primitives en
**services injectés**, au lieu du câblage ad-hoc actuel.

> **Observation clé** : le `RootStore` de Studio (`stores/RootStore.ts`) est **déjà un mini-kernel
> câblé à la main** — composition root, wiring de services (ApiClient, RealtimeClient, stores),
> réactions de lifecycle (reconnexion socket au changement d'identité). On ne _crée_ pas un kernel
> front : on **formalise** celui qui existe déjà en ad-hoc, et on le rend **réutilisable** par toute
> app Nodefony (pas seulement Studio).

### 2.2 Ce qu'il compose (couche INFRA/SERVICES)

- `Container` / DI (le même que le back, isomorphe).
- `Service` (base : DI + EventEmitter + logging).
- `LoggerService` ← `Syslog`/`Pdu` (logging unifié front/back).
- `SocketService` ← `RealtimeClient` (la socket Nodefony, protocole JSON-RPC partagé).
- `ApiService` ← wrapper `fetch` + pont socket (le data-plane BFF).
- `DebugBarService` (la barre de debug).
- `BrowserEventBridge` : `visibilitychange` / `online` / `offline` / `beforeunload` / `focus` → events
  Nodefony (un pont d'events navigateur).
- `PrefsService`, `AuthService`, etc.
- **Lifecycle** mappé au navigateur : `boot` = montage de l'app, `terminate` = `beforeunload`.

### 2.3 La ligne rouge (ce qui garde l'idée NON-utopique)

**Le ClientKernel possède la couche INFRA/SERVICES + lifecycle + observabilité. React Router + MobX
gardent la couche VUE / routing / état.**

- Les stores MobX deviennent des **adaptateurs minces** au-dessus des services du kernel (ou _sont_
  des services enregistrés dans le container).
- ❌ Le kernel ne doit **jamais** owner le **rendu**, le **routing**, ni l'**état observable de l'UI**
  → ce serait **se battre contre React** (le navigateur a déjà son « kernel » : React + Router + MobX).
- ❌ Frontière isomorphe **non négociable** : aucun code/secret serveur (firewall, ORM, config secrète)
  dans le bundle client.

### 2.4 Le motif « 1 contrat, 2 transports » (préoccupation isomorphe)

Plusieurs concerns sont **isomorphes mais à deux backends**. Le ClientKernel les rend propres :

| Concern          | Backend Node                                   | Backend navigateur              |
| ---------------- | ---------------------------------------------- | ------------------------------- |
| Couleurs de log  | `util.styleText` (ex-`cli-color`, migré natif) | `console %c` / CSS (debug bar)  |
| Transport Syslog | file / stdout / Loki                           | console / debug bar / IndexedDB |
| RequestContext   | `AsyncLocalStorage`                            | contexte par interaction (lite) |

C'est exactement ce que l'exemple `cli-color → styleText` illustre : un même contrat de
formatage/coloration, deux implémentations selon l'environnement.

### 2.5 Pourquoi c'est solide

1. **Aboutissement logique de l'isomorphisme** déjà en place.
2. **Formalise** le mini-kernel ad-hoc (`RootStore`) → réutilisable cross-app.
3. **ADN du framework** : inspiration NestJS (DI + decorators) ; Angular (supporté par le scaffold) fait
   de la DI cliente first-class → la DI navigateur n'est pas exotique ici.
4. **Différenciateur produit** : « écris tes services front (logger, socket, api, prefs, auth) en
   services Nodefony injectés, comme tes services back ».
5. **Subsume le bus de debug** : `Syslog` front = `Syslog` back → observabilité unifiée gratuite.

### 2.6 Le risque réel à mesurer

**Le poids du bundle** : la DI repose sur `reflect-metadata` + runtime de decorators dans le navigateur.
Pour Studio (qui embarque déjà React + Mantine + MobX) le surcoût est probablement marginal — **mais à
mesurer** (prototype `ClientKernel` minimal + `size-limit`) **avant** de s'engager.

---

## 3. Le bus de debug isomorphe — le pont entre les deux

C'est la **1ʳᵉ brique** du ClientKernel ET l'extension naturelle du debug runtime :

- mêmes `Syslog`/`Pdu` côté front → logs/erreurs front avec **même forme, sévérité, `requestId`** ;
- ils remontent par le **même canal realtime** (`syslog:stream`) dans le **même viewer** (debug bar +
  `/nodefony/logs`) ;
- → **trace end-to-end corrélée** : clic front → fetch → controller → requête ORM → réponse, dans **une
  seule timeline** (corrélation via `requestId` / `traceparent`, déjà portés par `Pdu`) ;
- le toggle debug-runtime devient isomorphe : `NF__DEBUG=front:realtime` → le front émet du DEBUG dans
  le même flux.

> **Justification concrète** : le bug du 2026-06-29 (le front décidait de se delogger sur un `me` 401)
> était **invisible côté serveur**. Avec ce bus, on l'aurait vu dans la timeline en quelques secondes.

---

## 4. Verdict & séquence

- ✅ **Debug runtime back** — bonne idée, peu risquée, à fort levier (debuggabilité d'incident sans
  redéploiement). **Prochain chantier.**
- ✅ **Bus de debug isomorphe** — extension naturelle ; 1ʳᵉ brique du ClientKernel. **Phase 2.**
- ✅ **`ClientKernel` (infra/services)** — bonne idée, **non** utopique _tant que la ligne rouge §2.3 est
  tenue_ (infra/services au kernel, vue/routing/état à React/MobX). **Phase 3, après migration.**
- ❌ **Kernel back complet dans le navigateur** (routing/firewall/ORM) — à ne pas viser.

**Ordre** : (1) debug-runtime back → (2) bus de debug isomorphe → (3) généralisation en `ClientKernel`.
**Timing** : après la migration TS (elle stabilise les primitives isomorphes — `Service`/`Container`/
`Syslog` — sur lesquelles le kernel front repose).

---

## Ancrages (vérifier au code avant d'attaquer)

- `src/nodefony/src/syslog/Syslog.ts` — `setSeverityThreshold`, `setConditions`, `_severityThreshold`.
- `src/nodefony/src/client/` + `tsconfigClient.json` — bundle navigateur isomorphe (Pdu/debugbar).
- `src/nodefony/src/Service.ts` · `Container.ts` · `Event.ts` · `runtime/RequestContext.ts` — primitives à composer.
- `src/packages/@nodefony/studio/frontend/src/stores/RootStore.ts` — le mini-kernel ad-hoc actuel (modèle à formaliser).
- `src/packages/@nodefony/studio/frontend/src/services/{ApiClient,AuthService}.ts` + `RealtimeClient` (core) — les services à promouvoir.
- `src/nodefony/src/.../colors.ts` (façade `util.styleText`) — exemple « 1 contrat, 2 transports ».

> Mémoire IA associée : `project_runtime_debug_toggle_kit` (chantier back) · `feedback_debug_instrument_choke_point` (méthode debug) · `project_session_2026-06-29_state` (avis ClientKernel).
