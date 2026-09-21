import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { listTokenStores, listWebAuthnStores } from "@nodefony/security";
import { listIdempotencyStores } from "@nodefony/framework";
import { registerRedisFrameworkStores } from "../../registerStores";
import { runStoreManifestContract } from "../../../../security/tests/support/storeManifestContract";

/**
 * Enveloppe Redis du contrat de manifeste — le banc vit chez
 * `@nodefony/security`, et les deux adaptateurs durables branchent le même.
 *
 * ⚠️ Redis est un adaptateur de **cache** : il n'est donc PAS soumis à la
 * totalité des briques durables. Ses absences (audit, utilisateurs, TOTP,
 * webhooks) sont un **domaine**, pas un manque — volume et motif d'accès
 * décident, pas « c'est un cache », puisqu'il porte déjà des passkeys, qui sont
 * durables. Ce banc vérifie donc exactement l'inverse de ce qu'on pourrait
 * croire : que le manifeste n'annonce **que** ce que les registres portent.
 *
 * Particularité à connaître : la brique `idempotency` n'est pas enregistrée par
 * CE module, mais par `@nodefony/framework` lui-même (`index.ts`), qui résout
 * le client Redis par le conteneur sans importer ce paquet — le graphe de
 * dépendances va dans l'autre sens. Le banc teste le RÉSULTAT (le registre),
 * pas qui a posé la fabrique : c'est le niveau auquel la console lit, elle aussi.
 */
const HERE = dirname(fileURLToPath(import.meta.url));

describe("Redis — couverture des briques framework", () => {
  beforeAll(() => {
    // Idempotent (guards). L'import de `@nodefony/framework` plus haut a déjà
    // exécuté son `registerIdempotencyStore("redis", …)`.
    registerRedisFrameworkStores();
  });

  runStoreManifestContract({
    packageJsonPath: join(HERE, "..", "..", "..", "package.json"),
    engine: "redis",
    storeKind: "cache",
    bricks: [
      // Le STORAGE de session s'enregistre auprès du `SessionsService` à
      // l'import du module (pas de registre par backend, pas d'entité ORM).
      { brick: "session" },
      { brick: "tokens", backends: listTokenStores },
      { brick: "passkeys", backends: listWebAuthnStores },
      { brick: "idempotency", backends: listIdempotencyStores },
    ],
    // Pas de `durableBricks` : un adaptateur de cache n'y est pas soumis.
  });
});
