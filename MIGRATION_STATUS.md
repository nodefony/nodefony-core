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
- ✅ **Gap FERMÉ — banc e2e SYSTÈME** (`db-persistance-pod.mjs`, étape d'`orm.yml` sur le Postgres du décor) : une donnée écrite par une requête HTTP, à travers le pipeline entier et le repository ORM, est relue après **arrêt gracieux ET redémarrage** du pod — et c'est l'**empreinte** qui est comparée, pas seulement la présence (une ligne recréée par un décor complaisant ne passe pas). Une transaction en échec ne laisse rien derrière elle. **Vu ROUGE** en débranchant d'un mot (`--url sqlite::memory:`), et rouge sur ces DEUX seules assertions : c'est ce qui prouve qu'il mesure la persistance et non le redémarrage. ⚠️ Le pod tourne en `development` — les routes de sonde vivent dans un module `policy: "dev"`, donc absent en production (404 constaté, pas déduit) : le chemin de DDL de production (`drizzle-kit`) reste hors preuve.

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
| `nodefony` (core) | ✅ | Kit C1→C6 clos (PM2 retiré, modes run `IRunProfile`, park, ménage boot −378 ms). **Fuite de 7 listeners `process` par `Cli` FERMÉE** (`2493f7b2`) : SIGINT/SIGTERM/SIGHUP/SIGQUIT + `warning` + les 2 faces d'un rejet, posés par des handlers ANONYMES donc impossibles à retirer — invisible en production (1 `Cli` par process), mais une suite en instancie des dizaines et au 11ᵉ Node émet `MaxListenersExceededWarning` dont la charge est l'objet `process` ENTIER. `Cli` mémorise DE QUOI retirer chaque listener (retrait fermé sur la référence, zéro cast), `releaseProcessListeners()` idempotent appelé par `terminate()`, et le décor de test pose un filet dans `vitest.setup.ts` (ce qu'un test attache, le test le remporte). Mesuré sur la suite complète : **71 → 0 avertissements, 7 571 → 263 lignes de journal**, 2 363 verts. `Event` : `nbListeners: 0` (illimité chez Node) était rejeté par sa VÉRACITÉ (`if (options.nbListeners)`) et l'appelant recevait le défaut, donc l'avertissement qu'il cherchait à éviter ; TSDoc qui annonçait un défaut de 20 jamais appliqué corrigé. `GcScheduler` : les tests de DÉLAI passent en horloge SIMULÉE (`3 ms` de marge en temps réel faisaient accuser un commit innocent en CI) — celui de l'anti-empilement reste en horloge réelle, il fabrique un chevauchement et non une échéance. `project_hardening_core_kit` | **Un runtime fantôme n'interdit plus la production** (`dfdada9e`) : le garde de démarrage DÉDUISAIT une collision d'une présence de process — un superviseur dev orphelin à **0 port détenu** faisait sortir `production`/`cluster` en `UNAVAILABLE` ; il SONDE désormais les ports (`defaultDevPorts`, même source que `status`/`stop`), comme le chemin dev le faisait déjà.
| `@nodefony/http` | ✅ | Kit H1→H6 + config Zod + domain matching + forwarded RFC 7239 COMPLET + banc proxy Docker E2E + **service certificates durci** (RFC 5280/6125, SHA-256, serial 128b, 0600, lazy node-forge, CLI `certificates`) + **banc TLS re-encrypt validé** (verify required/verifyhost/sni) + `proxy:generate` (**annonçait `proto=https` à un client venu en clair** — le scheme se CONSTATE sur `ssl_fc` ; + `timeout tunnel`/`client_max_body_size` dérivés de la config, `f70d2894`) + **suite reverse-proxy automatisée** (4 raccords contre nginx+haproxy RÉELS, gate `PROXY_GATE`, `32c1d29f`) + **préfixe natif statique `/<module>/`** (`mountModulePublics`, configurable `publicMount`) + **`assets:publish`** (arbre CDN-ready provider-agnostic) + **`PATCH` parsé** (RFC 5789 — était absent de la table `parse` de `Request.ts` → body jamais lu → 500 sur mutation). `65f7e41`/`6ac8562`/`e735544`/`6918f89`/`867d6458` |
| `@nodefony/framework` | ✅ | F1→F7 (sauf F6 résolu via dette CLI) ; 495 tests unit ; 0 dette. **Fichier introuvable → 404 et non 500** (`109976c0`, RFC 9110 §15.5.5 : le 404 est l'absence de « représentation courante », le 500 suppose une condition INATTENDUE — or le chemin vient d'une entrée) : corrigé dans `getFileAsync`, donc les 3 façades d'un coup (`renderMediaStream`/`streamFile`/`renderFileDownload`) ; `EACCES` et E/S remontent inchangés (500 légitime), un dossier rend 404. Fuite d'information fermée au passage : le chemin serveur ne voyage plus dans le corps (la même section autorise la non-divulgation). Prouvé aux DEUX étages — unitaire (code porté par l'erreur) ET pipeline complet (`/media-missing` du module test : 500 amputé → 404 restauré, 0 fuite), le test unitaire ne disant rien de ce que reçoit le client. `project_hardening_framework_kit` |
| `@nodefony/realtime` | ✅ | **Durci** : back-pressure WS, 5 seams sécu, **210 tests verts** (+9 skipped docker ; inclut banc loopback isomorphe E2E L0-L4 — 26 scénarios VRAI client↔serveur) ; série socket isomorphe L0-L4 ✅ (duplex S→C, contrat typé partagé, façade serveur `ServerRealtimeSocket`) ; dettes backplane #1/#2 fixées (`c082560`). **Bus authentifié (F83, `44becb5a`)** : admission par canal à l'ingress + sceau HMAC des transports partagés (`backplane.secret`), prouvé sur banc 3 apps / 1 Redis. **Déclaration broadcast STATIQUE `@RealtimeBroadcast` (`2369deb0`)** — l'override n'était lu qu'au handshake, un pod publiant sans abonné local ne propageait rien. **File d'envoi du backplane BORNÉE** (`backplane.maxQueueBytes`, défaut 8 MiB) : `publish` fire-and-forget laissait la file du client Redis grossir sans limite (583 MB sous rafale au banc) — seuil + compteurs `describe().queue` (sonde + Studio) + alerte de transition, doctrine du back-pressure WS ; ferme au passage un `unhandledRejection` quand le bus coupe en plein envoi. **Prouvé au banc** (1 M publications synchrones, `mempeak.sh`) : pic **3 231 MB → 387 MB** (÷8,3) et rafale 2,5× plus courte, à perte de messages IDENTIQUE — sans borne on payait 3,2 Go pour perdre les mêmes. **Plancher des canaux de PLATEFORME (F82 cas 2)** : sans `@nodefony/security`, aucun verrou n'était posé → `syslog:`/`orm:`/`kernel:`… servis à l'anonyme, et l'alerte censée prévenir était muette (elle exigeait une policy déclarée). Le hub porte désormais sa propre fermeture (`subscribeClient`, insensible à la casse), DIT le refus au client (`realtime:denied`), le compte (`systemFloorDeniedTotal`) et avertit à la DÉCLARATION (policy sur namespace réservé → WARNING ; diffusion d'un namespace réservé → REFUSÉE). Liste des namespaces = source unique côté hub, consommée par security (`reservedSystemPrefixes()`), fini les deux inventaires. **Fan-out MUTUALISÉ (plan S1, livré)** : une frame diffusée n'est plus sérialisée qu'une fois pour N abonnés (`ChannelSerializer` fourni par l'abonné, `JsonRpcPeer.buildNotification` = source unique des deux voies, repli protégé si la charge n'est pas sérialisable). Étage fan-out **26× à 62× moins cher** selon la taille de charge (`fanoutSerialize.perf.test.ts`, `NF_RUN_PERF=1`) ; le banc saturé, lui, ne peut pas trancher (variance ×3 > écart cherché). **Contrat du `welcome` tenu des DEUX côtés (`7161699f`)** : le serveur jette toute frame reçue avant `realtime:welcome` (transport JSON-RPC pas encore branché — aucun canal pour porter un refus) ; le client rejouait ses abonnements sur `onOpen`, donc trop tôt, perdant TOUT abonnement posé avant `start()` et tous ceux d'après une reconnexion. Le rejeu part désormais du welcome ; sept mocks du socle enchaînent ouverture ET welcome — sans quoi ils décrivaient un serveur qui n'existe pas (16 cas verts contre lui). Reste dette #3 (frontière inter-modules, attend P6) |
| `@nodefony/orm-*` | ✅ | **Virage ORM Ph.1-4 CLOS 2026-06-08** (cf § Virage ORM) : Seq OUT, Mongoose refait, kernel/orm OUT, C2/C5, 160 tests + seuils v8. **RÉSILIENCE DE CONNEXION livrée** : une base qui tombe PENDANT que l'application tourne n'était couverte nulle part — les suites ne connaissaient que le `disconnect()` volontaire. Banc de coupure réelle (`docker stop`) : PostgreSQL **tuait le process** (`pg-pool` fait `pool.emit("error")` sur un client INACTIF qui tombe ; un EventEmitter sans auditeur lève, et rien n'installe d'`uncaughtException`), et sur les trois dialectes `isConnected()` répondait `true` en pleine coupure — donc `buildOrmLeanHealth().connected` aussi, et toute readiness qui s'y adosse. Le contrat vit désormais dans `orm-core` et NON dans l'adapter (drizzle est remplaçable) : `isConnected()` concret sur la classe de base, deux hooks idempotents `connectionLost`/`connectionRestored` que chaque adapter appelle depuis SON driver, événements `onOrmLost`/`onOrmRestored`, et `reconnectCount` qui cesse d'être déduit de `connectCount-1` (une reprise de driver ne repasse jamais par `connect()`). Éprouvé à TROIS étages : contrat portable sans infra (`ormResilience.test.ts`, exigible de tout adapter futur), traduction driver→contrat chez chaque adapter (`outage.test.ts`), coupure RÉELLE gatée `NF_RUN_DB_OUTAGE=1` (`outage-real.test.ts`). **Complété après audit** : la détection événementielle ne couvrait que le client INACTIF (`pg-pool` retire son auditeur pendant l'usage) — une coupure sous TRAFIC restait invisible sur pg et mysql, et chaque boot comptait une reconnexion fantôme. Ajoutés : battement de cœur borné dans `orm-core` (le seul mécanisme qui voie une base GELÉE, qu'aucun événement ne signale), `keepAlive` TCP, capacité déclarée `liveness` + compte `assumed` jusqu'à l'agrégat cross-pod. **Éprouvé jusqu'au POD** : banc `db-outage-pod.mjs` (1 à N pods en `production`, base coupée) — débranché, les pods MEURENT en code 1 ; branché, ils survivent et repartent. Job CI `outage` dédié (conteneurs NOMMÉS en `docker run`, `services:` ne donnant pas de nom stable). **Deux trous de plus fermés par la forge** (`e595ef36`, `32e7f574`), tous deux invisibles en local : en MySQL l'`error` d'une `PoolConnection` **n'arrive jamais** quand le serveur tombe (mesuré : le socket rend `end`/`close`, la requête en vol est rejetée en `PROTOCOL_CONNECTION_LOST`, et `mysql2` délivre l'erreur fatale au demandeur, pas à l'émetteur) — l'écoute ne couvrait donc que la connexion INACTIVE, et MySQL n'avait en pratique que le battement à 30 s là où `pg` bascule aussitôt ; le socket sert désormais de signal et déclenche `beatNow()`, qui tranche par une requête au lieu de conclure sur une fermeture (un recyclage en produit une aussi). Et 🔴 **une base qui tombe PENDANT une transaction tuait le pod** : `pg-pool` retire son auditeur `error` du client tant qu'il sert (`index.js:344`), donc le défaut fermé sur le pool restait entier sur le chemin des transactions — `#beginTx` pose un puits et le retire au rendu, synchrone jusqu'au `release`. Prouvés sur serveurs réels, débranchement vérifié sur le dist avant de conclure. ⚠️ Reste : E2E système (cf note P7) ; et Mongo pend **30 s** par requête pendant une coupure (`serverSelectionTimeoutMS` du driver) — mesuré, documenté, **pas raccourci** (choix produit) |

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

**La forge éprouve enfin ce que le dépôt PRODUIT** (`scaffold.yml`, `1827d92c`) : matrice
`ubuntu · macos · windows` sur le plancher `engines`, décor ISOLÉ (tarballs hors dépôt), deux bancs
enchaînés — le code généré tient debout (16 étapes), puis l'application générée tient ses PROMESSES
(`verify-runtime.mjs`, `017022f5` — 51 cas en trois étages : unitaire sans décor, intégration avec
l'app bootée et zéro port ouvert, e2e sur serveur réel en production). Quatre défauts trouvés par ce
seul workflow, dont **la suite e2e de TOUTE application générée, morte sous Windows** (`becf7e2e`) :
elle lançait `node_modules/.bin/nodefony`, qui n'existe pas là-bas. Le framework résout désormais son
propre lanceur (`nodefonyBin()` publié par `nodefony/testing`, `efbfacf5`) — plus aucun chemin deviné
chez l'utilisateur. Au passage : la passe principale était **rouge depuis 20 exécutions** sans que
personne ne la lise (`bd7485c0`), et le graphe symbolique, gitignoré, manquait à tout checkout frais
(`8a1fad04` — `release-smoke.yml` portait le même trou).

**Le 404 des routes d'un module local sous Windows est FERMÉ** (`e0d4b55e`), et sa cause dépassait le
symptôme : `nodefony create module` lance le `npm install` qui pose le lien de workspace sans lequel
le Kernel ne peut pas importer le module par son nom, et sous Windows `npm` est un `npm.cmd` que Node
refuse d'exécuter sans shell (il répond `ENOENT`, qui se lit « npm n'est pas installé »). La règle
existait — écrite la veille dans le BANC, jamais dans le PRODUIT : l'outil de mesure était portable
pendant que le produit ne l'était pas. `besoinDeShell` est publiée par le cœur, le banc l'importe, et
**11 sites** qui la redevinaient ou l'ignoraient sont fermés. `scaffold.yml` : **4/4 vert**.

**L'intégration s'exécute désormais sur les TROIS systèmes** (`8f2321a7`) — c'est la seule tâche du
dépôt qui DÉMARRE un serveur et lui parle : pipeline HTTP, **WebSocket**, sessions, firewall, cycle de
vie et arrêt, en development ET en production. L'obstacle n'était pas le framework mais
`.github/actions/nodefony-server`, qui recopiait le spawn, la readiness (`grep` sur le journal) et
l'arrêt (`kill -9` + `lsof`) — tout cela POSIX. L'action APPELLE maintenant le lanceur du framework
(`638ce1f8`), qui porte le kill d'arbre unique, la readiness sur les ports RÉELS et, depuis
`10c6d556`, **le refus d'un boot DÉGRADÉ** : un module du manifeste écarté en fail-soft ne peut plus
laisser une application se déclarer prête et rendre 404 sur toutes ses routes — le refus NOMME ce qui
manque. Ce que la matrice a rapporté au premier passage : `websocket-fragmentation` pendait 60 s sous
macOS et redevient vert avec la readiness réelle ; sous Windows `@nodefony/http` passe INTÉGRALEMENT
(77 fichiers, 0 rouge), les seuls rouges venant d'une sonde de banc POSIX, d'une étape de CI sans
`shell:` déclaré et d'un test d'ordre comparant deux horloges de process différents.

✅ **`orm.yml` est VERT** (`e6374174` → `32e7f574`), et ses trois jobs disaient trois choses
différentes. Les deux jobs Redis étaient un **faux rouge de l'INSTRUMENT** : le renommage `NF_`
avait porté `REDIS_URL` → `NF_REDIS_URL` dans `REDIS_GATE` et pas dans le workflow, si bien que le
rapporteur annonçait « Redis non exercé » pendant que 141 tests et onze bancs de backplane RÉELS
tournaient — un instrument qui contredisait ses propres preuves, deux jours sans lecteur. Le
troisième job portait deux vrais défauts, dont un **grave** : en MySQL la coupure n'émet AUCUN
événement (`mysql2` délivre l'erreur fatale au demandeur, pas à l'émetteur), donc MySQL n'avait que
le battement à 30 s là où `pg` bascule en millisecondes — le socket sert désormais de signal et fait
trancher un battement anticipé ; et surtout 🔴 **une base qui tombait PENDANT une transaction tuait
le pod** : `pg-pool` retire son auditeur `error` du client tant qu'il sert, donc le défaut déjà fermé
sur le pool restait ouvert sur le chemin des transactions. Un `ciGateVars.test.ts` compare désormais
les `env:` des workflows aux gates du dépôt et refuse toute forme rivale.

✅ **`memory.yml` et `e2e-autonomes.yml` sont ouverts aux TROIS systèmes.** Préalable payé d'abord :
**12 étapes** de ces deux workflows n'avaient pas de `shell:` déclaré — inoffensif tant qu'on ne
tourne que sur ubuntu, fatal dès que Windows prend PowerShell (axiome 11, que `efac722e` n'avait pas
appliqué ici, ces fichiers étant hors matrice). Pour `e2e-autonomes` rien à étalonner : ses preuves
ASSERTENT un comportement et ne mesurent rien. Pour `memory.yml`, le premier passage est une MESURE
avant d'être un verdict — les seuils vivent dans `memory.test.ts`, sont grossiers à dessein (35 Mo
quand le bruit du ramasse-miettes se compte en quelques Mo) mais n'ont été étalonnés que sur Linux ;
`fail-fast: false` pour que chaque système rende SON chiffre, et un seuil qui saute se recalibrera
AVEC ce chiffre, par plateforme — jamais par un `continue-on-error`, qui en ferait un vert menteur.

✅ **`ViteProcessSupervisor` sous Windows : 6 cas, tous verts** (4,7 s) — le verdict qu'on n'avait
jamais obtenu. Ils s'exécutent RÉELLEMENT (aucun `skipIf` de plateforme, spawn réel), y compris
l'auto-redémarrage après un `SIGKILL` — le cas même où Windows n'a pas de groupes de process.

⚠️ **Windows a parlé au premier passage, et le trou n'était pas dans le produit** (`30f5ede4`) : un
banc tuait son serveur par `process.kill(-pid)` — un GROUPE de process, qui n'existe pas là-bas ;
l'appel y LÈVE et le `catch` le lisait « déjà mort ». Le serveur survivait au banc et emportait les
ports du SUIVANT, d'où trois symptômes sans rapport apparent dans le même journal (`Port 5173 is
already in use`, `status` annonçant le mode du RÉSIDU faute de `ps`, et « aucun process n'écoute sur
:5151 »). Le dépôt POSSÉDAIT la réponse — `signalProcessGroup`, cinq sites du produit l'utilisent —
et un gate (`bancsPortables.test.ts`) interdit désormais le kill deviné dans tout script du dépôt.

🔴 **Les seuils du gate mémoire sont 55 à 572× trop larges** (`54e2653a`) — et personne ne pouvait le
savoir : le delta n'était publié qu'en ÉCHEC. Mesuré une fois la marge imprimée : 0,05 à 0,37 Mo
pour des seuils de 10 à 35 Mo, quand la règle du dépôt chiffre la fuite à surveiller à 0,1 Mo /
1000 requêtes. Le vert ne prouve donc que « pas de fuite ÉNORME ». La marge est maintenant imprimée
à chaque passage sur les trois systèmes ; **les seuils se resserreront sur CES chiffres**, par cas
et par plateforme — pas sur un run local, qui fabriquerait des faux rouges ailleurs.

**Reste** : Loki/OpenSearch jamais montés à la forge (dette APRÈS release) ; `dependabot.yml` en place
pour que la dérive des versions se voie ; le resserrage des seuils mémoire ci-dessus ; et
`graceful-shutdown-e2e` sous Windows, non revérifié depuis le correctif du résidu — s'il retombe,
c'est l'axiome 6 (aucun SIGTERM réel là-bas), donc un fait de plateforme à ÉNONCER, pas un défaut à
corriger. Et un flake instruit sans être fermé :
`websocket-fragmentation` a pendu ses 60 s sous Windows/production puis repassé tel quel. Le fichier
portait déjà la leçon À MOITIÉ — `premierMessage` écoutait `close` et `error`, `consumeHandshake` non,
et c'est lui qui attend le premier message. Les deux passent maintenant par le même chemin (idem
`ws-latency-load`, où une attente muette au milieu de 500 allers-retours passerait pour de la
latence) : aucun seuil relâché, mais la prochaine occurrence DIRA ce que le serveur a répondu.

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

> **Chaque dette a désormais un TICKET** — c'était le [#56](https://github.com/nodefony/nodefony-core/issues/56).
> Le détail (preuve `fichier:ligne`, critère de fin, estimation) vit là-bas, pas ici : un ticket
> porte un état que personne n'oublie de changer. Ce tableau n'est plus qu'un **index**, et les
> deux seules lignes sans ticket portent leur verdict écrit.

<!-- prettier-ignore -->
| Dette | Grav. | Où elle vit maintenant |
| --- | --- | --- |
| ~~Union TypeScript sans contrainte `CHECK` en SQL~~ | ✅ | **SOLDÉ** `81a9813c` — kind `enum` au colKit, `CHECK` émis dans le `CREATE TABLE` et vu mordre sur les 3 dialectes ([#94](https://github.com/nodefony/nodefony-core/issues/94)) |
| ~~Compteur anti-clonage WebAuthn en entier 32 bits~~ | ✅ | **SOLDÉ** `81a9813c` — `signCount` **et** `lastUsedStep` (TOTP, débordait en 2038) en 64 bits ([#94](https://github.com/nodefony/nodefony-core/issues/94)) |
| Échec de création d'index mongoose jamais écouté | ✅ | **SOLDÉ** `47b308f1` — `verifyIndexes()` constate l'écart et crie en `CRITIC` ([#93](https://github.com/nodefony/nodefony-core/issues/93)) |
| L'entité `User` appartient au framework, pas à l'app | 🔴 | [#18](https://github.com/nodefony/nodefony-core/issues/18) |
| Surcharge attrape-tout de la socket cliente | 🟡 | [#26](https://github.com/nodefony/nodefony-core/issues/26) |
| Renvois au code en dérive dans le corpus doc | 🟠 | [#49](https://github.com/nodefony/nodefony-core/issues/49) |
| Option de tri mal formée = tri silencieusement ignoré | 🟠 | [#57](https://github.com/nodefony/nodefony-core/issues/57) |
| Le corps des requêtes est injecté sans schéma | 🟠 | [#58](https://github.com/nodefony/nodefony-core/issues/58) — arbitrage |
| Le cluster arrache les gestionnaires de signaux tiers | 🟠 | [#59](https://github.com/nodefony/nodefony-core/issues/59) |
| Les noms de rôles sont écrits deux fois, front et back | 🟠 | [#60](https://github.com/nodefony/nodefony-core/issues/60) |
| Une politique de canal ne mord pas sur un canal dynamique | 🔴 | [#61](https://github.com/nodefony/nodefony-core/issues/61) |
| La sonde de disponibilité lit les ports de la config | 🟡 | [#62](https://github.com/nodefony/nodefony-core/issues/62) |
| Bancs : décor non démarré, compte partagé, seuils absolus | 🟠 | [#63](https://github.com/nodefony/nodefony-core/issues/63) |
| 45 s de construction à chaque démarrage du superviseur | 🟡 | [#64](https://github.com/nodefony/nodefony-core/issues/64) |
| Une vingtaine de preuves e2e vivent dans un kit | 🟠 | [#65](https://github.com/nodefony/nodefony-core/issues/65) — backlog |
| Taille du pool de connexions non exposée | 🟠 | [#66](https://github.com/nodefony/nodefony-core/issues/66) |
| Une requête qui échoue ne laisse pas son contexte | 🟠 | [#67](https://github.com/nodefony/nodefony-core/issues/67) |
| Préférences d'administration dans le navigateur | 🟡 | [#68](https://github.com/nodefony/nodefony-core/issues/68) — backlog |
| L'administration ne dit pas qu'un serveur est en dérogation | 🟠 | [#69](https://github.com/nodefony/nodefony-core/issues/69) |
| Un webhook métier doit passer par le journal d'audit | 🟡 | [#70](https://github.com/nodefony/nodefony-core/issues/70) — backlog |
| La hiérarchie de rôles n'a qu'une source statique | 🟠 | [#71](https://github.com/nodefony/nodefony-core/issues/71) — backlog |
| La mémoire système croît hors du tas sous charge | 🟠 | [#72](https://github.com/nodefony/nodefony-core/issues/72) — plafonne sous Linux, donc pas un obstacle à la publication |
| Le profil processeur du 14 juillet n'a jamais été rejoué | 🟡 | [#73](https://github.com/nodefony/nodefony-core/issues/73) |
| La configuration d'un module ne s'édite pas à chaud | 🟡 | [#74](https://github.com/nodefony/nodefony-core/issues/74) — backlog |
| L'injection lit les dépendances héritées de la classe mère | 🟡 | [#75](https://github.com/nodefony/nodefony-core/issues/75) — arbitrage |
| Contrôle des rôles non isomorphe entre client et serveur | 🟠 | [#60](https://github.com/nodefony/nodefony-core/issues/60) (les noms) + [#34](https://github.com/nodefony/nodefony-core/issues/34) (le noyau client) |
| **Collision de `secretHash` en MySQL** — l'insertion en conflit écrase le jeton en place, là où SQLite et PostgreSQL rejettent | 🟡 | **PAS DE TICKET, et c'est un choix.** Le remède serait une lecture avant chaque écriture sur un chemin chaud, pour un cas inatteignable (empreinte aléatoire de 256 bits). L'invariant « un secret ne désigne jamais deux jetons » tient sur les trois dialectes et EST au banc ; la divergence est gravée dans le commentaire de type et testée des deux côtés |
| **Table de routes globale et modifiable** — pas d'isolation entre deux noyaux d'un même process | 🟡 | **PAS DE TICKET.** La surface réelle est le test multi-noyau, pas la production : un process sert un pod. À rouvrir le jour où deux noyaux doivent coexister dans un même process |

#### Trois entrées trop longues pour une cellule de tableau

> Sorties du tableau ci-dessus, où elles n'avaient qu'une colonne sur trois — le rendu
> était cassé, et leur longueur paddait de blancs les 30 autres lignes. Contenu inchangé.

##### ~~`listAll()` matérialise N objets par requête~~

**SOLDÉ `4baa2b4b`→`a358af85`** (chantier pagination) : data planes admin sur `listPage` (pagination native au store), 4 consoles (sessions, clés d'API, users, webhooks) en `DataGrid mode="server"`, tri/filtres/recherche exécutés serveur et **publiés** (`IAdminPageCapabilities`). Reste UN appelant légitime de `listAll()` : le snapshot du dispatcher webhook (`webhooks.ts`, registre entier pour router, pas pour afficher). Journal détaillé → git log + snapshot mémoire IA `core-dev/migration/`.

##### `@nodefony/devkit`

Module `policy:dev` — kit en 8 lots + vagues S1→S5 : **lots 0→5 ✅, lot 7 ✅, S1→S4 ✅ — périmètre 10.0.0 COMPLET** (le code généré est FIGÉ dans l'app à sa création) ; **S5 (UX Studio) = 10.1 ; lots 6·8 non entamés**. Le **protocole MCP vit au CŒUR** (`nodefony/src/mcp/`) — ce module ne porte que la PORTE (`McpController`), et une application ajoute ses outils par `IModule.getMcpTools?()`, ramassés à la demande (`collectMcpTools`) : pas de registre, coût nul en production. **5 skills publiés par npm** dont `nodefony-browser` (sondes d'écran a11y/rendu/réseau/Web Vitals/stockage/responsive + socket applicatif joué DANS la page), éprouvés hors de ce dépôt (app `create app`) et sur `windows-latest`. Détail vivant → kit `project_devkit_ai_kit` + `docs/release/nodefony-10.md` ; journal → git log.

##### Performance du pipeline HTTP — les 5 goulots

**Verdict courant (banc 08-23, production, c64, route identique)** : Nodefony **12 226 req/s** (p50 4,97 ms · p99 9,57 ms) contre **express-fair 13 333** — soit **92 % du débit d'un Express muni des mêmes middlewares** (ALS, CORS, en-têtes de sécurité, CSRF, traceparent, zones), pour +2,40 ms de p99. Repères du même run : `node:http` nu 33 821 · fastify 31 960 · express NU 17 418. ⚠️ Comparer à un serveur nu ou à un Express dépouillé ne compare pas le même TRAVAIL — `express-fair.mjs` est la seule comparaison honnête. **Soak 88 min, 56,8 M de requêtes** : tas PLAT (47,5 → 47,8 MB, pente +0,2 MB/h, R² 0,04) — aucune fuite JavaScript. Le RSS, lui, monte SANS plateau : voir la ligne dédiée ci-dessus, qui porte le chiffre comparable (**+0,55 MB par million de requêtes**). **Capacité d'un pod** (dev, profileur actif ⇒ borne basse) : p99 0,54 ms · 293 µs de boucle par requête · 12,8 KB par socket WS · 9 208 msg/s en écho. ⚠️ Aucun ABSOLU mesuré derrière Docker Desktop n'est transposable (facteur 3,7 constaté) — comparatif sur Linux natif à faire.

Historique du chantier (fabrique CLOSE) : base 9 347 RPS → lots A→D +8,9 %, F-A/F-F/F-C ~+7 % (`ba1f0d17`), F-B fast-path URL +4-10 % (`5fa6ee7a`), F-D rejeté (bruit). **Lot prepared mémoïsé** (SELECT préparés par FORME dans `DrizzleRepository`) : sqlite ~+86/+96 %, PostgreSQL ~+62/+59 % (`8121bef1`). **Pré-filtre de préfixe littéral du routeur** (`a42512e3`) : 26,3 → 2,8 motifs exécutés/req (−89 %) — gain 0,6 %, SOUS le bruit, l'enjeu est la SCALABILITÉ (1 200 routes = 30 % du budget). Sonde `NF_PERF_PROBE=1` à demeure. Reste : updateOne/upsert non mémoïsés, A/B MySQL, index FK scaffold → kit `project_perf_pipeline_p2_kit` ; journal → git log.

### ✅ Audit externe 2026-07-14 — INSTRUIT AU CODE (audit vérité 08-20)

> Les 9 constats, jamais instruits depuis juillet, ont été confrontés au code le 08-20 :
>
> - **5 CONFIRMÉS → montés au tableau des dettes ci-dessus** : `NF__HTTP__TRUSTPROXY=1` cassait le
>   boot (✅ soldé) · `ClusterManager` arrache les handlers tiers · table de routes `static` globale ·
>   `@Body()` injecte le payload brut sans validation de schéma (`routerDecorators.ts:1209` —
>   **TRANCHÉ #58** : la validation vit dans le service, hooks `beforeCreate`/`beforeUpdate`
>   d'`AbstractCrudService`, `await`és donc ouverts à l'asynchrone et communs à REST, socket et
>   CLI ; le décorateur n'accueillera pas de schéma — la résolution des paramètres est synchrone,
>   et la promettre asynchrone taxerait toute requête décorée) · `@inject` lit `getMetadata`
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

## 📊 Avancement — la CARTE (photo du 2026-08-20)

> 🔴 **Trois avertissements, sans lesquels ce tableau induit en erreur.**
>
> **1. Il date.** États vérifiés au code le 20 août, recroisés le 24 — **208 commits `feat`/`fix`
> plus tard**. Une confrontation du 27 août indique que plusieurs cases non cochées correspondent à
> du travail livré. Le tri item par item est le ticket
> [#80](https://github.com/nodefony/nodefony-core/issues/80).
>
> **2. « Pas commencé » n'est pas « en retard ».** **P12** (couche IA agentic), **P15** (média
> WebRTC et SIP) et **P17** (multi-tenant) sont **différées par décision**, hors périmètre de la
> 10.0.0 — leur 0 % est un choix, pas une dette. Les compter dans le global tire un chiffre vers le
> bas sans que rien n'aille mal. De même, un module de P12 sans script `test` n'est **pas** une
> dette : c'est une phase non câblée, et le `CLAUDE.md` le dit déjà.
>
> **3. Ce n'est pas le pilotage.** Ce qui reste à livrer pour la publication vit dans le jalon,
> pas dans ce pourcentage.

> **Recroisement du 2026-08-24** (19 sessions et ~107 commits `feat`/`fix` depuis l'audit vérité) : le **comptage est INCHANGÉ** — aucune tâche n'a changé de statut, le travail de la période porte sur des correctifs, l'outillage de banc et la porte MCP déjà tracés. **Trois écarts corrigés** : les chiffres de performance du § _Performance du pipeline HTTP_ étaient périmés (« base 9 347 RPS vs `node:http` nu ») et cadraient la comparaison contre un serveur qui ne fait pas le même travail → remplacés par le verdict mesuré du 08-23 (**92 % d'Express équipé**, p99 9,57 ms, soak 20 min sans fuite) ; le défaut de démarrage `production` (`dfdada9e`) n'était tracé nulle part ; deux cellules-journal de 8 093 et 3 551 caractères ont été condensées.

> Comptage **autorité = emoji en 1ʳᵉ cellule** de la roadmap (1 ligne = 1 tâche, ⏭️ exclu). `◀` = bloqueur du chemin critique. **MVP sécurité ✅ atteint (P6, resource-server P6.9.x compris) · multi-dialecte S1-S5 ✅ (DDL de production livré : génération, applicateur sous verrou, cinq commandes, garde destructive, verdict `divergent`, et les migrations générées éprouvées sur les TROIS moteurs à la forge) · doctor ✅ → bloqueurs actuels = P8 publication npm + P11 (CLI métier).**

```
━━━━━━ NODEFONY · MIGRATION ━━━━━━━━━━━━━━━━━━━ vérifié code 2026-08-20 ━━━━━━
 P0  Bugs bloquants        ██████████ 100%   6✅  0🔶  0⬜
 P1  Fondations symbiose   ██████████ 100%   8✅  0🔶  0⬜
 P2  Cycle de vie Context  ██████████ 100%   9✅  0🔶  0⬜   (P2.6 idempotency ✅ via @Idempotent)
 P3  Logs structurés       █████████░  85%   7✅  3🔶  0⬜
 P4  Tests symbiose        ██████████ 100%   6✅  0🔶  0⬜
 P5  Session/User/ORM core ████████▌░  85%  13✅  3🔶  1⬜   ◀ (reste P5.0b batch/cron)
 P6  Security              █████████░  87%  29✅  3🔶  3⬜   cœur MVP + resource-server P6.9.x LIVRÉS ; reste P6.9d (serveur d'autorisation, APRÈS release), mTLS, rpId, authz B, logs auth
 P7  ORM drivers           ███████▏░░  72%   3✅  3🔶  1⬜   ◀ BLOQUEUR RELEASE — S1→S4 ✅ ; S5 DDL prod : 10 sous-tickets fermés sous #17 (génération, applicateur, commandes, sonde de disponibilité, app générée, écran de la console) ; **adoption d'une base sans historique ✅** (`orm:migrate:baseline --from-database` ; impossible sur MariaDB — l'outil de lecture de schéma ne lit pas ses `CHECK (json_valid)` — et le refus le NOMME) ; **les commandes éprouvées sur un DÉMARRAGE réel et en intégration continue** (`NF_RUN_CLI_BOOT` posé dans le travail qui monte PostgreSQL et MariaDB — ces bancs ne tournaient jusque-là que sur un poste) ; **audit `fable` de la grappe passé** (cœur, commandes, tests) : la garde d'adoption INTERROGE la base au lieu de déduire, quatre refus ne rejouent plus leur propre refus, le verrou et l'échec SQL rendent enfin les codes qu'ils publiaient, et `repair --forget` donne une sortie à un historique qui ment ; **les refus des commandes sont prouvés sur le MONTAGE et non sur leurs briques** (#120 : adoption d'une base divergente, son exemption `--up-to`, description d'une table du framework — trois moteurs, démarrage réel) ; **le cycle d'ESSAI est nommé** — le refus d'une migration qui échoue dit comment itérer sans détruire, le succès dit comment vérifier que les données ont suivi, et une base d'essai dont l'historique n'est pas le nôtre est RECONNUE au lieu d'être imputée à la base ; **#17 FERMÉ** — la chaîne est livrée et prouvée par la forge (7 jobs/7, dont « une app générée migre une base PostgreSQL réelle », rouge depuis huit jours) ; deux défauts SILENCIEUX l'ont retenue jusqu'au bout, tous deux du sang de #124 — l'outil est fidèle à ce qu'il croit avoir lu, pas à la base : **#125** l'adoption écrivait un index composite inapplicable (une seule classe d'opérateur recopiée sur toutes les colonnes ; la base adoptée ne montre rien, c'est l'exemplaire SUIVANT qui tombe, et la migration s'arrêtant là aucune table suivante n'est créée) — la classe est désormais DEMANDÉE au moteur ; **#126** l'adoption était impossible sur MySQL Community (exclure une table qui porte un `CHECK` tue l'introspection, sortie d'erreur VIDE) — on lit tout et l'on retire après coup. **la grappe est SOLDÉE côté produit** : #118 fermé sur arbitrage (le produit ne pousse plus à détruire — 0 destruction sur 3 runs ; « l'agent écrit une bonne migration » n'est pas gouvernable par un ticket de produit et revient à #99), #122 le refus d'une entité qu'aucun fichier ne fournit est prouvé sur le MONTAGE — sans module de décor, la dérogation `NF_WITH_DEV_MODULES` du produit y suffisait, #123 le refus ne propose plus un second geste QUI NE PRODUIT RIEN (le critère est la COUVERTURE, qui se constate, jamais l'origine de la base, qui se devinerait faux pour toute production à jour), #121 la casse d'un nom rend le MÊME verdict que le moteur — et le banc a fait tomber la première version du correctif : `lower_case_table_names` vaut 0 sur MySQL 8.4, donc les tables y sont SENSIBLES, ce qui dépend de la MACHINE et non du dialecte ; il n'y a donc aucune règle synchrone pour les tables, elles se CONSTATENT. Restent #99 (banc IA), #127 #128 nés de l'instruction, #129 (catalogue des variables d'environnement) et #130 (une génération concurrente ne doit pas écrire une migration amputée) + P7.11 NoSQL
 P8  CLI + Monitoring      █████████░  90%   4✅  1🔶  0⬜   (doctor ✅ ; chaîne de publication ✅ P8.5 — R6 = DETTE ASSUMÉE, jouée AU MOMENT de publier)
 P9  Polish + clôture      ████████░░  75%   3✅  0🔶  1⬜   (P9.4 : 0 vulnérabilité, re-prouvé 08-20)
 P10 Studio (admin web)    ████████░░  84%  12✅  3🔶  1⬜   (P10.6 🔶 : ROLE_NODEFONY_ADMIN actif sur /studio/api/create/* seul)
 P11 CLI par module        █████░░░░░  50%   3✅  2🔶  3⬜   ◀ BLOQUEUR MVP — lifecycle + scaffold ✅ ; orm:migrate ✅ (S5c soldé, #98 : cinq verbes × 3 dialectes, chaque réglage sur son couple) ; reste user:* métier
 P12 Couche IA agentic     █▍░░░░░░░░  14%   0✅  2🔶  5⬜   🧪 différé (llm réel non intégré ; protocole MCP AU CŒUR, module vide ; agent-guard vide)
 P13 Realtime distribué    ████████░░  77%  10✅  3🔶  2⬜   (reste Kafka 13.6a/b · décorateurs 13.8)
 P14 Frontend Vite + iso   ████████░░  81%  14✅  1🔶  3⬜   (P14.18 ✅ origine par Host · svelte5 ✅ · solid retiré)
 P15 Mediasoup + SIP       ░░░░░░░░░░   0%   0✅  0🔶  8⬜   (banc ORM `mod/mediasoup` ≠ implé P15)
 P16 Cloud-Native (10 axes)████▌░░░░░  45%  15✅  0🔶 18⬜   (33 sous-items vérifiés code 08-20 · 16.J /metrics repoussé)
────────────────────────────────────────────────────────────────────────
 GLOBAL                    ███████▏░░  72% 141✅ 24🔶 46⬜  (211 tâches · audit vérité 2026-08-20)
────────────────────────────────────────────────────────────────────────
 DOC Corpus de référence   █████████▋  97%  61/63 pages aux 4 gates (rejoués 08-20) · 437 ancres en DÉRIVE (dette)
 DOC Site public           ██████████ 100%  84 pages PUBLIÉES sur GitHub Pages (f9aaf5de) · accueil + /docs/ + /performance/
 BANC devkit (référence)   █████████▎  93%  28/30 PASS unanimes, 2 runs, décor `MCP eteint` (a851c1a3) · T5+T17 étaient des FAUX ROUGES du banc · restent T18/T22 à 1/2
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

## 🗺️ Ce qui reste à faire, par phase

> **Les 112 lignes FAITES ont quitté ce fichier** : cette histoire vit dans `git log`, et sa photo
> intégrale — cases cochées comprises — dans
> [`docs/archives/migration-roadmap-2026-08-27.md`](docs/archives/migration-roadmap-2026-08-27.md).
> Ne restent ici que les tâches **non faites** (⬜) ou **en cours** (🔶).
>
> ⚠️ **Ces états sont posés à la main, et le dernier audit date du 20 août — 208 commits
> `feat`/`fix` plus tard.** Une confrontation au code menée le 27 août indique qu'une partie de ces
> cases correspond à du travail DÉJÀ livré, sans que le relevé soit assez fiable pour cocher
> quoi que ce soit : ses verdicts « livré » se déclenchaient dès qu'une partie du travail
> existait. Le tri item par item est le ticket
> [#80](https://github.com/nodefony/nodefony-core/issues/80). **En attendant : ne pas conclure
> qu'une tâche est à faire sur la seule foi d'une case — vérifier dans le code.**

> Spécifications détaillées : mémoire IA `core-dev/migration/phases-details.md`.

### Dette `NF_` sur les variables d'environnement — ✅ SOLDÉE

Les 122 noms lus par le framework portent le préfixe, sauf **17 délibérés** : ceux qu'on ne possède
pas (`NODE_ENV`, `CI`, `UV_THREADPOOL_SIZE`…), les alias qu'un hébergeur pose lui-même
(`DATABASE_URL`, `REDIS_URL`, `APP_ENV`) et des fixtures de test. Renommage fait **sans alias de
compatibilité**, avant la première release — après, il aurait fallu un repli transitoire, donc deux
chantiers au lieu d'un.

**La règle, elle, est vivante et vit dans `CLAUDE.md`** (invariants) : aucune variable neuve sans
`NF_`, y compris pour les tests et les interrupteurs de coût des bancs. Le détail du tri famille par
famille est dans `git log` et dans la mémoire `feedback_env_var_nf_prefix`.

### P0 — Bugs bloquants ✅ (6/6)

Tous résolus : 11 fails RFC HTTP, 2 fails WS binary, `getController()` typé, **BUG-001→004** (propagation ALS WS,
leaks scope DI sur erreur/session WS). Tests preuve présents (`http-rfc-errors`, comptage scopes).

### P1 — Fondations symbiose ✅ (8/8)

`Context.phases`, `onAfterResponse`, `signal` (AbortSignal lazy), **`RequestContext` ALS** (requestId/user), `errorRenderer`
unifié HTTP+WS, `logRequest` pluggable, hooks security (`beforeResolve`/`afterAuth`/`onAuthFailure`), graphe symbolique `.ai/symbols.json`.

### P2 — Cycle de vie Context (100 %)

_Aucune tâche restante — le détail des tâches faites est dans [l'archive](docs/archives/migration-roadmap-2026-08-27.md)._

### P3 — Logs structurés (85 %)

<!-- prettier-ignore -->
| # | Tâche | État |
| --- | --- | --- |
| 🔶 P3.6 | Filtrage par requestId (CLI) | `Pdu.requestId` livré ; reste le CLI tool (LB.3b) |
| 🔶 P3.8 | Rate limit logs par requestId | anti-flood livré ; reste clé par requestId |
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
| ⏭️ P5.7 | ~~Adapter Sequelize User~~ | **caduc (virage ORM : sequelize supprimé)** |
| 🔶 P5.10 | Tests User cross-ORM | couvert **de facto** par 2 bancs miroirs même contrat `IUserRepository` (Drizzle 8 + Mongoose 8) ; banc paramétré unifié = optionnel |
| 🔶 P5.12 | `Redis` SessionStorage | File + **Redis livrés** (TTL natif IoC) ; reste câblage prod |

### P6 — Security (87 %) — ✅ cœur MVP LIVRÉ (bloqueur MVP LEVÉ) ; reste durcissement/niches HORS MVP

> **CŒUR P6 BOUCLÉ** — J0→J9 (`1634f09e`→`1df19b93`) + CSRF/CORS/en-têtes (`ebe7e915`/`0724a8c6`/`f4f9ead8`) + CSP nonce (`eb59daf6`). Authenticators Anonymous/Password/Session-BFF/JWT/OAuth2-social/WebAuthn ; autorisation voters + `@IsGranted` (HTTP **et** WS) ; Argon2id + throttle NIST. **Détail-journal = `git log` + mémoires IA + audit vérité `core-dev/migration/AUDIT-verite-2026-06.md` + plan P6 `core-dev/audits/p6-security-audit-2026-06-12.md`.** ✅ **modèle session NIST-aligné** (idle+absolute+touch HTTP+WS, retrait du reliquat PHP `maxLifetimeS`, red-team 11/11, `e27de035`). Reste : P6.16 rpId multi-vhost · P6.9b mTLS (niches). App pose `users` en prod (`3d140de1`, auth prod réparée). Audit persistant P6.18 ✅ (multi-dialecte S3/S4).

<!-- prettier-ignore -->
| # | Tâche | Preuve / état (détail → git log + mémoires IA) |
| --- | --- | --- |
| 🔶 P6.8 | `authorization.ts` (3 niveaux) | J6 `4e336d50` : RoleVoter + `decide()` affirmative+DENY véto, voterRegistry ; reste niveau B (ACL fine par ressource) |
| ⬜ P6.9d | **Serveur d'autorisation OAuth 2.1** (code flow + PKCE) | **NON FAIT — TRANCHÉ (décision user) : APRÈS la release 10.0.0.** Conséquence assumée : la 10.0.0 sort avec un MCP dont la sécurité est complète et prouvée, mais dont le jeton s'obtient **hors bande**. Le report déplace la charge sur la DOCUMENTATION (comment obtenir et poser le porteur). Nodefony ÉMET des jetons et publie de quoi les vérifier (RFC 8414 + JWKS), mais n'offre aucun **flux d'obtention** normatif : ni `authorization_endpoint`, ni `token_endpoint`. Conséquence CONSTATÉE sur un vrai client : le SDK MCP exige les deux champs et refuse la connexion — alors que le document est LÉGAL sans eux (RFC 8414 §2). **Ce n'est PAS un prérequis du MCP authentifié** : la spec impose le porteur, pas le moyen de l'obtenir. C'en est un pour un client qui doit obtenir son jeton SEUL. |
| ⬜ P6.9b | `MTlsAuthenticator` | zones admin (niche, non démarré) |
| 🔶 P6.10 | Logs auth + CSP stricte + headers | J5-A `SecurityHeaders` (CSP + Referrer + COOP/COEP/CORP + Permissions-Policy) ; reste logs auth dédiés |
| 🔶 P6.15 | Studio — section Sécurité | Pages LIVRÉES : Sessions/Users/API Keys/Firewall/Audit/Profil self+admin (`8d54bf4a`→`486eb75b`) ; reste live `security:audit` (canal OFF) |
| ⬜ P6.16 | WebAuthn — `rpId` dynamique par Host (multi-vhost) | `#rpID` figé au boot (`webAuthn.ts`) → dériver du `Host` de la requête |

### P7 — ORM Drivers (64 %) ◀ **BLOQUEUR RELEASE** — multi-dialecte sqlite/pg/mysql = condition de release ; **comparatif froid ✅ (`a370b5a1`) → Drizzle CONFIRMÉ**, portage débloqué (`orm-comparatif-froid-2026-07`, mémoire IA `core-dev/audits/`)

<!-- prettier-ignore -->
| # | Tâche | État |
| --- | --- | --- |
| ⏭️ P7.1 | ~~Sequelize (legacy)~~ | **SUPPRESSION COMPLÈTE** (virage ORM, `716fce6`) |
| ⏭️ P7.3 | ~~Tests intégration Sequelize~~ | caduc |
| 🔶 P7.5 | Tests Mongoose | **156 verts / 12 fichiers contre un MongoDB 8 RÉEL** (docker `--profile mongo`, replica set — mesuré 07-23 ; `MONGO_GATE` pose `NF_MONGO_TEST_URI`, `gateReporter` confirme « cible exercée »). Les 5 briques déclarées sont exercées par LEUR store : session 37 · webhooks 20 · jetons 24 · passkeys 24 · user 17 · orm-core 13 · transactions/eager-load/cycle de vie 14. ⚠️ **La mention « 0 E2E / memory-server seulement » qui figurait ici était FAUSSE** — corrigée en la LANÇANT (le décor docker existe depuis le début ; `mongodb-memory-server` n'est que le repli hors ligne). **Reste** → tout est porté par **P7.11** : parité de contrat (4 suites partagées ne tournent que sur drizzle) et E2E système (aucun serveur Nodefony bootté sur Mongo — les bancs montent les services à la main, sans Kernel). Étude complète : mémoire IA `project_orm_multidialect_chantier_kit` |  |
| 🔶 P7.7 | `@nodefony/redis` refactor | conventions/config Zod faites |
| 🔶 P7.10 | ⭐ **Portabilité multi-dialecte (CRITIQUE RELEASE)** | **Slice 0 + S1→S4 ✅** (`5bcd2d7f`→`0ac019ef`, 06-26→07-08) : `connector.dialect` sqlite/postgres/mysql, repository **PK-portable**, **colKit** (spec logique → table du dialecte, G1) + **queryKit** (SQL natif routé : `json_each`/`@>` jsonb/`JSON_CONTAINS`, bindé), chemins sans-RETURNING mysql, idempotence `INSERT IGNORE`+vol, `mysqlJsonCompat` (LONGTEXT MariaDB). **LES 8 BRIQUES × 3 DIALECTES** — preuves : **drizzle 274/274** dont **banc de parité de contrat `IRepository` 14×3** + 41 e2e PG réel + 33 e2e MySQL 8.4 ET MariaDB 11.4 (gatés `NF_PG_URL`/`NF_MYSQL_URL`). Comparatif froid ✅ Drizzle CONFIRMÉ (`a370b5a1`, garde-fous G1-G3). **Reste : S5 DDL prod** — S5-0 (dettes de DDL) ✅ `81a9813c` · **S5-R (registre de disponibilité `/readyz`) ✅** ([#95](https://github.com/nodefony/nodefony-core/issues/95)) · **S5a (migrations du framework GÉNÉRÉES) ✅** `4d25742d`→`dfeb8a14` ([#96](https://github.com/nodefony/nodefony-core/issues/96)) : `0000_framework_init` × 3 dialectes versionné et publié, contrôle de dérive en CI, trois refus à la génération (destructeur / renommage / verrouillant), et un **banc de parité** qui prouve sur sqlite + PostgreSQL + MariaDB + MySQL Community qu'une base migrée est identique à une base à DDL dérivé · **S5b (APPLICATEUR `DrizzleMigrator`) ✅** `c4998acb` ([#97](https://github.com/nodefony/nodefony-core/issues/97)) : plan/validate/migrate/baseline/repair, table `nodefony_migrations(source,tag)` **auto-amorcée**, verrou natif d'identité GRAVÉE (`pg_advisory_lock` / `GET_LOCK` qualifié par `DATABASE()`) sur **connexion unique** — un pool rendrait un verrou de session inopérant —, empreinte `sha256:` normalisée CRLF→LF, sources en espace de noms OUVERT, verdicts `NF_MIGRATE_*` structurés ; **12 des 14 cas sqlite vus ROUGES** par débranchement, e2e verrou/échec sur PostgreSQL + MariaDB 11.4 + MySQL 8.4 — design ✅ VALIDÉ 07-10 (`orm-migrations-design-2026-07`, mémoire IA `core-dev/audits/` : drizzle-kit + applicateur MAISON `DrizzleMigrator`, table `nodefony_migrations(source,tag)`, lock natif, modes ddl auto/migrate/none), **S5c (commandes + config + sonde) 🔶 EN COURS** `5139f48e`→`3d2b6f48` ([#98](https://github.com/nodefony/nodefony-core/issues/98)) : les **cinq verbes** `orm:migrate`/`:status`/`:baseline`/`:repair` + `orm:reset`, config Zod (`ddl` par connecteur, `migrations.{dir,check,lockTimeoutMs,divergence}`) aux défauts résolus par environnement (`migrate` n'est JAMAIS un défaut), démarrage qui OBÉIT au mode et l'énonce, sonde `/readyz` retenue avec re-vérification périodique (`/livez` jamais touché), grille de codes FIGÉE 0/1/2, `formatVersion: 1` à cœur neutre, `--json` flux pur même en échec, et un **garde destructif** hors énoncé (refus d'un `DROP` de données hors développement ; au démarrage, sans drapeau pour le lever) ; 44 tests dont **8 vus ROUGES** par débranchement et 7 cas sur BOOT RÉEL. `94b3f1e2` a branché `schemaDiff.ts`, jusque-là CODE MORT : le démarrage en `auto` **rattrape** les colonnes qui acceptent le vide, **refuse** d'inventer les obligatoires, et l'ordre de connexion devient tables → rattrapage → index — parce qu'un `CREATE INDEX` sur une colonne absente TUAIT la connexion, ce que la conception ne pouvait pas voir. Le verdict `divergent` (la TROISIÈME source : historique complet, rien en attente, base pourtant fausse) ne se calcule que si les deux autres sources n'ont plus rien à dire, ignore ce qui est EN TROP, et ne bloque qu'à la demande. `08cc9f3f` livre la page `docs/migrations.md` (patron d'orchestrateur, droits du compte qui migre, expansion/contraction, pourquoi PAS de sauvegarde automatique) et corrige **7 documents** qui niaient encore les migrations — dont le gabarit figé dans chaque application créée. Le verdict **NOMME** désormais ce qui diverge (`d4b57b9e`, [#105](https://github.com/nodefony/nodefony-core/issues/105)) : `describeDivergence()` remplace le booléen et PRODUIT le verdict — un `divergent` sans détail est devenu impossible à construire ; la clé `divergence` vit au premier niveau (cœur neutre) et est ABSENTE, jamais vide, sur base conforme ; les gestes suivent l'environnement (`resetAllowed()`, source unique lue par `orm:reset` qui refuse ET par le rendu qui propose). Quatre débranchements vus mordre, dont un sur PostgreSQL réel. Et une base sans tables cesse d'être une panne (`44d137c3`, [#107](https://github.com/nodefony/nodefony-core/issues/107)) : le détecteur de #98 devient `schemaMismatchOf`, GRADUÉ (`certain` PG/MySQL, `probable` SQLite au message figé) — un seul détecteur, deux seuils, le corps d'erreur HTTP restant à `certain`. **S5c ✅ SOLDÉ** (`d9f0fe67`→`66805fc8`, #98 fermé) : les cinq verbes tournent sur un BOOT RÉEL sur les TROIS dialectes, et **chaque réglage est prouvé sur son couple** — le refus sans le drapeau, le travail avec (`migrate-reglages.test.ts`, 69 cas × 3 dialectes). Quatre faux positifs silencieux fermés, qu'aucun test n'exerçait : `--up-to` sur un tag inconnu adoptait TOUT l'historique en rendant 0 ; `--source` sur un nom inconnu rendait « rien à réparer » sans rien toucher ; un `.sql` annoncé par le journal mais absent remontait un `ENOENT` nu ; et **`NF_MIGRATE_DATABASE_URL` était JETÉE en silence sur un connecteur sqlite** — un travail de déploiement migrait alors une base locale éphémère et rendait le code du SUCCÈS, les pods démarrant ensuite sur une base jamais migrée. Deux pièges d'encodage payés par Windows au passage (marque d'ordre des octets comptée dans l'empreinte ; ligne à deux tirets DANS une chaîne littérale prise pour un commentaire), et la couleur des commandes rebranchée sur la règle du cœur (`NO_COLOR`/`FORCE_COLOR` étaient ignorés, donc aucune sortie colorée n'était capturable). **Non couvert, énoncé à la fermeture** : le refus « ce connecteur ne porte pas de migrations » contre un mongoose RÉEL (le dépôt ne charge pas le module), et la sonde de disponibilité DÉBRANCHÉE vue faire tomber un banc. Puis **S5d (écran)**. Détail-journal = `git log` + `project_orm_multidialect_chantier_kit` |
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
| 🔶 P8.4 | `Metrics` runtime | via Studio (ticker stats → canal `nodefony:supervision`, `studio/nodefony/realtime/providers.ts`), pas service standalone ; `/metrics` Prometheus = 16.J repoussé |

### P9 — Polish + clôture (75 %)

<!-- prettier-ignore -->
| # | Tâche | État |
| --- | --- | --- |
| ⬜ P9.2 | Barrels `index.ts` | résiduel |

### P10 — Studio admin web (84 %)

<!-- prettier-ignore -->
| # | Tâche | État |
| --- | --- | --- |
| 🔶 P10.6 | Auth admin (`ROLE_NODEFONY_ADMIN`) | rôle actif sur `/studio/api/create/*` (`@IsGranted`, `StudioCreateController.ts`) ; reste : le généraliser à toute la surface `/nodefony` (vérif audit 08-06) |
| 🔶 P10.9 | Vues firewall/logs/databases/migrate | Logs ✅ (WS) + Databases ✅ + Firewall ✅ (cf P6.15) ; reste migrate (S5d, gelé) |
| 🔶 P10.10 | Vues services/profiling | incrémental (~~pm2~~ retiré C6) |
| ⬜ P10.11 | Tests intégration studio | 0 test studio (vérif 06-28) — back couvert e2e via security |

### P11 — CLI par module (50 %)

<!-- prettier-ignore -->
| # | Tâche | État |
| --- | --- | --- |
| 🔶 P11.1 | Tests intégration commandes existantes | filet spawn livré (`NF_RUN_CLI_BOOT=1`) + **renforcé `0b883854`** (typo=EX_USAGE 64, happy-path commande de module `http:network` 1-Kernel/0-serveur, point d'arrêt `onReady`, `status` standalone 0-Kernel) ; **refacto parse-pur `4a7d46ae`** (resolveCommand point unique, `runProfile` déclaratif → commande de module SERVER possible, `finishOrPark` uniforme) ; **lancement détaché natif `be9ca8b2`** (`--detach --wait --health`, fast-path standalone, `start.sh` = wrapper mince) ; reste commandes métier |
| ⬜ P11.2 | Commandes `http:*` | couplée API admin Studio |
| 🔶 P11.3 | Commandes `framework:*`/`security:*`/`user:*` | **`security:secrets` ✅ (`ac095e38`→`faa743eb`)** : génère les clés (TOTP/webhook/CSRF, 32 o base64) + câblage 3 fichiers `.env.local`→`env.ts`→`use()`, détection par clé, `--write` gardé (refus si tracké git) — référencée par les 3 warnings « clé ÉPHÉMÈRE » ; **`security:user:add` ✅ (`4ac7245e`)** : création de compte (hash Argon2id via UserService, prompt masqué TTY, `--admin` = rôles Studio), fix kernel `finishOrPark` console à `onPostReady` (process fantôme). Reste `framework:*` + `user:*` métier (dont `security:user:password`) |
| ✅ P11.4 | Commandes `orm:migrate/…` | **LIVRÉ** — six verbes : `orm:generate` (`712c4286`, écrit les migrations de l'APPLICATION : découverte des entités, module à ré-exports plats, drizzle-kit piloté, trois refus nommés, `--custom`), `orm:migrate`/`:status`/`:baseline`/`:repair` et `orm:reset`. Applicateur MAISON `DrizzleMigrator` (~~délégation aux CLI ORM natifs~~ REJETÉE : migrator drizzle prouvé insuffisant au code). Conception : `orm-migrations-design-2026-07` (mémoire IA `core-dev/audits/`). Page utilisateur : `src/packages/@nodefony/drizzle/docs/migrations.md`. Reste l'écran Studio (#100) |
| ⬜ P11.5 | Commandes `logs:tail/filter` + bridge Studio | LB.3b |

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
| 🔶 P13.1 | TCP/UDP/Unix sockets | scaffold ; code protocoles reste (niche différable) |
| 🔶 P13.2 | `@nodefony/redis` refactor | fondation conventions faite ; **cloison des clés par application** `e43530ae`+`2820a219` (`keyNamespace` — sessions, jetons, WebAuthn, idempotence) ; 110 tests |
| ⬜ P13.6a | `KafkaBackplane` (driver seul) | 4 briques réutilisées telles quelles ; seam transport injectable, 0 dep ajoutée |
| ⬜ P13.6b | Module `@nodefony/kafka` | connexions + config + santé ; **attend un 2ᵉ consommateur** (bus events métier / P12 agents) |
| 🔶 P13.8 | Décorateurs `@RealtimeAction`/`@RealtimeChannel` | 3 décorateurs livrés ; reste pattern RegExp |

> **Dettes backplane multi-pod / multi-app** (détail : [`@nodefony/realtime` — configuration](src/packages/@nodefony/realtime/docs/configuration.md)) :
>
> - ✅ **#1 + #2 RÉSOLUES (`c082560`, 2026-06-12)** : `resolveBackplaneOriginId()` = `(NF_POD_NAME ?? hostname):pid` (anti-écho fiable cross-pod k8s) + champ `backplane.namespace` (Zod) → canal `nodefony:realtime:<ns>` dérivé de `kernel.projectName` (fin du cross-talk multi-app Redis mutualisé). +9 tests.
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
| 🔶 P14.7 | CLI `frontend:create/build/dev` | commands existent (bug CLI) ; skill scaffold ✓ |
| ⬜ P14.12 | Plugin Vite Nodefony (alias + env) | zéro config dev |
| ⬜ P14.14 | API CSP origines dynamiques | remplace hack POC |
| ⬜ P14.16 | Syslog isomorphe (logs front → back) | traçabilité front — [#35](https://github.com/nodefony/nodefony-core/issues/35) ; le socle EXISTE déjà (`Syslog`/`Pdu` isomorphes exportés, `x-request-id` sur le fil, `logs/search?requestId=` servi) |

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
| 16.B HTTP | ✅ B.1 `/livez`+`/readyz` natifs (court-circuit `http-kernel.ts:978`, readiness 503 au SIGTERM **et tant qu'un composant RETIENT la mise en service** — registre `kernel.setReadiness()`, verdict déjà calculé, registre `null` tant que personne ne s'inscrit ; `livez.ready` du plan d'administration et `nodefony status` rendent le MÊME verdict) · ✅ B.2 `Forwarded` RFC 7239 + XFF anti-spoof (chantier clos 06-07, banc Docker E2E) · ✅ B.3 `trustProxy` gate (`config.ts:980`) |
| 16.C Secrets | ⬜ C.1 `ISecretProvider` · ⬜ C.2 `SecretManager` · ⬜ C.3 hook boot · ⬜ C.4 migration des secrets — 0 occurrence des symboles (vérifié 08-20) ; dépend P6, design au kit |
| 16.D Docker | ⬜ D.1 `Dockerfile.dev` · ✅ D.2 Dockerfile PROD multi-stage (gabarit `create app` : HEALTHCHECK `/readyz`, USER node, node PID 1 — prouvé sur app générée depuis le tarball) · ✅ D.3 compose (`docker/docker-compose.yml`) · ✅ D.4 profils (postgres/mongo/redis/kafka/tools/loki/opensearch/proxy/browser) · ✅ D.5 réseau bridge + alias DNS |
| 16.E Skills/Tooling | ⬜ E.1 `docker-debug` · ⬜ E.2 `infra-up` · ⬜ E.3 détection conteneur dans start-server — absents de `.claude/skills/` |
| 16.F Cleanup PM2 | ✅ F.1 code retiré (0 occurrence `pm2Service`/`Pm2Command`/`NF_MODE_START==="PM2"`) · ✅ F.2 dep npm retirée · ⬜ F.3 doc migration PM2→systemd/docker |
| 16.G Docs DevOps | ⬜ G.1 env-vars · ⬜ G.2 health-endpoints · ⬜ G.3 quickstart-docker · ⬜ G.4 quickstart-k8s — seul `docs/guides/docker-cloud-native.md` existe (partiel) |
| 16.H Scaling multi-process | ✅ H.1 topologie `workers` · ✅ H.2 `cluster -w N` (`ClusterManager`, cgroup-aware) · ✅ H.3 sonde/worker · ✅ H.4 Studio cluster · ⬜ H.6 banc backplane cross-pod k8s (l'anti-écho `resolveBackplaneOriginId` = `(NF_POD_NAME ?? hostname):pid` EST livré, `originId.ts:24`) |
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

## 🧭 Où lire le reste-à-faire — PAS ici

> **Ce fichier est une CARTE, plus un tableau de bord.** Le reste-à-faire de la 10.0.0 vit dans le
> jalon [`10.0.0`](https://github.com/nodefony/nodefony-core/milestone/1) et son tableau de bord :
> un ticket porte un état que personne n'oublie de changer, une liste écrite à la main se périme
> entre deux sessions. Les trois sections qui vivaient ici — chemins, blockers, prochaine étape —
> l'avaient prouvé : elles envoyaient encore travailler sur les commandes `framework:*`, sorties du
> périmètre par [#32](https://github.com/nodefony/nodefony-core/issues/32).

| Ce qu'on cherche                                               | Où                                                                                        |
| -------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Ce qui reste, dans l'ordre                                     | le tableau de bord, ou **hors ligne** l'empreinte commitée [`.ai/BOARD.md`](.ai/BOARD.md) |
| Le périmètre et l'échéance                                     | [`docs/release/nodefony-10.md`](docs/release/nodefony-10.md) §8 et §10.9                  |
| Le POURQUOI d'une décision                                     | ce fichier (§ Décisions), les `docs/adr/`, les `CLAUDE.md`/`MEMORY.md` de module          |
| Ce qui est FAIT                                                | `git log` — jamais une case cochée à la main                                              |
| Ce qu'une variable `NF_*` fait, et ce que son ABSENCE provoque | l'empreinte générée [`.ai/ENV.md`](.ai/ENV.md) (`npm run env:snapshot`)                   |

**L'empreinte `.ai/BOARD.md` est GÉNÉRÉE** (skill `nodefony-session`, `scripts/board-snapshot.mjs`)
et ne s'édite pas : c'est ce qui l'empêche de mentir comme mentaient les sections retirées.

**Ce que ce fichier garde**, et qu'aucun ticket ne porte : la carte des phases, les décisions
stratégiques, l'**index des dettes transverses** (§ dédié — chacune renvoie à son ticket, et les deux qui n'en ont pas portent leur verdict)
et l'état vérifié des sous-items P16.

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
