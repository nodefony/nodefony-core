---
title: Audit vérité migration Nodefony
date: 2026-06-05
auteur: audit Claude Code (exhaustif P0→P16, confronté au code)
statut: COMPLET (P0→P16 confrontés au code) — dashboard resync le 2026-06-05
---

# Audit vérité — migration Nodefony (2026-06-05)

> But : confronter `MIGRATION_STATUS.md` (+ mémoire IA + docs + MD modules) au **code réel**,
> phase par phase, pour produire un dashboard qui soit LA vérité.
> Méthode : lecture roadmap + sondes code (`find`/`grep`/compte tests/présence dist) par phase.
> Légende écart : ✅ déclaré = réel · ⚠️ déclaré périmé/optimiste · 🔴 contradiction nette · ➕ réel non tracké.

---

## 🧭 Synthèse des écarts majeurs (consolidée en fin d'audit)

> _(remplie au fur et à mesure — voir détail par phase plus bas)_

| #   | Écart                                                                                                                                                             | Gravité        | Action                                                   |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------- | -------------------------------------------------------- |
| F1  | `MIGRATION_STATUS.md` = 729 L / **278 KB** : ~12 cellules-tableau de 3 700-3 800 car. (journal de commits inline). Illisible/non-diffable.                        | Forme          | Externaliser les cellules-journal vers `docs/migration/` |
| F2  | Tableau « Avancement » daté **2026-05-30** (périmé de 6 j).                                                                                                       | Forme          | Recompter + redater                                      |
| 1   | `documentation` = module complet (14 src, dist, tests, doc) mais **1 occ.** dans le dashboard.                                                                    | ➕ non tracké  | Ajouter ligne roadmap (P10/P14)                          |
| 2   | `mediasoup` = code réel (8 src, dist, 2 tests) mais **P15 = 0 %**.                                                                                                | 🔴             | Recaler P15                                              |
| 3   | `test-frontend-{react,vue,angular}` = 3 POC qui buildent, 0 doc IA.                                                                                               | ➕             | Tracker bancs P14                                        |
| 4   | ORM : décisions actées **non exécutées** — `sequelize` présent (14 src), `mongoose` ancienne forme (11 src), `kernel/orm/*` **encore dans le core** (3 fichiers). | 🔴             | Marquer « dette virage ORM »                             |
| 5   | `security` (P6 12 %) : 19 src + dist mais **0 test**.                                                                                                             | ⚠️             | Vérifier état réel P6                                    |
| 6   | `DETTE-CFG` (ordering config) marquée **🚧 ouverte** (l.378) mais **RÉSOLUE dans le code**.                                                                       | 🟠 doc périmée | Passer 🚧 → ✅                                           |
| 7   | Mémoire IA **en avance** sur le dashboard ; MD manquants : CLAUDE.md `mongoose`/`sequelize`(caduc), README `http`/`framework`.                                    | ⚠️             | Combler MD ; resync dashboard                            |

---

## Couche IA — HORS SCOPE (décision user 2026-06-05)

`agent`, `agent-guard`, `llm`, `mcp`, `memory`, `rag`, `vector` = **modules de brainstorming créés au début**,
peu d'importance pour l'instant. `agent-guard` + `mcp` = coquilles **sans `package.json`**. Tous taggés
**« squelette différé P12 »**, non audités, à ne PAS supprimer.

---

## P0 — Bugs bloquants ✅ (déclaré 100 % — CONFIRMÉ)

6 tâches ✅ (P0.1→P0.6). Tests cités **tous présents** : `http-rfc-errors`, `client-abort-499`
(P2.3), bugs ALS/scope DI (BUG-001→004). Réel = déclaré. **Aucun écart.**

## P1 — Fondations symbiose ✅ (déclaré 100 % — CONFIRMÉ)

8 tâches ✅ (Context.phases, onAfterResponse, signal, RequestContext ALS, errorRenderer, logRequest,
hooks security, graphe symbolique). `.ai/symbols.json` présent. **Aucun écart.**

## P2 — Cycle de vie Context (déclaré 72 % — CONFIRMÉ)

9 tâches : ✅ P2.1-2.5, P2.7 · ⬜ P2.6 (idempotency keys), P2.8 (backpressure doc) · 🔶 P2.9 (`@Body({stream})`
partiel — multipart busboy OK, décorateur reste). Tests `lifecycle-init-crash`, `timeout-abort`, `fileStream`
présents. Réel = déclaré. **Aucun écart.**

## P3 — Logs structurés (déclaré 64 % — ⚠️ léger glissement)

11 tâches. ✅ P3.1-3.5, P3.9 · 🔶 P3.6 (CLI filtre requestId — préalable `Pdu.requestId` livré), P3.8 (rate-limit
par requestId), P3.11 (Log Backplane : LB.W+LB.0→LB.5 livrés, reste LB.3b CLI) · ⬜ P3.7 (trace verbose), P3.10
(absorbé par P3.11). **Écart** : comptage 2026-05-30 disait 6✅2🔶3⬜ ; réel ≈ 6✅3🔶2⬜ (P3.6/P3.8 passés ⬜→🔶,
P3.10 absorbé). Mineur. Log Backplane = gros morceau **réellement livré** (drivers memory/file/cluster-file/loki/
opensearch, validés runtime).

## P4 — Tests symbiose ✅ (déclaré 100 % — CONFIRMÉ)

6 tâches ✅. Tests `forward`, `decorators-response`, `request-context` (100 concurrent), `als-load`,
`Injector` (scopes), `session`/`websocket-session` **tous présents**. **Aucun écart.**

> **Verdict P0→P4** : fondations solides, déclaré ≈ réel. Seul P3 a un comptage à rafraîchir.

## P5 — Session/User/ORM core (déclaré 58 % : 9✅ 3🔶 6⬜ — comptage FIDÈLE)

Sonde code : `orm-core` 7 tests, `@nodefony/user` 4 tests, drizzle user 4 fichiers + SessionStorage ✓.
✅ P5.1-5.6 + P5.3b + P5.9 réels · 🔶 P5.0/5.12/5.13 · ⬜ P5.0b/5.7/5.8/5.10/5.11/5.14. **Comptage = réel.**

**🔴 Écart majeur — virage ORM (2026-06-02) NON répercuté dans la roadmap** :

- **P5.7** (adapter Sequelize User) → **CADUC** : décision = suppression complète de Sequelize. `sequelize user-files=0` (jamais fait, et ne le sera pas).
- **P5.8** (adapter Mongoose User) → **à recadrer** : Mongoose refait neuf sur modèle Drizzle (`extends Service`). `mongoose user-files=0`.
- **P5.13** `OrmSessionStorage` : mentionne des storages sequelize/mongoose **caducs/à refondre** (les fichiers `SessionStorage` sequelize+mongoose existent mais sont sur l'ancien socle).
- `kernel/orm/*` **encore dans le core** (3 fichiers) alors que P5.1 a sorti l'ORM dans `@nodefony/orm-core` → résidu à retirer (décision « core ne connaît pas l'ORM »).

## P6 — Security (déclaré 12 % : 0✅ 4🔶 13⬜ — FIDÈLE)

Sonde code : fondations **S1 réelles présentes** — `RoleHierarchyWalker.ts`, `service/firewall.ts`,
`contracts/ISecuredArea.ts`, `config/defineSecurityConfig.ts` (Zod), `src/token/AnonymousToken.ts`,
`service/csrf.ts`. **MAIS** : aucun authenticator concret (seul le contrat `IAuthenticator.ts`) ·
**0 test** (confirme P6.11 « 0 test committé ») → c'est ce qui maintient **0✅** (rien n'est complet+vérifié).
Le 12 % est honnête. ⚠️ `csrf.ts` présent alors que P6.7 est ⬜ → vérifier stub vs réel lors de l'attaque P6.

> **Verdict P5→P6** : comptages fidèles au code. Le vrai chantier = (a) répercuter le virage ORM sur
> P5.7/P5.8/P5.13 + retirer `kernel/orm`, (b) P6 reste à 88 % devant (pipeline auth + tests).

## P7 — ORM Drivers (déclaré 50 % : 2✅ 5🔶 2⬜ — comptage fidèle, VISION PÉRIMÉE)

C'est **la phase la plus secouée par le virage ORM (2026-06-02)**. Le 50 % est calculé sur l'ancienne
vision « multi-ORM symétrique » que la décision a abandonnée :

- **P7.1 / P7.3** (Sequelize legacy + tests) → **CADUC** : décision = suppression complète. (Adapter orm-core Sequelize présent mais à supprimer.)
- **P7.2 / P7.5** (Mongoose adapter + tests) → **À REFAIRE NEUF** sur modèle Drizzle (`extends Service`, pas `extends Orm` core).
- **P7.8 / P7.9** (MikroORM) → **🔴 VAPORWARE** : module `@nodefony/mikroorm` **absent du repo**, jamais commencé (« ajouté 2026-05-16 » = intention morte). À retirer ou geler explicitement.
- **P7.4 / P7.6** (Drizzle ✅) = **la référence**, conforme à « Drizzle par défaut ». OK.
- P7.7 (redis refactor) 🔶 : module présent.

> ⇒ Le % de P7 va **changer** après recadrage (sequelize sort, mikroorm sort, mongoose repart de ~0).

## P8 — CLI + Monitoring (déclaré 63 % : 2✅ 1🔶 1⬜ — FIDÈLE)

✅ P8.1 (`bin/nodefony`), P8.3 (DebugBar — réel : `src/nodefony/src/client/debugbar/DebugBar.ts` + test) ·
🔶 P8.4 (Metrics via Studio, pas service standalone) · ⬜ P8.2 (generators). **Nuance P8.2** : le scaffold
existe mais **via skills** (`nodefony-create-module`), pas via une commande CLI `nodefony create` →
besoin couvert autrement, pas un « manque » strict. Comptage OK.

## P11 — CLI par module (déclaré 33 % : 1✅ 2🔶 3⬜ — à rafraîchir)

✅ P11.6 (BootReporter) · 🔶 P11.1 (filet intégration spawn livré) · ⬜ P11.2-5. Commandes réelles
comptées : frontend×3, http×1, sequelize×1 (**caduque**, sequelize supprimé), core×12. La panoplie
métier (`http:*` complet / `security:*` / `user:*` / `orm:*`) **n'existe pas** → ⬜ cohérent.
Comptage réel ≈ 1✅ 1🔶 4⬜ (léger glissement vs déclaré).

## P10 — Studio admin web (déclaré 59 % : 3✅ 7🔶 1⬜ — FIDÈLE, module bien avancé)

Réel : `@nodefony/studio` 40 src + dist + 3 tests. ✅ P10.1/10.2/10.3/10.x (data plane IAdminApi sur
kernel/http/framework/syslog/frontend + docs/symbols Studio). 🔶 P10.4/10.5/10.7/10.8/10.9/10.10/10.11.
⬜ P10.6 (auth admin, dépend P6). **Vues réellement live** : Dashboard, Modules, Routes, Cluster, Runtime,
Logs (WS `syslog:stream`), Databases, Docs. Avancement crédible. **Écart** : P10.10 cite une vue **« pm2 »**
→ **caduc** (PM2 retiré C6) ; reformuler en « services/profiling ». sessions/users/firewall en attente P5/P6.

## P9 — Polish + clôture (déclaré 38 % : 1✅ 1🔶 2⬜ — FIDÈLE)

✅ P9.1 (@entities decorator + tests) · 🔶 P9.3 (README : **security** ✓ ; **http + framework absents** —
confirmé par la matrice modules) · ⬜ P9.2 (barrels), P9.4 (**10 vulnérabilités** npm déclarées 2026-05-25
— 0 crit/3 high/6 mod/1 low ; non re-vérifié dans cet audit → à re-`npm audit`).

> **Verdict P7→P11 + P9** : comptages fidèles. Écarts = (a) P7 vision multi-ORM périmée (virage),
> (b) refs mortes « pm2 » (P10.10) et « mikroorm » (P7.8), (c) P9 vulnérabilités à re-vérifier.

## P12 — Couche IA agentic (déclaré 17 %) — HORS SCOPE (différé, per user)

Squelettes brainstorming : `agent` 4 src, `memory` 5 src, `rag` 6 src, `vector` 5 src, `llm` 7 src
(seul `llm` a un dist). **Non audité** (décision user). Statut réel = « 🧪 squelette différé P12 ».
Le 17 % déclaré n'est pas confronté ici. `agent-guard` + `mcp` = coquilles vides (sans package.json).

## P13 — Realtime distribué (déclaré 77 % : 7✅ 3🔶 1⬜ — FIDÈLE, très avancé)

Réel : `@nodefony/realtime` 27 src + dist + 14 tests. ✅ P13.0 (rapatriement framework→realtime),
P13.4 (RealtimeService), P13.5 (RedisBackplane — **prouvé cluster live -w2**), P13.7 (JSON-RPC 2.0),
P13.9 (e2e cluster IPC), P13.10 (AIMD), P13.11 (sonde socket) · 🔶 P13.1 (TCP/UDP/Unix — niche
différable), P13.2 (redis refactor — fondation faite), P13.8 (décorateurs) · ⬜ P13.6 (Kafka).
**Les 5 seams sécurité (P13.4a/4b/4c/7a/8a) tous ✅** → P6 se branchera sans refonte. Comptage = réel.

**🟠 Contradiction à lever** : `DETTE-CFG` (override `module-<name>` ignoré car Zod gèle à `onKernelRegister`
avant l'override à `onPreBoot`) est marquée **🚧 ouverte** dans le dashboard (l.378), mais la mémoire IA
`project_config_ordering_chantier` la dit **✅ RÉSOLU** (`applyModuleConfigOverrides` en preRegister).
→ Vérifier dans le code lequel est vrai (croisement task 8).

## P14 — Frontend Vite + Core isomorphe (déclaré 72 % : 10✅ 3🔶 3⬜ — FIDÈLE, très avancé)

Réel : `@nodefony/frontend` 25 src + dist + 4 tests, + 3 bancs `test-frontend-{react,vue,angular}` qui
buildent. ✅ presets React/Vue/Angular, ViteProcessSupervisor, build prod (manifest), multi-module,
multi-instance Vite, DevSupervisor, migration Studio. 🔶 P14.7 (CLI frontend buggée), P14.9 (Svelte/Solid
restent ; Angular fait), P14.11 (core isomorphe partiel — `exports.browser` + RealtimeClient OK, reste
Container/Syslog/Service). ⬜ P14.12 (plugin Vite alias), P14.14 (CSP dynamique), P14.16 (syslog isomorphe).
**Écart mineur** : glyphes `🟡 PARTIEL` au lieu de `🔶` (P14.7/14.9) ; refs PM2 mortes dans notes (marquées
abandonnées, OK). Comptage = réel.

## P15 — Mediasoup + SIP/Asterisk (déclaré 0 % — LÉGITIME)

**Correction d'une fausse alerte de surface** : le module `src/modules/mediasoup` (`poc.1`) n'est PAS
l'implé P15 — sa description est _« banc test ORM (schémas Drizzle) + build Vue 3 (front non implémenté) »_.
C'est un **banc de test ORM** thématique (relations riches), pas le pont télécom vocal (P15.1 `MediasoupService`/
`RoomManager`/`SignalController`/`PlainTransport` Asterisk). **P15 = 0 % est correct.** Note : son test
`orm-mediasoup-sequelize.test.ts` devient **caduc** (Sequelize supprimé).

## P16 — Cloud-Native (déclaré 26 % : 8✅ 1🔶 24⬜ — FIDÈLE)

8 axes (A-H), 33 tâches. ✅ 16.F.1/F.2 (retrait PM2), 16.H.1-5/H.7 (scaling multi-process + Studio cluster,
livré en avance). 🔶 16.B.2 (XFF lu en `remoteAddress`, pas `clientIp`, sans whitelist proxy → ⚠️ spoofing).
⬜ le reste (16.A graceful shutdown per-process, 16.C secrets [dépend P6], 16.D Docker, 16.E skills, 16.G docs).
**Écart** : 16.D Docker tout ⬜ mais le **`docker-compose` infra existe déjà** (Redis/Kafka via P13, Loki/
OpenSearch via LB.4) + `docs/guides/docker-cloud-native.md` présent → 16.D.3/D.4 + 16.G.3 **partiellement
entamés** (le `Dockerfile` de nodefony lui-même, 16.D.1/D.2, reste vraiment ⬜). Comptage global OK.

> **Verdict P14→P16** : fidèles. P14/P16 très crédibles. P15 = 0% confirmé (banc ORM ≠ implé télécom).
> Reste à recaler : 16.D (compose infra déjà là), glyphes 🟡→🔶.

## Croisement docs/ + mémoire IA + MD modules

**`DETTE-CFG` → RÉSOLUE dans le code** : `Kernel.applyModuleConfigOverrides()` (`Kernel.ts:590`) applique
l'override `module-<name>` **entre `onPreRegister` et `onPreBoot`** (`Module.ts:193` : « `readOverrideModuleConfig`
N'EST PLUS appelé à `onPreBoot` »). Le fix d'ordering est en place → **la mémoire IA a raison, le dashboard ment**
(l.378 à passer 🚧 → ✅).

**Hiérarchie de fraîcheur constatée** (du + frais au + périmé) :

1. **Code** = vérité (toujours le plus à jour).
2. **Mémoire IA** (`MEMORY.md` + `project_*`) = quasi à jour : sait config CLOS, virage ORM décidé, DETTE-CFG résolue, PM2 retiré.
3. **MD modules** (CLAUDE/MEMORY par module) = à jour sur les modules touchés récemment ; lacunes sur les stables.
4. **`MIGRATION_STATUS.md`** = **le maillon le plus périmé** : tableau « Avancement » figé 2026-05-30, vision ORM
   multi-driver (pré-virage), `DETTE-CFG` 🚧, refs mortes **PM2** (P10.10) / **mikroorm** (P7.8), cellules-journal de 3 800 car.

**MD manquants (modules actifs)** : CLAUDE.md absent — `mongoose`, `sequelize` (caduc), `llm` ; README absent —
`http`, `framework` (= P9.3 🔶). IA hors scope.

**docs/migration/ : réceptacle déjà là** pour dégraisser le dashboard — `phases-details.md` (1013 L),
`journal-sessions.md` (56 L mais **72 KB** → lui-même obèse, à assainir aussi), `archive-snapshots.md`.

---

## ✅ Conclusion de l'audit — verdict global

**Le code est sain, le comptage de migration est globalement HONNÊTE** (P0→P16 confrontés : la quasi-totalité
des % déclarés = réels). Le problème n'est PAS l'exactitude du fond — c'est :

1. **La FORME** du `MIGRATION_STATUS.md` (278 KB, cellules-journal illisibles) → dégraisser vers `docs/migration/`.
2. **3 vraies péremptions** : `DETTE-CFG` (résolue, encore 🚧), tableau Avancement (2026-05-30), vision ORM (pré-virage).
3. **2 refs mortes** : PM2 (P10.10), mikroorm (P7.8 vaporware).
4. **1 angle mort assumé** : couche IA (squelettes, hors scope user).
5. **Lacunes doc** : MD/README manquants sur quelques modules.

> **Pas de mensonge majeur dans les chiffres.** Le dashboard dit à peu près la vérité — il la dit MAL
> (illisible) et avec ~6 jours + 1 virage de retard. Le fichier vérité = ce même dashboard **assaini + resync**.
