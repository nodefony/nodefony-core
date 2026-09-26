---
title: "Parité des adaptateurs — ce qui est prouvé identique, ce qui diffère, ce qui n'est pas prouvé"
navTitle: Parité des adaptateurs
lang: fr
module: global
topic: orm-parity-guide
audience: [developer]
tags: [persistence, orm, parity, drizzle, mongoose, contract, tests, guide]
version: "doc"
status: stable
updated: 2026-09-24
source: "docs/guides/parite-des-adaptateurs.md"
---

# Guide — Parité des adaptateurs (SQL et MongoDB)

> Changer `NF_DATABASE_URL` de `postgres://` à `mongodb://` ne doit rien changer à ce que voit
> l'application. Cette page dit ce qui le **prouve**, les écarts **assumés** entre moteurs, et
> — surtout — ce qu'aucun banc ne prouve encore. Un développeur qui choisit son moteur doit
> pouvoir lire ici ce qu'il perd, avant de le découvrir en production.

📍 [Documentation](../index.md) › [Guides](README.md) › **Parité des adaptateurs**

## Le modèle — un contrat, un banc, N moteurs

**Chaque contrat de stockage a UN banc de tests, qui vit chez le propriétaire du contrat — et
chaque adaptateur le branche.** Comme un examen commun : la même copie est posée à tous les
candidats, et c'est l'identité de la copie qui rend les notes comparables. Deux bancs recopiés
divergeraient en silence, chacun passant ses propres tests.

Un adaptateur ne fournit au banc qu'un **harnais** : comment ouvrir la base, la vider, fabriquer
le store, et quelles **capacités** il porte. Il n'écrit aucune assertion. Un écart de
comportement entre deux moteurs devient donc un test rouge, par construction.

<!-- prettier-ignore -->
| Contrat | Banc (propriétaire) | Mémoire | Drizzle × sqlite / pg / mysql | MongoDB |
| --- | --- | --- | --- | --- |
| `IRepository` + `IOrm` | `runRepositoryContract()` (`orm-core/tests/support/repositoryContract.ts:80`) | — | ✅ | ✅ |
| `ITokenStore` | `runTokenStoreContract()` (`security/tests/support/tokenStoreContract.ts:80`) | ✅ | ✅ | ✅ (+ Redis) |
| `IWebAuthnCredentialStore` | `runWebAuthnStoreContract()` (`security/tests/support/webAuthnStoreContract.ts:63`) | ✅ | ✅ | ✅ |
| `IWebhookStore` | `runWebhookStoreContract()` (`security/tests/support/webhookStoreContract.ts:66`) | ✅ | ✅ | ✅ |
| `ITotpSecretStore` | `runTotpStoreContract()` (`security/tests/support/totpStoreContract.ts:81`) | ✅ | ✅ | ✅ |
| Journal d'audit sous rafale | `runAuditBurstContract()` (`security/tests/support/auditBurstContract.ts:56`) | — | ✅ | ✅ |
| Manifeste des stores | `runStoreManifestContract()` (`security/tests/support/storeManifestContract.ts:82`) | — | ✅ | ✅ |

Au-dessus de ces bancs unitaires, **l'application entière démarre sur MongoDB** et rejoue la
passe d'intégration HTTP (`npm run test:all -- --mongo`, garde `MONGO_BOOT_GATE` dans
`vitest.gates.ts`) : c'est ce qui prouve que les briques se câblent au boot, pas seulement
qu'elles répondent une fois montées à la main.

## Ce que ces bancs ont déjà trouvé

Ils ne sont pas décoratifs : leur premier rejeu croisé a trouvé des écarts que chaque banc isolé
laissait passer.

- **`$ne` et `$nin` attrapaient les valeurs absentes sous MongoDB**, que SQL écarte — la même
  requête rendait plus de lignes en production MongoDB. Corrigé dans `#mongoOps()`
  (`MongooseRepository.ts:173`).
- **`describeEntity()` parlait le vocabulaire du moteur** (`_id`, `__v`) : l'ERD et le contexte
  IA changeaient de noms selon l'adaptateur (`MongooseOrm.ts:639`).
- **Le store de jetons MongoDB rendait le document brut**, champs du moteur compris.
- **Le store de jetons Redis laissait RECULER le seuil de révocation en masse** sous
  concurrence (`GET` puis `SET`) : deux déconnexions simultanées pouvaient rendre valides des
  jetons révoqués. Il pose désormais le seuil en une instruction serveur
  (`MONOTONIC_SET_SCRIPT`, `RedisTokenStore.ts:62`). Il gardait aussi l'ancien secret d'un jeton
  réécrit, acceptait deux jetons pour un même secret, et ne purgeait jamais un PAT enregistré
  déjà révoqué.
- **Le journal d'audit sous MongoDB parcourait toute la collection puis triait en mémoire**
  (plan `COLLSCAN` + `SORT`) : un `SchemaDefinition` plat n'exprime pas d'index composite. Les
  entités déclarent désormais les leurs (`IEntityIndex`, appliqué par `MongooseOrm`), et l'ordre
  total `{ ts: -1, _id: -1 }` est servi par l'index — un test lit le plan d'exécution.
- **Les stores mémoire partageaient leurs objets avec l'appelant** et gardaient d'anciens liens
  d'index : un jeton réécrit sous un nouveau secret restait joignable par l'ancien. Copies
  profondes et ré-indexation : `cloneOrNull()` (`MemoryTokenStore.ts:51`), `cloneCredential()`
  (`MemoryWebAuthnCredentialStore.ts:53`), `cloneEndpoint()` (`MemoryWebhookStore.ts:53`), `cloneSecret()` (`MemoryTotpSecretStore.ts:68`).

## Écarts ASSUMÉS entre moteurs

Ce sont des différences réelles, connues, qu'on a choisi de ne pas masquer. Le banc ne les
exige donc pas — et les nomme.

<!-- prettier-ignore -->
| Écart | SQL | MongoDB | Ce que ça change pour vous |
| --- | --- | --- | --- |
| **Savepoints** | réels | `savepoint()`/`rollbackTo()` lèvent `SavepointNotSupportedError` (`MongooseTransaction.ts:69`) | Pas de rollback PARTIEL sous MongoDB : le refus fait échouer le callback, et la transaction ENTIÈRE est annulée. Le banc éprouve ce refus (`savepoints: false`). |
| **Expiration des jetons** | `gc()` balaie et compte | `gc()` balaie et compte ; **Redis** : TTL natif, `gc()` rend toujours 0, à la seconde près | Le banc vérifie que l'expiré a DISPARU plutôt qu'un compte (`nativeTtl`), et saute la borne à la milliseconde sous Redis. |
| **Casse de `$like`** | suit la collation (sqlite/mysql insensibles, pg sensible) | expression régulière, sensible | Ne pas compter sur l'insensibilité à la casse : le banc n'utilise que des motifs à casse exacte. |
| **Ordre de deux écritures concurrentes** | sqlite : le premier lancé gagne ; pg/mysql : ordre d'arrivée libre | ordre d'arrivée libre | Le banc exige ce qui vaut partout — aucun rejet, une seule révocation effective, aucune réécriture ultérieure — jamais QUI gagne. |
| **Deux jetons au même `secretHash`** | sqlite/pg **rejettent** ; mysql **écrase** la ligne en conflit | rejette | Inatteignable en pratique (le hash vient d'un secret aléatoire). L'invariant portable — jamais deux jetons pour un secret — est exigé ; la manière, non (`DrizzleTokenStore.ts:180`). |
| **Visibilité avant commit** hors transaction | sqlite : connexion unique, tout lit dans la transaction ; pg/mysql : invisible | invisible | Seule règle portable : `withTransaction(tx)` est le SEUL moyen d'entrer dans une transaction. |

## Ce que les bancs ne prouvent PAS

- **Seule l'attestation `none` est éprouvée.** La cérémonie WebAuthn ENTIÈRE l'est, sur les deux
  moteurs : un authentificateur logiciel enrôle une passkey, ouvre une session par elle, et voit
  refuser le rejeu, le compteur qui recule, la clé étrangère, l'origine étrangère et la passkey
  supprimée (`http/…/webauthn-ceremony.test.ts`). Les formats `packed`, `tpm` ou `android-key`,
  et toute confrontation aux métadonnées FIDO, ne le sont pas — Nodefony ne les exploite pas.
- **L'expiration d'un jeton Redis n'est éprouvée que sur le double.** Le serveur réel prouve les
  commandes et la vraie concurrence, mais on n'avance pas son horloge : ses cas d'expiration
  sont sautés (`clockDrivenExpiry: false`), et le double fidèle, piloté par l'horloge du banc,
  les porte.
- **MySQL Community se joue dans une passe séparée** de MariaDB (les deux partagent
  `NF_MYSQL_URL`) : `npm run test:all -- --dialects`.
- **La coupure réelle du serveur MongoDB** (`outage-real.test.ts`) ne tourne que sur demande
  (`NF_RUN_DB_OUTAGE=1`), le banc ayant alors la main sur le conteneur ; sans elle, ses cas sont
  sautés.

## Rejouer le banc

```bash
# Tout, avec le rapport de ce qui n'a PAS été lancé
npm run test:all                  # Drizzle × sqlite/pg/mariadb + mémoire
npm run test:all -- --mongo       # + démarrage de l'application sur MongoDB
npm run test:all -- --dialects    # + MySQL Community

# Un adaptateur seul (les variables viennent de vitest.gates.ts)
cd src/packages/@nodefony/mongoose && npx vitest run tests/integration/repository-contract.test.ts
```

## 📖 Lexique

<!-- prettier-ignore -->
| Terme | Sens ici |
| --- | --- |
| **Contrat** | L'interface qu'un store promet de respecter (`ITokenStore`, `IRepository`…), comportement compris. |
| **Banc de contrat** | La suite de tests UNIQUE qui décrit ce comportement, rangée chez le propriétaire du contrat. |
| **Harnais** | Ce qu'un adaptateur fournit au banc : ouvrir, vider, fabriquer le store, déclarer ses capacités. Jamais d'assertion. |
| **Capacité** | Ce qu'un moteur porte ou non (les savepoints) — déclarée par le harnais, pour que le banc saute le cas en le NOMMANT. |
| **Parité** | Deux adaptateurs passent la même copie. Ce n'est pas l'identité d'implémentation. |

## ⚠️ Pièges

- **Un saut compte comme vert.** Un banc sans sa variable d'infrastructure se saute en silence :
  lire le rapport de `test:all` (« non lancée ») avant de conclure qu'un moteur est couvert.
- **Un store mémoire n'est pas une base.** Les stores mémoire passent le même contrat, mais ne
  survivent pas au redémarrage et ne se partagent pas entre pods — un repli de développement.
- **Un test qui mute un objet lu sans le réécrire** ne passe que sur un store qui partage ses
  références : il échouera sur toute base réelle. Écrire par `put`/`update`, toujours.
- **Un nouvel adaptateur branche les bancs existants AVANT d'écrire ses propres tests.** Écrire
  d'abord les siens, c'est reproduire ce qui a laissé passer les écarts ci-dessus.

## 🧪 Tests & couverture

Les chiffres exacts vivent dans la carte de l'aperçu, régénérée depuis vitest — jamais figés ici.

<!-- prettier-ignore -->
| Type | Où | Ce qui est prouvé |
| --- | --- | --- |
| Unitaires (mémoire) | `@nodefony/security` `unit/tokenStoreContract.test.ts`, `unit/webAuthnCredentialStoreContract.test.ts`, `unit/webhookStore.test.ts`, `unit/totpStoreContract.test.ts` | les stores mémoire passent la même copie que les bases |
| Intégration (sqlite) | `@nodefony/drizzle` `repository-contract-sqlite.test.ts`, `token-store-sqlite.test.ts`, `webauthn-store-sqlite.test.ts`, `webhook-store-sqlite.test.ts` | les contrats sur SQLite |
| E2E (bases réelles) | `@nodefony/drizzle` `*-postgres.e2e.test.ts`, `*-mysql.e2e.test.ts` · `@nodefony/mongoose` `repository-contract.test.ts`, `token-store.test.ts`, `webauthn-credential-store.test.ts`, `webhook-store.test.ts` | les mêmes contrats sur PostgreSQL, MySQL/MariaDB et MongoDB |

> [!CAUTION]
> Les suites E2E se **skippent** sans leurs variables d'infrastructure, et un skip compte comme
> vert. Source unique des variables : `vitest.gates.ts` à la racine.

## 🔗 Pour aller plus loin

- ⬆️ **Retour au hub** : [Guides](README.md) · [Toute la documentation](../index.md)
- 🗃️ **Où va chaque brique, et sur quel moteur** : [`persistence.md`](./persistence.md)
- 🔁 **Ce que lance la forge, et comment le rejouer** : [`integration-continue.md`](./integration-continue.md)
- 🗄️ **Les adaptateurs** :
  [`@nodefony/drizzle`](../../src/packages/@nodefony/drizzle/docs/index.md) ·
  [`@nodefony/mongoose`](../../src/packages/@nodefony/mongoose/docs/index.md)
- 📖 [Lexique général](../lexique.md) du framework.
