---
title: "Migrations de schéma SQL — conception (chantier ORM S5)"
module: "@nodefony/drizzle"
status: "VALIDÉ 2026-07-10 — implémentation gelée (reprise après P8 + P11)"
audience: "framework authors"
---

# Migrations de schéma SQL — document de conception (S5)

> **Statut : design VALIDÉ (2026-07-10) — aucun code écrit ; implémentation gelée,
> reprise APRÈS P8 (CLI+Monitoring) et P11 (CLI par module). Kit de reprise :
> mémoire IA `project_orm_multidialect_chantier_kit` §S5.**
> Étude préalable : 4 recherches approfondies (Flyway/Liquibase · Doctrine/Django/Rails/Laravel ·
> patterns cloud-native k8s · drizzle-kit/Prisma/Atlas vérifiés au code source), croisées avec la
> lecture du migrator embarqué `drizzle-orm@0.45.2` (node_modules) et du terrain Nodefony
> (colKit, DrizzleOrm, CliKernel, readyz).

---

## 1. Pourquoi — l'état des lieux et le trou

### Ce qu'on a aujourd'hui

Le chantier multi-dialecte (S1→S4) a livré **8 entités framework** (session, user, tokens ×3,
webauthn, totp, audit, webhook, idempotency) définies en **specs colKit** et portées sur
**3 dialectes** (sqlite, postgres, mysql/mariadb). Leur DDL est dérivé **au boot** :
`DrizzleOrm.onConnect()` émet un `CREATE TABLE IF NOT EXISTS` par entité
(`DrizzleOrm.ts:163` `#buildCreateTable`).

C'est parfait en **dev/test** : zéro friction, la base suit le code, les tests `:memory:`
fonctionnent sans rien.

### Le trou (prod)

1. **`CREATE TABLE IF NOT EXISTS` ne fait pas évoluer un schéma.** Si la v10.1 ajoute une
   colonne à `audit_event`, une base créée en v10.0 ne l'aura jamais : la table existe déjà,
   le boot ne la touche plus. Premier `INSERT` → erreur runtime. C'est le mode de défaillance
   silencieux classique.
2. **Moindre privilège impossible.** Le boot fait du DDL → le user DB de l'app doit avoir les
   droits `CREATE`. En prod cloud-native on veut l'inverse : l'app en DML-only
   (`SELECT/INSERT/UPDATE/DELETE`), le DDL appliqué au déploiement par un rôle dédié.
3. **Aucune trace, aucun audit.** Quel schéma tourne ? Depuis quand ? Appliqué par qui ?
   Aujourd'hui : impossible à répondre. (Rappel doctrine : jamais de dégradation silencieuse.)

### La promesse S5

Des **migrations SQL versionnées par dialecte**, générées depuis nos specs colKit,
**livrées dans le paquet npm**, appliquées par une commande explicite `nodefony orm:migrate`
— avec l'état complet visible dans Studio, et un déroulé cloud-native de référence.

---

## 2. État de l'art — ce qu'on apprend des autres

### 2.1 Les mécaniques qui font consensus (Flyway, Liquibase, Prisma, Atlas)

| Mécanique                                                                | Qui                                                                                       | Ce qu'on retient                                                                                                                                                                                                                                                 |
| ------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Table d'historique riche** (version, checksum, durée, succès, par qui) | Flyway `flyway_schema_history`, Prisma `_prisma_migrations`                               | La table EST l'observabilité. Colonnes succès/échec conservées → diagnostic.                                                                                                                                                                                     |
| **Checksum vérifié à chaque apply**                                      | Flyway (CRC32), Prisma (sha256), Atlas (`atlas.sum`)                                      | Un fichier modifié après application = STOP. Protège contre le drift dev↔prod.                                                                                                                                                                                   |
| **Transaction par migration** (quand le SGBD le permet)                  | Flyway                                                                                    | PG/SQLite : échec → rollback propre de LA migration.                                                                                                                                                                                                             |
| **Échec = marqueur persistant + réparation explicite**                   | Prisma (`P3009` : deploy refuse tant que non résolu, `migrate resolve`)                   | Fail-loud. Jamais de retry aveugle sur un état partiel.                                                                                                                                                                                                          |
| **Baseline** (adopter une base existante)                                | Flyway `baseline`, Django `--fake-initial`, Prisma `resolve --applied`                    | Indispensable pour NOUS : toute base actuelle a déjà les tables (créées par le DDL boot).                                                                                                                                                                        |
| **Séparation dev / prod**                                                | Prisma `migrate dev` vs `migrate deploy`                                                  | En prod : appliquer les pending, rien d'autre. Pas de génération, pas de prompt, pas de reset.                                                                                                                                                                   |
| **Forward-only**                                                         | Consensus total (Flyway undo = payant, Prisma/drizzle-kit = pas de down, Atlas argumente) | Le rollback DB n'existe pas en pratique (un down `DROP COLUMN` détruit les données ; un down non testé = « plan de reprise jamais répété »). Le rollback réel = redéployer le code N-1 sur un schéma expand-compatible + PITR pour le désastre.                  |
| **Lock anti-concurrence**                                                | Flyway (advisory PG), Liquibase (table — zombie documenté)                                | 2 process qui migrent en même temps = corruption. PG `pg_advisory_lock` et MySQL `GET_LOCK` sont **auto-libérés à la mort de la connexion** (pod OOM-killed inclus) → jamais de lock zombie, contrairement au lock-par-table Liquibase (déblocage 100 % manuel). |

### 2.2 La question centrale : comment un PACKAGE livre-t-il son schéma à l'app hôte ?

Trois modèles dans l'industrie (vérifiés au code source par l'étude) :

| Modèle                                                                            | Qui                                                                               | Verdict pour Nodefony                                                                                                                                                                                                                                                                  |
| --------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **(a) Le package livre le MAPPING, l'app génère TOUTES les migrations par diff**  | Doctrine/Symfony (les bundles livrent des entités, l'app fait `migrations:diff`)  | ❌ L'app devient propriétaire du schéma framework : chaque upgrade exige un diff manuel par app, le framework ne peut plus **garantir** son schéma (le code des stores en dépend). Et Symfony lui-même y déroge pour ses tables techniques (`messenger_messages`, `rememberme_token`). |
| **(b) Le package LIVRE ses migrations, exécutées EN PLACE, historique namespacé** | Django (`site-packages/<pkg>/migrations/` + table `django_migrations(app, name)`) | ✅ **Notre modèle.** Zéro action à l'install, upgrade npm = nouvelles migrations disponibles, le framework garantit son schéma. Le seul modèle qui traite les tables d'infrastructure comme ce qu'elles sont.                                                                          |
| **(c) Le package livre, l'app COPIE et renumérote**                               | Rails engines (`install:migrations`), Laravel `vendor:publish`                    | ❌ Étape manuelle à rejouer à chaque upgrade (oubliable), divergence si l'app édite la copie. Justifié quand l'app doit pouvoir ÉDITER les tables du package (Laravel Jetstream) — pas notre cas : nos 8 tables sont consommées par le code du framework, pas par l'app.               |

**Pièges documentés qui condamnent le pool plat façon Flyway** : les `locations` multiples de
Flyway fusionnent tout dans UN espace de versions global — le cas « lib + app » est une issue
ouverte non résolue chez eux (#3003) : collision de numéros, coordination manuelle. Le modèle
Django (identité namespacée `(source, nom)`) supprime la classe de bug à la racine.

### 2.3 Et dans l'écosystème Node.js ?

**Personne ne le fait.** Prisma et drizzle-kit sont mono-projet ; les libs d'auth (Lucia,
Auth.js, better-auth) s'arrêtent à « voici le SQL/schéma de référence, copiez-le » ; Medusa v2
(le plus outillé) a des migrations par module mais un ORM imposé. La demande existe upstream
chez Drizzle (#1365 « Django-style domain-scoped migrations », ouvert depuis 2023, re-demandé
en 2026) — jamais résolue. **Nodefony comble un trou réel.**

### 2.4 Pourquoi PAS l'applicateur natif de drizzle-orm (preuve par le code)

On a lu `drizzle-orm@0.45.2/…/migrator.js` + les `dialect.js`. L'applicateur natif :

1. ne compare que le **timestamp de la DERNIÈRE ligne** (`ORDER BY created_at DESC LIMIT 1`) :
   toute migration dont le `when` est antérieur (upgrade du framework pendant que l'app a
   avancé, merge de branche) est **skippée en silence** — bug connu (#5316, corrigé en
   v1-beta uniquement ; #5769 ouvert) ;
2. stocke un `hash` sha256 **jamais relu** (zéro détection de modification) ;
3. n'a **aucun lock** anti-concurrence (#874, ouvert depuis 2023, scénario k8s décrit) ;
4. exécute tout dans **une seule transaction globale** (pas par migration), illusoire en
   MySQL (chaque DDL = commit implicite) ;
5. n'a ni statut, ni dry-run, ni baseline, ni réparation.

**Décision : on garde 100 % du FORMAT drizzle-kit** (génération, journal, snapshots,
breakpoints — solide, committable, outillé) **et on écrit l'applicateur** (`DrizzleMigrator`,
~400 lignes) qui consomme ces fichiers avec la rigueur Flyway/Prisma. Le meilleur des deux
mondes, et zéro dépendance runtime nouvelle.

---

## 3. Architecture Nodefony

### 3.0 Vue d'ensemble — le cycle de vie complet

```
┌─ DEV FRAMEWORK (repo nodefony-core) ─────────────────────────────────────┐
│  specs colKit (8 entités) ──[drizzle-kit generate ×3 dialectes]──►       │
│  src/packages/@nodefony/drizzle/migrations/{sqlite,postgres,mysql}/      │
│     ├── 0000_framework_init.sql        (versionné git, livré npm)        │
│     └── meta/_journal.json + snapshots                                   │
└──────────────────────────────────────────────────────────────────────────┘
                                   │ npm publish (files += migrations)
                                   ▼
┌─ APP UTILISATEUR ────────────────────────────────────────────────────────┐
│  node_modules/@nodefony/drizzle/migrations/…      ← source "framework"   │
│  <app>/migrations/{postgres}/…                    ← source "app"         │
│     (drizzle-kit generate sur SES entités, ou orm:generate --custom)     │
└──────────────────────────────────────────────────────────────────────────┘
                                   │
                                   ▼
┌─ APPLICATION (par environnement) ────────────────────────────────────────┐
│  dev/test : ddl "auto"    → DDL dérivé au boot (comme aujourd'hui)       │
│  single-node : ddl "migrate" → DrizzleMigrator au boot (lock, opt-in)    │
│  prod k8s : ddl "none"    → Job `nodefony orm:migrate` AVANT le rollout  │
│             + readiness : pod pas ready tant que le schéma est en retard │
└──────────────────────────────────────────────────────────────────────────┘
```

### 3.1 Génération (drizzle-kit, devDependency du framework)

- **3 schémas matérialisés** : `nodefony/migrations-schema/{sqlite,postgres,mysql}.ts` —
  chacun appelle les 8 factories colKit avec son dialecte et exporte les tables. Fichiers
  purs (aucun accès kernel — règle config-lazy déjà respectée par les entités).
- **3 configs drizzle-kit** : `drizzle-kit/{sqlite,postgres,mysql}.config.ts`
  (`dialect`, `schema`, `out: "migrations/<dialecte>"`, `prefix: "index"` → `0000_…`).
- **Script unique** `npm run generate:migrations -- --name <nom>` : enchaîne les 3 dialectes
  avec le **même nom** imposé → les 3 journaux restent alignés (même liste de tags).
  Un check refuse de générer si les 3 journaux divergent.
- **`drizzle-kit check`** en pre-commit/CI : détecte un fork de snapshots (2 branches qui
  génèrent en parallèle).
- Les migrations générées sont **versionnées git** et **livrées npm**
  (`package.json.files += ["migrations"]`). Résolution runtime : `Module.path` (déjà résolu
  par le kernel, y compris depuis `dist/`) → `<module>/migrations/<dialecte>`.
- **Drift-check** (script, session de dev) : régénère dans un tmp et diff avec le versionné →
  détecte « une entité colKit a changé sans migration ».

> ⚠️ Règle gravée : **un tag publié sur npm est immuable à vie** (le renommer/renuméroter
> casse la détection chez tout consommateur qui l'a déjà appliqué — piège documenté Flyway
> #606, Liquibase, Django). Squash interdit après GA.

### 3.2 Distribution — 2 sources, ordre déterministe

| Source      | Dossier                                                        | Historique                  | Qui génère                                                                                                              |
| ----------- | -------------------------------------------------------------- | --------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `framework` | `node_modules/@nodefony/drizzle/migrations/<dialecte>/`        | lignes `source='framework'` | le repo framework (drizzle-kit sur colKit)                                                                              |
| `app`       | `<app>/migrations/<dialecte>/` (configurable `migrations.dir`) | lignes `source='app'`       | l'app : drizzle-kit sur SES entités (devDep), et/ou `orm:generate --custom` (SQL libre : vues, triggers, seeds, FK SQL) |

- **Ordre d'application : framework d'abord, app ensuite** (les entités app peuvent référencer
  les tables framework). À l'intérieur d'une source : l'ordre du journal (`idx`).
- Les deux séquences sont **indépendantes** : l'upgrade du framework qui apporte une
  `0003_...` framework s'applique même si l'app en est à sa 47ᵉ migration. Pas d'espace de
  versions partagé = pas de collision possible (leçon Flyway #3003).
- **Convention FK cross-source** : les entités app ne doivent PAS importer les tables
  framework dans leur schéma drizzle-kit (sinon le diff app re-CREATE les tables framework).
  Cohérent avec l'ORM Nodefony (relations déclaratives + eager-load manuel, pas de FK
  imposée). Une FK SQL réelle vers `user.id` → migration `--custom`.

### 3.3 L'applicateur : `DrizzleMigrator`

Nouveau composant du module drizzle (`nodefony/src/migrator/`). Réutilise `DrizzleOrm` en
mode lib pour la connexion (lazy import pg/mysql2 déjà en place ; un connecteur sans entités
n'émet aucun DDL) → **zéro duplication driver, zéro dépendance nouvelle**.

#### La table d'historique : `nodefony_migrations`

Une seule table (pas une par source) : l'état complet se lit d'un SELECT (Studio), la colonne
`source` namespace les historiques (modèle `django_migrations(app, name)`).

```sql
CREATE TABLE nodefony_migrations (
  id            <PK auto>,
  source        TEXT    NOT NULL,   -- 'framework' | 'app'
  tag           TEXT    NOT NULL,   -- '0000_framework_init' — identité, immuable
  hash          TEXT    NOT NULL,   -- sha256 du .sql tel qu'appliqué
  run_id        TEXT    NOT NULL,   -- uuid du run — groupe les migrations d'un déploiement
  started_at    BIGINT  NOT NULL,   -- epoch ms
  finished_at   BIGINT,             -- NULL = en cours OU process mort en plein vol (mysql)
  execution_ms  INTEGER,
  success       BOOLEAN NOT NULL DEFAULT FALSE,
  error         TEXT,               -- message d'échec (tronqué)
  applied_by    TEXT,               -- hostname / user DB du job
  UNIQUE(source, tag)
);
```

(Types par dialecte via le savoir colKit : `BIGINT` pg/mysql, `INTEGER` sqlite, etc.
Schéma PG : `public` — on n'utilise pas le schéma `drizzle` du migrator natif.)

#### L'algorithme `migrate()` (set-based, PAS high-water-mark)

```
1. Connexion DÉDIÉE (NF_MIGRATE_DATABASE_URL sinon URL du connecteur) — jamais le pool app.
2. LOCK natif par dialecte :
     pg    : SELECT pg_advisory_lock(<clé 64 bits constante>)   -- session-level
     mysql : SELECT GET_LOCK('nodefony:migrations', <timeout>)
     sqlite: single-writer par nature (BEGIN IMMEDIATE par migration)
   → auto-libéré si le process meurt (OOM, éviction) : PAS de lock zombie possible.
   ⚠️ pg : poser aussi `SET lock_timeout = '30s'` (un ALTER en attente derrière une
   transaction longue bloque toute la table en FIFO — piège documenté postgres.ai).
3. CREATE TABLE IF NOT EXISTS nodefony_migrations.
4. CHARGER les 2 sources : journal (_journal.json) + contenu .sql + sha256 courant.
5. VALIDATE (fail-loud, AVANT toute application) :
   a. marqueur d'échec présent (success=false OU finished_at NULL)
        → STOP « repair first » (modèle Prisma P3009)
   b. hash stocké ≠ sha256 du fichier actuel (migration appliquée puis modifiée)
        → STOP drift (modèle Flyway validate / Atlas)
   c. appliquée en base mais absente du dossier (downgrade de paquet, fichier supprimé)
        → STOP (option --ignore-missing)
   d. pending « dans le passé » (idx < max des appliquées de la même source)
        → STOP out-of-order (option --out-of-order pour l'assumer — modèle Flyway)
   e. historique vide MAIS les tables framework existent déjà (base d'avant S5)
        → STOP + message : « base existante détectée → nodefony orm:migrate:baseline »
6. PLAN : pending = entries du journal dont (source, tag) ∉ appliquées-avec-succès.
   → ensemble par IDENTITÉ, pas par timestamp : rien ne peut être skippé en silence.
7. APPLIQUER, source framework puis app, ordre du journal, UNE PAR UNE :
     pg / sqlite : BEGIN → statements (split '--> statement-breakpoint')
                   → INSERT ligne succès → COMMIT           (atomique : schéma + trace)
                   échec → ROLLBACK, puis INSERT marqueur d'échec HORS transaction
                   (trace du fail pour status/Studio — mieux que Flyway qui ne trace pas en PG)
     mysql       : INSERT marqueur started (autocommit) → statements un par un
                   → UPDATE finished+success.
                   (DDL non transactionnel : un crash à mi-course laisse started sans
                   finished = détecté en 5.a au run suivant → inspection humaine + repair.
                   C'est la réalité MySQL — Prisma documente exactement ce workflow.)
8. RELEASE lock. Sortie : code 0 (à jour / N appliquées) · ≠0 (validate failed / erreur).
```

#### Les autres verbes

- **`plan()/status()`** : lecture seule — appliquées, pending, drifted, failed, baseline
  suggéré. Sert la CLI (`orm:migrate:status`), le data plane Studio ET le readiness check
  (même code, 3 surfaces — pattern API souveraine).
- **`baseline(upTo?)`** : INSERT les lignes (success=true, `run_id`, hash courant) SANS
  exécuter le SQL. Toujours **explicite** (jamais auto — la doc Flyway elle-même met en garde
  contre `baselineOnMigrate` qui retire le filet « mauvaise DB par erreur de config »).
- **`repair()`** : supprime les marqueurs d'échec après inspection humaine.
  Flag séparé `--update-hashes` (dangereux, documenté) pour ré-aligner un hash après une
  édition assumée d'un fichier appliqué (modèle Flyway repair).

### 3.4 Les modes `ddl` par connecteur — qui fait le schéma, et quand

Nouveau champ de config par connecteur : `ddl: "auto" | "migrate" | "none"`.

| Mode      | Qui fait le DDL                                         | Quand l'utiliser                                                                                                                               | Défaut       |
| --------- | ------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | ------------ |
| `auto`    | le boot (DDL dérivé, comme aujourd'hui)                 | dev, test, prototypage                                                                                                                         | **dev/test** |
| `migrate` | `DrizzleMigrator` au boot (avec lock)                   | single-node assumé (VPS, docker-compose, sqlite) — **opt-in explicite**, jamais un défaut (norme unanime observée : pas d'auto-run silencieux) | —            |
| `none`    | personne au boot — un Job externe exécute `orm:migrate` | prod orchestrée (k8s)                                                                                                                          | **prod**     |

- Défauts résolus par environnement au boot (`DrizzleService`, comme `#defaultFilename`) —
  surchargeables par config/env.
- **Comportement inchangé en dev** : `auto` reste le défaut dev/test, les tests `:memory:`
  et la DX actuelle ne bougent pas d'un millimètre. L'API lib (`new DrizzleOrm(...)`) garde
  `auto` par défaut.

### 3.5 Readiness check — le pod refuse le trafic tant que le schéma est en retard

Quand `ddl ≠ auto`, `DrizzleService` enregistre un check sur **`/readyz`** (jamais livez :
un schéma en retard est un état EXTERNE — redémarrer le pod ne répare rien, doc k8s
explicite) :

- `migrations.check: "fail"` (défaut prod) → pending/drift/failed ⇒ readyz **503** +
  log CRITIC. Le check **re-vérifie à chaque probe** (cache court) → dès que le Job applique
  les migrations, le pod devient ready **tout seul** : self-healing, zéro redéploiement.
  Un déploiement sans migration préalable → rollout bloqué proprement (l'ancien ReplicaSet
  continue de servir), rollback auto k8s au progressDeadline.
- `"warn"` (défaut dev en mode migrate/none) → log WARNING, ready quand même.
- `"off"` → rien.

Coût : 1 SELECT sur une table minuscule, seulement en mode `migrate`/`none`, avec cache —
négligeable (règle perf).

> Différenciateur : ni Drizzle, ni TypeORM, ni Sequelize n'offrent ça (constat de l'étude —
> Rails/Ecto ont l'équivalent). Aligné doctrine : fail-loud, jamais de service dégradé
> silencieux.

### 3.6 Config (Zod) + environnement

```ts
// connectorSchema (config.ts drizzle) — par connecteur
ddl: z.enum(["auto", "migrate", "none"]).optional()
  .describe("Stratégie DDL : auto (dérivé au boot — dev), migrate (migrations au boot " +
    "avec lock — single-node opt-in), none (Job externe — prod). Défaut par environnement : " +
    "dev/test→auto, prod→none.")

// drizzleConfigSchema — global module
migrations: z.object({
  dir: z.string().default("migrations")
    .describe("Dossier des migrations de l'APP (source 'app'), relatif à la racine ; " +
      "sous-dossier par dialecte. Le dossier framework est livré dans le paquet."),
  check: z.enum(["fail", "warn", "off"]).optional()
    .describe("Vérif readiness quand ddl≠auto : pending/drift ⇒ readyz 503 (fail) ou " +
      "log (warn). Défaut : prod→fail, dev→warn."),
  lockTimeoutMs: z.number().int().positive().default(30_000)
    .describe("pg : SET lock_timeout pendant les migrations (anti file FIFO derrière " +
      "une transaction longue). mysql : timeout GET_LOCK."),
}).default(...)
```

- **`NF_MIGRATE_DATABASE_URL`** : URL de connexion du **job de migration** (rôle DDL).
  Prioritaire sur l'URL du connecteur pour `orm:migrate` uniquement. Portée par le Secret
  monté DANS LE JOB SEULEMENT — jamais dans les pods app (moindre privilège).
- ⚠️ Gravé dans la doc : cette URL doit être une **connexion directe** au serveur —
  PgBouncer en transaction pooling casse les advisory locks session-level (doc PgBouncer :
  « Never » compatible).

---

## 4. Les commandes CLI

Namespace `orm:*`, portées par le module drizzle (`module.addCommand`), mode console
one-shot déjà câblé dans le Kernel (`finishOrPark`) → utilisables telles quelles dans un
Job k8s. `--json` partout (CI, Studio, agents).

| Commande                        | Rôle                                                                          | Options                                                                                                                                                              |
| ------------------------------- | ----------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `nodefony orm:migrate`          | applique les pending (framework puis app)                                     | `--connector` (défaut `default`) · `--source all\|framework\|app` · `--dry-run` (affiche le SQL, n'applique rien) · `--out-of-order` · `--ignore-missing` · `--json` |
| `nodefony orm:migrate:status`   | plan lecture seule : appliquées / pending / drift / failed / baseline suggéré | `--json` · exit 0 = à jour, 1 = action requise → **gate CI** (modèle Django `migrate --check`)                                                                       |
| `nodefony orm:migrate:baseline` | marque appliquées SANS exécuter (adoption d'une base existante)               | `--up-to <tag>` · `--source`                                                                                                                                         |
| `nodefony orm:migrate:repair`   | efface les marqueurs d'échec après inspection                                 | `--update-hashes` (dangereux, documenté)                                                                                                                             |
| `nodefony orm:generate`         | app : wrapper drizzle-kit (si config app présente) ; framework : script repo  | `--custom --name <n>` → squelette SQL libre + entrée journal (sans drizzle-kit) · `--dialect`                                                                        |

Exemple de sortie `status` (aussi le JSON du data plane) :

```
Connector default (postgres) — ddl: none — table nodefony_migrations
  framework  3 appliquées · 1 pending (0003_audit_severity)   ✔ hash OK
  app        12 appliquées · 0 pending                         ✔ hash OK
  → nodefony orm:migrate   (ou : Job de déploiement)
```

---

## 5. Cloud-native — le déroulé complet

### 5.1 Le pattern de référence : Job AVANT rollout

Consensus 2024-2026 (étude) : **Job Kubernetes pré-déploiement**, PAS initContainer
(Atlas : « no longer recommended » — N replicas = N exécutions concurrentes), PAS de
migrate-on-boot par défaut (thundering herd, CrashLoop généralisé, privilèges DDL dans
l'app). Notre lock rend ces variantes SÛRES, mais le Job reste le chemin recommandé.

**La même image** sert l'app et la migration — seule la commande change :

```yaml
# --- Job de migration (hook Helm pre-upgrade OU ArgoCD PreSync wave -1) -----
apiVersion: batch/v1
kind: Job
metadata:
  name: myapp-migrate-{{ .Release.Revision }} # nom unique par révision (Job immuable)
  annotations:
    "helm.sh/hook": pre-install,pre-upgrade
    "helm.sh/hook-delete-policy": before-hook-creation
    # ArgoCD équivalent : argocd.argoproj.io/hook: PreSync + sync-wave: "-1"
spec:
  backoffLimit: 0 # fail fast — jamais de retry aveugle sur un état partiel
  activeDeadlineSeconds: 600 # borne dure (Helm --timeout > cette valeur)
  template:
    spec:
      restartPolicy: Never
      containers:
        - name: migrate
          image: myapp:{{ .Values.tag }} # MÊME tag que le Deployment (règle dure)
          command: ["node_modules/.bin/nodefony", "orm:migrate"]
          env:
            - name: NF_MIGRATE_DATABASE_URL # rôle DDL — Secret monté ICI SEULEMENT
              valueFrom: { secretKeyRef: { name: db-migrator, key: url } }
```

Déroulé d'un déploiement :

```
1. CI build l'image (migrations framework dans node_modules + migrations app copiées).
2. Hook pre-upgrade : le Job tourne — lock → validate → applique → exit 0.
   Échec → le release ÉCHOUE, le Deployment n'est PAS touché, l'ancien continue de servir.
3. Rollout du Deployment (pods ddl:none). Au boot, readiness check : schéma à jour → ready.
4. Cas dégradé (déploiement sans migration) : pods jamais ready → rollout bloqué proprement
   → k8s rollback auto. Lancer le Job → les pods deviennent ready SEULS (check re-poll).
```

Notes : hooks Helm **non rejoués au rollback** (« assume hooks commit ») — cohérent
forward-only. ArgoCD self-heal peut relancer le Job → notre runner est idempotent par
construction (re-run = 0 pending = exit 0).

### 5.2 Sans orchestrateur (VPS, docker-compose, sqlite en prod légère)

Mode `ddl: "migrate"` (opt-in) : le boot applique les migrations sous lock puis démarre.
`docker compose up --scale app=3` reste sûr (le lock sérialise, les suivants voient
« 0 pending »). C'est le pragmatisme single-node — documenté comme tel.

### 5.3 Moindre privilège — les grants exacts (livrés dans la doc module)

```sql
-- PostgreSQL : 2 rôles
CREATE ROLE app_migrator LOGIN PASSWORD '…';       -- DDL : le Job
CREATE ROLE app_runtime  LOGIN PASSWORD '…';       -- DML : les pods
GRANT CREATE, USAGE ON SCHEMA public TO app_migrator;
GRANT USAGE ON SCHEMA public TO app_runtime;
-- Les tables FUTURES créées par le migrator sont auto-grantées au runtime :
ALTER DEFAULT PRIVILEGES FOR ROLE app_migrator IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_runtime;
ALTER DEFAULT PRIVILEGES FOR ROLE app_migrator IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO app_runtime;   -- ⚠️ séquences = grant séparé
-- Pièges documentés : non rétroactif (GRANT ponctuel pour l'existant) ; la règle ne vaut
-- que si le CREATE est exécuté par app_migrator exactement (pas un superuser CI) ;
-- PG15+ : public n'a plus CREATE par défaut.
```

```sql
-- MySQL : les grants db.* couvrent déjà les objets futurs (pas d'équivalent nécessaire)
GRANT SELECT, INSERT, UPDATE, DELETE ON myapp.* TO 'app_runtime'@'%';
GRANT CREATE, ALTER, DROP, INDEX, REFERENCES, SELECT, INSERT, UPDATE, DELETE
  ON myapp.* TO 'app_migrator'@'%';
```

### 5.4 Zero-downtime : la règle N-1 (expand/contract)

Pendant un rolling update, ancien ET nouveau code coexistent → **chaque migration doit être
compatible avec le code N-1**. Le pattern (Parallel Change, Fowler) :

```
EXPAND   (release N)   : additif seul — ADD COLUMN nullable, CREATE TABLE, nouvel index
MIGRATE  (N → N+1)     : le code écrit les 2 formats, backfill par lots
CONTRACT (release N+2) : DROP de l'ancien — dans une release ULTÉRIEURE, jamais la même
```

Tant qu'on est dans la fenêtre expand, **le rollback du CODE est gratuit** (redéployer
l'image N-1, la DB ne bouge pas) — c'est ÇA le rollback cloud-native, pas un down SQL.
La doc module portera le tableau des opérations dangereuses PG/MySQL et leurs mitigations
(`lock_timeout` + retry, `CREATE INDEX CONCURRENTLY` hors transaction, `NOT NULL` via
`CHECK NOT VALID` + `VALIDATE`, `ALGORITHM=INSTANT` MySQL 8.0.12+…) — inspiré
strong_migrations/squawk/atlas lint.

### 5.5 Ce que S5 ne fait PAS (assumé)

- **Pas de down-migrations** (consensus total ; le forward-fix + PITR est la doctrine).
- **Pas de linter de migrations** (strong_migrations-like) — extension future possible.
- **Pas de repeatable migrations** (`R__` vues/procs Flyway) — le canal `--custom` couvre
  le besoin ponctuel ; extension future si demande.
- **Pas de migrations multi-connecteurs** (S5 = connecteur `default`, celui des entités
  framework). Extensible sans breaking (la config le permettra plus tard).

---

## 6. La page Studio — « comprendre l'état de la migration dans les moindres détails »

### Data plane (monté par le module drizzle, comme `registerOrmAdminApi`)

| Endpoint                                          | Rôle                                                                                                                                                                                  |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /nodefony/orm/api/migrations`                | état complet par connecteur : dialecte, mode ddl, par source {appliquées (tag, date, durée, run_id, applied_by, hash ok), pending, drifted, failed}, baseline suggéré, verdict global |
| `GET /nodefony/orm/api/migrations/{source}/{tag}` | le SQL de la migration + hash + statut (viewer)                                                                                                                                       |
| `POST /nodefony/orm/api/migrations/apply`         | **dev uniquement** (gate env + rôle admin + confirmation) — en prod la page est read-only : la migration passe par le Job (doctrine : superviser ≠ tomber la prod)                    |

Même code que la CLI (`DrizzleMigrator.plan()`) — 1 service, 3 surfaces (CLI, HTTP, readyz).

### L'écran `/nodefony/orm/migrations` (session dédiée S5d, skill studio-dev)

1. **Header** : sélecteur connecteur · badge dialecte · badge mode `ddl` (avec DocHint
   expliquant qui fait le DDL dans ce mode) · verdict global (✅ à jour / ⚠️ N pending /
   ❌ drift / 🛑 failed).
2. **Timeline par source** (framework / app) : chaque migration = ligne avec statut,
   `applied_at`, durée, `applied_by`, `run_id` (groupement visuel par déploiement — modèle
   `DEPLOYMENT_ID` Liquibase).
3. **Drawer au clic** : SQL colorisé, hash, erreur complète si échec.
4. **Encarts intelligents** (DocHint dynamiques, norme Stores) :
   - base existante sans historique → explication + commande baseline à copier ;
   - failed marker → workflow repair expliqué ;
   - drift → quel fichier, hash attendu/actuel ;
   - mode `none` → rappel du déroulé Job + lien doc cloud-native.
5. **Panneau commandes** : chaque action affiche sa commande CLI à copier
   (`orm:migrate --dry-run`, `status --json`…) — l'UI enseigne la CLI.
6. **Bouton « Appliquer » en dev seulement** (confirmation modale, affiche le SQL du plan).

---

## 7. Plan d'implémentation (après validation)

| Lot                                | Contenu                                                                                                                                                                                                                       | Preuves                                                                                                                                                            |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **S5a — génération**               | devDep `drizzle-kit` (⚠️ package.json module drizzle — accord demandé), 3 schémas matérialisés, 3 configs, script `generate:migrations` + drift-check, migrations `0000_framework_init` ×3 versionnées, `files += migrations` | **test de parité** : base migrée == base DDL-auto (introspection PRAGMA sqlite ; e2e pg/mysql gatés `NF_PG_URL`/`NF_MYSQL_URL`) — LE test qui garantit dev ≡ prod  |
| **S5b — applicateur**              | `DrizzleMigrator` (plan/validate/migrate/baseline/repair), table, lock, transactions par dialecte                                                                                                                             | suite vitest sqlite (identité set-based, drift, out-of-order, échec→repair, baseline, idempotence) + e2e pg/mysql (lock : 2 process concurrents → 1 seul applique) |
| **S5c — CLI + config + readiness** | commandes `orm:*`, champ `ddl` + `migrations.*` (Zod), défauts par env, readiness check, doc module `drizzle/docs/migrations.md` (workflow, k8s, grants SQL, N-1)                                                             | boot réel 3 modes ; `status` gate CI ; memory.test (règle absolue)                                                                                                 |
| **S5d — Studio**                   | data plane + écran (spec §6)                                                                                                                                                                                                  | session dédiée, skill studio-dev                                                                                                                                   |

Estimation : S5a+S5b = 1 session chacune (voire 1 grosse), S5c = 1, S5d = 1.

---

## 8. Décisions & alternatives rejetées (le POURQUOI condensé)

| #   | Décision                                                                          | Alternative rejetée                                                                                      | Pourquoi                                                                                                                                               |
| --- | --------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | Format drizzle-kit conservé (génération, journal, snapshots)                      | format de migration maison                                                                               | outillage diff/custom/check existant et solide ; zéro invention de format                                                                              |
| 2   | **Applicateur maison** `DrizzleMigrator`                                          | `migrate()` natif drizzle-orm                                                                            | prouvé insuffisant au code : skip silencieux (#5316), hash jamais vérifié, pas de lock (#874), pas de statut — tous vivants en 0.45.x                  |
| 3   | Modèle **Django** : le paquet livre, exécution en place, historique namespacé     | copie Rails/Laravel (divergence, étape manuelle) ; diff Doctrine (l'app possèderait le schéma framework) | tables d'infrastructure : le framework doit garantir son schéma ; upgrade npm = migrations dispo sans action                                           |
| 4   | **1 table** `nodefony_migrations` avec colonne `source`                           | 2 tables (framework/app)                                                                                 | état complet en 1 SELECT (Studio) ; identité `(source, tag)` = même isolation                                                                          |
| 5   | Application par **identité set-based**                                            | high-water-mark timestamp (drizzle natif, Flyway ordre strict)                                           | l'upgrade framework insère « dans le passé » de l'app par construction — le set-based le gère nativement, l'out-of-order intra-source reste détecté    |
| 6   | Lock **natif par dialecte** (advisory pg / GET_LOCK mysql / single-writer sqlite) | table de lock façon Liquibase                                                                            | auto-libération à la mort de connexion = zéro zombie (Liquibase : déblocage manuel documenté) ; zéro table en plus                                     |
| 7   | Transaction **par migration** + marqueur d'échec persistant                       | transaction globale (drizzle natif)                                                                      | échec = état net (PG rollback la migration fautive seule) + trace pour Studio ; MySQL assumé non-transactionnel (workflow repair, modèle Prisma)       |
| 8   | Forward-only (pas de down)                                                        | up/down symétriques                                                                                      | consensus industrie total ; down non testé = danger ; rollback réel = code N-1 sur schéma expand + PITR                                                |
| 9   | Baseline **explicite**                                                            | `baselineOnMigrate` auto                                                                                 | la doc Flyway elle-même : l'auto retire le filet « mauvaise DB » ; fail-loud + message actionnable                                                     |
| 10  | Readiness check re-pollé (`readyz` 503)                                           | BootConfigurationError (fatal)                                                                           | un schéma en retard se répare de l'EXTÉRIEUR (lancer le Job) → le pod doit pouvoir devenir ready seul ; fatal = redéploiement forcé pour rien          |
| 11  | `orm:*` porté par le module drizzle                                               | interface `IMigrator` dans orm-core                                                                      | pas d'abstraction à 1 seul implémenteur (mongoose = schemaless) ; l'URL data plane `/nodefony/orm/api/*` reste générique → généralisable sans breaking |
| 12  | drizzle-kit en **devDependency**, spawn CLI                                       | API programmatique `drizzle-kit/api`                                                                     | l'API existe mais non documentée/non garantie ; le CLI est le contrat stable ; jamais de drizzle-kit au runtime                                        |

## 9. Risques & pièges gravés (iront dans CLAUDE.md/MEMORY.md du module au moment du code)

- **Tag publié = immuable à vie** ; squash interdit post-GA.
- **URL de migration = connexion directe** (PgBouncer transaction pooling casse les advisory
  locks — doc officielle).
- **MySQL : DDL non transactionnel** → jamais de retry aveugle ; workflow repair.
- **CRLF/newline** : un .sql réécrit par un ConfigMap/éditeur change le hash → validate STOP
  (comportement voulu — à connaître).
- **Les entités app n'importent jamais les tables framework** dans leur schéma drizzle-kit
  (double CREATE sinon) ; FK SQL cross-source → `--custom`.
- **`drizzle-kit push` côté app** : exclure `nodefony_migrations` + tables framework
  (`tablesFilter`) — doc.
- Générer **les 3 dialectes ensemble** (script unique, même `--name`) — journaux alignés.
