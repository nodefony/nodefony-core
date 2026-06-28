---
title: Audit vérité migration Nodefony
date: 2026-06-28
auteur: audit Claude Code (exhaustif P0→P16, confronté au code)
statut: COMPLET — passes 06-05 + 06-12 + 06-28 (dashboard resync à chaque passe)
---

# Passe 2026-06-28 — re-confrontation au code (après +189 commits)

> Contexte : le bandeau « Avancement » était daté **2026-06-17**. **189 commits** depuis (P6 webhooks/2FA/
> audit/scopes/idempotence, modèle session NIST, GcScheduler, Node 24, deps cleanup, ~80 pages Studio).
> Méthode : recompte `awk` 1ʳᵉ cellule + 4 sous-agents `Explore` (1 par groupe de phases) confrontant chaque
> claim au code (`find`/`grep`, pas de tests lancés) + vérifs manuelles des 🔴 (README, npm audit, modules IA).

## Verdict

**Les chiffres sont honnêtes ; le dashboard se SOUS-VENDAIT** (bandeau gelé au 17/06 alors que P6 a quasi
fini et que Studio a beaucoup avancé). Aucun faux positif structurant. 3 vraies corrections (P9.3 README,
P9.4 vulns, P10.11 tests studio) + des items achevés restés marqués 🔶.

## Synthèse des écarts (passe 06-28)

| #   | Écart                                                                               | Gravité        | Action                           |
| --- | ----------------------------------------------------------------------------------- | -------------- | -------------------------------- |
| F1  | Bandeau « Avancement » daté 17/06, **189 commits** depuis                           | 🔴 forme       | recalculé → 2026-06-28           |
| 1   | P9.3 « README http+framework **absents** » alors que les 3 sont présents            | 🔴 faux        | P9.3 🔶 → ✅                     |
| 2   | P9.4 « **0 vulnérabilité** » (06-12) ; `npm audit` = **3 low** transitives          | 🟡 périmé      | P9.4 ✅ → 🔶 (3 low held back)   |
| 3   | P2.6 Idempotency keys ⬜ — livré via `@Idempotent` (P6.8) + stores Redis/Drizzle    | ➕ sous-marqué | P2.6 ⬜ → ✅                     |
| 4   | P10.7 / P10.8 / P10.14 marqués 🔶 — ~80 pages Studio + portail doc COMPLET livrés   | ➕ sous-marqué | → ✅ (Studio réel ~73 %)         |
| 5   | P10.11 « Tests intégration studio » marqué 🔶 — **0 test** studio trouvé            | 🔴 faux        | P10.11 🔶 → ⬜                   |
| 6   | P6 bandeau `17✅ 3🔶` — recompte cellule = `16✅ 4🔶 3⬜`                           | 🟡 périmé      | P6 80 % → 78 %                   |
| 7   | P12 « squelettes brainstorming » — `llm` = module réel (Claude/Ollama+tests+rollup) | 🟡 nuance      | préciser (agent-guard/mcp vides) |

## Verdict par phase (drapeau de fidélité déclaré↔réel)

```
P0  Bugs bloquants     100%  6✅              🟢 fidèle
P1  Fondations         100%  8✅              🟢 fidèle
P2  Cycle Context      100%  9✅              ➕ P2.6 livré via @Idempotent (était ⬜)
P3  Logs structurés     85%  7✅ 3🔶          🟢 fidèle (reste LB.3b CLI)
P4  Tests symbiose     100%  6✅              🟢 fidèle
P5  Session/User/ORM    85% 13✅ 3🔶 1⬜      🟢 fidèle 93% — gaps déclarés (P5.0b cron, banc unifié)
P6  Security            78% 16✅ 4🔶 3⬜      🟢 fidèle — cœur livré ; nuance = stores memory-only (P6.18/TOTP)
P7  ORM drivers         75%  3✅ 3🔶          🟢 fidèle 85% — 0 E2E système + MySQL repoussés (déclarés)
P8  CLI + Monitoring    63%  2✅ 1🔶 1⬜      🟢 fidèle
P9  Polish + clôture    63%  2✅ 1🔶 1⬜      🔴 P9.3 README (faux) + 🟡 P9.4 vulns (périmé) corrigés
P10 Studio (admin web)  73%  9✅ 4🔶 2⬜      ➕ sous-vendu (était 64 %) ; vrai écart = P10.11 tests
P11 CLI par module      44%  3✅ 1🔶 4⬜      🟢 fidèle (commandes métier non testées intég)
P12 Couche IA           17%  0✅ 2🔶 4⬜      🟡 « squelettes » sous-vend llm ; agent-guard/mcp vides
P13 Realtime distribué  77%  7✅ 3🔶 1⬜      🟢 fidèle (pattern RegExp #3 reporté, attend P6)
P14 Frontend Vite/iso   75% 11✅ 2🔶 3⬜      🟢 fidèle (Angular ✅ ; Svelte/Solid déclarés absents)
P15 Mediasoup           0%  0✅ 8⬜           🟢 fidèle (mod/mediasoup = banc ORM, PAS implé télécom)
P16 Cloud-Native        29% 10✅ 25⬜         🟢 fidèle (PM2 résidu = 1 ligne external rollup)
─────────────────────────────────────────────────────────────────────
GLOBAL                  65% 112✅ 27🔶 53⬜  (192 tâches)   62 % → 65 %
```

## Confirmé solide (preuves code)

- **P5/P7** : ORM core + User + adapters Drizzle/Mongoose câblés ; Sequelize **0 résidu fonctionnel** ;
  MikroORM absent comme prévu ; Slice 0 multi-dialecte Postgres présent (`createIdempotencyTable(dialect)`,
  `#connectPostgres` lazy) — **MySQL absent** (`#connectMysql` non câblé, déclaré « reste »).
- **P6** : `RoleHierarchyWalker`, `firewall.ts`, authenticators (Anonymous/Password/Session/JWT/ApiKey/
  WebAuthn), `csrf.ts` + `@CsrfProtect`, `ScopeVoter` + `@RequireScope`, `idempotency.ts` + stores Redis/
  Drizzle, webhooks (registre+dispatcher+stores Drizzle/Mongoose+page Studio), audit (`MemoryAuditStore`+
  stream WS), TOTP (RFC 6238). ⚠️ **memory-only** : audit persistant (P6.18 ⬜), idempotence Mongoose
  absente, stores TOTP Memory+File seulement → OK dev, pas prod multi-pod.
- **P10/P13/P14** : ~80 pages `.tsx` Studio, Twin, portail doc (DocLayout/MarkdownDoc/FlowGraph),
  `RealtimeHub`/`RedisBackplane`/JSON-RPC, presets Vite (react/vue/angular), Core isomorphe, DevSupervisor.

## Limites de l'audit

- Sondes = **présence/contenu du code**, tests **non exécutés** cette passe (les compteurs de tests cités
  proviennent des claims + comptage de fichiers `*.test.ts`, pas d'un run).
- Couche IA (P12) restée **hors scope** par directive (audit de surface seulement : compte fichiers + pkg).

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

---

# Passe 2 — resync vérité 2026-06-12 (95 commits code depuis la passe 1)

> Période couverte : 2026-06-05 → 2026-06-12. Méthode identique (autorité = emoji 1ʳᵉ cellule,
> confrontation code). Branche `poc/api-souveraine`.

## Synthèse des écarts corrigés

| #   | Écart                                                                                | Gravité          | Action faite                          |
| --- | ------------------------------------------------------------------------------------ | ---------------- | ------------------------------------- |
| F1  | § Séquencement = cellule-journal **2 767 car.** (re-obésité post-dégraissage)        | 🔴 Forme         | condensé → 640 car., détail = git log |
| F2  | § Virage ORM = 6 bullets-journal (~4 000 car.)                                       | 🟠 Forme         | condensé en 3 bullets + liens audits  |
| 1   | Dettes backplane #1/#2 marquées « à corriger » → RÉSOLUES (`c082560`)                | 🟠 doc périmée   | bloc P13 recalé ✅/⬜                 |
| 2   | Durcissement realtime « 🔶 14 tests » → réel 167 tests, dettes fixées                | 🟠 périmé        | ligne → ✅                            |
| 3   | Durcissement orm « ⬜ 🥇 PROCHAIN » alors que Ph.1-4 closes                          | 🔴 contradiction | ligne → ✅ (gap E2E noté)             |
| 4   | P9.4 « 10 vulns 2026-05-25 » → `npm audit` 2026-06-12 = **0 vulnérabilité**          | 🟠 périmé        | → ✅                                  |
| 5   | Bandeau périmé : P3 73→85 %, P5 76→79, P9 38→63, P10 65→68, P11 33→44, P16 26→27     | 🔴 chiffres faux | bandeau recompté (awk 1ʳᵉ cellule)    |
| 6   | P16.B 🔶 → chantier forwarded/proxy CLOS 2026-06-07 (RFC 7239, anti-spoof, banc E2E) | 🟠 périmé        | → ✅                                  |
| 7   | Encadré « PROCHAINE = POC API souveraine » → POC Ph.1+2 faits (V4)                   | 🔴 contradiction | → P6 Security                         |

## Verdict par phase (delta vs passe 1)

```
P2   89%  8✅ 0🔶 1⬜    🟢 fidèle    (P2.8/P2.9 livrés 06-05)
P3   85%  7✅ 3🔶 0⬜    🟡 bandeau périmé (P3.7 verbose livré)
P5   79% 12✅ 3🔶 2⬜    🟡 bandeau inversait 🔶/⬜ (session 5.11 + P5.8 livrés)
P6   12%  0✅ 4🔶 13⬜   🟢 fidèle    ◀ PROCHAINE
P7   80%  3✅ 2🔶 0⬜    🟢 fidèle    (post-virage)
P9   63%  2✅ 1🔶 1⬜    🟡 P9.4 résolu non répercuté
P10  68%  6✅ 7🔶 1⬜    🟡 P10.12/13 (workspace+Twin) pas au bandeau
P11  44%  3✅ 1🔶 4⬜    🔴 bandeau disait 33% 1✅ (P11.6/7/8 livrés)
P13  77%  7✅ 3🔶 1⬜    🟢 fidèle    (dettes #1/#2 fixées c082560, 167 tests)
P14  75% 11✅ 2🔶 3⬜    🟢 fidèle
P16  27%  9✅ 0🔶 24⬜   🟡 16.B clos non répercuté
GLOBAL 57%  90✅ 29🔶 63⬜  (182 tâches)   — passe 1 : 53 % / 179
```

## Verdict global passe 2

**Chiffres honnêtes, bandeau en retard d'une semaine** (le rythme 06-05→06-12 = 95 commits code a
distancé la tenue manuelle). La re-obésité du § Séquencement (2 767 car. en 7 jours) confirme la
règle : le détail-journal DOIT aller dans git log / retros, jamais dans une cellule. Mémoires IA et
MD modules resyncés dans la même passe (cf commit). **Prochaine étape inchangée : P6 Security.**

---

# Passe 3 — resync vérité 2026-06-17 (111 commits code depuis la passe 2)

> Période : 2026-06-12 → 2026-06-17. Branche `refactor/p6-security`. Méthode identique (autorité =
> emoji 1ʳᵉ cellule, confrontation code + croisement retex + commits + dev applicatif).
> **Le delta est massif et localisé : P6 (187 fichiers `security` touchés) + stores ORM P7.** Les
> autres phases n'ont pas bougé → l'audit des passes 1/2 tient (re-confirmé par sonde de surface).

## Synthèse des écarts

| #   | Écart                                                                                                      | Gravité          | Action                                    |
| --- | ---------------------------------------------------------------------------------------------------------- | ---------------- | ----------------------------------------- |
| F1  | l.177 = pavé-journal P6 de **13 027 car.** (pire cellule jamais vue, re-obésité)                           | 🔴 Forme         | condenser → 1 ligne + git/audit           |
| F2  | cellules tableau P6.x ~800 car. (journal inline)                                                           | 🟠 Forme         | raccourcir : 1 phrase + hash              |
| F3  | encadré « Prochaine étape » décrit P6 **non commencé** (« S1 + câblage + beforeResolve »)                  | 🔴 contradiction | réécrire : cœur P6 bouclé → @Csp/API Keys |
| 1   | **P6.9** ⬜ OAuth2 → social login BFF **livré** (J9, `oauth2-flow` 6/6)                                    | 🔴 chiffre faux  | ⬜→🔶 (reste OAuth2 resource-server opt.) |
| 2   | **P6.11** ⬜ « intégration = 0 » → **22 fichiers test security + 7 bancs E2E**                             | 🔴 chiffre faux  | ⬜→🔶                                     |
| 3   | **P6.12** ⬜ API Keys → modèle PAT **déjà persisté** (`IAccessTokenRecord` kind:pat) + 3 stores ORM testés | 🟠 sous-compté   | ⬜→🔶                                     |
| 4   | bandeau P6 = **13✅4🔶3⬜** alors que le tableau détail = ~9-10✅                                          | 🔴 chiffre faux  | recompter (awk 1ʳᵉ cellule)               |
| 5   | refs mortes : `mikroorm`×3 / `pm2`×8 / `sequelize`×5 (**modules absents du code**)                         | 🟠 doc périmée   | purger / marquer abandonné                |
| 6   | module `@nodefony/documentation` (**14 src + dist**) = **0 occurrence** au dashboard                       | ➕ non tracké    | ajouter ligne (P10/P14)                   |
| 7   | P7 : stores **token + webauthn** Drizzle/Mongoose/Redis **livrés + testés** (J4b/J9)                       | 🟢 recaler       | noter (drivers servent la sécu)           |

## Verdict par phase (delta vs passe 2)

```
P0–P4              inchangés       🟢 fidèle    (delta git = 0 ; audit passes 1/2 tient)
P5  Session/User    79%  12✅3🔶2⬜ 🟢 fidèle    (user mûri : provisioning OAuth Shadow User + 9 tests)
P6  Security       ~68%  ~10✅5🔶4⬜ 🔴 ventilation FAUSSE (bandeau 13✅) + 3 ⬜ périmés (6.9/6.11/6.12)
                                                 RÉEL : J4 JWT ✅ · J6 autz ✅ · J7 décorateurs ✅
                                                 · J8 garde WS ✅ · J9 WebAuthn+OAuth2 ✅ · CSRF/CORS/
                                                 headers/CSP-nonce ✅ — 22 tests + 7 bancs E2E
P7  ORM drivers    ~80%             🟡 recaler   stores token+webauthn 3 backends testés (delta J4b/J9)
P8–P9              inchangés       🟢 fidèle
P10 Studio          68%             🟢 fidèle    (50 src ; +login social = amorce P6.15)
P11 CLI module      44%             🟢 fidèle
P13 Realtime        77%+            🟢 fidèle    (32 src/20 tests ; +RBAC canal WS + socket L0→L4)
P14 Frontend        75%             🟢 fidèle
P15 Mediasoup        0%             🟢 fidèle    (module = banc ORM, confirmé par sa description)
P16 Cloud-Native    29%             🟢 fidèle    (P16.I liveness ✅ ; cluster P16.H livré)
+   documentation   ——             ➕ NON TRACKÉ (14 src + dist, complet) → à ajouter à la roadmap
```

> Drapeau = fidélité COMPTAGE↔code : `🟢 fidèle` · `🟡 forme/vision périmée` · `🔴 chiffre faux`.

## Croisement retex + commits + dev applicatif (exigence « zéro erreur »)

- **Commits** (111 depuis 06-12) : confirment chaque ✅ P6 (1 commit `feat(security)` par jalon J4→J9 +
  CSRF/CORS/headers/CSP) et les stores ORM (`feat(drizzle/mongoose/redis): store … J4b/J9`).
- **Retex** (`docs/session-retros/`, 16 sessions) : cohérents avec le code (J4 jose EdDSA, J8 cause dual-package,
  stores HASH/TTL, login UX multi-credentials, OAuth périmètre arctic). Aucun écart code↔retex.
- **Dev applicatif** (« le truc dev en plus ») : app de dev racine = `nodefony.config.ts` + `env.ts` +
  **`config/oauth.ts`** (social login Google/GitHub niveau APP, `feat(app)` 811c8994) — hors roadmap par
  nature (config de déploiement), à mentionner mais pas une tâche P6.
- **Forme annexe** : `RETEX.md` (le SAS « ~1 écran ») a enflé à **1257 lignes** → CONSOLIDATE dû (hors scope
  dashboard, noté).

## Verdict global passe 3

**Les chiffres sont honnêtes SUR LE FOND, mais P6 a 3 erreurs nettes** (≠ passes 1/2 où tout était fidèle) :
le bandeau P6 sur-compte (13✅ vs ~10 réel) et **3 tâches livrées/partielles sont encore ⬜** (6.9 OAuth2,
6.11 tests, 6.12 API Keys) — le rythme 111 commits/5 j a distancé la tenue manuelle, comme prévu. La FORME
reste le gros défaut : **le pavé l.177 (13 KB) est la pire cellule-journal de l'historique** + l'encadré
« Prochaine étape » ment (P6 décrit non commencé). **Action = recaler P6 (statuts + ventilation), dégraisser
l.177 + tableau P6, réécrire l'encadré, purger 3 refs mortes, tracker `documentation`.**
**Prochaine étape réelle : @Csp per-route → API Keys (P6.12) → Studio sécu.**
