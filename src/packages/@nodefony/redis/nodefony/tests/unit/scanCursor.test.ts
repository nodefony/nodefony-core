import assert from "node:assert/strict";
import type { SessionsService } from "@nodefony/http";
import { RedisTokenStore } from "../../src/RedisTokenStore";
import { RedisWebAuthnCredentialStore } from "../../src/RedisWebAuthnCredentialStore";
import RedisSessionStorage from "../../src/SessionStorage";

// ════════════════════════════════════════════════════════════════════════════
// 2. Un curseur hostile n'atteint JAMAIS le serveur — vu des trois stores
// ════════════════════════════════════════════════════════════════════════════

/** Client double qui note les curseurs reçus et ne rend jamais rien. */
function spyClient(seen: string[]) {
  return {
    scan: async (cursor: string) => {
      seen.push(cursor);
      return { cursor: "0", keys: [] as string[] };
    },
    hGetAll: async () => ({}),
    sMembers: async () => [] as string[],
  } as never;
}

/** Manager de session minimal branché sur un client donné. */
function sessionManager(client: unknown): SessionsService {
  return {
    options: { idleTimeoutS: 120, absoluteTimeoutS: 0, store: "redis" },
    log: () => {},
    get: (name: string) =>
      name === "redis" ? { getClient: () => client } : null,
  } as unknown as SessionsService;
}

describe("curseur hostile — aucun store ne le transmet à Redis", () => {
  const HOSTILE = "'; FLUSHALL --";

  it("sessions", async () => {
    const seen: string[] = [];
    const storage = new RedisSessionStorage(sessionManager(spyClient(seen)));
    await storage.listPage({ limit: 10, cursor: HOSTILE });
    assert.deepEqual(seen, ["0"]);
  });

  it("jetons", async () => {
    const seen: string[] = [];
    const store = new RedisTokenStore(() => spyClient(seen));
    await store.listPage({ limit: 10, cursor: HOSTILE });
    assert.deepEqual(seen, ["0"]);
  });

  it("passkeys", async () => {
    const seen: string[] = [];
    const store = new RedisWebAuthnCredentialStore(() => spyClient(seen));
    await store.listPage({ limit: 10, cursor: HOSTILE });
    assert.deepEqual(seen, ["0"]);
  });

  it("un curseur qui prétend emporter une clé ne fait lire QUE ce que SCAN rend", async () => {
    // La règle (`scanPage`, cœur) ne transporte aucune clé : un curseur forgé
    // ne peut donc pas faire lire `hGetAll` une clé hors du lot SCAN.
    const reads: string[] = [];
    const client = {
      scan: async () => ({ cursor: "0", keys: ["nf:tok:rec:a"] }),
      hGetAll: async (key: string) => {
        reads.push(key);
        return {};
      },
    } as never;
    const store = new RedisTokenStore(() => client);
    for (const forged of [
      "0.nf:auth:secret",
      `0.${Buffer.from('["nf:auth:secret"]').toString("base64url")}`,
      `5:${HOSTILE}`,
    ]) {
      await store.listPage({ limit: 10, cursor: forged });
    }
    assert.deepEqual([...new Set(reads)], ["nf:tok:rec:a"]);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// 3. Curseur composite : un batch PLUS GROS que la page (F76)
// ════════════════════════════════════════════════════════════════════════════

/**
 * Double qui rend **tout le keyspace d'un coup**, `COUNT` ignoré — c'est le
 * comportement réel de Redis sur un petit keyspace encodé en listpack, et c'est
 * exactement ce qu'aucun double du dépôt ne reproduisait.
 */
function fatBatchClient(keys: string[], record: (key: string) => object) {
  return {
    scan: async (cursor: string) => {
      // Un seul batch : le scan est terminé (`"0"`), mais il déborde la page.
      if (cursor !== "0") return { cursor: "0", keys: [] as string[] };
      return { cursor: "0", keys };
    },
    hGetAll: async (key: string) => record(key) as Record<string, string>,
    get: async (key: string) => JSON.stringify(record(key)),
    sMembers: async () => [] as string[],
  } as never;
}

/** Hash de jeton minimal mais complet pour `#decode`. */
function tokenHash(id: string): Record<string, string> {
  return {
    id,
    kind: "pat",
    name: id,
    subjectId: "u1",
    subjectType: "user",
    secretHash: `h-${id}`,
    hashAlg: "sha256",
    createdAt: "1",
  };
}

describe("curseur composite — un batch plus gros que la page (jetons)", () => {
  const ids = ["a", "b", "c", "d", "e"];
  const keys = ids.map((id) => `nf:tok:rec:${id}`);
  const client = fatBatchClient(keys, (key) =>
    tokenHash(key.slice("nf:tok:rec:".length)),
  );

  it("la page ne déborde JAMAIS la limite demandée", async () => {
    const store = new RedisTokenStore(() => client);
    const page = await store.listPage({ limit: 2 });
    assert.equal(page.items.length, 2, "5 clés rendues, 2 demandées");
    assert.equal(page.hasNext, true);
    assert.ok(page.nextCursor, "il reste des clés de CE batch");
  });

  it("les pages suivantes reprennent sans perte ni doublon", async () => {
    const store = new RedisTokenStore(() => client);
    const seen: string[] = [];
    let cursor: string | null | undefined;
    let pages = 0;
    do {
      const page = await store.listPage({
        limit: 2,
        cursor: cursor ?? undefined,
      });
      for (const item of page.items) seen.push(item.id);
      cursor = page.nextCursor;
      pages += 1;
      assert.ok(pages < 10, "la pagination doit CONVERGER");
    } while (cursor);

    assert.deepEqual(seen, ids, "tout le lot, dans l'ordre, une seule fois");
    assert.equal(pages, 3, "5 éléments en pages de 2 → 3 pages");
  });

  it("🔴 un lot RÉORDONNÉ entre deux pages ne fait perdre aucun jeton", async () => {
    // Redis ne rend pas deux fois le même lot pour un même curseur (rehash) :
    // la reprise « en sautant les 2 premières clés » perdait c et d.
    let calls = 0;
    const reordering = {
      scan: async () => {
        calls += 1;
        const order = calls === 1 ? ids : [...ids].reverse();
        return { cursor: "0", keys: order.map((id) => `nf:tok:rec:${id}`) };
      },
      hGetAll: async (key: string) =>
        tokenHash(key.slice("nf:tok:rec:".length)),
    } as never;
    const store = new RedisTokenStore(() => reordering);
    const seen: string[] = [];
    let cursor: string | null | undefined;
    let pages = 0;
    do {
      const page = await store.listPage({
        limit: 2,
        cursor: cursor ?? undefined,
      });
      for (const item of page.items) seen.push(item.id);
      cursor = page.nextCursor;
      pages += 1;
      assert.ok(pages < 10, "la pagination doit CONVERGER");
    } while (cursor);
    assert.deepEqual([...seen].sort(), ids, "chaque jeton, une seule fois");
  });
});

describe("curseur composite — un batch plus gros que la page (sessions)", () => {
  const ids = ["s1", "s2", "s3", "s4", "s5"];
  const keys = ids.map((id) => `nf:sess:${id}`);
  const client = fatBatchClient(keys, () => ({
    user: "alice",
    Attributes: {},
    metaBag: {},
    flashBag: {},
    createdAt: 1,
    updatedAt: 1,
  }));

  it("les pages couvrent tout le lot sans doublon", async () => {
    const storage = new RedisSessionStorage(sessionManager(client));
    const seen: string[] = [];
    let cursor: string | null | undefined;
    let pages = 0;
    do {
      const page = await storage.listPage({
        limit: 2,
        cursor: cursor ?? undefined,
      });
      assert.ok(page.items.length <= 2, "une page ne déborde pas sa limite");
      for (const item of page.items) seen.push(item.id);
      cursor = page.nextCursor;
      pages += 1;
      assert.ok(pages < 10, "la pagination doit CONVERGER");
    } while (cursor);

    assert.deepEqual(seen.sort(), ids, "tout le lot, une seule fois");
  });
});

// ════════════════════════════════════════════════════════════════════════════
// 4. Balayage administratif plafonné et ANNONCÉ (jetons)
// ════════════════════════════════════════════════════════════════════════════
describe("listAll (jetons) — plafond de balayage", () => {
  /** Keyspace sans fin : le curseur ne retombe jamais à `"0"`. */
  function endlessClient() {
    let batch = 0;
    return {
      scan: async () => {
        batch += 1;
        return {
          cursor: String(batch),
          keys: Array.from(
            { length: 200 },
            (_, i) => `nf:tok:rec:${batch}-${i}`,
          ),
        };
      },
      // Records illisibles : on mesure le BALAYAGE, pas le décodage.
      hGetAll: async () => ({}),
    } as never;
  }

  // Délai court ASSUMÉ : sans plafond, ce balayage ne se termine jamais. Le
  // test doit alors échouer en quelques secondes, pas immobiliser la suite.
  it("s'arrête au plafond au lieu de balayer tout le keyspace", async () => {
    const notices: string[] = [];
    const store = new RedisTokenStore(
      () => endlessClient(),
      undefined,
      undefined,
      undefined,
      (message) => notices.push(message),
    );
    const all = await store.listAll();
    assert.deepEqual(all, [], "aucun record décodable dans ce décor");
    assert.equal(notices.length, 1, "un listing tronqué se DIT");
    assert.match(notices[0]!, /PARTIEL/);
  }, 5_000);
});
