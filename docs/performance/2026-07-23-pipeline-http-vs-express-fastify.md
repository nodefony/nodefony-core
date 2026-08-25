---
title: "Pipeline HTTP — où part le temps"
lang: fr
module: "global"
topic: perf-pipeline-http
coverageModule: http
coverageFiles: "http-kernel.ts,HttpContext.ts,Response.ts,Request.ts,Resolver.ts,Service.ts"
section: "Performance"
audience: [developer]
tags: [performance, http, pipeline, benchmark, express, fastify, profilage]
status: superseded
last-updated: 2026-07-23
updated: "2026-07-23"
source: "docs/performance/pipeline-http.md"
tests: none
---

📍 [Documentation](../index.md) › [Performance](index.md) › **Archive — rapport du 23 juillet**

# Pipeline HTTP — où part le temps

> ⚠️ **Page remplacée — conservée comme point de départ historique.**
> Ce document est l'**analyse statique** qui a ouvert le chantier de performance : elle a été
> produite par lecture du chemin chaud, sans exécuter le serveur. Le profilage runtime qui a suivi
> l'a **en partie contredite** — un poste sous-estimé d'un facteur 5, une hypothèse réfutée, un
> coût entièrement découvert, et 8 ancrages sur 22 inexacts. Les corrections qu'elle propose ont
> depuis été livrées ou rejetées par la mesure.
>
> **Ses chiffres ne sont plus une référence.** L'état actuel, la méthode et les résultats vivent
> dans le [dossier Performance](index.md) ; ce que cette page a eu juste et faux est raconté dans
> [Le pipeline HTTP](pipeline-http.md).

Mesure comparée de Nodefony face à Express, Fastify et un serveur `node:http` nu, puis
analyse des goulots par lecture du chemin chaud. Objectif : savoir **ce que coûte chaque
service rendu par le framework**, et lequel relève du gaspillage.

## Décor de la mesure

|                      |                                                                      |
| -------------------- | -------------------------------------------------------------------- |
| Processeur           | Intel Core i9-8950HK @ 2,90 GHz — 6 cœurs physiques, 12 logiques     |
| Mémoire              | 32 Go                                                                |
| Système              | macOS 15.7.7 (24G720)                                                |
| Node                 | v26.5.0                                                              |
| Générateur de charge | wrk 4.2.0 `[kqueue]`, `-t4 -c128`, 10 s par run, 3 runs, médiane     |
| Serveur              | mono-process, `NODE_ENV=production`, loopback                        |
| Journalisation       | `NF_LOG_DRIVER=null` (sauf ligne dédiée) ; Fastify en `logger:false` |
| Charge utile         | objet JSON identique pour tous (8 champs), `JSON.stringify` partout  |
| Routage              | 186 routes chargées, cible en position #31                           |

> **Machine portable de 2018, sujette au throttling thermique**, générateur de charge
> co-localisé avec le serveur. Les valeurs absolues sont basses pour **tous** les
> participants : seuls les **rapports entre eux** sont exploitables, et uniquement à décor
> identique.

## Résultats

| Cible                           | RPS médian | µs / requête | Rapport vs Nodefony |
| ------------------------------- | ---------: | -----------: | ------------------: |
| `node:http` nu                  |     35 594 |         28,1 |                ×3,8 |
| Fastify                         |     30 445 |         32,8 |                ×3,3 |
| Express                         |     16 321 |         61,3 |                ×1,7 |
| **Nodefony** (journal coupé)    |  **9 347** |        107,0 |                   — |
| **Nodefony** (journal `stdout`) |  **7 993** |        125,1 |                   — |

Chaque run a vérifié que la cible répondait `200` **avant** de mesurer, et aurait été
invalidé si wrk avait signalé la moindre réponse hors 2xx/3xx ou erreur de socket. Aucun
run n'a été écarté.

> Une sixième mesure, prise en cours de session sur la cible équivalente exposée par le
> **data plane d'administration**, donnait 8 324 RPS (runs de 6 s) contre 8 801 pour le
> controller. Elle n'est **plus rejouable** : cet endpoint a été retiré (`8caf7720`) au
> profit du controller, précisément parce qu'il n'était pas le bon point de comparaison.
> Elle est citée pour ce qu'elle a servi à établir, pas comme référence.

## Ce que ces chiffres comparent réellement

Les points de comparaison ne font **rien de particulier**, au sens littéral :

```js
// fastify.mjs — sans schéma de sérialisation rapide (JSON.stringify, comme les autres)
app.get(BENCH_PATH, async () => state);

// express.mjs
app.get(BENCH_PATH, (_req, res) => res.json(state));
```

Les trois serveurs chargent les **mêmes 186 routes**, avec la cible en position #31, et
renvoient le **même objet**. Le décor est honnête : l'écart ne vient pas d'un biais de banc.

Il vient de ce que Nodefony fait **en plus**, à chaque requête :

<!-- prettier-ignore -->
| Nodefony, par requête | Équivalent Fastify |
| --- | --- |
| Instancie 5-6 objets d'infrastructure (Scope DI, HttpContext qui est un `Service` complet, HttpRequest, HttpResponse, Resolver, Controller) | 2 enveloppes légères, handler unique partagé |
| ~25 frames de promesses, dont 3 `fireAsync` sans abonné et un `saveSession` sans session | 2-3 promesses |
| 3 traitements d'URL (deux analyses complètes + un reformatage) | analyse de la query string seule |
| 12-14 opérations d'en-têtes, dont des valeurs constantes reposées à chaque fois | ~4, en un bloc |
| `randomUUID` (199 ns) pour le `requestId` + `traceparent` W3C | compteur incrémental |
| 2× `Buffer.from` du corps + un `Buffer.alloc(0)` | une conversion interne |
| ~10 résolutions de conteneur + 3 `Reflect.getMetadata` | aucune |
| Firewall sur toutes les requêtes : zones, CORS, CSRF, en-têtes de sécurité | aucun — **c'est une fonctionnalité, pas un défaut** |
| `AsyncLocalStorage` (~50-100 ns) pour la corrélation | aucun |
| Démontage structuré : sortie de scope DI, listeners tracés | aucun |

### Deux hypothèses commodes, réfutées par la mesure

**« C'est l'étage d'administration. »** La première cible de banc vivait dans le data plane
admin — on pouvait donc croire que la mesure payait le broker et la résolution de zone que
les concurrents n'ont pas. Une seconde cible, sur un controller ordinaire hors de cette
aire, a donné 8 801 contre 8 324 RPS : **l'étage admin ne pèse que ~6 %**. Il n'explique pas
l'écart.

**« Le drapeau de journalisation ne fait peut-être rien. »** Vérifié plutôt que supposé :
rejouer le même banc en `stdout` donne **7 993 contre 9 347 RPS**, soit **−14,5 %**
(~18 µs par requête). Un drapeau inerte aurait donné deux chiffres confondus. Il fonctionne,
la comparaison avec Fastify est donc équitable — et l'audit par requête devient le
**premier levier de production**, réglable par échantillonnage sans toucher au pipeline.

> À noter : l'analyse statique estimait ce poste à 3-5 µs. La mesure donne ~18 µs. Là où
> l'estimation et la mesure divergent, c'est la mesure qui a raison.

## Les cinq goulots

Analyse conduite par un agent **Fable 5** en effort maximal, par lecture du chemin chaud,
sous trois contraintes : ne modifier aucun fichier, **ancrer chaque affirmation à un
`fichier:ligne`**, n'inventer aucun chiffre. Les valeurs en nanosecondes proviennent de
micro-mesures isolées sur cette machine ; les coûts par requête sont des **estimations
raisonnées**, signalées comme telles.

### G1 — La fabrique de contexte (3-6 µs + 6-12 Ko par requête)

Chaque requête construit un `Scope` (`Container.ts:293-303`), un `HttpContext` qui est un
`Service` complet — EventEmitter dédié (`Service.ts:61`), `Map` de listeners tracés,
étalement d'options, puis `delete this.options.events` (`Service.ts:131`, qui fait muter la
classe cachée) — un `HttpRequest` (~8 champs, `Request.ts:101-137`), un `HttpResponse`, un
`Resolver` et un `Controller`.

L'URL est traitée **trois fois** : `new URL()` (`Request.ts:175`, ~430 ns),
`url.format()` (`HttpContext.ts:110`, ~380 ns — régénère une chaîne qui existe déjà), puis
une seconde analyse complète pour `originUrl` (`HttpContext.ts:114`). Le `Content-Type` est
posé au constructeur (`Response.ts:54`), retiré deux fois, puis reposé.

**Difficulté** : moyenne, une série de petits chantiers indépendants. **Risque** : faible
par élément — sauf l'allocation paresseuse de l'`Event` sur `Service`, qui touche la base de
tout le framework et exige la porte mémoire complète.

### G2 — La profondeur asynchrone (2-5 µs)

Une échelle d'`await` de profondeur 25 coûte ~2,2 µs à vide. Le garde « zéro listener »
existe côté kernel (`http-kernel.ts:1132`, `1273`, `1298`) mais **pas** aux points chauds du
contexte : `onSend` (`HttpContext.ts:380`), `onClose` (`:469`), `onRequestEnd`
(`Request.ts:221`) — trois enveloppes asynchrones programmées par requête pour aucun abonné.
`saveSession()` est attendu même sans session (`HttpContext.ts:372`).

**Difficulté** : faible, le motif de garde est déjà éprouvé ailleurs.

### G3 — L'écriture de la réponse (1,5-3 µs)

`setBody` s'exécute **deux fois** (`HttpContext.ts:377` puis `Response.ts:362`) → deux
`Buffer.from` du même corps. La regex de nettoyage du `statusMessage` tourne deux fois
(`Response.ts:246-249` et `391-393`). `writeHead` passe **toujours** un `statusMessage`
personnalisé, empêchant Node de réutiliser sa ligne de statut pré-calculée. `hasHeader()`
copie l'intégralité des en-têtes au lieu d'utiliser le natif (`Response.ts:519-528`).

### G4 — Controller instancié par requête (1-2 µs)

Trois `Reflect.getMetadata` (~90 ns pièce, `injector.ts:270-273`), `Reflect.construct`, un
constructeur `Service` complet, une résolution de template, deux écritures de conteneur — à
chaque requête. **La solution existe déjà** : `@Scope("singleton")` (`routerDecorators.ts:738-746`).
Le banc mesure le chemin par défaut.

**Difficulté** : triviale en opt-in ; changer le défaut serait une rupture de compatibilité
(du code applicatif porte son état par requête sur `this`).

### G5 — Les en-têtes (1,5-3 µs)

12 à 14 opérations par requête : `Server`, `nosniff`, `frame`, puis 5 à 7 en-têtes de
sécurité posés un par un (`firewall.ts:871-874`) — des valeurs **constantes**, figées au
boot, mais rejouées à chaque requête avec la validation Node à chaque appel, plus un
`toLowerCase` maison (`Response.ts:142`). Fastify en pose environ quatre, en un bloc.

### Une optimisation neutralisée par sa propre configuration

`HttpContext.setTimeout` affirme en commentaire ne plus rien armer par requête « si
`server.timeout` est aligné sur `responseTimeout` ». Or les défauts **ne sont pas alignés** :
120 000 ms contre 30 000 ms (`http/config/config.ts:273-292`). Un `socket.setTimeout` est
donc ré-armé **à chaque requête**. Le commentaire décrit une intention, pas le comportement.

## Structurel ou accidentel

Distinction décisive : le **structurel** découle du design — contexte unifié HTTP et
WebSocket, injection de dépendances, sécurité par défaut, observabilité. On ne le corrige
pas, on l'assume ou l'on change d'architecture. L'**accidentel** est du travail fait pour
rien.

<!-- prettier-ignore -->
| Structurel — assumé | Accidentel — corrigible |
| --- | --- |
| Scope DI par requête (déjà optimisé) | `Event` + `Map` + étalement + `delete` par `Service`, par requête |
| `AsyncLocalStorage` (~50-100 ns) | Double `setBody`, double regex, `statusMessage` systématique |
| Contexte riche (métadonnées, cookies, session paresseuse) | `url.format` redondant, `originUrl` eager, singleton `ACCEPT_ANY` ignoré (`parser.ts:291` vs `315-317`) |
| `requestId` UUID + `traceparent` W3C (des contrats) | `fireAsync` non gardés, `saveSession` attendu à vide |
| Passes firewall systématiques | 3 `Reflect.getMetadata` par requête (mémoïsables) |
| Routeur à regex compilées + index O(1) | `timeout` / `responseTimeout` désalignés |
| Audit JSON en production (choix d'observabilité) | `setLength` : tableaux alloués par appel, `hasHeader` par copie |

## Gains rapides, et ce qui les prouve

Chacun pris isolément vaut probablement **moins que le bruit de mesure** (±3 %). Ils doivent
donc être mesurés **en lot**, puis séparés seulement si le lot se détache nettement.
Protocole : paires A/B alternées, un seul basculement à la fois.

| Correction                                                      | Où                                         | Ce qui la prouve                                         |
| --------------------------------------------------------------- | ------------------------------------------ | -------------------------------------------------------- |
| Supprimer le double `setBody`                                   | `HttpContext.ts:391`, `Response.ts:438`    | `Response.test.ts` (24), auto-json, fileStream           |
| Gardes zéro-listener sur `onSend`/`onClose`/`onRequestEnd`      | `HttpContext.ts:380,469`, `Request.ts:221` | security-hooks, after-response-als, intégration (400)    |
| Court-circuiter `saveSession` sans session                      | `HttpContext.ts:372`                       | `session.test.ts` (15), websocket-session, porte mémoire |
| Aligner `timeout` sur `responseTimeout`                         | `config.ts:273-292`                        | `resilience.test.ts` + compteur sur `socket.setTimeout`  |
| Utiliser le singleton `ACCEPT_ANY`                              | `parser.ts:291` vs `315-317`               | `parser.test.ts` (17)                                    |
| `url.href` au lieu de `url.format` ; `originUrl` paresseux      | `HttpContext.ts:545,114`                   | `httpKernel.test.ts` (35), `cors.test.ts`                |
| Ne plus poser le `Content-Type` par défaut au constructeur      | `Response.ts:54`                           | `static.test.ts` (12), headers, errors                   |
| `setLength` : ensembles au niveau module + `hasHeader` natif    | `Response.ts:324-330,519-528`              | `Response.test.ts`, `httpKernel.test.ts`                 |
| `statusMessage` personnalisé seulement s'il diffère du standard | `Response.ts:246-249,391-393`              | `errors.test.ts` (18)                                    |

## Ce qui reste indéterminé

**Les coûts ancrables au code expliquent 10 à 20 µs des ~74 µs d'écart avec Fastify.** Le
reste est vraisemblablement le ramasse-miettes induit par le débit d'allocation, le dispatch
d'EventEmitter et le polymorphisme des sites d'appel — les mêmes helpers servent HTTP,
HTTP/2 et WebSocket. **Aucune attribution fiable sans profilage runtime** : ce qui précède
est une hypothèse, pas un résultat.

Il n'y a probablement **pas de goulot unique**, mais une mort par mille coupures, dominée
par la fabrique de contexte et la pression mémoire qu'elle induit.

| Question                              | Protocole                                                                                               |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Où part le temps CPU                  | `node --cpu-prof`, wrk `-t4 -c128 -d60s`, lecture dans speedscope, temps propre agrégé par fichier      |
| Quelle part au ramasse-miettes        | `PerformanceObserver` sur les entrées `gc`, ou `--trace-gc` ; au-delà de 10 %, G1 devient le levier n°1 |
| `write`+`end` ou `end(body)`          | compter les `writev`/`write` par requête (dtruss, 5 s suffisent)                                        |
| Gain réel de chaque lot               | paires A/B alternées, un basculement à la fois, seuil de séparation ±3 %                                |
| Le ré-armement de timeout existe-t-il | compteur sur `Socket.prototype.setTimeout` pendant 10 s : ~1/requête avant, ~1/socket après             |

## Attente réaliste

Les corrections accidentelles seules ne ramèneront pas à 30 000 RPS : une part du coût est
le prix du contexte riche, de l'injection de dépendances et du firewall. Un objectif
défendable, après le lot de gains rapides, l'allocation paresseuse et les controllers en
singleton, se situe autour de **12 000 à 16 000 RPS** — à valider au banc. Au-delà, ce n'est
plus de l'optimisation mais un choix d'architecture : contexte allégé, ou mis en réserve.

## Lexique

| Terme                    | Ce qu'il désigne dans cette page                                                                             |
| ------------------------ | ------------------------------------------------------------------------------------------------------------ |
| **Structurel**           | Coût qui découle du design. On l'assume, ou l'on change d'architecture.                                      |
| **Accidentel**           | Travail fait pour rien. Cible légitime d'une optimisation.                                                   |
| **Estimation raisonnée** | Coût déduit d'une lecture du code, **jamais mesuré**. Signalé comme tel à l'époque — et souvent faux depuis. |
| **Goulot** (G1 à G5)     | Regroupement de postes proposé par cette analyse. La numérotation ne vaut que dans cette page.               |

## Pièges — ce que cette analyse a eu faux

C'est la raison pour laquelle cette page est conservée. Le profilage runtime a tranché ainsi :

| Affirmation de cette page                | Verdict de la mesure                                              |
| ---------------------------------------- | ----------------------------------------------------------------- |
| En-têtes : 1,5–3 µs par requête          | **Sous-estimé d'un facteur 5** — ≈13–14 µs, c'était le levier n°1 |
| « Le reste est vraisemblablement le GC » | **Réfuté** — 0,93 %, sur trois instruments concordants            |
| Trois gardes zéro-listener côté kernel   | **Faux** — il n'y en avait qu'une                                 |
| Trois `Reflect.getMetadata` par requête  | **Faux** — deux                                                   |
| Nonce CSP                                | **Absent de cette page** — découvert au profilage, ≈1,7 % du CPU  |
| 22 ancrages `fichier:ligne`              | **14 exacts, 5 déplacés, 2 faux**                                 |

La leçon générale a été gravée dans la méthode : **une analyse sans exécution oriente, elle ne
prouve pas** — et tout pourcentage estimé se convertit en nanosecondes par une mesure avant
d'ouvrir un chantier.

## Pour aller plus loin

- ⬆️ **Retour au hub** : [Performance](index.md)
- 🔬 [Le pipeline HTTP](pipeline-http.md) — ce qui a été livré, mesuré, et rejeté depuis
- 📏 [Méthode de mesure](methode.md) — le protocole né de ce chantier
