---
date: 2026-07-07
statut: étude à froid — confirme ou infirme le choix Drizzle AVANT le chantier multi-dialecte
scope: "@nodefony/drizzle · @nodefony/orm-core · entités framework"
adr-liés: [0003]
---

# Comparatif ORM à froid — Drizzle confirmé ? (gate Phase 1, release Nodefony 10)

> **Question posée** : les entités que Nodefony LIVRE (session, user, token, webauthn, totp,
> webhook, audit, idempotency) doivent tourner sur sqlite/postgres/mysql. Drizzle ne fournit
> pas cette portabilité nativement → le chantier « factory par entité » est estimé à 4-5 sessions.
> **Un autre ORM résoudrait-il MIEUX le problème, coût de migration inclus ?**
> Étude 0-code, données collectées le 2026-07-06/07 (npm registry + GitHub API).

---

## 1. Pourquoi cette étude

- **Perte de confiance exprimée** (2026-06-26) : la découverte que Drizzle est
  _dialect-spécifique_ (`sqliteTable` ≠ `pgTable` ≠ `mysqlTable`) a cassé la promesse implicite
  « un ORM, c'est portable ». ADR-0003 avait acté « type-safety > portabilité » mais la
  **conséquence** (décliner chaque entité par dialecte) n'avait jamais été chiffrée.
- **Décision figée** (2026-06-29) : postgres + mysql/mariadb sont DANS le MVP de la release 10.
- Avant d'investir 4-5 sessions dans le portage, on instruit à charge **et** à décharge.

## 2. Le besoin exact (terrain vérifié ce jour)

### 2.1 Ce que le framework livre

8 entités (1 008 lignes), 8 stores/repositories consommateurs dans le module
(`src/packages/@nodefony/drizzle/nodefony/src/`), module complet = **4 568 lignes TS**.

| Entité                     | Lignes | État dialecte                                                                           |
| -------------------------- | -----: | --------------------------------------------------------------------------------------- |
| `idempotencyEntity`        |    206 | ✅ **porté sqlite+pg** (Slice 0, e2e PG 7/7) — patron `createIdempotencyTable(dialect)` |
| `tokenEntity`              |    176 | sqlite-only                                                                             |
| `auditEventEntity`         |    128 | sqlite-only                                                                             |
| `webhookEndpointEntity`    |    127 | sqlite-only                                                                             |
| `webAuthnCredentialEntity` |    114 | sqlite-only                                                                             |
| `totpSecretEntity`         |    110 | sqlite-only                                                                             |
| `userTable`                |    104 | sqlite-only                                                                             |
| `sessionEntity`            |     43 | sqlite-only                                                                             |

### 2.2 Le SQL natif dialect-spécifique (inventaire exhaustif — plus petit que craint)

| Site                                | SQL                                                                      | Portabilité                                                                                                                  |
| ----------------------------------- | ------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------- |
| `DrizzleRepository.ts:363,449,488`  | `rowid in (select rowid … limit 1)` ×3 (update/increment/delete « one ») | ⚠️ **sqlite-only** (non listé au kit). Forme portable unique : sous-requête PK en table dérivée — marche sur les 3 dialectes |
| `DrizzleUserRepository.ts:217-219`  | `json_each("User"."socialProviders")` (Shadow User OAuth)                | ⚠️ sqlite-only. Équivalents one-liner : PG `@>` (containment jsonb), MySQL `JSON_CONTAINS`                                   |
| `DrizzleRepository.ts:445,515`      | `${col} + ${delta}`, `sql\`1\``                                          | ✅ portables                                                                                                                 |
| `DrizzleOrm.ts` `#buildCreateTable` | DDL généré via `getTableConfig`                                          | ✅ déjà dialect-aware (Slice 0)                                                                                              |

**La surface dialect-spécifique totale à traiter est < 20 lignes de SQL.** Le gros du chantier
est la déclinaison des tables (×N builders par dialecte), pas les requêtes.

### 2.3 Contraintes non négociables (règles du repo)

1. **TS strict, zéro `any`** — la type-safety des requêtes est un critère de premier rang.
2. **Perf/mémoire runtime** (règle absolue) : couche fine sur le driver, pas d'hydration lourde.
3. **Framework générique** : les entités sont livrées PAR le framework, le dialecte est choisi
   PAR l'app en config (`connector.dialect`) au **runtime** — pas à la génération de code.
4. **Zéro codegen imposé à l'app** : un module Nodefony ne peut pas exiger que chaque app
   utilisatrice exécute une étape de génération pour que la sécurité (sessions, tokens) marche.
5. Architecture **ports & adapters** (ADR-0003) : les stores consomment `IOrm`/`IRepository` —
   l'ORM SQL est un adapter remplaçable, il cohabite déjà avec mongoose.
6. ESM pur, Node ≥ 24, licence compatible CeCILL-B.

## 3. Données fraîches (collecte 2026-07-06/07)

|                     | version `latest`                     | dernière release | releases / 6 mois | dl npm / mois | ⭐ GitHub | open issues |
| ------------------- | ------------------------------------ | ---------------- | ----------------: | ------------: | --------: | ----------: |
| **drizzle-orm**     | 0.45.2 · canal `rc` = **1.0.0-rc.4** | 2026-06-27       |               168 |        48,1 M |    35 056 |       1 882 |
| **@prisma/client**  | **7.8.0**                            | 2026-07-06       |               223 |        50,3 M |    46 356 |       2 642 |
| **kysely**          | 0.29.3                               | 2026-07-05       |                13 |       38,5 M¹ |    14 009 |         165 |
| **typeorm**         | **1.0.0** (GA 2026-05-19)            | 2026-07-06       |               139 |        19,3 M |    36 580 |         543 |
| **@mikro-orm/core** | 7.1.5                                | 2026-07-03       |              740² |        3,25 M |     9 113 |          28 |

¹ dont une part transitive difficile à isoler (kysely est une dépendance d'outillage répandue).
² cadence mono-repo : chaque patch publie tous les paquets — non comparable brut.

**Événements depuis le choix initial (ADR-0003, 2026-05)** :

- **TypeORM 1.0.0 est sorti** (2026-05-19) après ~6 ans de 0.3.x — reprise de maintenance réelle
  et chiffrée (open issues : ~2 400 historiques → 543). Recul : 7 semaines.
- **Prisma 7** (2025-11-19) : client TS pur par défaut (fini le moteur Rust — ~90 % de bundle en
  moins, requêtes annoncées jusqu'à 3× plus rapides), architecture **driver adapters obligatoire**
  (`new PrismaClient({ adapter })`). Le **codegen depuis `schema.prisma` demeure** le cœur du modèle.
- **Drizzle v1.0 en rc.4** : toujours pas GA (~1 an de beta), mais canal actif ; tag `node-sqlite`
  en préparation (support `node:sqlite` natif — aligné avec notre trajectoire Node 24 natif).

## 4. Fiches candidats — fit contre NOS critères

### Drizzle (tenant du titre)

- **Multi-dialecte entités** : rien en natif — schema-as-code par dialecte. MAIS le patron factory
  est **prouvé chez nous** (Slice 0 : `createIdempotencyTable(dialect)`, e2e PG 7/7) et
  `getTableConfig` génère le DDL par dialecte sans code spécifique. L'API de requête
  (`select/insert/update` sur la table injectée) est commune une fois la table résolue —
  le `DrizzleRepository` a déjà tourné sur PG via cast (dette de typage connue, pas un mur).
- **Type-safety** : exemplaire — inférence complète sans codegen, `$type<>` sur colonnes.
- **Perf/mémoire** : couche fine sur driver (better-sqlite3 sync / pg). **Prouvé chez nous** :
  gates mémoire verts, RPS auth mesurés, chaos flood 10 min · 1,08 M req · 0 crash (stores 0.8).
- **Maintenance** : traction massive (48 M dl/mois, push quotidien), MAIS 0.x après 4 ans,
  1 882 open issues, v1 en rc depuis des mois, équipe dispersée sur beaucoup de fronts
  (Effect, AI, DuckDB, Studio…). Risque réel = **jeunesse/mouvement d'API**, pas l'abandon.
  Notre exposition est faible : on consomme le cœur SQL (l'API la plus stable), pas les
  relational queries (RQB v2 beta).
- **À charge, assumé** : on maintient NOTRE mini-couche (colKit/factories) pour toujours.
  C'est le prix structurel du choix « type-safety sans runtime » — connu, borné, désormais chiffré.

### Kysely (challenger sérieux)

- **Multi-dialecte requêtes = son cœur de design** : le MÊME code query-builder tourne sur les
  3 dialectes (dialect injecté au constructeur). Types purs, zéro codegen, zéro dep.
- **Mais côté entités : rien** — pas de définition de table (types TS seulement), pas de DDL
  (à notre charge), pas de codecs de valeurs : JSON stringify/parse, bool 0/1, dates par dialecte
  reviennent à NOUS. Le travail « colKit » ne disparaît pas, il se **déplace** (du schéma vers les
  valeurs) et on **perd** la génération DDL de `getTableConfig`.
- **Type-safety** : exemplaire. **Perf** : la plus fine de toutes. **Maintenance** : périmètre
  petit et stable (13 releases/6 mois, 165 issues), mais 0.x aussi et équipe réduite.
- Verdict : **meilleur choix si on partait de zéro** pour des entités framework. À coût de
  migration inclus (réécrire l'adapter 4,6 kloc + re-prouver sécu/perf), non justifié. → **plan B**.

### Prisma 7

- **Abstraction SQL totale** (le schéma `.prisma` est dialecte-agnostique) — sur le papier,
  exactement notre besoin. **Mais le modèle de livraison casse tout** : le client est GÉNÉRÉ
  dans l'app depuis un schéma que l'app possède. Livrer nos 8 entités = imposer Prisma + une
  étape codegen à toute app Nodefony (violation contraintes §2.3-3/4) ; les entités framework
  devraient être fusionnées dans le schéma de l'app. Un framework qui embarque ses tables de
  session/sécurité ne peut pas vivre là-dessus.
- Reste une couche épaisse malgré la v7 (mapping, client généré), pivot produit orienté
  plateforme (Accelerate/Postgres cloud) — priorités upstream pas alignées sur notre cas.
- **Disqualifié pour le rôle** « entités livrées par le framework », indépendamment de ses qualités.

### TypeORM 1.0

- **Le fit conceptuel parfait** : métadonnées runtime (`EntitySchema` sans décorateurs), dialecte
  switché par config, SQL traduit par l'ORM, DDL/migrations fournis. C'est le modèle Sequelize
  qu'on a quitté — en maintenu.
- **Mais** : type-safety la plus faible du panel (find options partiellement typés, relations
  par strings — frontal avec « zéro any ») ; couche runtime plus lourde (metadata + hydration) ;
  et la renaissance 1.0 n'a que **7 semaines de recul** après 6 ans de stagnation. Parier les
  briques de sécurité du framework dessus = re-prendre le risque qu'on a fui avec Sequelize.

### MikroORM 7 (ajouté au panel du kit, par honnêteté)

- Abstraction runtime multi-dialecte + bonne type-safety + excellence opérationnelle
  (28 open issues !). MAIS Unit of Work / Identity Map = poids conceptuel et runtime qu'on
  n'utiliserait pas (nos stores font du CRUD plat) ; traction 15× moindre que Drizzle ;
  bus factor ≈ 1 mainteneur. Swap complet non justifiable pour 8 tables plates.

## 5. Scores intrinsèques (hors coût de migration)

Notes /5, sur NOS critères pondérés — le score n'est PAS la décision (le coût de bascule
s'ajoute au §6) :

| Critère (poids)                         |  Drizzle |   Kysely | Prisma 7 | TypeORM 1 | MikroORM 7 |
| --------------------------------------- | -------: | -------: | -------: | --------: | ---------: |
| Entités framework multi-dialecte (30 %) |        3 |        3 |        2 |     **5** |      **5** |
| Type-safety TS strict (25 %)            |    **5** |    **5** |      4,5 |       2,5 |          4 |
| Perf / mémoire runtime (25 %)           |      4,5 |    **5** |      3,5 |         3 |          3 |
| Maintenance / pérennité (15 %)          |      3,5 |        4 |        4 |         3 |        3,5 |
| Outillage (DDL, kit, drivers) (5 %)     |      4,5 |        3 |    **5** |         4 |          4 |
| **Pondéré**                             | **4,08** | **4,25** |     3,53 |      3,33 |       3,90 |

Lecture honnête : **Kysely gagne l'intrinsèque d'un cheveu** (perf + issues basses), Drizzle
2ᵉ, MikroORM 3ᵉ. Aucun candidat ne domine : ceux qui résolvent le multi-dialecte nativement
(TypeORM/MikroORM) perdent sur nos 2 règles absolues (type-safety, perf). Le multi-dialecte
« gratuit » n'existe qu'en payant ailleurs.

## 6. Scénarios chiffrés (coût de bascule inclus — le facteur décisif)

| Scénario                                                                          | Coût                                                                                                                                                                                                              | Risque                                                                             | Ce qu'on gagne                                            |
| --------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- | --------------------------------------------------------- |
| **A. Finir Drizzle** (colKit + 7 entités + rowid/json_each + mysql + typing repo) | **4-5 sessions**                                                                                                                                                                                                  | Faible — patron prouvé (Slice 0), tests e2e existants, sécu intacte                | pg+mysql MVP ; surface dialectale confinée et auditable   |
| B. Kysely pour les entités framework                                              | 8-12 sessions : adapter neuf (~4 kloc), 8 entités en types + DDL manuel + codecs valeurs, réécrire les 2 repositories + 8 stores, **re-prouver** intégration 567×2, gates mémoire, red-team stores, baselines RPS | Moyen-fort — régression sécu possible sur des briques prouvées                     | requêtes nativement communes ; −1 dep binaire potentielle |
| C. TypeORM / MikroORM                                                             | 10-15 sessions : tout B + absorber le modèle (UoW/hydration/metadata) + mapper `ITransaction`                                                                                                                     | Fort — type-safety en recul (TypeORM) ou complexité UoW (Mikro) + re-preuve totale | multi-dialecte natif, plus de colKit à maintenir          |
| D. Prisma 7                                                                       | —                                                                                                                                                                                                                 | —                                                                                  | **Disqualifié** (§4 : codegen imposé à l'app)             |

Le différentiel A→B est de +4 à +7 sessions pour un gain net ≈ nul (le colKit devient des
codecs, le SQL natif reste à porter dans les deux cas), avec un risque de régression sur des
briques de sécurité **déjà éprouvées** (red-team + campagne stores 0.8 + chaos). Le différentiel
A→C achète la vraie abstraction, mais en cédant sur les deux règles absolues du repo — et se
rentabilise sur des dizaines de tables mouvantes, pas sur **8 tables plates et stables**.

## 7. Verdict

**Drizzle CONFIRMÉ** — pas parce qu'il serait « le meilleur ORM », mais parce que :

1. Le besoin « entités livrées par le framework, dialecte choisi par l'app au runtime » n'est
   nativement couvert par AUCUN candidat acceptable : ceux qui l'offrent (TypeORM/MikroORM)
   contredisent les règles absolues type-safety/perf ; Prisma casse le modèle de livraison.
   **Une mini-couche maison est inévitable quel que soit le query-builder retenu** — autant
   garder celle dont le patron est déjà prouvé en production de test.
2. La surface dialect-spécifique réelle est **petite et bornée** : < 20 lignes de SQL natif +
   ~800 lignes d'entités à décliner via colKit. Coût one-shot, schémas stables.
3. Le swap coûte 2 à 3× le chantier restant et rejoue le risque sur la sécurité prouvée.
4. Santé upstream Drizzle correcte au 2026-07 : 48 M dl/mois, push quotidien, v1.0-rc.4.
   Le risque (API 0.x qui bouge) est mitigé par notre exposition minimale (cœur SQL seul).

**Garde-fous attachés à la confirmation** (ce qui la rend contrôlable — la confiance n'exclut
pas le contrôle) :

- **G1 — Confinement** : « dialecte » n'apparaît QUE dans le colKit + les factories d'entités +
  un queryKit (les 2 requêtes natives). Budget : ~200 lignes. Tout `sql\`` hors queryKit = interdit
  (règle à graver dans le CLAUDE.md du module en fin de chantier).
- **G2 — Plan B nommé** : si le colKit dépasse 1 session OU révèle un mur de typage
  cross-dialecte infranchissable sans `any`, bascule **Kysely pour les entités framework
  uniquement** (orm-core permet la cohabitation ; les stores consomment des interfaces).
- **G3 — Premier jalon indépendant** : porter `rowid` → sous-requête PK (table dérivée, forme
  unique valide sur les 3 dialectes) AVANT le colKit — gain portable immédiat, dé-risque le
  repository générique quel que soit la suite.

### Ordre du chantier révisé (1 entité = 1 lot, 4-5 sessions)

1. **S1** : G3 (rowid → PK-subquery) + colKit + port de `session` (43 l., la plus simple) → prouve le patron en vrai.
2. **S2** : `webauthn` + `totp` + `token` + `user` (dont `json_each` → `@>` PG / `JSON_CONTAINS` MySQL).
3. **S3** : `webhook` + `audit` + typage propre du `DrizzleRepository` cross-dialecte (solde la dette Slice 0).
4. **S4** : dialecte `mysql` (`mysql2` optionalDep, `onDuplicateKeyUpdate`) + DDL prod (drizzle-kit) + e2e matrice sqlite/pg/mysql.

### Ce que cette étude répare (au-delà du choix)

La perte de confiance venait d'une promesse jamais écrite : **Drizzle n'est pas un ORM
d'abstraction, c'est du SQL typé par dialecte**. ADR-0003 avait choisi la type-safety en
connaissance de cause, mais sans chiffrer la conséquence multi-dialecte. C'est désormais fait :
le prix est de 4-5 sessions, borné, confiné, avec un plan B nommé. La décision redevient
falsifiable — c'est ça, la confiance.

---

## Annexe — méthode et sources

- npm registry (`npm view <pkg> version time dist-tags`) et api.npmjs.org (downloads
  last-month), api.github.com (stars/issues/push, release notes TypeORM 1.0.0 et Prisma 7.0.0) —
  collecte 2026-07-06/07.
- Terrain repo : `grep`/`wc` sur `src/packages/@nodefony/drizzle/nodefony/` (commit `7212800e`).
- Périmètre : entités framework SEULEMENT. Les entités de l'app utilisateur restent
  mono-dialecte par choix de l'app — hors scope.
- Licences : Drizzle/Prisma Apache-2.0 · Kysely/TypeORM/MikroORM MIT — toutes compatibles.
