# MIGRATION_STATUS.md — Tableau de bord

> **Mis à jour : 2026-08-20** (audit vérité — cf mémoire IA `core-dev/migration/AUDIT-verite-2026-08.md` ; passes précédentes : `AUDIT-verite-2026-06.md`).
> Légende : ✅ Migré | 🔶 Partiel | ⬜ À faire | 🚫 Bloqué | ⏭️ Skip/Caduc
>
> **Règle de tenue (CONVENTION) :** statut en **TÊTE de la 1ʳᵉ cellule** (`| ✅ P5.2 | …`), **1 ligne courte**
> par tâche. Le « comment » détaillé (pavés, hashes, gotchas) va dans la mémoire IA `core-dev/migration/` ou le
> commit — **JAMAIS** dans la cellule (sinon scroll horizontal + fichier illisible, cf l'obésité corrigée le
> 2026-06-05 : 278 KB → ce fichier). Le bandeau « Avancement » se recalcule depuis ces marques.

---

## 🎯 Décisions stratégiques (le « pourquoi » vit en mémoire IA)

Les décisions complètes sont **persistées en mémoire IA** (survivent au `/clear`). Pointeurs :

- `project_decisions_p5_p6_orm` — Sécurité + ORM + IUser · `project_decisions_realtime_isomorphic` — Realtime + Core isomorphe + Mediasoup
- `project_orm_hardening_kit` — **virage ORM** (graine) · `project_orm_audit_state` — **audit ORM + plan** (boussole terrain) · `project_hardening_before_p6` — durcir avant P6 · `project_api_souveraine_poc` — API souveraine

### ⚡ Séquencement actuel (resync 2026-06-12)

Config ✅ → durcissement ORM Ph.1-4 ✅ → durcissement WS ✅ → POC API souveraine Ph.1-3 ✅ (pont `api.request` + data plane admin duplex) → durcissement cycle requête V1-V5 ✅ → Container + fast path routes ✅ → **P6 Security — cœur MVP LIVRÉ, durcissement en cours** (J1→J9 ✅ + API Keys + Audit + 2FA + Webhooks ✅ COMPLET + Sessions/Users + Firewall Studio + red-team par brique ; reste = durcissement/niches hors MVP). Détail-journal = `git log` + mémoires IA (pointeurs ci-dessus).
Boussole : durcir les fondations (orm, realtime, core, http, framework) AVANT P6 — P6 se greffe dessus. **Fondations DURCIES — P6 débloqué.** Détail jalons : `git log` + `docs/session-retros/`.

### 🔀 Virage ORM (décidé 2026-06-02) — ✅ **CLOS 2026-06-08** (Ph.1→Ph.4)

- **Ph.1 Sequelize SUPPRIMÉ** (`716fce6`, 0 résidu) · **Ph.2 Mongoose REFAIT** (`51d9ea8`, `extends Service` + sondes Studio) · **Ph.2.5 contrat CRUD durci** (`220c00a`, `updateOne`/`updateMany` + critère strict) · **Ph.3 kernel/orm RETIRÉ du core** (`5ba6bd1`) · **Ph.4 couplage C2 `IErrorAdapter` + C5 `wireOrmAdminPlane`** (`58381df`/`7ac0bac`) · **config Zod unifiée** drizzle+mongoose+redis · **couverture 109→160 tests** + seuils v8 (`953ccc2`).
- Audits (mémoire IA `core-dev/audits/`) : `orm-state-and-hardening-2026-06` · `orm-solidity-2026-06` · `orm-config-pattern-2026-06`. MikroORM abandonné (⏭️). ⭐ **Drizzle = référence** ; migrations DB = déléguer `drizzle-kit` (hors chemin critique).
- ⚠️ **Gap restant** : 0 test E2E système (Kernel réel + HTTP + ORM Docker persistant) — cf note P7.

### 🔐 Sécurité (P6) — décisions **EN REVUE 2026-06-08** (les « figées 2026-05-20 » ont divergé — cf mémoire `project_p6_security_kit` §REVUE)

Passport ❌ · **Session HYBRIDE** : session serveur cookie opaque (BFF) web/Studio + **JWT réservé API/agents** (révisé 2026-06-06 — PLUS « full stateless ») · pattern authenticator (pas « Bridge », **pas « Symfony »**) ·
auth de base (Anonymous/UserPassword/Jwt/OAuth2 `arctic`/mTLS/APIKeys) **+ à intégrer P6 : Passkeys/WebAuthn (FIDO2), Token Exchange RFC 8693 (délégation agents), DPoP, Argon2id, OAuth 2.1+PKCE** ·
CSRF SameSite+Origin + `@CsrfProtect` opt-in · `defineSecurityConfig()` + Zod · Zero Trust ·
identité = **`IUser` racine + slot agent/service** (`kind`/`onBehalfOf`, PAS `IPrincipal`) · `BcryptEncoder`/`UserService`/**`IUserProvider` (à implémenter)** dans **@nodefony/user** · gros travail = au démarrage P6.

### Autres (résumés — détail en mémoire)

- **User/IUser (P5.5)** : module séparé `@nodefony/user` (IUser strict + BaseUser POJO + encoders). `project_nodefony_user_module`.
- **Realtime + Core isomorphe** : P13.3 supprimée → Core devient isomorphe (intégré P14). Pattern `IRealtimeHub` + `RealtimeService` + JSON-RPC 2.0 maison.
- **P15 Mediasoup + SIP/Asterisk** : agent IA vocal PSTN (`PlainTransport` RTP, pas WebRTC navigateur). Après P12+P13.
- **P16 Cloud-Native** : 1 process = 1 pod ; healthz/readyz (http), SecretProvider (security), tini PID 1 ; PM2 retiré (C6). `project_cloud_native_plan`.
- **API souveraine (POC, après ORM)** : 1 service → N surfaces (REST+WS+GraphQL) via `ResourceController`. `docs/api/README.md`.

---

## 🛡️ Durcissement fondations (transverse — pas de lignes P dédiées)

<!-- prettier-ignore -->
| Couche | État | Résumé (détail → mémoire `project_hardening_*`) |
| --- | --- | --- |
| `nodefony` (core) | ✅ | Kit C1→C6 clos (PM2 retiré, modes run `IRunProfile`, park, ménage boot −378 ms). **Fuite de 7 listeners `process` par `Cli` FERMÉE** (`2493f7b2`) : SIGINT/SIGTERM/SIGHUP/SIGQUIT + `warning` + les 2 faces d'un rejet, posés par des handlers ANONYMES donc impossibles à retirer — invisible en production (1 `Cli` par process), mais une suite en instancie des dizaines et au 11ᵉ Node émet `MaxListenersExceededWarning` dont la charge est l'objet `process` ENTIER. `Cli` mémorise DE QUOI retirer chaque listener (retrait fermé sur la référence, zéro cast), `releaseProcessListeners()` idempotent appelé par `terminate()`, et le décor de test pose un filet dans `vitest.setup.ts` (ce qu'un test attache, le test le remporte). Mesuré sur la suite complète : **71 → 0 avertissements, 7 571 → 263 lignes de journal**, 2 363 verts. `Event` : `nbListeners: 0` (illimité chez Node) était rejeté par sa VÉRACITÉ (`if (options.nbListeners)`) et l'appelant recevait le défaut, donc l'avertissement qu'il cherchait à éviter ; TSDoc qui annonçait un défaut de 20 jamais appliqué corrigé. `GcScheduler` : les tests de DÉLAI passent en horloge SIMULÉE (`3 ms` de marge en temps réel faisaient accuser un commit innocent en CI) — celui de l'anti-empilement reste en horloge réelle, il fabrique un chevauchement et non une échéance. `project_hardening_core_kit` |
| `@nodefony/http` | ✅ | Kit H1→H6 + config Zod + domain matching + forwarded RFC 7239 COMPLET + banc proxy Docker E2E + **service certificates durci** (RFC 5280/6125, SHA-256, serial 128b, 0600, lazy node-forge, CLI `certificates`) + **banc TLS re-encrypt validé** (verify required/verifyhost/sni) + `proxy:generate` (**annonçait `proto=https` à un client venu en clair** — le scheme se CONSTATE sur `ssl_fc` ; + `timeout tunnel`/`client_max_body_size` dérivés de la config, `f70d2894`) + **suite reverse-proxy automatisée** (4 raccords contre nginx+haproxy RÉELS, gate `PROXY_GATE`, `32c1d29f`) + **préfixe natif statique `/<module>/`** (`mountModulePublics`, configurable `publicMount`) + **`assets:publish`** (arbre CDN-ready provider-agnostic) + **`PATCH` parsé** (RFC 5789 — était absent de la table `parse` de `Request.ts` → body jamais lu → 500 sur mutation). `65f7e41`/`6ac8562`/`e735544`/`6918f89`/`867d6458` |
| `@nodefony/framework` | ✅ | F1→F7 (sauf F6 résolu via dette CLI) ; 495 tests unit ; 0 dette. **Fichier introuvable → 404 et non 500** (`109976c0`, RFC 9110 §15.5.5 : le 404 est l'absence de « représentation courante », le 500 suppose une condition INATTENDUE — or le chemin vient d'une entrée) : corrigé dans `getFileAsync`, donc les 3 façades d'un coup (`renderMediaStream`/`streamFile`/`renderFileDownload`) ; `EACCES` et E/S remontent inchangés (500 légitime), un dossier rend 404. Fuite d'information fermée au passage : le chemin serveur ne voyage plus dans le corps (la même section autorise la non-divulgation). Prouvé aux DEUX étages — unitaire (code porté par l'erreur) ET pipeline complet (`/media-missing` du module test : 500 amputé → 404 restauré, 0 fuite), le test unitaire ne disant rien de ce que reçoit le client. `project_hardening_framework_kit` |
| `@nodefony/realtime` | ✅ | **Durci** : back-pressure WS, 5 seams sécu, **210 tests verts** (+9 skipped docker ; inclut banc loopback isomorphe E2E L0-L4 — 26 scénarios VRAI client↔serveur) ; série socket isomorphe L0-L4 ✅ (duplex S→C, contrat typé partagé, façade serveur `ServerRealtimeSocket`) ; dettes backplane #1/#2 fixées (`c082560`). **Bus authentifié (F83, `44becb5a`)** : admission par canal à l'ingress + sceau HMAC des transports partagés (`backplane.secret`), prouvé sur banc 3 apps / 1 Redis. **Déclaration broadcast STATIQUE `@RealtimeBroadcast` (`2369deb0`)** — l'override n'était lu qu'au handshake, un pod publiant sans abonné local ne propageait rien. **File d'envoi du backplane BORNÉE** (`backplane.maxQueueBytes`, défaut 8 MiB) : `publish` fire-and-forget laissait la file du client Redis grossir sans limite (583 MB sous rafale au banc) — seuil + compteurs `describe().queue` (sonde + Studio) + alerte de transition, doctrine du back-pressure WS ; ferme au passage un `unhandledRejection` quand le bus coupe en plein envoi. **Prouvé au banc** (1 M publications synchrones, `mempeak.sh`) : pic **3 231 MB → 387 MB** (÷8,3) et rafale 2,5× plus courte, à perte de messages IDENTIQUE — sans borne on payait 3,2 Go pour perdre les mêmes. **Plancher des canaux de PLATEFORME (F82 cas 2)** : sans `@nodefony/security`, aucun verrou n'était posé → `syslog:`/`orm:`/`kernel:`… servis à l'anonyme, et l'alerte censée prévenir était muette (elle exigeait une policy déclarée). Le hub porte désormais sa propre fermeture (`subscribeClient`, insensible à la casse), DIT le refus au client (`realtime:denied`), le compte (`systemFloorDeniedTotal`) et avertit à la DÉCLARATION (policy sur namespace réservé → WARNING ; diffusion d'un namespace réservé → REFUSÉE). Liste des namespaces = source unique côté hub, consommée par security (`reservedSystemPrefixes()`), fini les deux inventaires. **Fan-out MUTUALISÉ (plan S1, livré)** : une frame diffusée n'est plus sérialisée qu'une fois pour N abonnés (`ChannelSerializer` fourni par l'abonné, `JsonRpcPeer.buildNotification` = source unique des deux voies, repli protégé si la charge n'est pas sérialisable). Étage fan-out **26× à 62× moins cher** selon la taille de charge (`fanoutSerialize.perf.test.ts`, `RUN_PERF=1`) ; le banc saturé, lui, ne peut pas trancher (variance ×3 > écart cherché). Reste dette #3 (frontière inter-modules, attend P6) |
| `@nodefony/orm-*` | ✅ | **Virage ORM Ph.1-4 CLOS 2026-06-08** (cf § Virage ORM) : Seq OUT, Mongoose refait, kernel/orm OUT, C2/C5, 160 tests + seuils v8. ⚠️ Reste : E2E système (cf note P7) |

**Intégration continue** ([`docs/guides/integration-continue.md`](docs/guides/integration-continue.md)) : le
rapporteur `vitest.gates.ts` fait ÉCHOUER une passe dont une cible déclarée n'a pas tourné (`proof`,
`NF_GATES_ALLOW`, `NF_GATES_EXPECT`). Le **mode du serveur est une dimension de la MATRICE**, plus une
propriété de branche (24/dev · 26/dev · 26/**prod**) — la casse du mode livré n'apparaît plus après la
fusion ; le banc se crée son second compte en production (`security:user:add`) et chaque cas propre à un
mode a sa contrepartie EXIGÉE dans l'autre. Analyse de code : périmètre restreint au code de production
(114 alertes de tests écartées), `Bearer` sans automate et tirage de codes de récupération sans biais.
**21 alertes soldées — branche à ZÉRO** (`334efa2a` `b420e5cc` `2efcfc4a` `fd164b01` `ce75768d`
`621912a3`) : 16 corrigées, 5 fermées avec un motif écrit (entrée = code du développeur au démarrage,
sans attaquant). En instruisant celle de `Route.ts`, le défaut trouvé n'était pas celui que l'outil
signalait : **une route ne servait pas le chemin déclaré** — `compile()` échappait le motif après
l'avoir assemblé, et seulement `/` et `.`, si bien que `"/a|b"` produisait `^\/a|b$`, soit « commence
par /a » **ou** « finit par b » (la route absorbait `/n'importe/quoi/b`). RFC 3986 §3.3 : `( ) * + $`
sont des `sub-delims` non encodés — huit métacaractères atteignent le routeur intacts. Un chemin
portant l'un des six autres (`^ { } \ ? #`) est **inatteignable** et le dit désormais au démarrage.
**Reste** : Loki/OpenSearch jamais montés à la forge (dette APRÈS release), et `dependabot.yml` en
place pour que la dérive des versions se voie.

**Log Backplane** (`project_log_backplane_vision`) : axe WRITE (`LB.W`) ✅ + axe QUERY (`LB.0→LB.5`) ✅ — drivers
`memory`/`file`/`cluster-file`/`loki`/`opensearch` queryables, validés runtime cluster + Loki/OpenSearch réels.
**E2E réel `loki`/`opensearch` livré** (`84ca6f36`, gates `NF_LOKI_TEST_URL`/`NF_OPENSEARCH_TEST_URL` → skip
propre sans infra) : les deux drivers n'étaient prouvés que contre un `fetch` mocké ; le round-trip
write↔read contre les vrais serveurs a révélé un **bug d'ordre Loki**. Câblage `log.*` → sink → driver
couvert (`0052f869`). Reste ⬜ **LB.3b** (CLI `syslog:filter`, dette dispatch CLI) et ⏳ le chantier
**Dashboards iframe Studio** (driver-gated, design figé, planifié APRÈS devkit).
Console Logs Studio = panneau P10 de facto livré.

> **DETTE-CFG (ordering config `module-<name>` ⊥ validation Zod) ✅ RÉSOLUE** : `Kernel.applyModuleConfigOverrides()`
> appliqué entre `onPreRegister` et `onPreBoot`. `project_config_ordering_chantier`.

> 🏗️ **CHANTIER config clarté — ✅ CŒUR LIVRÉ (ADR-0006 ; reste `NF__APP__*`)** : 4 structures de config coexistent + duplication des
> défauts (ex. security `timeCost` 3 vs 2) = confusion réelle du user. **Vision** : chaque module =
> `config.ts` (Zod commenté = **SEULE source des défauts**) + `defineXConfig.ts` (builder pur),
> fusionner les `schema.ts` ; Studio = provenance par champ (défaut / surcharge / env).
> `project_config_clarity_chantier_kit`

---

## 🧨 Dettes transverses ouvertes (hors lignes P — le détail vit dans le kit cité)

> **Pourquoi cette section** : ces dettes n'appartiennent à aucune phase `P<n>` et étaient donc
> INVISIBLES ici (croisement mémoires de session ↔ dashboard, 2026-07-16). Le § Durcissement
> ci-dessus ne dit que ce qui est ✅ ; celui-ci dit ce qui reste. Une dette qui n'est écrite nulle
> part se re-découvre à chaque session.
> Gravité : 🔴 corrige avant release · 🟠 structurel, à planifier · 🟡 confort/DX.

> 🔴 **PRÉREQUIS À LA PUBLICATION NPM DE 10.0.0 — session SÉCURITÉ dédiée (GO user).** Nodefony est
> un logiciel libre : le paquet publié contient `dist/`, `.d.ts` et souvent les sourcemaps —
> **fermer le code ne protégerait de rien**, et un agent sans garde-fou trouvera des choses. Ce qui
> décide n'est pas le nombre de failles mais le **délai entre découverte et correctif**. Périmètre
> de la session, du plus urgent au moins : **(1)** ✅ **`SECURITY.md` livré** (`8d992260`, corrigé
> `a226f974`) — canal privé, périmètre (ce qui n'est PAS une faille : comptes de dev, modules
> `policy:"dev"`, `NF_BENCH_ROUTE`, maquettes IA), délais tenables en solo. L'historique complet a
> été scanné (`gitleaks`, 2 020 commits, 59 Mo) : **aucun secret**, 44 résultats tous expliqués
> (35 = jetons d'exemple des RFC bundlées, 3 = vecteur de test RFC 6238, 1 = cert mkcert de dev).
> Le **signalement privé GitHub est ACTIVÉ** (dépôt désormais PUBLIC — vérifié API 08-20,
> `private-vulnerability-reporting: enabled`). 🔴 Reste **ouvert sur ce point, et il MONTE
> maintenant que le dépôt est public** : brancher gitleaks en gate avec une allowlist (sinon les
> 44 faux positifs le feront désactiver) — vérifié 08-20 : AUCUN workflow/hook gitleaks.
> **(2)** ✅ **Vulnérabilités : 0** (`npm audit` re-prouvé 08-20, 0 alerte Dependabot — P9.4 ;
> les « 166 » de la branche par défaut ont disparu avec l'alignement `main` ≡ `claude-ts`).
> **(3)** **Provenance npm + 2FA** :
> pour un projet solo, le risque n°1 n'est pas la faille trouvée, c'est le **compte de publication
> compromis** ou une dépendance qui l'est. **(4)** Passe **red-team sur la surface PUBLIÉE**
> (`nodefony-security-review`, 2 passes threat-first) — ce qu'un installeur reçoit, pas ce que le
> dépôt voit de lui-même. **(5)** Scaffold : `SECURITY.md` généré dans l'app (contact en zone
> explicitement À REMPLIR — un placeholder muet vaut moins que rien) + **§ sécurité dans
> l'`AGENTS.md`** : des INTERDITS exécutables pour l'agent (jamais de contrôle d'accès écrit à la
> main, jamais de secret en clair ni en journal, rotation par `security:secrets`, `.env.local`
> jamais committé), pas de la prose de sensibilisation. **Le moment est AVANT la publication** :
> après, chaque faille voyage dans les applications des utilisateurs.

<!-- prettier-ignore -->
| Dette | Grav. | Kit / preuve |
| --- | --- | --- |
| ~~**`transaction()` ne marche QU'EN SQLITE**~~ — **RÉSOLU `3dabb5ae`** : transaction portée aux 3 dialectes via `ITxDriver` (connexion DÉDIÉE empruntée au pool en pg/mysql — un `BEGIN` sur le pool n'est pas atomique) ; 2ᵉ bug de dialecte trouvé au passage (`SAVEPOINT "x"` = chaîne en mysql → `quoteIdent` par dialecte). **Le test manquant ÉTAIT la dette** → 5 cas transaction au banc de contrat (19/19 × sqlite/PG 17/MariaDB 11.4/MySQL 8.4 réels ; preuve négative faite) | ✅ | `3dabb5ae` · banc `repository-contract.ts` · les tx sont désormais dans le contrat 3 dialectes |
| ~~**Le scope `singleton` du DI n'est pas un singleton**~~ — **SOLDÉ**. Le diagnostic était FAUX (« il manque une mémoïsation ») : la racine = **deux annuaires, un seul nom** — `@injectable(nom)` indexe des CLASSES, `super(nom, …)` indexe des INSTANCES, et rien ne les reliait (le décorateur tourne au CHARGEMENT de la classe, `super()` à la CONSTRUCTION → il ne PEUT pas connaître la clé). Corrigé, dans l'ordre où l'attaque les a trouvés : (1) propagation d'`argsClass` parent→dépendance SUPPRIMÉE — elle interdisait toute mémoïsation ET donnait à `Fetch(module: Module)` un `HttpContext` (ne tenait que par duck-typing sur `.container`) ; (2) `singleton` MÉMOÏSE, sous la clé CANONIQUE (`instance.name`) — mémoïser sous le nom demandé aurait créé le doublon qu'on tuait ; (3) `Fetch` POSÉ au container — 1 instance/kernel au lieu d'**une par requête** (mesuré : 10 req = 10 instances) ; (4) registre en `Object.create(null)` → 6 vecteurs de pollution de prototype fermés ; (5) **TOKEN = la CLASSE** : la clé container est APPRISE au moment où le service est posé (`addService`), le nom écrit dans `@inject` ne sert plus qu'à retrouver la classe — c'est ELLE qui dit où l'instance vit. **1 seul des 7 `@injectable` round-trippait → 7/7** (vérifié en runtime : `allRoundTrip: true`). API publique inchangée (0 breaking) | ✅ | `injector.attack.test.ts` (13 vecteurs, 0 `it.fails` restant) + intégration `di-singleton.test.ts` (sonde `/nodefony/test/di/tokens` sur serveur réel) · preuves NÉGATIVES faites (relais débranché → C3/H1/H3 rouges) |
| ~~**DI ordre-dépendant**~~ — **SOLDÉ**. Les 6 `@inject("HttpKernel")` ne résolvaient que parce que `HttpKernel` était **1ᵉʳ** dans `@services([...])` (instanciation séquentielle). Le descendre de 3 lignes → serveur « UP », **499 sur chaque requête**, aucune dégradation annoncée. **L'ordre se CALCULE désormais** (`serviceOrder.ts`, tri topologique STABLE des dépendances déclarées `@inject` + `design:paramtypes`) → l'ordre écrit n'a plus d'effet, comme chez Symfony (container compilé) / NestJS (graphe). Cycle → erreur explicite qui nomme le cycle. **Preuve en conditions réelles** : ordre volontairement inversé → `HEALTH 200`, **579/579 intégration**, `httpKernelShared: true`, 0 erreur (avant : TIMEOUT + 499). Preuve NÉGATIVE faite (tri débranché → G1/G2/G3 rouges) | ✅ | `serviceOrder.test.ts` (11) + `services.attack.test.ts` G1/G2/G3 + intégration `di-singleton.test.ts` (3, serveur réel via sonde `/nodefony/test/di/probe`) |
| **`@services` avalait TOUT échec** — le `catch` du décorateur se contentait de `log(e, "ERROR")` : l'échec n'atteignait NI la politique de criticité (`isBootErrorFatal` → donc **jamais fatal, même en PRODUCTION** : un service critique impossible à construire laissait le pod démarrer amputé et se déclarer sain) NI le BootReport (donc pas de « boot DÉGRADÉ » — un boot cassé s'affichait « UP »). C'était le chemin de **tous** les modules (30 services). **RÉSOLU** : `Module.handleServiceBootError` → `Kernel.serviceBootErrorFatal` → la MÊME politique que `guardServiceInitialize`. Asymétrie corrigée : on gardait l'`init` d'un service et pas sa **construction** | ✅ | `services.attack.test.ts` (rouge → vert) · vérifié en runtime : « BOOT dégradé — 14 module(s) chargé(s), 1 en échec » |
| ~~**`CliIntegration` flake sous charge**~~ — **RÉSOLU** (constaté audit 08-20) : la readiness n'est plus 45 s en dur — budget par env `NODEFONY_CLI_READY_TIMEOUT_MS`, défaut 80 s (`CliIntegration.test.ts:54`) = le fix que la dette réclamait. ⚠️ la variable est hors convention `NF_` → à renommer avec la dette env | ✅ | `CliIntegration.test.ts:54` |
| ~~**9 « check-then-act » dans les stores de SÉCURITÉ**~~ — **RÉSOLU `025b8b06` + `6dc17bd3` + `0cacbe7d` + `a017cb2d`** : la classe entière, sur les **DEUX** adapters (le diagnostic ne voyait que drizzle — `MongooseTokenStore` portait les mêmes, `put`/`denyJti` compris). Corrigés : faux upserts → `repo.upsert()` (`denyJti`, `TotpSecret.save`, `WebAuthnCredential.save`, `Webhook.save`) · `revoke`/`revokeFamily`/`gc` → la condition passe au `WHERE` via `$null` (`revokeFamily` : N+1 requêtes → 1 ; `gc` : la dette `listAll()` disparaît) · `revokeAllForSubject` → `$max` (le seuil ne recule plus). **1 faux positif** : `DrizzleTokenStore.put` — race inatteignable (les 3 appelants posent un id `randomUUID`/`#randomId`), fix gardé pour le round-trip et l'uniformité. Chaque race PROUVÉE avant fix (test rouge, puis vert). `grep` de contrôle : plus aucun `findOne`→`create`/`update` conditionnel dans les stores | ✅ | 4 commits · banc de PARITÉ 3 dialectes + Mongo réel · ⚠️ limite gravée sur `DrizzleTokenStore.put` : `access_token` a DEUX uniques (`id` PK + `secretHash`) et un `ON CONFLICT` n'arbitre qu'UN index |
| ~~**`IRepository` ne sait pas exprimer `IS NULL` ni un upsert CONDITIONNEL**~~ — **RÉSOLU `6dc17bd3` + `a017cb2d`** : deux familles d'opérateurs, chacune avec son détecteur + tests. **Lecture** — `$null` (10ᵉ de `FieldOperators`) ; la **valeur nue** `{ champ: null }` signifie désormais `IS NULL` au lieu de matcher 0 ligne en silence (`eq(col, NULL)` toujours faux en SQL = LA cause racine), ouverte seulement sur un champ typé nullable. **Écriture** — `UpdateOperators` `$max`/`$min` dans le `update` d'`upsert` (`UpdateData<T>`). ⚠️ **La clause `where` prévue par le kit a été ÉCARTÉE** : MySQL n'a ni `RETURNING` ni `WHERE` sur son `ON DUPLICATE KEY UPDATE` → 2-3 requêtes, donc une course. La condition vit dans la VALEUR (`GREATEST`/`MAX`/`$max` natif Mongo) = 1 instruction atomique sur les 4 backends, vérifiée en SQL pur avant de coder | ✅ | `orm-core/interfaces/IRepository.ts` · banc de contrat 3 dialectes (`$null` + `$max`/`$min` + concurrence ×10 en ordre dispersé) · parité Mongo |
| ~~**Les stores de sécurité n'ont d'e2e QUE sur PostgreSQL**~~ — **RÉSOLU** : les **5** stores (`token`/`totp`/`webauthn`/`webhook`/`session`) ont un **banc de parité partagé** joué sur les **3 dialectes** (pattern `repository-contract` : 1 banc + 3 consommateurs minces) au lieu de 2 implémentations sqlite/pg divergentes. 85 cas × 3 (concurrence pool chaud, bornes exactes `$lt`/`$lte`, round-trip unicode/JSON, no-op sur clé inconnue, isolation par porteur, `createdAt` insert-only, redaction `listAll`). Les 5 anciens fichiers doublons supprimés (4 sqlite + `session-postgres.e2e`), chaque cas reporté ; `session-storage.test.ts` réduit à ce qui lui est PROPRE (registre IoC + compteur de requêtes — « write = 1 UPSERT, 0 SELECT » n'est pas portable : mysql en coûte 2). **Le banc a immédiatement sorti 2 bugs** invisibles à la couverture PG-seule (2 lignes ci-dessous). **548/548, 0 skip** sur PG 16 + MariaDB 11.4 ET PG 16 + MySQL 8.4 | ✅ | `tests/integration/{token,totp,webauthn,webhook,session}-store-contract.ts` + `*-{sqlite,postgres,mysql}*` |
| **`signCount` WebAuthn : colonne int32, spec W3C uint32** — `kind: "int"` → `integer` pg / `int` mysql (SIGNÉ, max 2 147 483 647), or le W3C définit le compteur anti-clonage comme un **uint32** (max 4 294 967 295). Au-delà d'`INT32_MAX` : pg `22003`, mysql `ER_WARN_DATA_OUT_OF_RANGE` — **sqlite passe** (INTEGER 64-bit) → divergence. Inatteignable en pratique (+1 par authentification), mais le schéma n'est pas conforme. Fix = kind `bigint` au colKit (⚠️ change le DDL → migration) | 🟡 | trouvé 2026-07-17 par le banc mysql (`webauthn-store-contract.ts` borne à INT32_MAX et documente l'écart) |
| **`put` mysql : une collision de `secretHash` ÉCRASE le jeton en place** — `ON DUPLICATE KEY UPDATE` n'accepte pas de `target` → MySQL arbitre sur TOUTES les uniques : le jeton légitime garde son `id` mais reçoit les champs de l'intrus (sqlite/pg REJETTENT). Reproduit en SQL pur. **Non corrigé volontairement** : le remède = un SELECT avant chaque `put` (2 round-trips sur un chemin chaud) pour un cas inatteignable (hash = sha256 aléatoire ⇒ collision ≈ 2⁻¹²⁸). L'invariant « un secret ne désigne jamais deux jetons » tient sur les 3 dialectes et EST au banc ; la divergence est gravée + testée des deux côtés | 🟡 | trouvé 2026-07-17 par le banc mysql · TSDoc `DrizzleTokenStore.put` · `token-store-mysql.e2e` (« divergence mysql ») + `token-store-sqlite` (le rejet) |
| **2 tests de perf du core flakent sous contention** — `Tools.extend vs Object.assign` et `Service 10 000 instantiations sans DI` : seuils ABSOLUS, verts en isolation (258/258), rouges quand 79 fichiers + 7 conteneurs se disputent la machine. Opt-in `RUN_PERF` → invisibles en CI, mais la mesure n'est pas fiable (cf `feedback_measure_method` : médiane de N runs, pas un seuil sec) | 🟡 | constaté 2026-07-17 (`RUN_CLI_BOOT=1 RUN_PERF=1`, load 8,3) ; non lié au diff ORM (le core n'est pas touché) |
| **Union TS sans contrainte SQL** — catégories d'audit hors union (`"admin"`, `"burst"`) **persistées depuis des mois** ; colonnes `text $type<>` sans `CHECK` | 🔴 | constaté au typecheck des tests (`e0cbc590`) ; le type ne garde rien à l'exécution |
| **`options.order` mal formée = tri SILENCIEUSEMENT ignoré** — `{ age: "asc" }` au lieu de `[["age","ASC"]]` ne lève rien : la requête part SANS `ORDER BY`. Le pendant existe pour les critères (`UnknownCriteriaField`, « jamais un skip silencieux ») — les **options** n'ont pas cette garde. TS l'attrape (TS2353), donc surface = appel non typé / dynamique | 🟠 | trouvé 2026-07-16 en écrivant le banc tx (m'a coûté un faux diagnostic « collation ») |
| **`pool.max` non exposé** (pg/mysql) — pool par défaut = 10 → **696 → 294 RPS** dès c=50 | 🟠 | banc 2026-07-08 ; config drizzle |
| ~~**Boot resilience Ph.3** — `emitAsync` = `for await` nu~~ — **RÉSOLU** (constaté audit 08-20) : tout le cycle (`onPreRegister`→`onPostReady`) passe par `fireLifecycle` → `emitAsyncGuarded` — isolation par listener + `timeoutMs`/`warnMs` + politique `isBootErrorFatal` par module | ✅ | `Kernel.ts:896-1058` (appels) · `Kernel.ts:2891` · `Event.ts:266` |
| **Observabilité DB prod** — ⚠️ recalée 08-20 : `QueryFlowMonitor` EST livré (orm-core, `enabled=false` = prod-safe) ; RESTE la capture du contexte d'une query qui THROW (« le bug critique ») et le fingerprint cross-pod (0 occurrence, vérifié) | 🟠 | `orm-core/nodefony/src/QueryFlowMonitor.ts` · `project_runtime_observability_architecture` |
| **RBAC non isomorphe** — client `includes()` plat vs serveur hiérarchique (un admin voit une UI que le serveur autoriserait) ; **kernel client = types only** | 🟠 | audit 2026-07-14 ; borne la portée réelle de P14.11 ✅ (briques core, pas RBAC) |
| **Surcharge attrape-tout `RealtimeClient.request`** — annule le garde-fou « params conformes au contrat » ; la retirer = **breaking change** (décision produit) | 🟡 | ⚠️ l'ancrage `tests/RealtimeClient.types.test.ts` est MORT (constaté 08-20 — fichier disparu/renommé, surcharge attrape-tout toujours présente `RealtimeClient.ts:622`) : re-localiser ou réécrire la sentinelle ; `3f6c5de1` |
| **L'entité `User` appartient au FRAMEWORK, pas à l'application** — Symfony, Laravel, Django et Rails la donnent tous à l'app (le framework ne fournit qu'un contrat + un générateur) ; ici c'est `@nodefony/drizzle` qui la possède (`entity/userTable.ts`), et `create entity User` la refuse désormais — donc « un utilisateur métier avec des champs en plus » n'a **aucune voie de première classe**. Le mécanisme d'appropriation EXISTE pourtant déjà : `registerStores.ts:168` s'efface devant une entité déclarée par l'app (`appOwned`). Manquent le générateur (`create entity User --extends framework`), la spec de colonnes DÉRIVABLE (sinon la table de l'app dérive au premier changement du framework) et la vérification AU BOOT (colonne du contrat absente → message franc, pas « colonne inconnue » à la première connexion). Second volet : la hiérarchie de rôles n'a qu'une source STATIQUE (`security/config.ts:960`) → aucun rôle créé à l'exécution n'hérite de rien ; à rendre pluggable (`IRoleHierarchyProvider`, défaut = la config actuelle) en gardant à l'esprit que le firewall la lit sur le chemin de CHAQUE requête. NB les voters, eux, EXISTENT (`service/authorization.ts:84`, built-ins `role`+`scope`, extension par `registerVoterFactory`) : les permissions d'un domaine passent par un voter applicatif, il n'y a pas de table de permissions à inventer. **Volet A avant 10.0.0** — le code d'une app est FIGÉ à sa création, un correctif en 10.1 ne réparerait aucune app née en 10.0.0 ; volet B en 10.1. Contient la décision FK RÉVISÉE (les émettre, avec PRAGMA SQLite + tri topologique + cycle annoncé) | 🔴 | `project_user_entity_roles_kit` |
| **Une politique de canal declaree ne mord pas sur un canal DYNAMIQUE** — `registerChannelPolicy` indexe par nom EXACT : `@RealtimeChannel("chat:room", { roles })` ne couvre pas `chat:room:1000` servi par la fabrique dynamique (cadence, forage, suffixes). L'auteur croit son canal garde, il ne l'est pas, **et rien ne le dit**. **Le silence est FERME** (`noticeUnguardedDynamicChannel` + section dediee de `realtime/docs/securite.md`) : le serveur avertit une fois quand un canal servi dynamiquement n'a aucune politique alors que le module en declare. La levee complete (politique par MOTIF) est une des 6 briques du canal prive, en 10.x | 🔴 | `project_realtime_private_channels_kit` |
| **Prefs Studio en localStorage** — 10 clés device-local (recompté 08-20, `UiStore.ts` + `health.ts`) ; casse multi-device, fuite inter-identités | 🟡 | `project_studio_preferences_backend_kit` (P6.15 ; quick win anti-fuite déjà livré) |
| **Webhooks sans bus MÉTIER** — un `order.shipped` doit passer par `auditService.record` (pollue l'audit sécurité, sémantiquement faux) | 🟡 | `project_webhook_event_bus_chantier_kit` |
| **`#ensureBuilt` ~45 s à CHAQUE boot** même à cache chaud (overhead `npx turbo` ?) | 🟡 | `project_dev_supervisor_dx_kit` §F |
| **Une vingtaine de preuves e2e vivent dans un KIT, pas dans un paquet** — `.claude/skills/nodefony-load-test/scripts/*.mjs` porte des garanties fonctionnelles (TOTP, MFA sous attaque, anti-SSRF des webhooks, rate-limit HTTP et poignée de main WebSocket, plafond de connexions par IP, idempotence distribuée, arrêt gracieux, cluster) qui **assertent en 0/1 comme des tests** mais ne sont ni dans un espace de travail, ni dans `npm test`, ni dans un rapport agrégé. Elles y sont par DÉCOR (elles exigeaient un serveur réel), pas par nature — argument caduc depuis que le décor est reproductible en intégration continue. **Contourné** : les autonomes tournent désormais en CI (`e2e-autonomes.yml`) ; **la cause reste** : une preuve d'anti-SSRF appartient à `@nodefony/security`, une preuve de rate-limit à `@nodefony/http`. Correctif juste = les réécrire en vitest dans leur paquet, avec le décor en `beforeAll`. Reste dehors en attendant : les 4 bancs à décor opt-in (un serveur par plafond) et les 5 bancs de MESURE que le kit désigne lui-même comme à durcir (ils publient des chiffres sans vérifier que le travail a eu lieu) | 🟠 | après release — chantier de réécriture, pas un correctif |
| **`bun:test` inertes** — `agent`/`memory`/`rag`/`vector` : aucun script `test`, donc jamais exécutés (llm migré vitest `130f7386`) | 🟡 | à migrer au câblage de P12, pas avant |
| **Deux bancs jamais exécutés dans `src/modules/test`** — son script `test` est `node -e "console.log('test')"`, un no-op : `dolibarr.complex-query.test.ts` et `dolibarr.load.test.ts` ne tournent NULLE PART (ni en local, ni en intégration continue). Trouvés en cherchant, après le cas `jwt.attack`, ce que l'inventaire des tests rate encore. Trancher : les câbler à vitest, ou les retirer s'ils sont périmés — mais pas les laisser dans cet état, qui donne l'apparence d'une couverture | 🟠 | trancher : câbler ou retirer |
| **Studio ne dit pas qu'un runtime est en DÉROGATION** — `NF_WITH_DEV_MODULES=1` charge les modules `policy:"dev"` en production et **minute le process** (30 min par défaut, réglable jusqu'à 4 h par `NF_WITH_DEV_MODULES_TTL_MIN`, jamais désarmable, `Kernel.armDevModulesSelfStop`). Aujourd'hui ça ne vit que dans le journal : un `WARNING` par module au boot, un préavis à 5 min, un `CRITIC` à l'arrêt. **Manque dans Studio : un avertissement VISIBLE et permanent** (bannière, pas une puce discrète — un module de banc en production est une surface offerte) **+ le décompte avant arrêt automatique**, pour que celui qui mesure sache combien de temps il lui reste au lieu de découvrir un serveur mort au milieu d'une rafale. Données déjà côté serveur ; reste à les exposer sur le plan de données admin puis à les rendre. Dette posée à la création de la dérogation, volontairement non traitée dans la même session | 🟠 | à traiter quand Studio sera rouvert — dette posée sciemment, hors session |
| **Les NOMS de rôles sont écrits DEUX fois — front et back** — le mécanisme, lui, est bien isomorphe et unique (`nodefony/roles` : `hasRole`/`hasAnyRole`/`RoleRegistry`, `src/nodefony/src/client/roles/`, zéro nom de rôle dedans, vérifié). Mais la POLITIQUE — les chaînes `ROLE_USER`, `ROLE_DEV`, `ROLE_SUPERVISOR`, `ROLE_SECURITY_AUDITOR`, `ROLE_ADMIN`, `ROLE_NODEFONY_ADMIN` — est déclarée d'un côté dans `@nodefony/studio/frontend/src/auth/roleNames.ts` (front seul), de l'autre dans `nodefony.config.ts` (`roleHierarchy`), `nodefony/security/devUsers.ts`, `@nodefony/user/nodefony/src/{userFilters.ts,admin/UserAdminApi.ts}` et `service/UserService.ts`. Deux copies qui **divergent en silence** : chacune passe ses propres tests, et un rôle renommé d'un seul côté ne casse rien — il rend juste un écran vide ou un 403 inexplicable. C'est le motif « 1 RÈGLE = 1 implémentation » du `CLAUDE.md`. **Le canal pour la refermer EXISTE DÉJÀ et n'est pas consommé** : `SecurityAdminApi` expose `GET /nodefony/security/api/roleHierarchy` (vérifié en prod — rend les 6 rôles + l'héritage transitif calculé). ⚠️ Ce n'est PAS `RoleRegistry` (`nodefony/roles`) qui répond : c'est un accélérateur à masques de bits (32 rôles max), **utilisé nulle part en production** (seulement son test et sa doc) — s'en servir ici ajouterait une TROISIÈME implémentation. La dette se scinde : **(a) `STUDIO_ROLES`** n'a qu'un consommateur (`Users.tsx:164`, suggestions du sélecteur d'attribution) → un `useResource` sur l'endpoint suffit, et c'est le morceau DANGEREUX (liste divergente ⇒ l'admin ne peut plus attribuer un rôle qui existe, panne muette) ; **(b) les constantes de gating** (`ROLE_SUPERVISOR` dans `dashboards.ts`, `VIEW_ROLES` dans `navConfig`/`RoleGuard`, `ROLE_NODEFONY_ADMIN` dans `isVisibleForRoles`) sont des littéraux évalués à la COMPILATION — les dériver exige de rendre tout le gating data-driven et de traiter l'état « politique pas encore chargée » : chantier, pas correctif. Repéré en réparant les cycles d'imports Studio (`da045961`), hors périmètre de cette panne | 🟠 | (a) court — consommer `/nodefony/security/api/roleHierarchy` · (b) à trancher — touche `@nodefony/user` + la config d'app |
| ~~**Mode strict des gates de test en CI**~~ — **RÉSOLU** (constaté audit 08-20) : la CI EXISTE (7 workflows) et `vitest.gates.ts` fait ÉCHOUER la passe quand `CI` est posé et qu'une cible déclarée n'a pas tourné ; une absence voulue s'énonce (`NF_GATES_ALLOW`) | ✅ | `vitest.gates.ts:83` · `.github/workflows/` (7) |
| ✅ **`NF__HTTP__TRUSTPROXY=1` fait ÉCHOUER le boot** — SOLDÉ : la valeur REMPLACÉE guide la conversion (`coerceEnvValueLike`, appelée par `applyResolvedPath` — seul endroit qui connaît la chaîne brute ET le type attendu). `1/0/on/off/yes/no` sur une clé booléenne, chaîne brute sur une clé chaîne ; **une CIDR n'est JAMAIS promue en `true`** (elle vaudrait confiance totale aux `X-Forwarded-*` — test de sécurité dédié). Cibles nombre/tableau inchangées (le CSV → tableau documenté survit) | ✅ | `902791fe` |
| **`test:all` ne démarre pas le serveur qu'exigent les suites d'intégration live** — vécu 2× (08-19 et 08-20) : serveur éteint ⇒ **642 échecs** `ECONNREFUSED 127.0.0.1:5152` qu'on instruit comme du code ; le rapport « CE QUI A ÉTÉ TESTÉ » n'énonce pas ce prérequis. Fix : sonde de décor en tête de phase intégration (démarrer via `start.sh`, ou échouer TÔT en le disant) | 🟠 | `scripts/test-all.ts` · rerun serveur UP = 800/800 verts |
| **`ClusterManager.installSignalHandlers` arrache les handlers TIERS** — `process.removeAllListeners(sig)` (constat 07-14 confirmé 08-20) : un module qui a posé son propre SIGTERM le perd en mode cluster | 🟠 | `ClusterManager.ts:271` |
| **Table de routes `static` globale et mutable** — pas d'isolation entre deux kernels d'un même process (constat 07-14 confirmé 08-20) ; surface réelle = tests multi-kernel, pas la prod (1 process = 1 pod) | 🟡 | `framework service/router.ts:49,166` |
| **Corpus doc : 437 ancres en DÉRIVE + 2 mortes + 1 page hors gates** — mesuré 08-20 en jouant les 4 gates sur les 63 pages : `anchor-check` 3 489/3 928 OK, 437 SUSPECT (le code a bougé sous les pages), 2 LINE_OUT (`studio/docs/workspace.md` → `roles.ts:101/117`, fichier de 48 l.) ; `doc-lint` 62/63 (`devkit/docs/index.md` sans frontmatter/sections) ; `anchor-inpage` 63/63 ✅ ; `code-check` 124 blocs ✅ (après réparation du GATE : ENAMETOOLONG sur gros lot + notices npm prises pour un échec). Chantier : `anchor-fix.mjs` + passe éditoriale devkit | 🟠 | `tmp` session 08-20 · scripts `nodefony-documentation` |
| **`nodefony check` (readiness) sonde les ports de la CONFIG, pas les ports EFFECTIFS** — vécu 08-20 au banc devkit : le serveur du dépôt (5151/5152) rougit le check d'une app témoin qui tournera sur 5371 (`NF_PORT` ignoré par la sonde) ; chaque tâche du banc se fermait AVANT l'agent, sur un manquement qui n'appartient pas à l'app jugée. Et le banc n'énonce pas son prérequis « 5151/5152 libres ». Fix : la sonde readiness lit l'env/les ports effectifs ; le banc constate le prérequis au décor | 🟡 | vécu banc devkit 08-20 (gate ❌ → arrêt, serveur stoppé, relance verte) |
| **Les bancs d'intégration partagent UN compte, donc un compteur de backoff global** — toute la suite s'authentifie en `admin` sur un serveur qui vit d'un bout à l'autre. Le throttle NIST compte par identifiant SAISI : trois échecs n'importe où — y compris dans un banc d'ATTAQUE qui fait exactement son travail — épuisent le crédit, et `admin` répond ensuite 429 même avec le bon mot de passe, dans tous les fichiers suivants (vécu : **60 rouges pour un seul défaut**). Une purge par authentification réussie ne suffit pas : une fois le seuil franchi, le throttle rejette AVANT de vérifier le mot de passe, donc plus rien ne peut purger. **Contourné** (décor : backoff désactivé sur le serveur de banc, cas de câblage en opt-in `NF__SECURITY__RATELIMIT__ENABLED=true`) ; **la cause reste** : un banc ne devrait pas dépendre d'un compte partagé. Correctif juste = chaque fichier crée SON compte. Reporté sciemment après la release — c'est un chantier de banc, pas un correctif | 🟠 | après release — décor en place entre-temps |

#### Trois entrées trop longues pour une cellule de tableau

> Sorties du tableau ci-dessus, où elles n'avaient qu'une colonne sur trois — le rendu
> était cassé, et leur longueur paddait de blancs les 30 autres lignes. Contenu inchangé.

##### ~~`listAll()` matérialise N objets par requête~~

**SOLDÉ `4baa2b4b`→`a358af85`** (chantier pagination) : data planes admin sur `listPage` (pagination native au store), 4 consoles (sessions, clés d'API, users, webhooks) en `DataGrid mode="server"`, tri/filtres/recherche exécutés serveur et **publiés** (`IAdminPageCapabilities`). Reste UN appelant légitime de `listAll()` : le snapshot du dispatcher webhook (`webhooks.ts`, registre entier pour router, pas pour afficher). Journal détaillé → git log + snapshot mémoire IA `core-dev/migration/`.

##### `@nodefony/devkit`

Module `policy:dev` — kit en 8 lots + vagues S1→S5 : **lots 0→5 ✅, lot 7 ✅ et S1→S4 ✅ — périmètre 10.0.0 COMPLET** (le code généré est FIGÉ dans l'app à sa création) ; **S5 (UX Studio) = 10.1 remontable ; lots 6·8 non entamés**. **Lot 7 — serveur MCP** (`dbf6c6cc`, `2834ee17`, `9f8335da`) : `POST /nodefony/mcp` est une **route**, pas un process (révision `2026-07-28` du transport = plus de session), 4 outils qui appellent les MÊMES briques que `inspect`/`check`/`symbols`/`card` (extraites au cœur), `nodefony ai:mcp` écrit le `.mcp.json` en lisant le port RÉEL du runtime, gardes `Origin`+localité (pas d'OAuth — écart énoncé), conformité `server/discover`/`-32022`/`-32020`, dual-ère assumé ; éprouvé sur une app GÉNÉRÉE. **Les 2 dettes d'architecture sont SOLDÉES** : (a) le protocole, les gardes et le catalogue vivent désormais **au CŒUR** (`nodefony` → `src/mcp/`, exportés) — ce module ne porte plus que la PORTE (`McpController`) et n'en ré-exporte rien, donc le futur `@nodefony/mcp` de P12 n'aura pas une ligne de protocole à redéclarer ; (b) **une application ajoute ses propres outils** par `IModule.getMcpTools?(): IMcpTool[]`, ramassés **à la demande** (`collectMcpTools`) plutôt qu'enregistrés au boot — pas de registre, pas d'ordre à respecter, coût nul en production, fraîcheur gratuite ; `mcp.tools` ne filtre que les intégrés (sinon l'outil déclaré serait accepté puis jeté), les intégrés gagnent toute collision, et tout écart (nom hors forme, nom pris, handler absent, déclaration qui lève) part en `WARNING`. Éprouvé bout en bout **sur serveur réel** (`tests/mcp-http.test.ts`, 8 cas : la route, la garde `Origin`, et l'outil `test_probe` du module `test` publié PUIS appelé via `kernel.modules`) ; suite protocole portée au cœur (42 cas), débranchement joué (9 rouges puis 2 sur le chemin HTTP). Au passage : le rouge CI déterministe de `tests/mcp.test.ts` (6/6 jobs) était le cas `check` — scan de dépôt réel sous le timeout implicite de 5 s de vitest — désormais borné explicitement. 🔴 **Et un défaut de conformité que seul un VRAI client pouvait révéler** : `initialize` annonçait la révision PRÉFÉRÉE (`2026-07-28`) à tout client, au lieu d'ÉCHOER celle qu'il demande — or aucun SDK déployé ne connaît cette révision (`@modelcontextprotocol/sdk@1.30.0` : `LATEST = 2025-11-25`), donc la porte était **refusée par Claude Code** (« Server's protocol version is not supported »). Corrigé (`negotiateVersion` + 5 révisions servies + repli `2025-03-26` pour un client muet), prouvé par 4 cas neufs dont « chaque révision ANNONCÉE est réellement servie », et **éprouvé avec DEUX clients indépendants** : Claude Code et **Mistral Vibe** (`MCP integration registered 5 tools`, `nodefony_card` et `test_probe` appelés pour de vrai). Leçon : un serveur parfaitement conforme à la dernière norme peut ne parler à personne — la conformité se mesure sur un client, pas sur une spec. 🔴 **Deuxième occurrence, dans l'AUTRE sens (`ef706523`)** : le fil MODERNE de claude-code 2.1.238 meurt après `server/discover` quelle que soit la réponse (prouvé au proxy journalisant : `tools/list` conforme rejoué 4×, JSON puis SSE, 0 outil enregistré) — **retrait mesuré de `server/discover`** (-32601 ⇒ le client suit le repli `initialize` que la spec prévoit), `resultType`+`_meta` (MUST du schéma 2026-07-28) servis PAR ÈRE (`eraResult` — jamais à un client legacy), `instructions` migrées dans `initialize` ; preuve finale sur tarball réinstallé : 4 outils listés, 1 appel `nodefony_inspect` réel. Et le client **ne se RECONNECTE jamais** : application éteinte au démarrage de la session d'agent ⇒ `mcp_servers: failed` pour TOUTE la session (mesuré au banc : 0 appel sur 30 tâches malgré la porte conforme) — l'`AGENTS.md` généré dit désormais l'ORDRE (application d'abord, session ensuite ; la CLI reste toujours là) et la tâche 9 du banc démarre l'app dans sa prémisse (`31a8c0e8`). **Outils RÉSERVÉS** (`a24672aa`) : `IMcpTool.scopes` (TOUS exigés) et `requiresAuth`, filtrés **à la collecte** — donc `tools/list` ET `tools/call` d'un seul point, un outil retenu étant « inconnu » pour le protocole (son existence n'est pas révélée) ; handler `(args, caller)` pour borner ce qu'il REND. Conforme à `server/tools` (« MAY vary by the authorization presented on the request », jamais « per-connection ») — la collecte par requête EST la condition posée. **Rôle _resource server_ branché** (`6296fdaa` cœur) : `mcp.authorization` — vide (défaut) = porte anonyme inchangée ; un serveur d'autorisation déclaré l'allume ENTIÈREMENT (un seul réglage commande, deux auraient permis « protégé sans émetteur »). Métadonnées sur `/.well-known/oauth-protected-resource/nodefony/mcp` (chemin **dérivé** par insertion RFC 9728 §3.1 ; le module DÉCLARE désormais sa ressource — `DevkitService.publishedProtectedResources()` — et `@nodefony/framework` monte le document, son controller dédié ayant été retiré), `404` si le rôle est éteint — jamais un document sans `authorization_servers`, que la spec MCP interdit. L'URI canonique s'ÉCRIT et ne se dérive JAMAIS du `Host` : sinon un `Host` forgé obtient un jeton d'audience arbitraire ET passe la vérification, ce qui vide RFC 8707 de son sens. ✅ **Le vérificateur EST livré depuis** (P6.9.2→9.4) : la porte cherche `ACCESS_TOKEN_VERIFIER` dans le conteneur (`McpController.ts:109` — `@nodefony/devkit` ne dépend toujours pas de `security`) et `@nodefony/security` le pose sous LA MÊME constante du cœur (`protectedResource.ts:412`, service `accessTokenVerifier` → `RemoteJwtVerifier`, JWKS distant RFC 8414) — câblage bouclé, vérifié au code 08-20 ; `503` + `CRITIC` reste le comportement si le rôle est déclaré sans module security. Route prouvée sur serveur réel, et le test DISCRIMINE les deux `404` (rôle éteint = `{"error":"not_found"}` vs route absente = enveloppe framework — celle-là même qui cassait le parseur du SDK) ; débranchement joué (chemin concaténé au lieu d'inséré → 1 rouge). 🔴 Corrigée au passage : la justification « il faudrait un serveur d'autorisation OAuth 2.1 complet », **fausse** et qui surestimait le reste d'un ordre de grandeur (la spec place l'AS « beyond the scope »). Enfin (`52695e3a`) : `server/discover` **annonce qu'il existe des outils réservés** — un nombre, jamais un nom — sans quoi un catalogue filtré fait conclure « rien de plus ici » et l'agent ne demande jamais de jeton. Livré : parc 22 skills conformes (gate `npm run skills:check`), **5 skills embarqués par npm** (tous préfixés `nodefony-` : le dossier `.agents/skills/` d'une app est PARTAGÉ avec les skills de l'utilisateur) + `ai:sync` — 🔴 **qui pose désormais un MIROIR `.claude/skills/`** (`77ac85e7`) : mesuré en headless, claude-code ne lit PAS `.agents/skills/` (5 pointeurs posés, 0 skill chargé ; les mêmes sous `.claude/skills/`, tous chargés) — deux racines, un seul `renderPointer`, jamais de suppression dans une racine qui appartient d'abord à l'utilisateur, dont **`nodefony-browser`** qui livre les SONDES d'écran (`inspect.mjs` — 6 familles activables : a11y, rendu, réseau, Web Vitals, stockage, responsive ; `watch.mjs` ; `socket.mjs` — socket applicatif de bout en bout joué DANS la page, donc cookies et Origin réels), leur doc en `references/` et leurs tests (`browser-*.test.ts` : logique pure + banc fonctionnel paramétré `NF_BROWSER_TEST_*`, visable sur le dépôt comme sur une app générée) — `64ec2a5f`, `2254a741` ; **sondes ÉPROUVÉES hors de ce dépôt** : banc joué contre une app `create app` (`3b67b8a2` — le pont `api.request` n'est plus supposé), refus de canal `realtime:denied` exercé et gravé à deux passes + état d'authentification porteur de son identité (`60ea39f8`), et les quatre scripts publiés exécutés dans le job **windows-latest** sur leurs chemins de refus (budgets de temps par cas, `64ea617b`), `.ai/symbols.json` publié par le paquet `nodefony` + commande `symbols`, `check`/`doctor` à 3 familles (conformité, readiness, route), banc devkit (compilation + agent + schéma réel). Détail vivant → kit `project_devkit_ai_kit` + `docs/release/nodefony-10.md` ; journal → git log + snapshot mémoire IA.

##### Performance du pipeline HTTP — les 5 goulots

Base mesurée : **9 347 RPS** vs 30 445 Fastify / 35 594 `node:http` nu à décor identique ; stdout coûte −14,5 % ; 5 goulots ancrés (fabrique de contexte, ~25 frames async, double `setBody`, controller par requête, en-têtes). Depuis : **lots A→D +8,9 % re-audité · F-A/F-F/F-C ~+7 % (`ba1f0d17`) · F-B URL fast-path +4-10 % (`5fa6ee7a`) · F-D mesuré et REJETÉ (bruit) — chantier fabrique CLOS**. Sonde `NF_PERF_PROBE=1` à demeure (dump `/nodefony/kernel/bench/probe`). **Bancs WS axes 1+2 FAITS** (worktree avant-chantier vs HEAD, 2 séries A/B) : **non-régression confirmée** — echo/broadcast dans le bruit, churn non concluant sans signe de régression, les lots HTTP sont neutres côté WS. **Équité express-fair PROUVÉE sur HEAD (`e68c4e59`)** : 1 000 req → 0 Set-Cookie, 0 commit db (`data_version`), profiler 404 — harnais versionné `express-fair-proof.mjs`. **Profil du cycle ORM FAIT (`967f571b`)** : escalier session/entité (find() 20 rows +850 µs/req · session sqlite +322 µs vs memory +17 µs) + 2 cpuprofiles fenêtrés — couche Nodefony < 2,5 % du CPU, goulot = build+prepare drizzle refaits à CHAQUE requête (~48 % du chemin read) ; décor versionné `NF_BENCH_ORM=1` + `BENCH_HEADER`. **Lot prepared mémoïsé LIVRÉ** : SELECT préparés par FORME dans `DrizzleRepository` (placeholders re-bindés, repli `$or`/riches/tx, cap 128 ; `SessionStorage` inchangé — son `findOne` passe par le chemin préparé) — A/B c25 2 paires propres × 2 routes : read-lean 1 077-1 090 → 2 003-2 035 RPS (**~+86 %**), session+find 769-778 → 1 515-1 518 (**~+96 %**) ; gates drizzle 425 + intégration http 619 + memory 9/9. **A/B PG FAIT (`8121bef1`)** : décor multi-dialecte (corpus PG + DDL posé d'avance) — read-lean 1 017→1 640 (**~+62 %**), secure 642→1 021 (**~+59 %**), verdict par concordance des médianes inter-séries (gate 3 % impassable sur PG-Docker). **Parité Express PROUVÉE (`013554b4`, `18bfbca7`)** : Express naïf→prepared +65 % (même goulot), express-fair+drizzle vs Nodefony = **×1,07** ; capacité pod livré ~1 650/1 040 RPS (read/secure). **Routeur — pré-filtre de préfixe littéral LIVRÉ (`a42512e3`)** : l'index de `c533efa` trouvait les littérales par chemin exact, mais les dynamiques restaient scannées une à une (O(dynamiques)). Le motif étant ancré, une route ne peut servir qu'un chemin commençant par son préfixe littéral → `startsWith` (~5 ns) avant `exec` (~23 ns), zéro allocation, ordre d'insertion tenu par construction. Table réelle : **26,3 → 2,8 motifs exécutés/req (−89 %)**, 47 → 11 au pire ; ~0,54 µs sur 86 µs = **0,6 %, SOUS le bruit d'un A/B — aucun gain RPS revendiqué**. L'enjeu est la SCALABILITÉ (600 routes : 8,6 µs = 10 % du budget ; 1200 : 26 µs = 30 %), mesurable par `route-scan-cost.mjs --scale`. Garde ASCII sur le préfixe (cas réel : `/Σ/{id}` sert `/ς/1` que `toLowerCase` écarterait → 404). Gates framework 511 · intégration 619 · load 27 · memory 9/9. **Instrumentation de mesure ASSAINIE (`057e4b09`)** : quatre instruments faux démasqués sur « qui bloque la boucle » et deux explications réfutées — le plafond PG mesuré depuis macOS vient du chemin VIRTUALISÉ Docker (facteur 2,1-2,5 ; 40 backends sur 40 en attente du client, 11-12,9 k tps en interne), **pas** de PostgreSQL ni du pilote ; corollaire : aucun ABSOLU PG de ce dépôt n'est transposable. Outils versionnés : `db-backend-cost.mjs --prove/--ceiling`. Reste ORM : updateOne/upsert non mémoïsés (hors chemin chaud), A/B MySQL (variante corpus non générée), index FK scaffold → kit `project_perf_pipeline_p2_kit` ; journal → git log + snapshot mémoire IA.

### ✅ Audit externe 2026-07-14 — INSTRUIT AU CODE (audit vérité 08-20)

> Les 9 constats, jamais instruits depuis juillet, ont été confrontés au code le 08-20 :
>
> - **5 CONFIRMÉS → montés au tableau des dettes ci-dessus** : `NF__HTTP__TRUSTPROXY=1` cassait le
>   boot (✅ soldé) · `ClusterManager` arrache les handlers tiers · table de routes `static` globale ·
>   `@Body()` injecte le payload brut sans validation de schéma (`routerDecorators.ts:1178` —
>   design courant, la validation d'entrée reste un chantier) · `@inject` lit `getMetadata`
>   (hérité) et non `getOwnMetadata` (`injector.ts:271` — lecture héritée volontaire ou non, à
>   trancher avec le palier TS7/décorateurs).
> - **2 RÉSOLUS depuis** : fan-out realtime (mutualisé — 1 sérialisation pour N abonnés,
>   `buildNotification` source unique) · suites charge/mémoire EN CI (`memory.yml` exécute
>   `test:load`).
> - **1 RECALÉ** : `: any` = **189** aujourd'hui (143 cœur + 46 packages) vs « 166 » rapporté ;
>   oxlint tourne EN CI (`node.js.yml`) ET dans le hook lint-staged (`oxlint --deny-warnings`) — le constat « lint absent des hooks et de la CI » est PÉRIMÉ.
> - **1 NON INSTRUIT** (mesure, pas lecture) : les % de profil CPU (audit 5,9 % · setTimeout
>   2,6 % · churn listeners 1,9 %) — à rejouer au profileur si le chemin chaud est retouché.

---

## 📊 Avancement (vérifié code · **2026-08-20**)

> Comptage **autorité = emoji en 1ʳᵉ cellule** de la roadmap (1 ligne = 1 tâche, ⏭️ exclu). `◀` = bloqueur du chemin critique. **MVP sécurité ✅ atteint (P6, resource-server P6.9.x compris) · multi-dialecte S1-S4 ✅ · doctor ✅ → bloqueurs actuels = P8 publication npm + P11 (CLI métier), puis S5 (DDL prod).**

```
━━━━━━ NODEFONY · MIGRATION ━━━━━━━━━━━━━━━━━━━ vérifié code 2026-08-20 ━━━━━━
 P0  Bugs bloquants        ██████████ 100%   6✅  0🔶  0⬜
 P1  Fondations symbiose   ██████████ 100%   8✅  0🔶  0⬜
 P2  Cycle de vie Context  ██████████ 100%   9✅  0🔶  0⬜   (P2.6 idempotency ✅ via @Idempotent)
 P3  Logs structurés       █████████░  85%   7✅  3🔶  0⬜
 P4  Tests symbiose        ██████████ 100%   6✅  0🔶  0⬜
 P5  Session/User/ORM core ████████▌░  85%  13✅  3🔶  1⬜   ◀ (reste P5.0b batch/cron)
 P6  Security              █████████░  87%  29✅  3🔶  3⬜   cœur MVP + resource-server P6.9.x LIVRÉS ; reste P6.9d (serveur d'autorisation, APRÈS release), mTLS, rpId, authz B, logs auth
 P7  ORM drivers           ██████▍░░░  64%   3✅  3🔶  1⬜   ◀ BLOQUEUR RELEASE — S1→S4 ✅ ; reste S5 DDL prod (gelé → après P8+P11) + P7.11 NoSQL
 P8  CLI + Monitoring      █████████░  88%   3✅  1🔶  0⬜   (doctor ✅ = alias `check`, CheckCommand.ts:49 ; reste HORS ligne : publication npm)
 P9  Polish + clôture      ████████░░  75%   3✅  0🔶  1⬜   (P9.4 : 0 vulnérabilité, re-prouvé 08-20)
 P10 Studio (admin web)    ████████░░  84%  12✅  3🔶  1⬜   (P10.6 🔶 : ROLE_NODEFONY_ADMIN actif sur /studio/api/create/* seul)
 P11 CLI par module        █████░░░░░  50%   3✅  2🔶  3⬜   ◀ BLOQUEUR MVP — lifecycle + scaffold ✅ ; reste orm:migrate (S5c) + user:* métier
 P12 Couche IA agentic     █▍░░░░░░░░  14%   0✅  2🔶  5⬜   🧪 différé (llm réel non intégré ; protocole MCP AU CŒUR, module vide ; agent-guard vide)
 P13 Realtime distribué    ████████░░  77%  10✅  3🔶  2⬜   (reste Kafka 13.6a/b · décorateurs 13.8)
 P14 Frontend Vite + iso   ████████░░  81%  14✅  1🔶  3⬜   (P14.18 ✅ origine par Host · svelte5 ✅ · solid retiré)
 P15 Mediasoup + SIP       ░░░░░░░░░░   0%   0✅  0🔶  8⬜   (banc ORM `mod/mediasoup` ≠ implé P15)
 P16 Cloud-Native (10 axes)████▌░░░░░  45%  15✅  0🔶 18⬜   (33 sous-items vérifiés code 08-20 · 16.J /metrics repoussé)
────────────────────────────────────────────────────────────────────────
 GLOBAL                    ███████▏░░  72% 141✅ 24🔶 46⬜  (211 tâches · audit vérité 2026-08-20)
────────────────────────────────────────────────────────────────────────
 DOC Corpus de référence   █████████▋  97%  61/63 pages aux 4 gates (rejoués 08-20) · 437 ancres en DÉRIVE (dette)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

> **Chantier DOC — hors du compte des 198 tâches** (il n'a pas de tâches `P` numérotées).
> Corpus de référence des modules : une page est « faite » quand elle passe **4 gates**
> (`doc-lint` · `anchor-check` ancres vers le code · `anchor-inpage` ancres internes ·
> `code-check` compilation du Démarrage rapide).
> Vagues **1-6 ✅** (sécurité, architecture, cœur + hubs, identité + données, temps réel + UI) ·
> **4bis ✅** cœur/API : `kernel` + `request-context` recentrées sur l'API, `react-hooks`, hub core,
> **`client` CRÉÉE** (bibliothèque cliente isomorphe) ; `container` + `injection` **SUPPRIMÉES**
> (recouvertes par la transverse `injection-portees`, devenue source canonique du DI) ·
> **7 ✅** transverse — **(a) `docs/` assaini ✅** : 29 artefacts internes (audits datés, POC, plans,
> specs de migration, brouillons) sortis vers la mémoire IA `core-dev/` — le portail les servait au
> même rang que les guides, et `docs/migration/MIGRATION_STATUS.md` était un **lien symbolique** vers
> ce tableau de bord (385 Ko servis comme page de doc). **(b) socket canonisée ✅** : `protocole`,
> `actions`, `observabilite` créées, 6 **graphes temps réel** sauvés en fence `nodefony-livegraph`
> (ils étaient attachés au chemin des pages supprimées), page de vision transverse recentrée sur la
> trajectoire SIP/ponts. **(c) TERMINÉE** : régime `doc-lint` « glossaire » (§8bis-lexique) + 2 lexiques
> conformes (2 niveaux, ADR-0001) · page **`cli`** (moteur, commandes, scaffold, extension, complétion) ·
> **tutoriel** « ta première application » (Diátaxis, `docs/tutoriels/`) ; **`reference/` ABSORBÉ** — la
> référence d'API = auto (`symbols.json` + Studio), ADR-0001 interdit une référence manuelle ;
> les 8 pages « socket » de `docs/` racine sont **SUPPRIMÉES** (elles décrivaient une API `IBackplane`
> inexistante), leur contenu revalidé vit dans `@nodefony/realtime/docs/` · **8 ⬜** IA + devkit ·
> **4ter ✅** `cookies`, `upload`, `rate-limit`, `observabilite` (http) · `admin`, `templates`
> (framework) — 6 pages, 4 gates verts, hubs http/framework liés (corpus 54→60).
> Méthode, plan des vagues et **~180 écarts code↔doc relevés** (F1→F183) : mémoire IA
> `project_doc_corpus_chantier_kit`. **Les 6 écarts SYSTÉMIQUES sont SOLDÉS** (`024f32a7`→`12cb02e4`) :
> types realtime nommables côté navigateur (F131) · convention `I` qui cassait `@services()` (F140) ·
> écouteur de boot non tagué, fatal en prod et muet en dev (F142) · **action RPC fermée par défaut**,
> décorateur ET override (F173) · copie du contrat de sonde dans la console realtime (F172) ·
> config des modules typée dans `use()` (F115). 3 des 6 étaient **déjà corrigés ou partiels** dans le
> code : le kit se vérifie au terrain avant d'être exécuté.
>
> **Registre REQUALIFIÉ en entier (2026-07-22)** — les 102 constats en attente confrontés au code,
> 7 lots en parallèle, ancrages relus par symbole (jamais par numéro de ligne) : **85 TIENNENT**,
> 16 corrigés depuis, 1 périmé, **0 invérifiable**. La péremption réelle est de ~16 %, pas de moitié :
> l'échantillon « Lot 3 » (3 périmés sur 6) mesurait l'attention déjà reçue, pas le taux de survie.
> Les 85 vivants se rangent en **5 motifs qui se soldent en série** : texte périmé (36) · défaut de
> comportement (20) · **réglage sans lecteur** (12 — clé validée, décrite, jamais lue) · filet absent
> (9) · correction partielle (8). Photo de la requalification : `tmp/requalif-ecarts-doc-code.html`
> (non commitée). L'**avancement courant** a son propre rapport, régénéré depuis le kit :
> `node tmp/registre-ecarts/gen.mjs`.
>
> **Correction PAR MOTIF engagée (2026-07-23)** — on corrige le motif, pas l'item : 85 décisions
> deviennent 5 gestes. **Correction partielle : SOLDÉ** (`96e36890`) — Kafka purgé de la surface
> publique realtime, README réécrit sur le réel (décorateurs et subpath client faux), `IWsCookie` et
> `CookieOptionsType` dédupliqués, `unsign()` aligné sur son implémentation, TSDoc `regenerateId`
> (câblé depuis `authFlow.ts:388`), commentaire Rollup retiré. **Réglage sans lecteur : 9/12**
> — `887b2d9c` F9+F13 (les 5 clés inertes de `security.headers` portent `reserved:true` et NOMMENT
> leur remplaçante `http.securityHeaders.*`) · `62db6a0f`+`94179254` F24 (la trace d'usage d'une clé
> d'API, qui n'était pas seulement vide mais EFFACÉE à chaque usage, est écrite dans `onSuccess`
> avec IP et agent, exposée dans `IApiKeyView` et prouvée par un banc sur serveur réel) ·
> `237daad5` F29+F30 (5 réglages webhooks/audit ; 2 constats du registre étaient PÉRIMÉS —
> `denyPrivateIps` et `retentionDays` SONT lus) · `fc2e0ada`+`0052f869` F53 (4 clés `log.*` que le
> noyau lit mais qu'aucune app ne pouvait poser — déclarées, validées, prouvées jusqu'au driver) ·
> `b263aed7` F63 (`SessionIntent.eager` RETIRÉ : pour un champ TS, la suppression casse la
> compilation — c'est un signal, pas un silence, contrairement au strip Zod) · `cebb945b` F97+F99
> (deux voies d'extension realtime présentées comme atteignables) · `e2a90eea` F31 (la console
> d'audit Studio offrait 3 filtres sans émetteur et oubliait `webhook`, qui émet).
> **Le filet du motif est posé** (`e420f9ed`) : le boot AVERTIT quand une app écrit une clé
> `reserved` — le blocage annoncé (« le cœur n'accède pas au schéma d'un module ») n'existait pas,
> `Module.configSchema()` + `configProvenance.ts` suffisaient. **Restent F17, F22, F25** : variante
> où la clé est bien lue mais où le `.describe()` PROMET (AAL3 WebAuthn non vérifié · format de clé
> d'API à 2 séparateurs · `totp.store` annonçant `mongoose`/`redis` sans implémentation — une app
> Mongo croit persister ses secrets 2FA et retombe sur `memory`).
> **Motif SOLDÉ 12/12** avec F17, F22, F25 (`afb30720`) — variante « le `.describe()` PROMET » : la clé
> EST lue, c'est le texte qui invente (AAL3 non tenu, format de clé d'API faux, backends de store TOTP
> inexistants). Corrigés + WARNING au boot sur l'attestation + banc `configPromises.test.ts` qui teste le
> COMPORTEMENT promis.
> **Motif « symbole fantôme » SOLDÉ 7/8** (`c7664e4a`) et **« la phrase ne décrit pas le code »
> SOLDÉ 13/13** (`30f5ce79`) — dont un `.describe()` de session triplement faux qui alimentait le
> formulaire Studio, et une raison d'audit qui confondait passkey et OAuth faute d'argument transmis.
> **Motif « défaut de comportement réel » ENGAGÉ (2026-07-23)**, par geste et non par item :
> `3bf01a40` **@nodefony/redis** (6 items) — le service rendait aux trois stores un client **fermé**
> comme s'il était ouvert (`createClient()` rend un objet AVANT `connect()`, et une connexion en
> échec reste inscrite dans la map) : chacun promettait un repli, chacun prenait un
> `ClientClosedError` ; la règle de curseur `SCAN` était recopiée trois fois et durcie une seule (un
> `?cursor=` arbitraire faisait échouer une consultation d'administration côté jetons et passkeys) ;
> `listAll` des jetons balayait le keyspace sans plafond ; deux bancs purgeaient la même base.
> · `5282137c` **`Module.hookKernel`** (F66) — `static critical = false` ne taguait que les hooks de
> CLASSE : la connexion de mongoose, posée à la main, **interrompait le boot en production** au nom
> d'un module déclaré optionnel, et le journal accusait « (anonyme) ». Quatre sites y passent, dont
> les décorateurs `@services` et `@controllers`, qui concernaient TOUS les modules. · `b208ada4` les
> doubles de test déclarent le hook qu'ils doivent au contrat (`as unknown as Module` faisait taire
> le compilateur — un changement de contrat casse les DOUBLES avant la production).
> **Registre : 74 ✅ · 6 🔶 · 39 restants** sur 119 (3 🔴 : F27, F40, F51 — plus F18/F28 sécurité).
> F27+F51 (pagination : les champs de l'autre mode ignorés en silence) pèsent **22 implémentations
> de `listPage` sur 6 modules** + le contrat `IPage` au cœur : une session à part entière, mesurée
> AVANT d'être entamée — la durcir à moitié changerait un silence en plantage. Rapport triable
> régénérable : `node tmp/registre-ecarts/gen.mjs` (il PARSE le kit — pas de seconde liste).
> **Découvert en chemin, hors registre** : `body` n'existait ni au type ni au runtime sur
> `context.request` (`80eb2801`, alias de `queryPost`, `body` devient un nom d'action réservé) ; et
> **6 paquets publient des types injoignables après `npm i`** (`exports["."].types` → `./index.ts`,
> absent de `files`) — `frontend` réparé, les 5 autres verrouillés par un cycle de types
> `http ↔ framework ↔ security → user → orm-core`, tracés par la gate `nodefony check` (`1a139b14`,
> `a4cc8b72`).

> Fondations **hors roadmap** (déjà migrées, Phases 0-4) : Build, Core/Kernel, DI, Syslog, Router, Controller, Types.
> **Build = rolldown + tsgo** (`c600ae79`→`d295121b`, lots 0-5) : Rollup SUPPRIMÉ du repo, 20 cibles
> (19 workspaces + app racine), surface exportée prouvée identique, `.d.ts` par `tsgo`, target ES2024,
> core 20 s → 0,17 s, clean build 3 min 50 → 34 s. Plan : mémoire IA `core-dev/audits/rolldown-migration-plan-2026-07.md`.
> Le durcissement transverse (cycle requête V1-V5, Container, fast path, forwarded/proxy, WS, certificats)
> n'a **pas de lignes P dédiées** — cf § Durcissement fondations + `git log`.
> **Resync 2026-07-10 (151 commits depuis le 06-28)** : chiffres honnêtes, dashboard sous-vendait encore —
> corrigés : P6.18 ✅ (audit persistant prouvé pg/mysql via S3/S4) · P10.4/10.5 ✅ (SecurityAdminApi + UserAdminApi
> au code) · +P10.15 ✅ (écran Stores) · P10.9 firewall ✅ · P7 barre 90 % → 75 % (formule, S5 restant) ·
> cellule-journal P7.10 dégraissée (5 099 → 1 110 car.) · gap E2E SQL comblé (S1-S4) · blocker rollup caduc.
> Passes précédentes : mémoire IA `core-dev/migration/AUDIT-verite-2026-06.md`.
>
> **REGISTRE SOLDÉ — 120 / 120, 0 ouvert, 0 critique** (`16db7f53` : F59, dernier item — une action
> de controller ne peut plus reprendre un nom porté par `Controller`, le décorateur le refuse à la
> déclaration en nommant le conflit, liste dérivée du prototype donc jamais périmée). Les cinq motifs sont
> clos, et les trois derniers items — qui étaient des **décisions d'architecture** — ont été
> tranchés : **F93** (un canal appartient à qui fournit son provider ; `hub.listen()` = écoute
> PASSIVE, la fabrique est rejouée à l'arrivée d'un client — `ce7eb849`) · **F177** (streaming RPC
> **retiré** plutôt que publié à moitié : une action rend UNE valeur, la progression passe par le
> motif « travail + canal » ; à reconcevoir en P12 avec annulation / erreur en cours de flux /
> débit régulé — `0cac14c1`) · **F4** (déjà résolu au terrain : `docs/realtime/socket/` n'existe
> plus, la page d'architecture porte la TRAJECTOIRE et renvoie au module, seule source).
> Puis **F58** (`b6117eed`), **F47** (`78b145e6` — le trou réel était le champ `types` RACINE,
> absent du tarball) et **F87** (`7618cf96` → `0d295d42`). Reste **F59** en partiel : une action de
> controller nommée `remove` casse le build (collision `Service`), documentée, décision de préfixe
> réservé ouverte. Compteur régénérable : `node tmp/registre-ecarts/gen.mjs` — il ne lit que la
> COLONNE « suite à donner » du kit, jamais la prose.

---

## 🗺️ Roadmap priorisée (dette technique d'abord)

> Spécifications détaillées : mémoire IA `core-dev/migration/phases-details.md`.

### 🔴 Dette APRÈS RELEASE — préfixe `NF_` sur toutes les variables d'environnement

Le framework lit **47** variables ; **12** portent `NF_`, **35** non. Trois familles, une seule
règle : le préfixe dit à qui appartient la variable. Une application qui installe Nodefony a déjà
un environnement, et une collision ne produit pas d'erreur — elle produit un comportement
inexplicable.

<!-- prettier-ignore -->
| Famille | Nb | Traitement |
| --- | --- | --- |
| `NODEFONY_*` (`_ENV`, `_CLUSTER`, `_WORKERS`, `_BOOT_TIMEOUT_MS`, `_INSTANCE_ID`…) | 12 | renommer en `NF_*` (forme, pas fond) |
| Génériques à risque : `COOKIE_SECRET`, `PG_URL`, `REDIS_HOST/PORT/PASSWORD/TEST_URL`, `MONGO_TEST_URI`, `BCRYPT_COST/N`, `POD_NAME`, `APP_ENV`, `MODE_START`, `RUN_PERF`, `NO_TTY` | ~14 | renommer en `NF_*` — **priorité** |
| Standards tiers : `NODE_ENV`, `CI`, `NODE_DEBUG`, `UV_THREADPOOL_SIZE`, `BABEL_ENV`… | ~9 | **ne pas toucher** — on ne les possède pas |

**Pourquoi après la release** : renommer une variable lue est une rupture pour toute application
déjà déployée. À faire d'un bloc, avec repli transitoire (lire l'ancienne, avertir, documenter la
nouvelle), pas au fil de l'eau.

**En attendant, la règle vaut pour tout ce qui est ÉCRIT** : cf `CLAUDE.md`, section des
invariants — aucune variable neuve sans `NF_`, y compris pour les tests et les bancs.

### P0 — Bugs bloquants ✅ (6/6)

Tous résolus : 11 fails RFC HTTP, 2 fails WS binary, `getController()` typé, **BUG-001→004** (propagation ALS WS,
leaks scope DI sur erreur/session WS). Tests preuve présents (`http-rfc-errors`, comptage scopes).

### P1 — Fondations symbiose ✅ (8/8)

`Context.phases`, `onAfterResponse`, `signal` (AbortSignal lazy), **`RequestContext` ALS** (requestId/user), `errorRenderer`
unifié HTTP+WS, `logRequest` pluggable, hooks security (`beforeResolve`/`afterAuth`/`onAuthFailure`), graphe symbolique `.ai/symbols.json`.

### P2 — Cycle de vie Context (100 %)

<!-- prettier-ignore -->
| # | Tâche | État |
| --- | --- | --- |
| ✅ P2.1 | Boundary timing phase-by-phase | via P1.1 (`Context.phases`, lazy) ; **waterfall COMPLET (`a23b36d5`)** : `initialize` (DI + hook controller) / `render` (moteur de vue) / `send` (saveSession + write) désormais ÉMISES — le profil s'arrêtait à la fin de `action` ; sonde `timing.enabled` allumable EN PROD (`NF__APP__TIMING__ENABLED=true`, ~2-4 % RPS mesurés, 0 coût éteinte) |
| ✅ P2.2 | Tear-down déterministe (finish+close) | via P1.2 (dedup race) |
| ✅ P2.3 | Aborted cleanup + 499 interne | `client-abort-499.test.ts` |
| ✅ P2.4 | `initialize()` error boundary | crash → onError → 500 JSON cohérent |
| ✅ P2.5 | Request timeout (408/504) | 2 couches (Node natif + `onTimeout` Nodefony) |
| ✅ P2.6 | Idempotency keys (`X-Idempotency-Key`) | livré via `@Idempotent` (P6.8) + stores Redis/Drizzle |
| ✅ P2.7 | W3C `traceparent` honor + génère | `service/trace.ts` |
| ✅ P2.8 | Backpressure doc + tests streaming | `write()===false` → attend `'drain'` (Node stream) ; CL⊥TE RFC 9112 §6.1 ; tests unit |
| ✅ P2.9 | Body streaming (`@Body({stream})`) | flux brut (`Readable`), parse sauté ; route-match avant parse (A/B 0 régression) ; HTTP/1+2 |

### P3 — Logs structurés (85 %)

<!-- prettier-ignore -->
| # | Tâche | État |
| --- | --- | --- |
| ✅ P3.1 | Audit log canonique (1 PDU JSON/req) | `JsonAuditLogger` |
| ✅ P3.2 | Pretty formatter dev | `PrettyRequestLogger` |
| ✅ P3.3 | Severity selon HTTP status | `severityFromStatus()` |
| ✅ P3.4 | Header redaction (Authz/Cookie) | flags booléens, valeurs jamais loggées |
| ✅ P3.5 | Erreur enrichie (cause chain + stack) | `AuditErrorEntry` récursif |
| 🔶 P3.6 | Filtrage par requestId (CLI) | `Pdu.requestId` livré ; reste le CLI tool (LB.3b) |
| ✅ P3.7 | Mode trace verbose (phase DEBUG) | `logPhasesVerbose()` opt-in `timing.verbose`, perf-gate (0 coût off), teardown |
| 🔶 P3.8 | Rate limit logs par requestId | anti-flood livré ; reste clé par requestId |
| ✅ P3.9 | WS logs (handshake/close/error + wsId) | per-message volontairement écarté (hot path) |
| ⏭️ P3.10 | Transport NCSA/Combined dédié | absorbé par P3.11 (driver `file`) |
| 🔶 P3.11 | **Log Backplane** (write↔read pluggable) | LB.W+LB.0→LB.5+LB.4 ✅ ; défaut `queryDriver:auto` cluster-aware + garde-fou k8s multi-pod (`83f8b9ff`/`a0408f10`) ; reste LB.3b CLI |

### P4 — Tests symbiose ✅ (6/6)

`forward` cross-module, decorators × pipeline, **concurrence 100 req** (unicité ALS), WS pipeline (7 fichiers),
DI scopes (singleton/transient), lifecycle session.

### P5 — Session + User + ORM Core (85 %) ◀ chemin critique

<!-- prettier-ignore -->
| # | Tâche | État |
| --- | --- | --- |
| 🔶 P5.0 | Gate batch/console (`initServers` par type) | `isConsole()` + dispatch 0-serveur OK ; reste `BatchCommand` |
| ⬜ P5.0b | Service Cron/Worker (worker dédié) | décision : gardé, découplé serveur |
| ✅ P5.1 | `@nodefony/orm-core` + interfaces | `IOrm/IRepository/IEntity` + trappe SQL brut |
| ✅ P5.2 | `OrmRegistry`/`EntityRegistry` + base class | 15 tests |
| ✅ P5.3 | `@entity`/`@repository` decorators | WeakMap, sans reflect-metadata |
| ✅ P5.3b | `AbstractCrudService<T,R>` | socle CRUD générique (hooks template) |
| ✅ P5.4 | Tests orm-core + adapter réel | portabilité prouvée (orm-core 22 tests) |
| ✅ P5.5a | Workspace `@nodefony/user` | lib pure, peerDeps |
| ✅ P5.5 | Contrats `IUser`/`BaseUser`/`IUserProvider` | 11 tests, split credential |
| ✅ P5.6 | `UserService` + `BcryptEncoder` | `@node-rs/bcrypt`, 32 tests |
| ⏭️ P5.7 | ~~Adapter Sequelize User~~ | **caduc (virage ORM : sequelize supprimé)** |
| ✅ P5.8 | Adapter Mongoose User | `MongooseUserRepository implements IUserRepository` + `userSchema`/`registerUserEntity` (parité Drizzle, binding ORM dynamique) ; `findBySocialProvider` via `$elemMatch`. **8 tests** (ReplSet : CRUD/finders/tx rollback) |
| ✅ P5.9 | Adapter Drizzle User | ORM par défaut, 8 tests |
| 🔶 P5.10 | Tests User cross-ORM | couvert **de facto** par 2 bancs miroirs même contrat `IUserRepository` (Drizzle 8 + Mongoose 8) ; banc paramétré unifié = optionnel |
| ✅ P5.11 | **Refonte cœur + plug runtime session** | TS strict, ID CSPRNG opaque, dirty-tracking, cookie-only, contrat `ISessionStorage` unifié ; **plug runtime** `@UseSession` opt-in + lazy + L1 + point unique HTTP/WS (tue le ×23) ; cookie RFC 6265bis `__Host-`/SameSite/None⇒Secure + `cookie.hostPrefix` ; `readOnly` + `absolute_timeout` (OWASP). Tests unit+intég+load+mémoire. (chantier session 2026-06-06/07) |
| 🔶 P5.12 | `Redis` SessionStorage | File + **Redis livrés** (TTL natif IoC) ; reste câblage prod |
| ✅ P5.13 | `OrmSessionStorage` générique | Drizzle + **Mongoose livrés** (contrat `ISessionStorage` portable ; sequelize supprimé) |
| ✅ P5.14 | `session.user` + régén ID post-auth | J3 `00ee6631` : câblé via `AuthFlow.login` (regen INCONDITIONNEL + destroy old, anti-fixation prouvée au banc) ; session porte l'IDENTIFIANT, re-fetch provider par requête |

### P6 — Security (87 %) — ✅ cœur MVP LIVRÉ (bloqueur MVP LEVÉ) ; reste durcissement/niches HORS MVP

> **CŒUR P6 BOUCLÉ** — J0→J9 (`1634f09e`→`1df19b93`) + CSRF/CORS/en-têtes (`ebe7e915`/`0724a8c6`/`f4f9ead8`) + CSP nonce (`eb59daf6`). Authenticators Anonymous/Password/Session-BFF/JWT/OAuth2-social/WebAuthn ; autorisation voters + `@IsGranted` (HTTP **et** WS) ; Argon2id + throttle NIST. **Détail-journal = `git log` + mémoires IA + audit vérité `core-dev/migration/AUDIT-verite-2026-06.md` + plan P6 `core-dev/audits/p6-security-audit-2026-06-12.md`.** ✅ **modèle session NIST-aligné** (idle+absolute+touch HTTP+WS, retrait du reliquat PHP `maxLifetimeS`, red-team 11/11, `e27de035`). Reste : P6.16 rpId multi-vhost · P6.9b mTLS (niches). App pose `users` en prod (`3d140de1`, auth prod réparée). Audit persistant P6.18 ✅ (multi-dialecte S3/S4).

<!-- prettier-ignore -->
| # | Tâche | Preuve / état (détail → git log + mémoires IA) |
| --- | --- | --- |
| ✅ P6.1 | `AccessControl` (RBAC walker) | `RoleHierarchyWalker.ts` câblé J6 (firewall→container→`RoleVoter`) |
| ✅ P6.2 | `cors.ts` service | J5 `Cors` (Fetch Standard) ; `handleCors` en tête de `handleHttp` |
| ✅ P6.3 | `firewall.ts` + `SecuredArea` + `defineSecurityConfig` | J1 `c84c0ba3` : Zod fail-closed, mode first\|all, WWW-Authenticate RFC 7235 |
| ✅ P6.4 | `AnonymousAuthenticator` + token | J1 `c84c0ba3` : anonymat opt-in (Zero Trust sinon) |
| ✅ P6.5 | `UserPasswordAuthenticator` | J1 `c84c0ba3`+`25e90b29` : Basic RFC 7617 → `IPasswordVerifier` |
| ✅ P6.5b | Argon2id + migration + throttling NIST | J2 `08ae659e`+`a7e2520e`+`bd9cd602` : RFC 9106, MigratingEncoder, LoginThrottler 429 |
| ✅ P6.5c | **Session BFF** : SessionAuthenticator + AuthFlow | J3 : login/logout/me, anti-fixation OWASP, throttler partagé entre portes |
| ✅ P6.6 | `JwtAuthenticator` (Bearer EdDSA, `jose`) | J4 : allowlist EdDSA+aud+iss RFC 8725, Ed25519 keystore JWKS, TokenService |
| ✅ P6.7 | `csrf.ts` + `@CsrfProtect`/`@CsrfExempt` | J5 : Sec-Fetch-Site primaire + Origin/Referer ; double-submit HMAC stateless |
| 🔶 P6.8 | `authorization.ts` (3 niveaux) | J6 `4e336d50` : RoleVoter + `decide()` affirmative+DENY véto, voterRegistry ; reste niveau B (ACL fine par ressource) |
| ✅ P6.8b | Décorateurs sécu (`@IsGranted`/`@Anonymous`/`@CurrentUser`) | J7 `df673ef8`+`4a11523b` : dans @nodefony/framework (0 cycle, moteur par nom) |
| ✅ P6.9 | OAuth2 social login (`arctic`) | BFF Google/Keycloak/GitHub `oauth2-flow` 6/6 (J9 `41c702f2`→`1df19b93`). |
| ✅ P6.9.1 | Resource server — protocole au CŒUR + porte MCP | **Resource server : protocole + porte LIVRÉS** (`6296fdaa`) — `nodefony/src/oauth/` (RFC 9728 métadonnées, 6750 défi, 8707 audience) en fonctions pures HORS de `mcp/`, porte MCP sous `mcp.authorization` (éteint par défaut). |
| ✅ P6.9.2 | Vérificateur de jetons TIERS (`RemoteJwtVerifier`) | **VÉRIFICATEUR LIVRÉ** — `RemoteJwtVerifier` + service `accessTokenVerifier` dans `@nodefony/security` : accepte un jeton émis par un serveur d'autorisation TIERS (Keycloak/Auth0/Entra/agents) là où `JwtAuthenticator` ne connaît que le keyset LOCAL. Découverte RFC 8414 (3 URL, ordre normatif, `issuer` du document ≡ celui demandé §3.3), clés par `createRemoteJWKSet` (jamais `jku`/`jwk` d'en-tête), allowlist d'émetteurs FERMÉE consultée AVANT toute requête sortante, `HS*` impossible en config (les clés viennent d'un jeu public). 🔴 **Refus ⇒ `null`, PANNE ⇒ `throw`** : liste BLANCHE des fautes du jeton, car jose lève une erreur générique ou SANS code sur un JWKS en `500`, un corps non-JSON ou un `fetch` qui rejette — une liste noire aurait rendu ces trois pannes comme « jeton invalide » (démontré : le débranchement produit 3 rouges). `fetch` injectable (`jose.customFetch`) → 40 cas sans réseau ni port. Le NOM du point de rendez-vous vit au cœur (`ACCESS_TOKEN_VERIFIER`) et non en littéral de chaque côté : il existait en 2 exemplaires, qu'aucun test ne couvrait. |
| ✅ P6.9.3 | Authenticator firewall (`ExternalJwtAuthenticator`) | **AUTHENTICATOR FIREWALL LIVRÉ** — `ExternalJwtAuthenticator` (zone `external-jwt`) rattache le sujet externe à un `IUser` local : `subjectPolicy: "require"` (défaut — le sujet doit avoir un compte local, sinon 401) ou `"ephemeral"` (appelant purement machine, `BaseUser` non persisté, rôles configurés, vide par défaut ⇒ autorisé par SCOPES seulement). Défaut `require` parce qu'un jeton d'IdP d'entreprise vaut pour des milliers de comptes : l'accepter d'office ferait de l'IdP l'unique autorité d'accès, supprimant la seconde décision — locale — qui EST le pare-feu. **L'audience vient de la ZONE** (`area.resource`, RFC 8707 §2), exigée AU BOOT via le nouveau contrat `IAuthenticator.validateArea?(area)` — l'authenticator dit ce qu'il exige, le pare-feu ne connaît toujours aucun nom en dur. **`jwt` et `external-jwt` s'aiguillent par `iss`** (`peekIssuer`, lecture non vérifiée bornée à 8 Ko) : sans ce discriminant, en mode `first`, le premier listé capturait les deux familles et refusait la moitié des jetons — l'ordre d'une liste de config devenait une décision de sécurité (débranchement → 2 rouges). 🔴 **`supports()` ne lève JAMAIS** : le pare-feu l'appelle HORS de son bloc de rattrapage, et `canonicalIssuer` lève sur tout ce qui n'est pas une URL https ⇒ un `iss: "ftp://x"` donnait une **500 provoquée par un anonyme** (débranchement → 4 rouges). 🔴 **PANNE ⇒ 503** (`UnverifiableTokenError`), jamais le 401 générique du fail-closed, sinon le client renouvelle en boucle un jeton bon et la panne d'infra se range dans la statistique des échecs d'auth (débranchement → 2 rouges SUR LE FIL). Message CONSTANT : le banc live a montré l'URL de l'émetteur défaillant qui fuyait dans le corps du 503 — la cause vit désormais dans `detail`, pour le journal seul. Gates : security **996** (+27), intégration http **625/9 skipped** dont banc live `http/external-jwt.test.ts` **6/6** (zone `test-external`, émetteur `.invalid` RFC 2606 = panne déterministe sans IdP), mémoire **9/9**, typecheck **25/25 workspaces**. Coût mesuré de l'aiguillage : **1 763 ns/appel** (~1–3 % d'une requête authentifiée). ** |
| ✅ P6.9.4 | Porte MCP branchée et éprouvée | (c) PORTE MCP BRANCHÉE ET ÉPROUVÉE** (`bf798eec`) : `mcp.authorization` déclare l'URI canonique de la porte + l'émetteur (cette application elle-même), et `jwt.audiences` la rend demandable — sans quoi la porte serait protégée par une serrure dont aucune clé n'existe. Mode **`anonymous` en développement** (`false` en prod) : l'ABSENCE de jeton est tolérée, un jeton PRÉSENTÉ est vérifié strictement (audience étrangère ⇒ 401) — deux choses opposées, qui ne se tolèrent pas ensemble. Motif du mode : un client MCP conforme qui reçoit 401 veut obtenir son jeton SEUL, va chercher `authorization_endpoint`/`token_endpoint` chez l'émetteur, ne les trouve pas (P6.9d) et s'arrête — l'outil devient inutilisable pour qui ne colle pas un en-tête à la main. ⚠️ **Effet de bord réparé** : allumer l'autorisation faisait SAUTER les 13 tests de `mcp-http.test.ts` (sonde de décor recevant 401 ⇒ « serveur absent »), un vert qu'on croit ; le banc suit désormais le fil RFC 9728 (métadonnées → jeton pour la ressource → en-tête sur chaque requête) au lieu de supposer le décor — 15/15. ~~Le défi 401 de la zone `external-jwt` était un `Bearer` nu sans pointeur~~ — **fermé par P6.9.10** (`challenge(area?)` + `resource_metadata` composé au cœur). ✅ **L'ergonomie du jeton est RÉGLÉE sans P6.9d** (`dc5f1bc0`, `0378b8a0`, `1d53d9b3`) : 🔴 un jeton parfaitement valide était refusé — l'application allait lire son PROPRE JWKS par HTTPS chez elle-même (`SELF_SIGNED_CERT_IN_CHAIN`) ; elle le lit désormais en LOCAL (`ITrustedIssuer.localJwks`), le réseau n'ayant rien à faire dans une vérification dont la clé est en mémoire — et le banc `external-jwt-e2e` passe SANS `NODE_EXTRA_CA_CERTS`, la variable que seul `start.sh` posait. Une PANNE de vérification rend `unverifiable` (503) au lieu d'une 500 avec trace. Une ressource peut avoir DEUX adresses (`acceptedResources` — http et https de la même porte), écrites jamais dérivées du `Host` ; la liaison d'audience mord toujours (audience étrangère ⇒ 401). `--ttl <minutes>` (borné 30 j) remplace les 15 min pour un en-tête STATIQUE que rien ne rafraîchit, proposé aussi en interactif. Et le jeton va où l'AGENT le lit — 4 emplacements CONSTATÉS outil par outil, jamais d'après une doc (Claude Code `settings.local.json`.env, Gemini `.gemini/.env`, Vibe `$VIBE_HOME/.env`, Codex `$CODEX_HOME/.env`) — pendant qu'il dormait sans lecteur dans `.env.local`, qu'AUCUN code de l'application ne lit. La rotation SUIT les agents déjà câblés, l'état étant lu dans leurs fichiers plutôt que mémorisé. ✅ **La PORTE se déclare aussi chez l'agent** (`5c4771c1`) : la table remonte au CŒUR (`cli/agentTargets.ts` — `ai:mcp` et `create app` sont des commandes du cœur, `security:token` la consomme), et `nodefony ai:mcp --agent <liste|all|none> [--remove]` déclare la porte **en appelant la CLI de chaque agent**, jamais en écrivant son fichier — Nodefony possède le jeton et l'URL, l'agent possède le format de sa déclaration ; `shell: false` fait arriver `${NF_MCP_TOKEN}` LITTÉRAL (développé, le jeton serait gravé dans un fichier de projet). **« Aucun agent » est un CHOIX** : la case à cocher ne coche RIEN par défaut, rien n'est déclaré hors terminal, et une clé inconnue est refusée en nommant celles qui existent (exit 64). 🔴 Quatre défauts sortis du terrain, tous MUETS côté code de sortie : `gemini mcp remove` répond « not found », **sort en 0** et laisse l'entrée (⇒ verdict pris au CONSTAT, en relisant par la commande de l'agent) · la CLI héritait du cwd de l'appelant, créant un `.gemini/` fantôme dans un sous-dossier (⇒ lancée depuis la racine du projet) · `--dry-run` annonçait une URL différente de celle jouée (l'URL était recomposée à trois endroits) · le rendu disait encore « écrit `NF_MCP_TOKEN` dans `.env` », faux depuis la veille. **Portée : lire ≠ écrire** — les quatre agents savent LIRE une config de projet, seuls `claude` et `gemini` savent en ÉCRIRE une (`codex mcp add` répond « Added global ») ; leur portée projet existe mais tient à un dépôt **de confiance**, geste qui appartient à l'utilisateur ⇒ global, ANNONCÉ, écrasement d'une autre URL signalé. ⚠️ Une première rédaction affirmait « Codex n'a aucune notion de projet » : FAUX — la sonde tournait dans un dépôt non approuvé, elle mesurait la confiance et pas la portée. **Reste** : le flux d'obtention normatif (P6.9d) pour un client qui doit obtenir son jeton SEUL, et le lot 2 (`create app` propose le câblage — jamais par défaut, jamais hors TTY). |
| ✅ P6.9.5 | Rôle ÉMETTEUR (RFC 8414) — publier ses clés | **ÉMETTEUR LIVRÉ** — les deux documents qui rendent une app Nodefony DÉCOUVRABLE : `GET /.well-known/oauth-authorization-server` (RFC 8414 §2) + `GET /.well-known/jwks.json`, montés par `mountIssuerMetadataRoutes` (`@nodefony/framework`) **seulement si** `TokenService.publishedIssuer()` répond — `jwt.enabled ∧ jwt.jwks ∧ issuer en URL https`. Sans quoi : aucune route (404) + WARNING nommant la cause. Le protocole RFC 8414 (les DEUX faces) a été DÉPLACÉ de `security/…/token/issuerDiscovery.ts` vers le cœur `nodefony/src/oauth/authorizationServer.ts` : framework n'importe jamais security, et le chemin bien connu doit rester écrit UNE fois — 🔴 **la publication fait autorité, la lecture en dérive** (`issuerMetadataUrls()[0]` composée par `authorizationServerMetadataPath()`), sinon deux copies produisent un 404 que chacun lit comme « pas d'autorisation ici » (débranchement → 3 rouges). 🔴 **L'URL publique s'ÉCRIT** (`NF_JWT_ISSUER`), jamais dérivée du `Host` : derrière un relais elle vient du client, et un document forgé ferait servir l'identité d'un attaquant par le vrai serveur — même doctrine que l'URI canonique de ressource ; argument non sécuritaire qui suffirait seul : `iss` est gravé dans chaque jeton déjà émis. Document réduit à ce qui est VRAI : `response_types_supported`/`grant_types_supported` **vides** (omettre le second annoncerait `["authorization_code","implicit"]` par défaut §2). `jwt.jwks`, jusque-là **accepté puis jeté**, commande enfin les deux routes ; les 2 `.describe()` menteurs (« dérivé du domaine au boot ») corrigés. **Défaut trouvé par le banc LIVE, encore une fois** : `createdAt` fuyait dans le JWKS public (spread du keyset stocké) → liste BLANCHE `kty/crv/x/kid/use/alg` dans `JwtKeystore`. Gates : cœur **2737** (+12), security **989** (+7), intégration http **634/9 skipped** dont banc live `http/issuer-metadata.test.ts` **9/9** (débranchement → 8 rouges), mémoire **9/9**, typecheck **25/25 workspaces**. |
| ✅ P6.9.6 | e2e du SUCCÈS, sans IdP tiers | **SUCCÈS e2e LIVRÉ** — le chemin `authenticated` se joue enfin sur un VRAI serveur, **sans IdP tiers** : puisqu'une app qui publie RFC 8414 est découvrable, l'app de dev se déclare dans sa propre allowlist (`https://localhost:5152`, **sans `jwksUri`** ⇒ la découverte est réellement exercée) et un jeton de `/nodefony/security/api/token` entre par la zone `test-self-external`. La porte ne possède pas la clé : elle découvre le document, lit `jwks_uri`, tire le JWKS, vérifie la signature Ed25519, contrôle l'audience, puis rattache `admin` au compte LOCAL (politique `require` — les rôles rendus viennent du compte, jamais du jeton). Une zone JUMELLE `test-foreign-audience`, préfixe DISJOINT (deux zones qui se recouvrent feraient dépendre le verdict de leur ORDRE), refuse le MÊME jeton sur la seule foi de l'audience (RFC 8707 §2) ; les scopes traversent jusqu'au `ScopeVoter` (`@RequireScope`, scope absent ⇒ **403** et non 401 : le porteur est authentifié, c'est le pouvoir qui manque) ; signature altérée ⇒ **401 et jamais 503**, pendant exact du banc `.invalid` — la distinction refus/panne tranche désormais dans les DEUX sens. Décor : le processus se joint **lui-même en https**, donc `start.sh` pose `NODE_EXTRA_CA_CERTS` = CA de dev du dépôt (ancre AJOUTÉE, jamais `NODE_TLS_REJECT_UNAUTHORIZED` : un vrai défaut de certificat resterait visible). **Trois débranchements, trois fois le compte annoncé AVANT de couper** : CA retirée → 5/6 rouges (preuve que la découverte réseau a bien lieu), audience jumelée → 1/6 (le refus tient à l'audience et à rien d'autre), `@RequireScope` retiré → 1/6. Gates : intégration http **640/9 skipped** dont `http/external-jwt-e2e.test.ts` **6/6**, typecheck **25/25 workspaces**. |
| ✅ P6.9.7 | Red-team / blue-team — 2 failles fermées | **RED-TEAM + BLUE** — campagne d'attaque sur la brique (SSRF par `iss`, confusion d'algorithme, `jku`/`jwk` d'en-tête, audience étrangère, signature altérée, scope absent, ponts architecturaux) : **deux failles trouvées et fermées**. (1) _Le document d'émetteur était servi sur TOUTE autorité écoutée_ — corrigée par la garde d'autorité ci-dessus. (2) 🔴 _Une socket WS adossée à un jeton TIERS ne mourait jamais_ : `ExternalJwtAuthenticator` posait `scopes`/`subject` mais ni `claims` ni `jti`, là où `JwtAuthenticator` pose les trois ; `FirewallRealtimeAuthenticator` ne trouvait donc aucune borne, et — un store étant présent — ne tombait pas non plus dans son fail-closed : il interrogeait le store avec `jti = null`/`iat = null`, deux questions auxquelles on ne peut répondre que « toujours valable ». Ni `exp`, ni révocation ciblée, ni révocation en masse n'atteignaient cette connexion, **atteignable dès qu'une zone `external-jwt` garde `realtime` à son défaut, qui vaut `true`**. Cause racine : `IAccessPrincipal` ne transportait que `{subject, scopes}`, la borne s'arrêtait à la frontière du vérificateur. Fix en DEUX temps — la cause (`expiresAt`/`issuedAt`/`tokenId` au contrat du cœur, remontés du payload vérifié, reposés sous les noms de `JwtAuthenticator`) ET le filet (le fail-closed porte désormais sur ce qu'on PEUT vérifier : `exp` absent ET (aucun store OU ni `jti` ni `iat`) — il attrapera le prochain authenticator qui oublierait de transmettre ses claims). Débranchements : cause retirée → 1 rouge (le seul qui discrimine : « reste valide tant que le jeton n'a pas expiré » — les tests de refus, eux, passaient pour la MAUVAISE raison) ; ancien fail-closed remis → 1 rouge. Gates : security **994** (+5), cœur **2737**, intégration http **642/9 skipped**, mémoire **9/9**, typecheck **25/25**. |
| ✅ P6.9.8 | Audience DEMANDABLE (RFC 8707) | **AUDIENCE DEMANDABLE (RFC 8707) LIVRÉE** — le client NOMME sa cible (`resource` sur le grant), l'audience cesse d'être un défaut de configuration : une application peut enfin avoir une porte MCP, une API interne et un back-office dont les jetons ne se confondent pas. `jwt.audiences` devient une **liste blanche de ressources demandables** (1ʳᵉ entrée = défaut) ; hors liste, multiple, non-URI absolue ou porteuse d'un fragment ⇒ **400 `invalid_target`** (RFC 8707 §2), jamais servi avec l'audience par défaut — un `resource` accepté puis jeté rendrait un jeton valide POUR QUELQU'UN D'AUTRE, et la faute ne se manifesterait que chez la ressource. **Une seule ressource** par jeton (§3 : plusieurs destinataires ⇒ chacun peut agir chez les autres ; la RFC prévoit qu'un serveur soit « unwilling or unable »). L'audience accordée est **stockée au record refresh et rejouée à la rotation** — une restriction qui s'annulerait au premier renouvellement n'en serait pas une. **RED-TEAM du lot, 3 vecteurs** : (a) le refus n'est PAS un oracle — le credential est vérifié AVANT la ressource, sinon un anonyme lirait la carte des ressources protégées en comparant 400 et 401 (**résiste**, désormais verrouillé) ; (b) 🔴 **la ROTATION était une porte dérobée** — `resource` était transmis au point de terminaison de refresh et **ignoré**, donc un client croyait restreindre sa portée sans rien restreindre ; fermé par le contrôle §2.2 « resources originally granted or a subset thereof » (débranchement → 1 rouge) ; (c) une `resource` non-chaîne (objet, nombre, booléen) → 400, jamais 500. Débranchements : `resource` ignoré → 5 rouges sur 12 ; liste blanche neutralisée → 1 rouge. ⚠️ **Deux débranchements ont d'abord menti** : `if (false)` rend le bloc inatteignable et casse le narrowing TS (build en échec), et la sortie du build était masquée (`>/dev/null`) — on mesurait l'ancien binaire. Constaté par une requête réelle (`aud` du jeton rendu) avant de conclure. Gates : intégration http **652/9 skipped** dont `external-jwt-e2e` **16/16**, security **994**, typecheck **25/25**. **Reste** : `resource` n'existe que sur le grant par credential (pas de flux d'autorisation — cf P6.9d). |
| ✅ P6.9.9 | Espace de noms du sujet externe | **ESPACE DE NOMS DU SUJET — FERMÉ.** Le risque était : en `require`, le `sub` d'un émetteur tiers était mappé DIRECTEMENT sur l'espace des identifiants locaux — un annuaire où l'utilisateur CHOISIT son identifiant permettait de présenter `sub: "admin"` et de recevoir le compte local du même nom, avec un jeton valide et zéro anomalie. **Cause racine, la MÊME que celle de la socket WS** : une donnée qui s'arrête à la frontière du vérificateur — `IAccessPrincipal` ne portait pas `iss`, donc l'authenticator recevait un sujet détaché de l'espace de noms qui seul le rend unique (OIDC Core §2 : `sub` n'est unique QUE chez son émetteur ; l'identité est la paire). Correction en DEUX temps : la cause (`IAccessPrincipal.issuer`, **requis** — un vérificateur incapable de dire d'où vient une identité ne doit pas pouvoir en produire une ; le typecheck a révélé les 11 sites) ET la dérivation (`subjectMapping` par émetteur, défaut **`prefixed`** ⇒ `<issuer>#<sub>`, composition pure `localIdentifierFor` — séparateur `#` **injectif** puisque RFC 8414 §2 interdit le fragment dans un `issuer`). `subject` rend l'ancien rattachement mais doit être ÉCRIT : il ne se justifie que si l'on PRODUIT l'espace de noms (l'app son propre émetteur). S'applique AUSSI en `ephemeral` — aucun compte n'y est pris, mais deux annuaires homonymes se confondaient dans l'audit, les compteurs de limitation et les canaux realtime privés. Émetteur vérifié absent de la table ⇒ **503**, jamais un rattachement deviné. ⚠️ Piège traversé : le vérificateur rendait d'abord `trusted.issuer` (forme BRUTE de la config) quand la table est indexée en forme CANONIQUE — une barre oblique terminale en config aurait suffi à provoquer un 503 systématique ; c'est `claimedIssuer` qui sort désormais. Gates : security **998** (+4), cœur **2737**, intégration http **652/9 skipped** (inchangé), typecheck **25/25**. Débranchements : composition neutralisée → **5 rouges sur 31** annoncés avant de couper (l'attaque `admin`, les deux émetteurs homonymes, le sujet connu, l'audience, l'identifiant éphémère) ; et en LIVE, décor passé à `prefixed` → **7 rouges sur 16**, tous des cas de SUCCÈS, les refus restant verts — le mapping commande donc bien le rattachement sur un vrai serveur. |
| ✅ P6.9.10 | Défi RFC 9728 — le refus devient apprenable | **DÉFI RFC 9728 LIVRÉ** (`08a3f3f8`) — le refus devient APPRENABLE : `WWW-Authenticate` porte `resource_metadata`, seul mécanisme normalisé qui dise à un client où obtenir un jeton. Le blocage n'était pas le calcul (le cœur savait déjà : `buildBearerChallenge` + `protectedResourceMetadataUrl`) mais le CONTRAT — `challenge()` ne recevait rien alors qu'une instance est partagée entre zones et que le pointeur nomme UNE ressource ; il prend désormais l'`area`, que `#setChallenge` avait déjà (même forme que `validateArea`). Aucun `error` joint : le firewall pose le défi sur TOUT 401 sans savoir si un jeton était présent, et la RFC 6750 §3 l'interdit alors (sinon le client renouvelle en boucle un jeton inexistant). **Défaut annexe trouvé en LIVE** : les descriptions partaient ACCENTUÉES dans un en-tête HTTP, qui n'est pas de l'UTF-8 (« jeton refusé » → « jeton refus? ») ; filtre au POINT DE COMPOSITION selon la grammaire RFC 6750 §3 (`%x20-21 / %x23-5B / %x5D-7E`), guillemet → apostrophe (dans la grammaire), antislash retiré — il cassait la chaîne citée et n'était pas traité. Débranchement → 2 rouges ; ⚠️ la 1ʳᵉ tentative n'en donnait qu'UN : le test « aucun `error` » restait vert sur un `Bearer` nu, qui n'en porte pas non plus — **un test purement négatif ne prouve rien**, assertion positive ajoutée. Gates : cœur **2739** (+2), security **1001** (+3), intégration http **652/9 skipped**, mémoire **9/9**, typecheck **25/25**. |
| ✅ P6.9.11 | Document de ressource protégée — le pointeur mène quelque part | **DOCUMENT DE RESSOURCE PROTÉGÉE LIVRÉ** (`fde3d850`, `71228441`) — le pointeur du défi mène enfin quelque part. `ProtectedResourceMetadataController` + `mountProtectedResourceRoutes` (`@nodefony/framework`, modèle de `mountIssuerMetadataRoutes`) publient un document par ressource DÉCLARÉE. 🔴 **La source est la MÊME que celle du défi** — les zones du pare-feu (`Firewall.publishedProtectedResources()`) — donc le pointeur et le document ne peuvent pas diverger ; et `authorization_servers` dérive de `resourceServer.issuers`, pas d'une seconde liste : publier autre chose enverrait le client demander un jeton à un émetteur dont on refuse ensuite la signature. **Le montage BALAIE le conteneur** (`collectProtectedResources`) au lieu d'interroger le seul pare-feu : un module déclare aussi ses ressources (`DevkitService.publishedProtectedResources()`), et le controller MCP dédié a été RETIRÉ — deux implémentations d'une même règle divergent, et pouvaient se disputer un chemin que `Router.createRoute` attribue au premier arrivé sans un mot. Un registre aurait imposé une dépendance d'ordre (module enregistré après `onKernelReady` ⇒ jamais publié, en silence) ; le balayage non. 🔴 **Garde d'autorité partagée avec le document d'émetteur** (`onDeclaredAuthority`, fonction pure) : un document servi sur une autorité dont la ressource ne se réclame pas est REJETÉ par un client conforme, qui s'arrête — là où un 404 le laisse continuer ; c'est la faille d'août transposée, et le MCP la portait encore (son document répondait sur n'importe quelle autorité, quand le vrai client entre par `http://localhost:5151`, cf `.mcp.json`). Le banc MCP, lui, entrait par `https://127.0.0.1:5152` — une autre porte que le client réel ; il lit désormais le document là où la RFC le fait chercher. **Débranchements, compte annoncé AVANT de couper** : montage coupé → **5 rouges sur 6** en live (absence prouvée dans le dist), balayage forcé au seul pare-feu → 2/18, garde et déduplications → 4/15 et 1/5. ⚠️ **Deux défauts que seul le débranchement a montrés** : la sonde de décor interrogeait LE DOCUMENT, donc un montage coupé faisait SAUTER la suite au lieu de la faire rougir (un skip compte comme vert — le piège de `mcp-http.test.ts` à nouveau) ; et les deux cas d'autorité étaient purement NÉGATIFS, donc satisfaits par la disparition de la fonctionnalité — chacun porte désormais une assertion positive d'abord. Gates : framework **544** (+18), security **1006** (+5), devkit **109** (10 sautés : conteneur navigateur absent, dit par le banc), intégration http **658/9 skipped** dont `http/protected-resource-metadata.test.ts` **6/6**, typecheck **25/25** |
| ✅ P6.9.12 | Plan d'administration — porte UNIQUE d'exécution | **UNE PORTE, PLUS DEUX CHEMINS.** `AdminApiController.runAdmin` était `private` : l'exécution d'un endpoint (RBAC → porte d'idempotence → handler → normalisation → traduction des erreurs) était prisonnière d'un adaptateur de TRANSPORT, pendant qu'un second chemin — `callAdminEndpoint` (cœur), qu'empruntent la commande `inspect` et le serveur MCP — refaisait le geste en dégradé. Extraite au **cœur** (`kernel/adminPlane/executeAdmin.ts`), avec le RBAC (`adminRbac.ts`, déplacé depuis framework) et la règle de rôle effectif (`resolveAdminRole` — elle vivait dans le broker, donc les portes sans Router ne la traversaient jamais). Les appelants ne diffèrent plus que par la RÉSOLUTION de l'endpoint (par nom de route côté HTTP, par namespace/chemin côté cœur). 🔴 Ce que la duplication coûtait, mesuré par l'audit MCP du user (25 appels réels, D1/D2/D6) : le producteur joint à un refus le corps qui dit quoi demander à la place — le plan d'une page dont la section est inconnue — et la porte pauvre n'en gardait que le **statut** ; un agent lisait « introuvable (404) » et concluait que la PAGE n'existait pas, l'inverse de la vérité. Le corps voyage désormais entier (`InspectResult.body`) et ATTEINT les deux portes (MCP `mcpEchecAdmin` borné à 4 ko, CLI `inspect`). L'idempotence n'a **pas** été déplacée : son second consommateur (seam `Resolver`/`@Idempotent`) est franchement framework et aucun usage ne le justifie encore — elle est passée en paramètre `gate: AdminGate | null`, où `null` est un choix qu'on lit. ⚠️ Dette bornée et ÉCRITE au code : `adminSubjects.ts` fabrique encore `roles:["ROLE_NODEFONY_ADMIN"]` — l'identité réelle de l'appelant est l'étape suivante, et c'est elle qui fera mordre le contrôle désormais appliqué. Gates : cœur **2987** (+27 neufs), framework **549**, security **1019**, typecheck des deux ; débranchement joué (corps jeté + RBAC coupé → 3 rouges). |
| ✅ P6.9.13 | L'appelant porte son IDENTITÉ jusqu'à la porte | **LE RÔLE CESSE D'ÊTRE FABRIQUÉ.** `callAdminEndpoint` posait `roles:["ROLE_NODEFONY_ADMIN"]` en dur : le contrôle d'accès s'appliquait à un sujet inventé, donc **tout porteur d'un jeton d'audience valide obtenait la lecture d'administration complète** — même sans le moindre droit (point A de l'audit `fable`). L'identité se PRÉSENTE désormais (`IAdminCaller`, 3ᵉ paramètre OBLIGATOIRE : le compilateur force chaque porte à dire au nom de qui elle appelle) : `localOperatorCaller()` pour une commande locale (qui la lance possède déjà le processus — énoncé, plus fabriqué), rôles dérivés du JETON pour la porte MCP. **Les DEUX bornes existent** : `rolesFromScopes` n'accorde le rôle qu'à un jeton portant `admin:read`/`admin:write`, et `refusedAdminScopes` empêche un non-administrateur de les OBTENIR (appliqué à l'émission, `TokenService.#grantableScopes` ; retrait plutôt que refus — RFC 6749 §3.3 — et la CLI affiche les scopes ACCORDÉS, plus les demandés). Doctrine : autorisation = droits du sujet ∩ portée déléguée ; une session cookie n'a pas de tiers donc pas de scope (**Studio inchangé, 79 verts**). 🔴 **Généricité préservée** : la règle « que vaut un appelant sur une porte MCP » vit au cœur (`mcpCallerRoles`, `src/mcp/caller.ts`) — non protégée → opérateur (son périmètre EST sa protection) · protégée + jeton → ses scopes · protégée + anonyme toléré → rien. Toute porte MCP future (modules d'agents, P12) l'appelle au lieu de la réécrire. L'exigence est PUBLIÉE (`scopesSupported` défaut = les scopes d'administration) : exiger l'invisible ferait suivre le défi jusqu'à un jeton sans scope, refusé sans que le client sache quoi demander. Défaut de la CLI = `admin:read` SEUL (`admin:write` n'ouvre rien de plus aujourd'hui, mais le jour où la distinction sera réelle, des jetons émis d'office porteraient le pouvoir d'écrire sans décision). `forbidden` devient une raison distincte de `not-found` (+ `SysExit.NOPERM`). ⚠️ **Asymétrie NOMMÉE, non fermée** : un jeton sur la porte HTTP (`ExternalJwtAuthenticator`, `subjectPolicy:"require"`) hérite des rôles du compte local sans intersecter ses scopes — les routes du plan sont montées par le broker, donc sans `@RequireScope`. Et un seul rôle ouvre les 94 endpoints : c'est du RBAC **fail-closed**, pas du moindre privilège. Gates : cœur **2997**, security **1019**, framework **549**, devkit **111** (dont banc serveur RÉEL 16/16), studio **79**, user **192**, typecheck **25/25**. Preuve sur le FIL : même compte `admin`, jeton AVEC `admin:read` → lecture servie, jeton SANS scope → refusé en nommant le rôle manquant ; débranchement joué 2× (identité refabriquée, anonyme traité en opérateur → 3 rouges unitaires + 1 rouge sur serveur réel). |
| ✅ P6.9.14 | Le plan d'administration s'ouvre en LECTURE par MCP — deux outils, jamais 98 | **DEUX OUTILS GÉNÉRIQUES** (`4dbcd164`) : `nodefony_admin_list` + `nodefony_admin_call` — coût de contexte CONSTANT au lieu des ~12 k tokens permanents qu'aurait coûtés un outil par endpoint. **68 lectures atteignables sur 98 déclarées**, sans allowlist : le catalogue naît du registre (`kernel/adminPlane/catalog.ts`), donc un producteur qui ajoute un endpoint le publie sans qu'on écrive une ligne. 🔴 La règle est UNIQUE — **ce qui est listé est appelable, et rien d'autre** : `admin_call` ne re-décide rien, il cherche l'entrée dans le catalogue que `admin_list` rend (même patron que le filtrage des outils à la collecte ; deux points de décision, c'est celui qu'on relit le moins qui devient permissif). Trois exclusions, toutes COMPTÉES donc dicibles : 27 mutations (la porte d'idempotence vit dans le transport HTTP — les exécuter d'ici ferait la 4ᵉ voie divergente que l'unification vient de supprimer), 3 self-service `public:true` (scopés à `request.user`, qu'une porte sans session n'a pas), et ce que le rôle n'ouvre pas. **Défaut LATENT corrigé** : `callAdminEndpoint` résolvait par le seul CHEMIN alors que 8 chemins portent 2-3 méthodes (`users/{id}` GET+PATCH+DELETE) — le premier déclaré gagnait, lecture aujourd'hui *par chance*. Le catalogue publie aussi les capacités de page ÉVALUÉES (tri, filtres, recherche) : le plan REFUSE en 400 ce qui n'est pas déclaré. **RED-TEAM (`53a297b4`, 21 vecteurs threat-first sur les PONTS)** — 2 failles trouvées, fermées, re-prouvées : (a) le pont distant recopiait `error.message` d'un handler qui lève, quand HTTP rend « Internal admin handler error » — chemin de disque et requête fuyaient par MCP ce que HTTP masque, sur les mêmes handlers (la cause voyage désormais dans `InspectResult.cause`, publiée par le seul appelant LOCAL) ; (b) l'évaluation des capacités pouvait lever et emportait le catalogue ENTIER — un module en panne fermait `admin_list` ET `admin_call` pour toute l'application (le MÊME défaut vivait dans le catalogue HTTP de Studio, fermé aussi). 🔴 **Découvrabilité** (`c1c25ae2`) : `requiresAuth` ne regardait que la façon dont l'identité est prouvée — sur une porte non protégée, l'opérateur (à qui `inspect` rend DÉJÀ `config` et `stores`) se voyait refuser des données moins sensibles, et la capacité était inatteignable dans le mode nominal. On retient désormais sur ce que l'appelant PEUT. Les `instructions` d'`initialize` récitaient par ailleurs une liste d'outils ÉCRITE (elle taisait `docs` depuis 2 sessions) — dérivée. **Les 7 défauts de l'audit du user sont SOLDÉS et prouvés en appels MCP RÉELS** (`bfc358f5`, `6b761ed4`) : refus qui joignent `available`, paquet INSTALLÉ mais non chargé servi (`resolveDocDir`), clé courte acceptée par `symbols`, rang par DENSITÉ (un tableau de bord ne gagne plus par sa taille) et extraits choisis sur la COUVERTURE, `limit` transmis, bornage annoncé. Périmètre fermé au passage : la porte doc servait n'importe quelle dépendance npm (`chrome-launcher`) — `PACKAGE_NAME` bornait la traversée, pas le périmètre ; et l'homonyme `redis` du registre npm gagnait sur `@nodefony/redis`. **Argument inconnu REFUSÉ** dans `callMcpTool` (une règle, tous les outils). Gates : cœur **3059**, framework **558**, security **1019**, devkit **112**, typecheck **25/25**. |
| ✅ P6.9.15 | La porte publie ce qu'elle EXIGE — et ne punit plus qui présente MAL | **`scopesSupported` DÉRIVÉ** (`d2bd59ca`) — le point « non négociable » du plan MCP. La clé de configuration `mcp.authorization.scopesSupported` est SUPPRIMÉE : ce que la porte publie (RFC 9728 `scopes_supported`) et nomme dans son défi (RFC 6750 `scope`) est l'union des `IMcpTool.scopes` des outils DÉCLARÉS (`mcpDeclaredScopes`, cœur ; `DevkitService.declaredMcpScopes()`, deux lecteurs une source). Elle mentait dans les DEUX sens sans qu'aucun contrôle ne l'aperçoive — elle publiait `admin:write` qu'AUCUN outil n'exige (catalogue en lecture seule ⇒ le client demandait un droit qui n'ouvre rien) et TAISAIT le scope de tout outil déclaré par un module : mesuré sur ce dépôt, `test:secret` manquait au document, la liste vivant dans la config du devkit et l'outil dans un autre paquet. Pour publier un scope, il se pose désormais sur l'outil qu'il ouvre — le seul endroit où il a un EFFET. Au cœur, la traversée est extraite plutôt que recopiée : `declareMcpTools` (question sur le CODE) / `collectMcpTools` = son filtre par appelant (question sur une REQUÊTE) / `mcpDeclaredScopes` = union triée. Le vocabulaire ne dépend PAS de l'appelant, et c'est le point normatif : le document se lit SANS jeton, un catalogue filtré n'annoncerait à l'anonyme que ce dont il n'a pas besoin — il ne demanderait jamais de jeton. 🔴 **Et un défaut trouvé par le USER en s'en servant** (`741dcb84`) : **présenter MAL valait moins que ne rien présenter**. Un client dont l'en-tête portait un jeton expiré, une chaîne illisible ou un gabarit `${NF_MCP_TOKEN}` non substitué recevait `401`/`400` et **AUCUN outil**, quand le même client muet recevait les 6 publics — et un client MCP marque alors le serveur « failed » pour TOUTE la session, donc un jeton périmé coûtait l'outillage entier. `readBearerHeader` distingue les trois façons de ne rien porter (absent · `Bearer` vide · autre schéma) : le `Bearer` vide cesse d'être « mal formé » (RFC 6750 §3, « lacks any authentication information »), seul un AUTRE schéma reste un 400 ; et un jeton REJETÉ sur une porte `allowAnonymous` est servi en ANONYME (`rejected` → journal `WARNING`), jamais en 401 — aucun privilège accordé, les réservés restent retenus, la liaison d'audience RFC 8707 garde son mordant, elle n'est plus une porte qui claque (`anonymous:false` en prod ⇒ 401 inchangé). Un gabarit non substitué est DIT avec le geste à faire. Débranchement joué (ancienne liste écrite remise → 4 rouges sur 5 cas neufs) ; preuve sur l'artefact REÇU — document servi par la porte réelle (`admin:read` + `test:secret`, jamais `admin:write`), et les 3 cas d'en-tête rendent 200 + 6 outils là où ils rendaient 0. Gates : cœur **3071**, devkit **114**, security **1019**, framework **558**, typecheck **25/25** |
| ✅ P6.9.16 | Le CÂBLAGE d'un agent se choisit, et une app générée peut enfin ouvrir SA porte | **L'AGENT se choisit, la porte MCP vient AVEC** (`fbe3b92c`, `5c11a658`) : `create app` demandait de câbler un protocole — personne n'installe un protocole, on se sert d'un assistant. La question vit dans la SPEC (`agents`, type `list`), donc au terminal, en flags (`--agents`) ET dans **Studio**, qui n'en montrait rien : trois fronts, une source. Ce qui autorise l'écriture chez un tiers n'est plus « un humain est devant un terminal » mais un **choix EXPLICITE** — reformulation nécessaire pour que Studio (sans TTY) puisse le servir ; rien n'est coché par défaut, rien de coché ⇒ rien d'écrit. Un choix « autre agent conforme aux standards ouverts » existe : les 4 outils pilotables ne sont pas le monde. 🔴 **Trou produit fermé** (`ce931e99`, `73815ed4`) : **une application générée ne pouvait pas obtenir le jeton de SA porte** (`invalid_target`) — le gabarit n'avait AUCUN bloc `jwt` (ni `audiences`, ni `keystore.dir` : la clé éphémère aurait fait refuser le jeton par le serveur, second piège qui n'aurait surgi qu'après le premier). Le dépôt, lui, marchait grâce à `src/modules/test` qui déclarait `security.jwt.audiences` pour toute l'application — un module de BANC s'était arrogé une décision d'APPLICATION, et c'est ce qui rendait le trou invisible ici. L'audience remonte au `nodefony.config.ts` racine et suit les PORTS configurés (lire `ctx.env.NF_PORT` n'est pas dériver du `Host`). Preuve EXÉCUTÉE : le banc de vérité gagne une étape qui émet le jeton dans l'app générée et lit l'audience INSCRITE — **15/15**. **Gemini CLI ne voyait RIEN** d'une app Nodefony (`2ecd99cc`) : ce que chaque agent lit est désormais une donnée de la table, ancrée dans son SOURCE (Codex `agents_md.rs`, Vibe `conventions.py`, Gemini `memoryTool.ts`, Claude Code MESURÉ — sa doc et son binaire se contredisent), et un pointeur générique naît pour chaque dialecte non natif. Gate neuf : **une question de spec qu'aucun drapeau ne sert est inatteignable pour un script** (`11eb022d`, vu rouge : il cherchait « argument inconnu » quand le code dit « option inconnue »). |
| ✅ P6.9c | Passkeys / WebAuthn (FIDO2) | `@simplewebauthn` lazy, stores memory/file/Drizzle/Mongoose/Redis, 34 tests (J9) |
| ⬜ P6.9d | **Serveur d'autorisation OAuth 2.1** (code flow + PKCE) | **NON FAIT — TRANCHÉ (décision user) : APRÈS la release 10.0.0.** Conséquence assumée : la 10.0.0 sort avec un MCP dont la SÉCURITÉ est complète et prouvée, mais dont le jeton s'obtient hors bande (collé à la main). Ce report DÉPLACE la charge sur la documentation — expliquer comment obtenir et poser le porteur — et rend prioritaire une portée de jeton qui ne meure pas en 15 min (P6.12 API Keys/PAT est livré : vérifier si la porte MCP les accepte, ce serait l'ergonomie SANS P6.9d). Nodefony ÉMET des jetons et publie de quoi les vérifier (RFC 8414 + JWKS, `5c9f1c37`), mais n'offre aucun **flux d'obtention** normatif : ni `authorization_endpoint`, ni `token_endpoint` RFC 6749 (le grant maison est un POST JSON, pas un `grant_type` form-urlencoded). Conséquence CONSTATÉE sur un vrai client : le SDK MCP exige les deux champs dans le document de découverte et refuse la connexion — le document est pourtant LÉGAL sans eux (RFC 8414 §2, « REQUIRED unless no grant types are supported that use the authorization endpoint »). Ce qui manquerait : `/authorize` (code flow, `code_challenge` S256 obligatoire OAuth 2.1), `/token` (échange du code, refresh), consentement, enregistrement de client (RFC 7591 pour le dynamique), `resource` RFC 8707 sur les deux requêtes. **Ce n'est PAS un prérequis du MCP authentifié** : la spec MCP impose le porteur (`Authorization: Bearer`, MUST à chaque requête) mais pas le moyen de l'obtenir, et un jeton émis hors bande satisfait « issued by the MCP server's authorization server » quand le serveur MCP est lui-même l'émetteur. C'est un prérequis pour un client qui doit obtenir son jeton SEUL, sans intervention humaine |
| ⬜ P6.9b | `MTlsAuthenticator` | zones admin (niche, non démarré) |
| 🔶 P6.10 | Logs auth + CSP stricte + headers | J5-A `SecurityHeaders` (CSP + Referrer + COOP/COEP/CORP + Permissions-Policy) ; reste logs auth dédiés |
| ✅ P6.11 | Tests intégration security complets | 23 fichiers test + 7 bancs E2E live ; chantier red-team (matrice d'attaque par brique) |
| ✅ P6.12 | API Keys (PAT) | `2c3e252c` : `ApiKeyAuthenticator` (`nf_…` CRC anti-DoS, sha256, révoqué/expiré) |
| ✅ P6.13 | Webhooks (backend + data plane + stores ORM + Studio) | **COMPLET** `4d9006c5`→`486eb75b` — SSRF+secret chiffré+dispatcher Standard Webhooks v1+livraison bornée anti-DoS ; data plane `WebhookAdminApi` (broker) + stores Drizzle/Mongoose + page Studio + livraisons récentes + récepteur sink ; e2e live 25/25, 765 security. [[project_p6_webhooks_slice_c_kit]] |
| ✅ P6.14 | Audit events + stream WS | `6f028fbe` : `IAuditEvent` + `MemoryAuditStore` FIFO + query curseur (lots 1-4) |
| 🔶 P6.15 | Studio — section Sécurité | Pages LIVRÉES : Sessions/Users/API Keys/Firewall/Audit/Profil self+admin (`8d54bf4a`→`486eb75b`) ; reste live `security:audit` (canal OFF) |
| ✅ P6.17 | 2FA / TOTP (step-up login) | `e5d47a73`→`52a18811` : RFC 6238 step-up du login mot de passe + Studio + passkeys CRUD |
| ✅ P6.18 | Audit — store PERSISTANT (dette de P6.14) | `audit.driver` pluggable via `auditStoreRegistry` + **`DrizzleAuditStore`** append-only (curseur exact `(ts,id)`, gc rétention) — **porté sqlite+pg+mysql via S3/S4 multi-dialecte** (`40fa5aba`/`0ac019ef`, e2e PG+MySQL réels). Adapters mongoose/redis = CHOIX différé (couverture « adaptée, pas parité ») |
| ⬜ P6.16 | WebAuthn — `rpId` dynamique par Host (multi-vhost) | `#rpID` figé au boot (`webAuthn.ts`) → dériver du `Host` de la requête |

### P7 — ORM Drivers (64 %) ◀ **BLOQUEUR RELEASE** — multi-dialecte sqlite/pg/mysql = condition de release ; **comparatif froid ✅ (`a370b5a1`) → Drizzle CONFIRMÉ**, portage débloqué (`orm-comparatif-froid-2026-07`, mémoire IA `core-dev/audits/`)

<!-- prettier-ignore -->
| # | Tâche | État |
| --- | --- | --- |
| ⏭️ P7.1 | ~~Sequelize (legacy)~~ | **SUPPRESSION COMPLÈTE** (virage ORM, `716fce6`) |
| ✅ P7.2 | Mongoose — adapter orm-core | **refait (Ph.2)** : `MongooseService extends Service` + `describeConnection`/flow tap |
| ⏭️ P7.3 | ~~Tests intégration Sequelize~~ | caduc |
| ✅ P7.4 | ⭐ **`@nodefony/drizzle`** (référence) | `DrizzleOrm`/`DrizzleRepository`, 8 tests |
| 🔶 P7.5 | Tests Mongoose | **156 verts / 12 fichiers contre un MongoDB 8 RÉEL** (docker `--profile mongo`, replica set — mesuré 07-23 ; `MONGO_GATE` pose `MONGO_TEST_URI`, `gateReporter` confirme « cible exercée »). Les 5 briques déclarées sont exercées par LEUR store : session 37 · webhooks 20 · jetons 24 · passkeys 24 · user 17 · orm-core 13 · transactions/eager-load/cycle de vie 14. ⚠️ **La mention « 0 E2E / memory-server seulement » qui figurait ici était FAUSSE** — corrigée en la LANÇANT (le décor docker existe depuis le début ; `mongodb-memory-server` n'est que le repli hors ligne). **Reste** → tout est porté par **P7.11** : parité de contrat (4 suites partagées ne tournent que sur drizzle) et E2E système (aucun serveur Nodefony bootté sur Mongo — les bancs montent les services à la main, sans Kernel). Étude complète : mémoire IA `project_orm_multidialect_chantier_kit` |  |
| ✅ P7.6 | Tests Drizzle (SQLite/PG) | banc orm-core 8 tests |
| 🔶 P7.7 | `@nodefony/redis` refactor | conventions/config Zod faites |
| 🔶 P7.10 | ⭐ **Portabilité multi-dialecte (CRITIQUE RELEASE)** | **Slice 0 + S1→S4 ✅** (`5bcd2d7f`→`0ac019ef`, 06-26→07-08) : `connector.dialect` sqlite/postgres/mysql, repository **PK-portable**, **colKit** (spec logique → table du dialecte, G1) + **queryKit** (SQL natif routé : `json_each`/`@>` jsonb/`JSON_CONTAINS`, bindé), chemins sans-RETURNING mysql, idempotence `INSERT IGNORE`+vol, `mysqlJsonCompat` (LONGTEXT MariaDB). **LES 8 BRIQUES × 3 DIALECTES** — preuves : **drizzle 274/274** dont **banc de parité de contrat `IRepository` 14×3** + 41 e2e PG réel + 33 e2e MySQL 8.4 ET MariaDB 11.4 (gatés `NF_PG_URL`/`NF_MYSQL_URL`). Comparatif froid ✅ Drizzle CONFIRMÉ (`a370b5a1`, garde-fous G1-G3). **Reste : S5 DDL prod** — design ✅ VALIDÉ 07-10 (`orm-migrations-design-2026-07`, mémoire IA `core-dev/audits/` : drizzle-kit + applicateur MAISON `DrizzleMigrator`, table `nodefony_migrations(source,tag)`, lock natif, modes ddl auto/migrate/none), **implémentation GELÉE → après P8+P11** (lots S5a-d). Détail-journal = `git log` + `project_orm_multidialect_chantier_kit` |
| ⏭️ P7.8 | ~~`@nodefony/mikroorm`~~ | **abandonné** (jamais commencé, module absent) |
| ⏭️ P7.9 | ~~Tests MikroORM~~ | caduc |
| ⬜ P7.11 | 🔴 **FULL NoSQL — 3 stores mongoose + parité de contrat** | **Objectif tranché 07-23 : une app doit tourner SANS `@nodefony/drizzle`** — mongoose est un chemin durable, donc complet 8/8. Manquent `totp`, `audit`, `idempotency` : aujourd'hui `auto` se replie sur `memory` (secrets 2FA perdus au redémarrage, journal d'audit volatil). Détail → snapshot mémoire IA + git log. |

> ✅ **Gap intégration SQL COMBLÉ (S1-S4)** : e2e **PG réel** (41, gatés `NF_PG_URL`) + **MySQL/MariaDB réels**
> (33, `NF_MYSQL_URL`) + boot serveur réel (users/session drizzle) + e2e PG cross-pod (Slice 0).
>
> ⚠️ **Correction 07-23 — le « gap mongoose » décrit ici était FAUX.** Il annonçait « `mongodb-memory-server`
> seulement, 0 E2E contre un MongoDB Docker persistant » : la suite tourne en réalité contre un **MongoDB 8
> docker en replica set** (profil `mongo`, `MONGO_GATE`), **156 tests verts**, session comprise (37).
> Corrigé en LANÇANT la suite, pas en relisant le tableau — cf **P7.5** et l'étude complète (mémoire IA
> `project_orm_multidialect_chantier_kit`). Ce qui reste est plus précis et plus utile : **parité de
> contrat** (4 contrats partagés ne tournent que sur drizzle) et **E2E système** (aucun serveur Nodefony
> bootté sur Mongo). ⭐ Le mot « E2E » recouvrait deux choses — « contre un vrai serveur de base » (fait)
> et « à travers le framework bootté » (absent) : toujours dire lequel.
>
> ⚠️ **Correction 07-23 — « mongoose 5/8 = CHOIX » était FAUX.** La règle « couverture adaptée à la
> nature, pas parité SQL×NoSQL » reste juste pour un **cache** ; elle avait servi à couvrir un trou sur
> un chemin **durable**. Le bon critère n'est pas la nature de chaque brique mais : **peut-on tourner
> sans drizzle ?** Un backend durable est un chemin complet ou n'en est pas un — un utilisateur choisit
> sa base de données, il ne choisit pas de perdre le 2FA, l'audit ou l'idempotence. `totp`, `audit`,
> `idempotency` côté mongoose = **trou**, planifié en **P7.11** (objectif : full NoSQL, 8/8). Ce qui
> reste un vrai choix : `redis` sans `user`/`audit`/`webhooks` — pas parce qu'il « évince », mais parce
> que ces données croissent sans borne, se conservent des mois et se consultent (la RAM n'est pas leur
> support). `redis` gagne en revanche `totp`, au régime opt-in de ses `tokens`/`passkeys`.

### P8 — CLI + Monitoring (88 %)

<!-- prettier-ignore -->
| # | Tâche | État |
| --- | --- | --- |
| ✅ P8.1 | `bin/nodefony.ts` | banner rolldown (shebang), CLI fonctionnel + **complétion shell bash/zsh/fish** (`completion [install\|uninstall]` + `__complete` standalone 0-boot, manifest cache — commandes de module incluses ; install = bloc rc marqué idempotent/réversible) + **`man nodefony`** (`f8679d46` — page GÉNÉRÉE depuis commander, 3ᵉ porte de la même source que `--help` et la complétion ; champ npm `man`, gate de fraîcheur `scripts/generate-man.mjs --check`, Windows sans `man` natif ÉNONCÉ). 🔴 **Le manifest s'autodétruisait** (`fa7bc4b9`) : `writeFile` en fire-and-forget tronquait le fichier à **0 octet** quand le process sortait — chaque commande détruisait le cache de la précédente, d'où menu amputé ET complétion fausse ; temporaire + `rename`. Écriture élargie aux commandes ponctuelles (`9dbfb468`, profil et non environnement) et TAB **0,46 s → 0,14 s** (fast-path AVANT le chargement du cœur) |
| ✅ P8.2 | Generators Module/Controller | **commande CLI `nodefony create` livrée** — 7 types (`app/module/controller/service/front/entity/command`, `CREATE_TYPES` `src/nodefony/src/cli/create.ts`) + skills scaffold (vérif audit 08-06) |
| ✅ P8.3 | `DebugBar` (monitoring) | `src/nodefony/src/client/debugbar/` |
| 🔶 P8.4 | `Metrics` runtime | via Studio (ticker stats → canal `nodefony:supervision`, `studio/nodefony/realtime/providers.ts`), pas service standalone ; `/metrics` Prometheus = 16.J repoussé |

### P9 — Polish + clôture (75 %)

<!-- prettier-ignore -->
| # | Tâche | État |
| --- | --- | --- |
| ✅ P9.1 | `@entities` decorator + tests | `kernelDecorator.ts` |
| ⬜ P9.2 | Barrels `index.ts` | résiduel |
| ✅ P9.3 | README publics | http + framework + security présents (vérif 06-28) |
| ✅ P9.4 | Vulnérabilités npm | **0 vulnérabilité** (`npm audit`, 08-20 `42147fc3`) · **0 alerte Dependabot** · code scanning en `security-extended` (89 → 105 requêtes) : 4 TOCTOU `js/file-system-race` fermés (`3559d32e`), restent 2 `medium` `js/file-access-to-http` dev-only. 46 deps montées ; `typescript` 7 ÉCARTÉ (= palier P3 décorateurs, pas un bump) |

### P10 — Studio admin web (84 %)

<!-- prettier-ignore -->
| # | Tâche | État |
| --- | --- | --- |
| ✅ P10.1 | Stack frontend (React 19) + Vite | acté |
| ✅ P10.2 | `IAdminApi` + `AdminBroker` | contrat figé, inversion de dép |
| ✅ P10.3 | `IAdminApi` http/framework/syslog/frontend | 5 producteurs, data plane `/nodefony/<m>/api/*` |
| ✅ P10.4 | `IAdminApi` user/orm-core/security | livrés — `SecurityAdminApi.ts` + `UserAdminApi.ts` + orm (vérif code 07-10) |
| ✅ P10.5 | Backend Studio + WS realtime | StudioController + JSON-RPC pub/sub + broker IAdminApi complet (7 producteurs) |
| 🔶 P10.6 | Auth admin (`ROLE_NODEFONY_ADMIN`) | rôle actif sur `/studio/api/create/*` (`@IsGranted`, `StudioCreateController.ts`) ; reste : le généraliser à toute la surface `/nodefony` (vérif audit 08-06) |
| ✅ P10.7 | Frontend bootstrap + router + layouts | React 19 + Mantine + MobX + WS permanent + auth réelle (P6) |
| ✅ P10.8 | Vues prio (dashboard/routes/sessions/users) | Dashboard/Modules/Routes/Cluster/Runtime/Sessions/Users ✅ livrées |
| ✅ P10.16 | Docs+API modules dans Studio | onglets Docs/API + carte Core (ex-`P10.x`, renuméroté pour entrer au comptage) |
| 🔶 P10.9 | Vues firewall/logs/databases/migrate | Logs ✅ (WS) + Databases ✅ + Firewall ✅ (cf P6.15) ; reste migrate (S5d, gelé) |
| 🔶 P10.10 | Vues services/profiling | incrémental (~~pm2~~ retiré C6) |
| ⬜ P10.11 | Tests intégration studio | 0 test studio (vérif 06-28) — back couvert e2e via security |
| ✅ P10.12 | Workspace composable (bureau) | fenêtres libres + espaces nommés + Mission Control + catalogue à facettes (taxonomie tags) + widgets supervision (mémoire/handles/erreurs/health/gc) ; remplace dashboard Dev |
| ✅ P10.13 | Jumeau vivant (Twin) | explorateur archi runtime + registre de blocs unifié + forages Realtime/ORM/HTTP |
| ✅ P10.14 | Portail doc (`@nodefony/documentation`) | DocLayout/MarkdownDoc/FlowGraph + data plane `/nodefony/documentation/api` (COMPLET, 14 src) |
| ✅ P10.15 | Écran Stores (persistance runtime) | `a6ec2dec`→`2014e0e3` (0.8 lot 6 + Palier 3) : couverture DÉCLARÉE par adapter (« adaptée, pas parité »), endpoint réseau redacté, emplacement physique (`kernel.varDir`), brique user 1ʳᵉ classe, provenance → fichier réel |

### P11 — CLI par module (50 %)

<!-- prettier-ignore -->
| # | Tâche | État |
| --- | --- | --- |
| 🔶 P11.1 | Tests intégration commandes existantes | filet spawn livré (`RUN_CLI_BOOT=1`) + **renforcé `0b883854`** (typo=EX_USAGE 64, happy-path commande de module `http:network` 1-Kernel/0-serveur, point d'arrêt `onReady`, `status` standalone 0-Kernel) ; **refacto parse-pur `4a7d46ae`** (resolveCommand point unique, `runProfile` déclaratif → commande de module SERVER possible, `finishOrPark` uniforme) ; **lancement détaché natif `be9ca8b2`** (`--detach --wait --health`, fast-path standalone, `start.sh` = wrapper mince) ; reste commandes métier |
| ⬜ P11.2 | Commandes `http:*` | couplée API admin Studio |
| 🔶 P11.3 | Commandes `framework:*`/`security:*`/`user:*` | **`security:secrets` ✅ (`ac095e38`→`faa743eb`)** : génère les clés (TOTP/webhook/CSRF, 32 o base64) + câblage 3 fichiers `.env.local`→`env.ts`→`use()`, détection par clé, `--write` gardé (refus si tracké git) — référencée par les 3 warnings « clé ÉPHÉMÈRE » ; **`security:user:add` ✅ (`4ac7245e`)** : création de compte (hash Argon2id via UserService, prompt masqué TTY, `--admin` = rôles Studio), fix kernel `finishOrPark` console à `onPostReady` (process fantôme). Reste `framework:*` + `user:*` métier (dont `security:user:password`) |
| ⬜ P11.4 | Commandes `orm:migrate/…` | **design ✅ 07-10** (`orm-migrations-design-2026-07`, mémoire IA `core-dev/audits/`) : `orm:migrate`/`:status`/`:baseline`/`:repair`/`orm:generate --custom` — applicateur MAISON `DrizzleMigrator` (~~délégation aux CLI ORM natifs~~ REJETÉE : migrator drizzle prouvé insuffisant au code) ; implémentation = chantier S5 drizzle (S5c), après P8+P11 |
| ⬜ P11.5 | Commandes `logs:tail/filter` + bridge Studio | LB.3b |
| ✅ P11.6 | Boot UX dev — BootReporter + diagnostic (`58c15d8`/`74b4c8c`/`b140855`) | spinner/checklist dev-only + help modules + Vite checklist ; **diagnostic de boot** : `BootReport` (vérité unique) + **garde-fou 0-serveur** → CRITIC + `terminate(EX_UNAVAILABLE)` (visible k8s + DevSupervisor, plus de mort silencieuse) + résilience par-entrée `loadModulesFromManifest` ; **boot pro** : serveurs `➜ HTTP/HTTP2/WS/WSS` URLs cliquables, digest **Modules**, section **Données** (ORM `describeConnection` sans credential, via canal neutre `reportBootLine`), gate TTY `kernel.isTTY`, rien sur les commandes ; `await onServersReady` ; **bilan de FIN de boot (`e8cca076`)** : bloc « Bilan » du verdict (modules ignorés policy/when AVEC raison via `modulesGated`, échecs fail-soft, topologie process pid+RSS scopée projet, journal WARNING/ERROR du ring figé à postReady) — même `IBootReport` pour le futur endpoint Studio ; complétion TAB des arguments positionnels (`c48ce8be`) |
| ✅ P11.7 | Commande `proxy:generate nginx\|haproxy` (`6ac8562`) | dérive la conf de l'introspection (statiques, domaines sans IP, ports) ; nginx résout le trou statics multi-modules (chaîne `try_files`) ; haproxy proxy + Forwarded + `--reencrypt` ; générateurs purs (12 tests) |
| ✅ P11.8 | Préfixe natif statique + CDN (`e735544`/`29203c1`/`6918f89`) | `server-static.mountModulePublics` monte `public/` de chaque module sous `/<module>/` (configurable `publicMount`, défaut basename) ; `frontend.assetBaseUrl` + helper `asset()` préfixent les URLs prod (CDN) sans toucher au mount ; commande `assets:publish` assemble l'arbre `dist-assets/` (carte préfixe→dossier, provider-agnostic, 0 dep cloud) |

### P12 — Couche IA agentic (14 %) — 🧪 différé (dernière phase de la roadmap, cf skill `nodefony-roadmap`)

> Section créée à l'audit 08-20 : le bandeau comptait P12 sans qu'aucune section n'existe.
> État VÉRIFIÉ au code (sources hors dist ; règle « ne pas auditer/supprimer sans demande »).
> ⭐ Acquis structurel : le protocole MCP, ses gardes et son catalogue vivent **AU CŒUR**
> (`src/nodefony/src/mcp/`, livré lot 7 devkit) — P12.6 n'aura pas une ligne de protocole à écrire.

<!-- prettier-ignore -->
| # | Tâche | État |
| --- | --- | --- |
| 🔶 P12.1 | `@nodefony/llm` | module réel (11 src, tests **vitest** `130f7386`) — non intégré au kernel |
| ⬜ P12.2 | `@nodefony/vector` | 7 src, tests `bun:test` inertes (aucun script `test`) |
| ⬜ P12.3 | `@nodefony/rag` | 7 src, tests `bun:test` inertes |
| ⬜ P12.4 | `@nodefony/memory` | 6 src, tests `bun:test` inertes |
| ⬜ P12.5 | `@nodefony/agent` | 5 src, tests `bun:test` inertes |
| 🔶 P12.6 | `@nodefony/mcp` | module vide (0 src, pas de package.json) MAIS protocole/gardes/catalogue déjà AU CŒUR + porte éprouvée (devkit lot 7, P6.9.1→9.4) |
| ⬜ P12.7 | `@nodefony/agent-guard` | vide (0 src, pas de package.json) |

### P13 — Realtime distribué (77 %)

> **5 seams sécurité (P13.4a/4b/4c/7a/8a) tous ✅** → P6 se branchera sans refonte. Setup infra docker (Redis/Kafka) livré.

<!-- prettier-ignore -->
| # | Tâche | État |
| --- | --- | --- |
| ✅ P13.0 | Rapatriement framework → `@nodefony/realtime` | cycle cassé, 10 src + 5 tests `git mv` |
| 🔶 P13.1 | TCP/UDP/Unix sockets | scaffold ; code protocoles reste (niche différable) |
| 🔶 P13.2 | `@nodefony/redis` refactor | fondation conventions faite ; **cloison des clés par application** `e43530ae`+`2820a219` (`keyNamespace` — sessions, jetons, WebAuthn, idempotence) ; 110 tests |
| ✅ P13.4 | `IRealtimeHub` + `RealtimeService` | façade + `defineRealtimeConfig` Zod |
| ✅ P13.5 | `RedisBackplane` | **prouvé cluster live -w2** ; registre drivers ; **bus authentifié (sceau HMAC) + banc multi-apps** |
| ⬜ P13.6a | `KafkaBackplane` (driver seul) | 4 briques réutilisées telles quelles ; seam transport injectable, 0 dep ajoutée |
| ⬜ P13.6b | Module `@nodefony/kafka` | connexions + config + santé ; **attend un 2ᵉ consommateur** (bus events métier / P12 agents) |
| ✅ P13.7 | Protocole JSON-RPC 2.0 + types partagés | RPC bidirectionnel ; long-polling droppé |
| 🔶 P13.8 | Décorateurs `@RealtimeAction`/`@RealtimeChannel` | 3 décorateurs livrés ; reste pattern RegExp |
| ✅ P13.9 | Tests cluster simulé (IPC) | e2e `child_process.fork`, 5 tests |
| ✅ P13.10 | Granularité + cadence AIMD | différenciateur, client-driven |
| ✅ P13.11 | Sonde « socket Nodefony » | `RealtimeHub.probe()` + endpoint health |
| ✅ P13.12 | Namespace `nodefony:` des canaux de plateforme | `e24692f7` — 9 namespaces → **1** ; table isomorphe `platformChannels.ts` + gate pre-commit anti-littéral |
| ✅ P13.13 | Révocation realtime par MODE d'authentification | `b20c9640` — le mode agent (JWT/clé) ne s'appuie plus sur une session ; scopes propagés à la socket (élévation de privilège fermée) |
| ✅ P13.14 | Harnais de test publié `@nodefony/realtime/testing` | `21f74bf0` — `createRealtimeHarness` : ~100 l. de plomberie framework (faux `ContextType`, pont `handleRealtime`, reset du hub, identité) sortent des apps ; `create controller --kind realtime` pose son test |

> **Dettes backplane multi-pod / multi-app** (détail : [`@nodefony/realtime` — configuration](src/packages/@nodefony/realtime/docs/configuration.md)) :
>
> - ✅ **#1 + #2 RÉSOLUES (`c082560`, 2026-06-12)** : `resolveBackplaneOriginId()` = `(POD_NAME ?? hostname):pid` (anti-écho fiable cross-pod k8s) + champ `backplane.namespace` (Zod) → canal `nodefony:realtime:<ns>` dérivé de `kernel.projectName` (fin du cross-talk multi-app Redis mutualisé). +9 tests.
> - ⬜ **#3 (moyenne)** Frontière inter-module des canaux — le mécanisme livré n'est PAS celui du design de 2026-06-05 : realtime **déclare** (`RealtimeHub.registerChannelPolicy()`) et security **décide** (`buildFrameAuthorizer()`) ; il n'a jamais existé de garde `#channelAllowed`. La dette restante : le registre est global et indexé par NOM, donc un module peut redéclarer le canal d'un autre avec une politique plus faible. Détail : `realtime-module-isolation-2026-06-05` (mémoire IA `core-dev/audits/`).
> - ⬜ **Banc de conformité ventilation** (prouve le drop-in `IBackplane`) : scénarios paramétrés par driver (loopback/IPC/redis/kafka), comportement identique. Matrice : audit isolation § Banc de conformité.

> **P13.6 — cadrage Kafka** (design complet : mémoire IA `project_kafka_backplane_kit`) : le coût n'est PAS
> le driver. Quatre briques se réutilisent telles quelles — admission par canal (elle vit dans le **hub**,
> aucun driver ne s'y soustrait), sceau HMAC (`envelope.ts`, déjà mutualisé pour les transports partagés),
> `originId` anti-écho, file d'envoi bornée (`publishQueue.ts`). Ce qui change est la **sémantique** : Kafka
> est un journal persistant partitionné, pas un pub/sub éphémère → **un groupe de consommation par pod**
> (sinon les partitions se répartissent et un message broadcast n'atteint qu'UN pod — fan-out cassé en
> silence) et lecture depuis `latest` (jamais `earliest` : le port est at-most-once, le client
> re-synchronise). Le vrai coût est **P13.6b** : Redis a un module qui porte connexions/config/santé,
> Kafka n'en a aucun. D'où la séparation — 6a livre le driver avec un seam injectable (l'app câble son
> client, 0 dépendance ajoutée à realtime, testable sans infra) ; 6b ne se déclenche qu'avec un **2ᵉ**
> consommateur. Choix de bibliothèque volontairement **reporté** au banc de 6a (le seam le rend
> indolore). ⚠️ Tant que 6a n'est pas livré, le littéral `"kafka"` reste **interdit** dans le registre de
> drivers (`backplaneRegistry.test.ts` le garde) : pas de nom mort.

### P14 — Frontend Vite + Core isomorphe (81 %)

<!-- prettier-ignore -->
| # | Tâche | État |
| --- | --- | --- |
| ✅ P14.1 | Interfaces + décision Vite | — |
| ✅ P14.2 | Preset `vue3-vite` | + module test-frontend-vue |
| ✅ P14.3 | Preset `react19-vite` | + Fast Refresh |
| ✅ P14.4 | `ViteProcessSupervisor` | child process isolé, résilience ; **repli de port réparé (`6ca77b2f`)** : le retry sur `port+1` existait mais l'échéance de démarrage le contournait (un vite qui annonce « Port 5173 is already in use » puis reste pendu sortait en `timeout after …`, libellé que le détecteur ne reconnaît pas) → `startupTimeoutMessage` y reporte le constat, en fonction pure ; 1ᵉʳ test du conflit de port en vrai spawn (2 superviseurs, même port de base) |
| ✅ P14.5 | Build prod (manifest) + statique | page blanche prod/cluster résolue (`renderProdTags`) |
| ✅ P14.6 | Multi-module frontend | N bundles cohabitent |
| 🔶 P14.7 | CLI `frontend:create/build/dev` | commands existent (bug CLI) ; skill scaffold ✓ |
| ✅ P14.8 | Tests intégration | 14 unit + 3 real spawn |
| ✅ P14.9 | Presets **Angular**/Vue/**Svelte** | **Angular ✅** (instance isolée) · **Vue3 ✅** (P14.2) · **Svelte5 ✅** (`63c9b05f`) — preset enregistré `ViteBuilder.ts:28`, plugin + `resolve.dedupe` émis `ViteConfigGenerator.ts:132`/`:281`, type `IFrontPreset.ts:11`, test d'extensibilité `ViteConfigGenerator.test.ts:305`, scaffold CLI. **`solid` RETIRÉ de la surface** (décision user) : la valeur était annoncée par le type `FrontPresetType` sans qu'aucun preset ne soit enregistré. Le runtime, lui, ne se taisait PAS — `ViteBuilder.ts:59` et `ViteConfigGenerator.ts:144` lèvent tous deux `FrontendPresetUnknownError` — mais l'échec tombait au DÉMARRAGE là où le compilateur pouvait le refuser, et le `.d.ts` publié promettait un preset inexistant. Le retrait déplace le refus à la compilation. Ajouter Solid après la release reste local : l'extensibilité est prouvée par le test écrit pour svelte5 (`ViteConfigGenerator.test.ts:305`) |
| ✅ P14.10 | Migration Studio sur `@nodefony/frontend` | 1er consommateur prod |
| ✅ P14.11 | **Core isomorphe** | Container/Service/Event/Syslog/Pdu runnable browser — shim `node:events` complété (`rawListeners`/`prepend*`, hot path `emitAsync`) ; 0 `node:` runtime dans le bundle client |
| ⬜ P14.12 | Plugin Vite Nodefony (alias + env) | zéro config dev |
| ✅ P14.13 | Multi-instance Vite résilient | familles d'isolation (default/angular) |
| ⬜ P14.14 | API CSP origines dynamiques | remplace hack POC |
| ✅ P14.15 | DevSupervisor auto-restart | group-kill anti-orphelin, rebuild ciblé ; **introspection process MULTI-MODE** (`1bd57a7d`) : `nodefony status`/`stop` voient dev/prod/cluster (champ `mode`), gardes anti-collision fail-loud (dev refuse sur prod/cluster & inverse), `start.sh` délègue à `nodefony stop` ; **watch réparé (`de3dd07d`)** : le paquet SERVEUR `@nodefony/frontend` était ignoré (segment `frontend` = rôle ET nom de paquet) → aveugle, jamais de rebuild ; règle extraite en fonction pure `isIgnoredWatchPath` + 12 tests ; **scoping projet unifié (`9748a330`)** : `status` rendait les process d'un AUTRE projet comme les siens (« 4 process · 2/2 ports UP » sur une app arrêtée) et `stop` marquait `✗ encore occupé` des ports qui ne sont pas les siens — une seule partition, faite là où les syscalls ont lieu ; ports ATTRIBUÉS à leur projet, runtimes étrangers NOMMÉS ; cécité du rattachement CONSTATÉE (`lsof` absent → liste globale annoncée, jamais « aucune instance ») ; **projets NOMMÉS et CIBLABLES (`493de57a`, `26c3c2b5`, `f6ff1233`, `53628bc7`)** : `status` rend un bloc par projet (nom du `package.json`, process, ports SONDÉS — ceux d'un voisin aussi) + un résumé qui explique le cloisonnement, `stop <nom\|chemin>` arrête un autre projet sans `cd` et REFUSE (sortie `1`, rien de tué) une cible inconnue, homonyme ou combinée à `--all` ; `--all` sonde désormais les ports de TOUS les projets qu'il arrête (il en prouvait 2 sur 4) ; sous Windows le rattachement est impossible (`lsof` absent) → la cécité est ÉNONCÉE au lieu de nier le projet, et la grammaire de chemins est injectable (`path.win32`) pour l'éprouver depuis un poste UNIX |
| ⬜ P14.16 | Syslog isomorphe (logs front → back) | traçabilité front |
| ✅ P14.17 | **HMR joignable hors loopback** (dev déporté) | `devHost` = ÉCOUTE seule ; origine PUBLIQUE dissociée (`frontend.publicOrigin`, template `{port}` suivi par famille et par retry de port) + détection AUTO Codespaces/Gitpod (`remoteDev.ts`, pur+testé) + `server.allowedHosts` dérivé de `trustedHosts` http (1 liste) + `server.hmr` client (host/clientPort/protocol, 443/wss forwarder). `status().origin` = source unique des URLs (TemplateHelper, boot line, CSP, admin API, Studio Runtime). Résilience superviseur durcie : kill de l'orphelin au timeout de boot, drain des listeners au retry, budget restarts réarmé après stabilité prouvée, ping loopback (0.0.0.0 Windows), verdict npx win32, arrêt-pendant-boot nommé. Preuve : 403 témoin sans allowedHosts / 200 avec + origin au port réel (intégration spawn réel). En PLUS : preset `svelte5` (framework + scaffold complet). |
| ✅ P14.18 | **Origine des assets dérivée du `Host`** | En développement, chaque page annonce ses assets sur l'hôte par lequel le client est arrivé (NOM seul ; scheme et port restent ceux de Vite) : un poste et un navigateur en conteneur sont servis EN MÊME TEMPS par une seule instance, sans variable ni `/etc/hosts`. `originWithHostname` (pur) + `FrontendService.derivableHost` (3 gardes : origine non épinglée, `HttpKernel.isTrustedHostname` — règle UNIQUE résolue par nom —, barrière non déléguée). `NF_FRONTEND_PUBLIC_ORIGIN` SUPPRIMÉE (dépôt + 3 gabarits) : posée pour observer un écran puis oubliée, elle avait rendu Studio inaccessible depuis le poste. Preuve : HMR reçu des DEUX côtés simultanément (`connected`/`file-changed`/`js-update` sur `wss://127.0.0.1:5173` ET `wss://host.docker.internal:5173`), CSP couvrant les deux origines, 18 tests neufs dont 3 vus rouges au débranchement. |

### P15 — Mediasoup + SIP/Asterisk (0 %)

> ⚠️ `src/modules/mediasoup` = **banc test ORM** (schémas Drizzle), **PAS** l'implé P15. Le pont télécom vocal n'est pas commencé.

P15.1 `MediasoupService`/`RoomManager` · P15.2 mapping Routers↔Rooms · P15.3 `SignalController` · P15.4 `PlainTransport` Asterisk ·
P15.5 ARI/AMI · P15.6 pipeline agent IA vocal (STT→LLM→TTS) · P15.7 cluster `PipeTransports` · P15.8 tests E2E. **Après P12+P13.**

### P16 — Cloud-Native (45 %) — décomposition VÉRIFIÉE au code (audit 08-20)

> Comptage par SOUS-ITEM (plan `project_cloud_native_plan` + axes H/I/J ajoutés depuis) : chaque
> ✅/⬜ ci-dessous a été confronté au code le 08-20 — **15✅ 18⬜ = 33 sous-items, 45 %**.
> L'axe 16.A affiché « ✅ » jusqu'ici ne l'était que pour A.1 : A.2/A.3/A.4 n'existent pas (0 occurrence).

<!-- prettier-ignore -->
| Axe | Sous-items (vérifiés 08-20) |
| --- | --- |
| 16.A Kernel/Lifecycle | ✅ A.1 graceful drain COMPLET (`b94af814`→`d494730d` : http-terminator ×3, `shutdownTimeout`, WS 1001 avant drain, deadline `shutdownDeadline`, preuve `docker stop` → 200 + exit 0) · ⬜ A.2 événements `onPreShutdown`/`onDrain` (0 occurrence) · ⬜ A.3 bootstrap secrets avant DI (dépend 16.C) · ⬜ A.4 warning PID 1 sans tini (0 occurrence) |
| 16.B HTTP | ✅ B.1 `/livez`+`/readyz` natifs (court-circuit `http-kernel.ts:973`, readiness 503 au SIGTERM) · ✅ B.2 `Forwarded` RFC 7239 + XFF anti-spoof (chantier clos 06-07, banc Docker E2E) · ✅ B.3 `trustProxy` gate (`config.ts:980`) |
| 16.C Secrets | ⬜ C.1 `ISecretProvider` · ⬜ C.2 `SecretManager` · ⬜ C.3 hook boot · ⬜ C.4 migration des secrets — 0 occurrence des symboles (vérifié 08-20) ; dépend P6, design au kit |
| 16.D Docker | ⬜ D.1 `Dockerfile.dev` · ✅ D.2 Dockerfile PROD multi-stage (gabarit `create app` : HEALTHCHECK `/readyz`, USER node, node PID 1 — prouvé sur app générée depuis le tarball) · ✅ D.3 compose (`docker/docker-compose.yml`) · ✅ D.4 profils (postgres/mongo/redis/kafka/tools/loki/opensearch/proxy/browser) · ✅ D.5 réseau bridge + alias DNS |
| 16.E Skills/Tooling | ⬜ E.1 `docker-debug` · ⬜ E.2 `infra-up` · ⬜ E.3 détection conteneur dans start-server — absents de `.claude/skills/` |
| 16.F Cleanup PM2 | ✅ F.1 code retiré (0 occurrence `pm2Service`/`Pm2Command`/`MODE_START==="PM2"`) · ✅ F.2 dep npm retirée · ⬜ F.3 doc migration PM2→systemd/docker |
| 16.G Docs DevOps | ⬜ G.1 env-vars · ⬜ G.2 health-endpoints · ⬜ G.3 quickstart-docker · ⬜ G.4 quickstart-k8s — seul `docs/guides/docker-cloud-native.md` existe (partiel) |
| 16.H Scaling multi-process | ✅ H.1 topologie `workers` · ✅ H.2 `cluster -w N` (`ClusterManager`, cgroup-aware) · ✅ H.3 sonde/worker · ✅ H.4 Studio cluster · ⬜ H.6 banc backplane cross-pod k8s (l'anti-écho `resolveBackplaneOriginId` = `(POD_NAME ?? hostname):pid` EST livré, `originId.ts:24`) |
| 16.I Liveness/Readiness | ✅ route PUBLIQUE graduée `/nodefony/kernel/api/livez` (`95bb221f`, zone `nodefony-liveness`, pattern Actuator) |
| 16.J Métriques | ⬜ `/metrics` Prometheus (0 occurrence — repoussé, décidé 06-15 ; données déjà dispo `dashboard:stats`) |

---

### P17 — Multi-tenant / SaaS (0 %) — ⏸️ POST cloud-native (P16) + POST release 10.0.0

> Séquencement **acté 2026-06-19** : chantier ouvert APRÈS P16 ET APRÈS la release 10.0.0. Audit terrain complet + modèle + plan : mémoire IA `project_multitenant_chantier_kit`.

**Verdict audit (06-19)** : Nodefony n'est pas multi-tenant câblé MAIS l'archi est **saine** — aucun framework ne l'est par défaut (Rails/Django/Nest/Laravel/Spring = couche ajoutée) ; fondations dures déjà là (ALS, Repository, firewall central, `withTransaction` = patron de `withTenant`, slots `tenantId` semés). **Pas de refonte, couche additive.**

**Modèle acté** : pool (DB partagée + `tenant_id`) + scoping **AUTO fail-closed** + tenant dans l'**ALS** (PAS sur `IUser`) + **membership** `user × tenant × rôles`. **Livraison** = 1 module `@nodefony/tenant` + 1 seam de scope `orm-core` + 1 hook resolver firewall + entités drizzle/mongoose.

**Trous P6 à traiter** : RBAC plat global **incompatible** (→ P6.8 `IRole/IPermission` à concevoir tenant-aware) · tokens `tenantId=null` (slot existe → backfill, non bloquant).

| Lot (chemin critique = 1→2→3)                                         | Effort |
| --------------------------------------------------------------------- | ------ |
| 1. `ITenantResolver` + résolution firewall + tenant ALS               | M      |
| 2. Membership user×tenant×rôles (fonde RBAC tenant-aware)             | L      |
| 3. Repo `withTenant()` scope auto fail-closed                         | M      |
| 4. Tokens tenant-scopés · 5. cache/WS/audit · 6. RLS Postgres (bonus) | S–M    |

---

## 🛣️ Chemins (détail effort → mémoire IA `core-dev/migration/phases-details.md`)

- **MVP prod** : P0 → P1 → P2.2-2.5 + P3 minimal → P5.1-5.6 + 1 adapter (Drizzle) + session → **P6.1-6.8b ✅ LIVRÉ** + **config clean** + **CLI essentielles** (lifecycle + orm:migrate + user/security). Sécurité ✅ ; **reste MVP = config clean + CLI essentielles**.
- **Studio MVP** : MVP → P14 (Vite + Core isomorphe) → P13.4/13.7 → P11.1-3 → P10. (Studio = 1er consommateur prod de `@nodefony/frontend`.)
- **IA agentic** (phase FINALE, **différée**) : P12 (llm/vector/rag/memory refaits + agent + agent-guard + panels Studio).

---

## 🚧 Blockers connus

| Sujet                     | Problème                                  | État                       |
| ------------------------- | ----------------------------------------- | -------------------------- |
| ~~`rollup.config.ts`~~    | ~~`@ts-ignore` sourcemap-path-transform~~ | ✅ caduc (Rollup supprimé) |
| `IKernel.cli`             | typage `ICliKernel`                       | ✅                         |
| `IModule.getController()` | `IController` générique                   | ✅                         |

---

## ➡️ Prochaine étape (priorités revues à l'audit vérité 08-20)

> **Acquis qui ferment le chemin** : chaîne scaffold `create …` COMPLÈTE (7 types, 3 fronts, saveurs,
> catalogue versions — journal → `git log` + snapshot mémoire IA) · `doctor` ✅ (alias `check`) ·
> P6 cœur + resource-server P6.9.x ✅ · S1-S4 multi-dialecte ✅ (8 briques × 3 dialectes) · dépôt
> PUBLIC, README + SECURITY.md livrés, signalement privé activé, 0 vulnérabilité.

### 🔴 AVANT la release 10.0.0 (dans l'ordre)

1. **P8 — PUBLICATION NPM** (le bloqueur restant de P8) : chaîne `nodefony-release` (pack workspaces,
   bascule `exports.types`, post-traitement `.d.ts`, smoke conteneur depuis les TARBALLS) — plan et
   décisions : `docs/release/nodefony-10.md`. Y adosser les prérequis sécurité de la publication
   (§ dettes) : **gitleaks en gate + allowlist** (🔴, dépôt désormais public), **provenance npm + 2FA**,
   **red-team de la surface PUBLIÉE**, SECURITY.md/AGENTS.md générés dans l'app.
2. **P11 — commandes métier essentielles** : `user:*` (dont `security:user:password`), `framework:*`.
   (`orm:migrate` = S5c, voir 3.)
3. **S5 — DDL prod** (P7.10, dégelé après 1+2) : lots S5a-d (`DrizzleMigrator`, table
   `nodefony_migrations`, modes ddl) + P11.4 `orm:migrate` — design ✅ validé
   (`orm-migrations-design-2026-07`). Traiter au passage la dette 🔴 « union TS sans `CHECK` SQL ».
4. **Volet A — entité `User` à l'application** (dette 🔴 du tableau : le code d'une app est FIGÉ à sa
   création, un correctif 10.1 ne réparerait aucune app née en 10.0.0) → `project_user_entity_roles_kit`.
5. **Config app `NF__APP__*`** (reste ADR-0006) → `project_config_nf_app_kit` — si le temps le permet,
   sinon 10.x (additif, pas une rupture).

### ⏭️ APRÈS la release (10.x, ordre indicatif)

- **P6.9d serveur d'autorisation OAuth 2.1** (décision user 08-20 : après 10.0.0 ; en attendant,
  vérifier que la porte MCP accepte les PAT P6.12 = l'ergonomie sans P6.9d).
- **P7.11 full NoSQL** (totp/audit/idempotency mongoose) · **P6.16 rpId par Host** · **P6.9b mTLS** ·
  authz niveau B · logs auth dédiés · live `security:audit` Studio.
- **Dette `NF_`** (renommage env, § dédié) · réécriture des preuves e2e du kit load-test dans leurs
  paquets · bancs → 1 compte par fichier · volet B rôles pluggables · frontière canaux realtime (#3).
- **P12 couche IA** (le protocole MCP au cœur l'attend) · **P13.6 Kafka** · **P15** · **P16 complet**
  (16.J `/metrics`, secrets, docs DevOps) · **P17 multi-tenant**.

---

## 📚 Détail déplacé hors du dashboard

> Le **statut** vit ici (roadmap + comptage 1ʳᵉ cellule). Le **détail** (« comment », hashes, gotchas) vit à côté — les sources `core-dev/*` vivent dans la **mémoire IA, hors dépôt** (non cliquables ici) :

| Source                                       | Contenu                                                        |
| -------------------------------------------- | -------------------------------------------------------------- |
| `core-dev/migration/AUDIT-verite-2026-06.md` | **Audit vérité 2026-06-05** (confrontation code ligne à ligne) |
| `core-dev/migration/phases-details.md`       | Specs détaillées par phase (conception, archi)                 |
| `core-dev/migration/journal-sessions.md`     | Journal chronologique des sessions                             |
| `core-dev/migration/archive-snapshots.md`    | Instantanés périmés                                            |
| Mémoire IA `~/.claude/.../memory/`           | Décisions persistantes (`project_*`, `feedback_*`)             |
| `git log`                                    | Détail-journal complet des commits (ex-cellules verbeuses)     |
