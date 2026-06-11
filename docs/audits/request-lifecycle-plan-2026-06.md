---
title: Plan d'action — durcissement du cycle de vie requête (sécu · perf · archi)
date: 2026-06-10
branch: poc/api-souveraine
status: plan figé — exécution par vagues committables
progress: "V1 ✅ (0860a48) · V2 ✅ (55405ff + 4592679, A/B +2,2 %) · V3 ✅ (9b4dde4 POJO + c6010b0 P5, A/B ~+6 % — 3/3 paires) · V4 ✅ (6905ec3 ALS + 18b6e72 @Scope + V4.2 ResourceController — A/B singleton≈per-request dans le bruit, archi pas perf) · V5 ✅ 2026-06-11 (023fd5e R1+R5 · fd28a82 R2+R3+R4 · 1aaa6f2 P7 · 044df1d contrat retours controller — bonus audit : hang super.send http2, fuite scope DI sur hook onFinish qui throw, hang Buffer/scalaires retournés, 500 sur corps vide)"
depends_on: request-lifecycle-2026-06.md (findings)
principe: "réversible et local d'abord ; structurel seulement une fois le souverain stable. Le mieux est l'ennemi du bien."
---

# Plan d'action — cycle de vie requête

On reste sur `poc/api-souveraine`. On améliore le cycle **en même temps** que le POC
souverain avance, mais on **sépare strictement** ce qui est réversible/local (sécu,
micro-perf, Resolver POJO) de ce qui est structurel (controller singleton, index de
routes). Chaque lot = 1 commit + gate vert. Aucune vague ne touche realtime, backplane
ni le contrat ISessionStorage (vérifié — voir « Garde-fous »).

## Principe directeur (la réponse à « es-tu sûr de l'archi ? »)

1. **Le souverain et le durcissement du cycle sont synergiques, pas concurrents.** Le
   `ResourceController` souverain est _par nature_ une façade mince sans état → il est
   le premier client légitime du controller singleton + du Resolver POJO. On ne force
   rien sur le legacy.
2. **On ne refond PAS le Router maintenant** (index radix / fast path structurel). Gain
   à mesurer, risque matching élevé, et ça brouillerait le POC. → backlog post-souverain.
3. **Réversibilité** : tout lot perf passe par A/B (`bench-ab-mono.sh`) et n'est gardé
   que si le gain dépasse le bruit ±5 %. Un lot qui ne prouve rien est annulé, pas gardé
   « au cas où ».

## Garde-fous (Vague 0 — à tenir à CHAQUE lot)

- **Contrat gelé** : ne pas changer la signature de `Resolver.executeAction` /
  `callController` / `Router.resolve(ctx, cleanPathOverride?)` — le POC souverain en
  dépend (`PocInvokeController`). Ni `ISessionStorage`, ni `SessionsService.start/save`.
- **Non-régression obligatoire par lot** :
  `@nodefony/http` → `npm run test:integration` + `npm run test:memory` ;
  `@nodefony/framework` → `npm test` (176 unit).
- **Si la vague touche le WS** : relancer aussi `tests/load/ws-*` (heap, scopes drainés).
- **Realtime / ORM** : aucun lot ne les modifie ; on lance leurs suites seulement si un
  fichier partagé bouge (ne devrait pas).
- **Mesure perf** : mono `production` + `NF_LOG_DRIVER=null` + kill Vite résidus
  (cf `reference_perf_profiling_method`).

---

## VAGUE 1 — Sécurité bloquante (durcit le terrain AVANT P6)

> Indépendante du souverain. Aucune archi risquée. C'est le sol sur lequel P6 se pose.

| Lot     | Objet                                                                                   | Fichier                                                                                             | Risque                     | Gate                                  |
| ------- | --------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- | -------------------------- | ------------------------------------- |
| **1.1** | **B1** — limite taille body non-multipart (413)                                         | `parser.ts` (`Parser.write` compteur + abort), `config/config.ts` (`http.maxBodySize`, défaut 1 Mo) | faible — symétrique busboy | integration + memory + test dédié 413 |
| **1.2** | **B2** — fix ordre `origin` (2 lignes) + test                                           | `Request.ts:131-133`                                                                                | nul                        | integration                           |
| **1.3** | **B4** — validation Origin au handshake WS (1008)                                       | `WebsocketContext` (check vs allowlist = `trustedHosts` + config), gated                            | faible                     | ws-\* + test CSWSH                    |
| **1.4** | **B3** — nettoyer le code mort CORS/CSRF + poser les **seams** P6 nommés (pas d'implem) | `http-kernel.ts:343-351`, `onRequestEnd`                                                            | nul (suppression)          | integration                           |

Sortie de vague : 0 DoS body, cross-origin détectable, handshake WS non détournable,
emplacements CORS/CSRF balisés pour P6.

---

## VAGUE 2 — Perf réversible mesurée (le gros poisson restant)

> Chaque lot mesuré A/B. Le pattern de gate dev-only existe déjà (`lifecyclePromoted`,
> `wsContentLogging`) → pduFlow/Studio gardent toute leur matière EN DEV.

| Lot     | Objet                                                                                               | Fichier                                                                 | Gain attendu                              | Garde-fou                                                                            |
| ------- | --------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- | ----------------------------------------- | ------------------------------------------------------------------------------------ |
| **2.1** | **P1** — gate boot-time des logs d'events lifecycle (≈5 Pdu/req HTTP, 3/frame WS supprimés en prod) | `Context.ts:427-463` (`fire/emit/fireAsync/emitAsync`) + flag résolu 1× | **le plus gros** (frère du +14,6 % audit) | **pduFlow dev-only préservé** : gate = `env!=="production"`. Mesure A/B obligatoire. |
| **2.2** | **P3a** — requirements pré-compilés au boot (Set méthodes + RegExp)                                 | `Route.ts:441-453`, `compile()`                                         | 0 alloc/match                             | integration (routing)                                                                |
| **2.3** | **P8** — micro : `ansiRegex` const, `toLowerCase`, dead-check `"prod"`                              | `Response.ts:9`, `Context.ts:422`, `router.ts:92`                       | bruit cumulé                              | unit                                                                                 |

Règle : 2.1 d'abord, isolé, A/B avant/après. Si < bruit → on garde quand même (la
réduction de pression ring Syslog vaut indépendamment du RPS), mais on le dit.

---

## VAGUE 3 — Archi Resolver (sert directement le souverain)

> Le Resolver `extends Service` est du gras pur (EventEmitter + plumbing par requête)
> pour un objet jamais consommé comme Service. Déclassement sans risque ergonomique.

| Lot     | Objet                                                                                                                                                                                              | Fichier                                                       | Risque                                    | Gate                                  |
| ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- | ----------------------------------------- | ------------------------------------- |
| **3.1** | **Resolver → POJO** : retire `extends Service`. `get/set/log` délégués à `context` (qui porte le container). API publique (`.resolve/.route/.match/.executeAction/.callController`) **inchangée**. | `Resolver.ts`                                                 | faible — 0 consommateur Service (vérifié) | framework unit + integration + memory |
| **3.2** | **P5** — figer `paramsMeta`/`redirectMeta`/`httpCode`/`headers` sur la **Route** au boot (memo, comme `route.bodyStream`) → sort `Reflect.getMetadata` du hot path                                 | `Route.ts`, `Resolver.executeAction/_applyResponseDecorators` | faible                                    | integration + A/B                     |

Sortie : init/req allégée (le plus cher des 2 objets per-request éliminé), reflect hors
hot path. Le POC souverain `executeAction` en bénéficie immédiatement.

---

## VAGUE 4 — Souverain stateless + singleton opt-in (Phase 2 POC)

> C'est ICI que l'amélioration du cycle et l'API souveraine fusionnent. On ne touche
> PAS au défaut « controller per-request » ; on rend le singleton _possible_ et le
> `ResourceController` souverain en est le premier client.

| Lot     | Objet                                                                                                                                                                            | Risque                                                          | Gate                                    | État             |
| ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- | --------------------------------------- | ---------------- |
| **4.1** | Helpers controller (`render`/`session`/`response`) capables de lire le `context` via l'ALS `RequestContext` (en plus de `this.context`) — pré-requis du singleton sans data race | moyen — bien tester l'équivalence ALS vs `this`                 | integration + memory                    | ✅ `6905ec3`     |
| **4.2** | `ResourceController` souverain **stateless par construction** (état via décorateurs args + ALS, jamais `this.query=`)                                                            | —                                                               | tests POC souverain                     | ✅ (commit V4.2) |
| **4.3** | `@Scope("singleton")` **opt-in** : réutilise l'instance pour les controllers annotés stateless ; **défaut = per-request inchangé** (0 breaking legacy)                           | moyen — la data race est le piège : interdit si champs mutables | integration + memory + test concurrence | ✅ `18b6e72`     |

⚠️ **Le piège nommé** : un singleton n'est sûr que sans état par requête sur `this`.
Donc : défaut per-request CONSERVÉ, singleton réservé à l'opt-in explicite + au souverain.
Jamais de flip global.

**Livré (2026-06-10, ordre 4.1 → 4.3 → 4.2** — le ResourceController naît directement
singleton, ses tests E2E prouvent les deux lots) :

- **4.1** `6905ec3` : payload ALS gagne `context` (core + http-kernel HTTP/WS) ; champs
  per-request du Controller → accessors `shadow ?? dérivation` (toujours frais — le
  `once("onRequestEnd")` et 4 allocs `{}`/`[]` par construction disparaissent). Per-request :
  0 lecture ALS (champ d'abord).
- **4.3** `18b6e72` : `@Scope` pose le statique `Controller.scope` (hérité, `new.target` au
  ctor, 0 Reflect) ; singleton bindé au container KERNEL (celui de la requête est clean()é) ;
  cache de la **promesse** de création sur le Router (anti-race) ; `setRoute`/`module` writes
  skippés ; `initialize()` 1× à la création.
- **4.2** (commit suivant) : `ResourceController<T>` singleton PAR DÉFAUT + `IResourceService`
  structurel (aligné AbstractCrudService, 0 dep orm-core) + helpers CRUD valeur-brute
  (écriture absente → 501, criteria jamais implicites — deny-by-default). Dette Ph.1 corrigée :
  garde-fou `instanceof` sur le pointeur "controller" du container (invoke WS multi-messages).
  POC `/poc/r-books` : E2E **anti-data-race** (8 requêtes concurrentes → body.requestId ≡
  header X-Request-Id, 8 ids uniques, 1 instance) + même action en REST et WS invoke.
- **A/B mono prod** (3 paires alternées) : singleton ≈ per-request — **dans le bruit**
  (-1,2 % / +5,0 %, 1 paire polluée écartée : même URL re-run +30 % d'écart interne). V4 est
  une vague **archi/sécurité de concurrence**, pas perf ; le ROI RPS viendra du fast path
  (backlog P2/P3b) qui s'appuiera sur ces seams.

---

## VAGUE 5 — Robustesse / conformité RFC (lot qualité)

| Lot     | Objet                                                                | Fichier                                                            |
| ------- | -------------------------------------------------------------------- | ------------------------------------------------------------------ |
| **5.1** | **R1** — Range invalide → 416 (pas 500)                              | `Controller.renderMediaStream`                                     |
| **5.2** | **R2** — `void teardown()` : catch + log (pas d'unhandledRejection)  | `http-kernel.ts:658,674`                                           |
| **5.3** | **R3** — Host non autorisé → 421 (pas 401)                           | `http-kernel.ts:1067`                                              |
| **5.4** | **R4** — broadcast WS binaire préservé (pas de `.toString` forcé)    | `Response WS:119`                                                  |
| **5.5** | **R5** — détruire le ReadStream si client parti pendant `streamFile` | `Controller.ts:384-432`                                            |
| **5.6** | **P7** — aplatir les `new Promise(async executor)` restants          | `HttpContext.handle`, `HttpResponse.send`, `SessionsService.start` |

---

## BACKLOG — différé (NE PAS engager maintenant)

- **P2/P3b structurel** : Resolver split résolution/invocation/rendu + index de routes
  (map exacte → regex), controllers singleton généralisés. Gros gain potentiel vs
  Express/Fastify MAIS refonte du Router = risque matching → **après** stabilisation du
  souverain, chantier dédié « fast path » avec banc de non-régression routing complet.
- ~~**Banc comparatif Express/NestJS/Fastify** côte à côte (le chiffre manquant)~~ —
  ✅ **FAIT 2026-06-11** : `docs/audits/bench-frameworks-2026-06.md`. Verdict : Nodefony
  5 264 vs Express 11 740 vs Fastify 20 782 RPS (×4 de plafond ROI). L'écart
  Nodefony→Express (×2,23) n'est **PAS le routing** (Express scanne linéairement aussi)
  → le fast path doit attaquer le **coût par requête d'abord**, l'index radix ensuite.

---

## Séquencement recommandé

```
V1 (sécu)  →  V2.1 (P1, mesuré)  →  V3 (Resolver POJO + P5)  →  V4 (souverain stateless)
                     ↘ V2.2/2.3 + V5 intercalés quand utile (lots quali courts)
```

V1 et V2.1 sont les **deux premiers** : ils donnent le plus de valeur (sécu + le plus
gros gain perf) sans toucher à l'archi. V3 prépare V4. Le structurel (backlog) attend
que le souverain soit prouvé.
