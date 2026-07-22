import assert from "node:assert/strict";
import { createClient } from "redis";
import type { SessionsService } from "@nodefony/http";
import RedisSessionStorage from "../../src/SessionStorage";
import { RedisTokenStore } from "../../src/RedisTokenStore";
import { resolveKeyPrefix } from "../../src/keyNamespace";
import { redisTestUrl } from "../helpers/redisTestUrl";

/**
 * **Deux applications sur un même Redis ne se voient pas.**
 *
 * Ce banc ne vérifie pas une composition de chaîne — celle-là est déjà couverte
 * en unitaire. Il vérifie le comportement qui a motivé la cloison : le
 * **balayage**. Les stores exposent des listes d'administration (l'écran Sessions,
 * l'inventaire des jetons) qui parcourent l'espace de clés par `SCAN`. Sans
 * cloison, ce parcours ne pouvait pas distinguer une application d'une autre, et
 * l'écran Sessions de l'une listait les sessions de l'autre.
 *
 * Un test sur un double ne prouverait rien : c'est le `SCAN` du vrai serveur, avec
 * son `MATCH` et son curseur, qui décide de ce qui est vu. D'où le serveur réel.
 *
 * GATE : `REDIS_TEST_URL`.
 */
// Base DÉDIÉE : ce banc purge (`flushDb`) — partager celle d'un autre fichier
// effacerait son seed. Symptôme caractéristique quand on l'oublie : vert en
// isolation, rouge en suite (l'index 12 était déjà pris par deux bancs).
const REAL_URL = redisTestUrl(9);
const IDLE = 120;

let client: ReturnType<typeof createClient> | null = null;

/** Service Redis factice portant la cloison d'UNE application. */
function serviceFor(app: string | undefined, c: unknown) {
  return {
    getClient: () => c,
    keyNamespace: app,
    keyPrefix: (base: string) => resolveKeyPrefix(base, app),
  };
}

/** `SessionsService` factice qui résout le service ci-dessus. */
function managerFor(app: string | undefined, c: unknown): SessionsService {
  return {
    options: { idleTimeoutS: IDLE, absoluteTimeoutS: 0, store: "redis" },
    log: () => {},
    get: (name: string) => (name === "redis" ? serviceFor(app, c) : null),
  } as unknown as SessionsService;
}

describe.skipIf(!REAL_URL)(
  "Cloison des clés Redis — deux applications, un seul serveur",
  () => {
    beforeAll(async () => {
      client = createClient({ url: REAL_URL! });
      await client.connect();
      await client.flushDb();
    });

    afterAll(async () => {
      if (client) {
        await client.flushDb();
        await client.close();
      }
    });

    describe("sessions", () => {
      it("l'inventaire d'une application ne remonte JAMAIS les sessions d'une autre", async () => {
        const boutique = new RedisSessionStorage(
          managerFor("boutique", client),
        );
        const intranet = new RedisSessionStorage(
          managerFor("intranet", client),
        );

        await boutique.write("s-boutique-1", { user: "alice" } as never);
        await boutique.write("s-boutique-2", { user: "bob" } as never);
        await intranet.write("s-intranet-1", { user: "carol" } as never);

        const vueBoutique = await boutique.listPage({ limit: 50 });
        const vueIntranet = await intranet.listPage({ limit: 50 });

        const idsBoutique = vueBoutique.items.map((s) => s.id).sort();
        const idsIntranet = vueIntranet.items.map((s) => s.id).sort();

        assert.deepEqual(idsBoutique, ["s-boutique-1", "s-boutique-2"]);
        assert.deepEqual(idsIntranet, ["s-intranet-1"]);
      });

      it("une application ne peut pas LIRE la session d'une autre, même en connaissant son id", async () => {
        const boutique = new RedisSessionStorage(
          managerFor("boutique", client),
        );
        const intranet = new RedisSessionStorage(
          managerFor("intranet", client),
        );
        await boutique.write("meme-id", { user: "alice" } as never);

        const chezElle = await boutique.read("meme-id");
        const chezLautre = await intranet.read("meme-id");

        assert.equal((chezElle as { user?: string }).user, "alice");
        assert.deepEqual(chezLautre, {}); // rien : ce n'est pas son espace
      });

      it("deux applications peuvent porter le MÊME identifiant de session sans collision", async () => {
        // Conséquence directe : les identifiants n'ont plus à être uniques
        // globalement, seulement par application.
        const boutique = new RedisSessionStorage(
          managerFor("boutique", client),
        );
        const intranet = new RedisSessionStorage(
          managerFor("intranet", client),
        );
        await boutique.write("collision", { user: "alice" } as never);
        await intranet.write("collision", { user: "carol" } as never);

        assert.equal(
          ((await boutique.read("collision")) as { user?: string }).user,
          "alice",
        );
        assert.equal(
          ((await intranet.read("collision")) as { user?: string }).user,
          "carol",
        );
      });

      it("CONTRÔLE NÉGATIF — sans cloison, les deux se voient (l'état d'avant)", async () => {
        // Ce tir-là valide l'instrument : si le banc ne montrait PAS la fuite en
        // l'absence de cloison, il ne prouverait rien de sa présence.
        await client!.flushDb();
        const appA = new RedisSessionStorage(managerFor(undefined, client));
        const appB = new RedisSessionStorage(managerFor(undefined, client));
        await appA.write("s-a", { user: "alice" } as never);
        await appB.write("s-b", { user: "bob" } as never);

        const vueA = await appA.listPage({ limit: 50 });
        assert.deepEqual(
          vueA.items.map((s) => s.id).sort(),
          ["s-a", "s-b"],
          "sans cloison, l'inventaire de A voit bien la session de B",
        );
        await client!.flushDb();
      });
    });

    describe("jetons", () => {
      it("l'inventaire des jetons est cloisonné lui aussi", async () => {
        const now = () => 1_800_000_000_000;
        const boutique = new RedisTokenStore(
          () => client as never,
          now,
          undefined,
          () => resolveKeyPrefix("nf:tok", "boutique"),
        );
        const intranet = new RedisTokenStore(
          () => client as never,
          now,
          undefined,
          () => resolveKeyPrefix("nf:tok", "intranet"),
        );

        const record = (id: string, subject: string, hash: string) => ({
          id,
          kind: "pat" as const,
          name: id,
          prefix: null,
          subjectId: subject,
          subjectType: "user" as const,
          tenantId: null,
          scopes: [],
          audience: [],
          resources: null,
          secretHash: hash,
          hashAlg: "sha256",
          clientId: null,
          cnf: null,
          family: null,
          replacedBy: null,
          createdAt: now(),
          expiresAt: now() + 3_600_000,
          lastUsedAt: null,
          lastUsedIp: null,
          lastUsedUserAgent: null,
          revokedAt: null,
          revokedReason: null,
          metadata: {},
        });
        await boutique.put(
          record("t-boutique", "alice", "h-boutique") as never,
        );
        await intranet.put(
          record("t-intranet", "carol", "h-intranet") as never,
        );

        // Lecture directe : un identifiant connu ne franchit pas la cloison.
        assert.equal((await boutique.findById("t-boutique"))?.id, "t-boutique");
        assert.equal(
          await boutique.findById("t-intranet"),
          null,
          "un jeton d'une autre application est introuvable",
        );
        assert.equal((await intranet.findById("t-intranet"))?.id, "t-intranet");

        // Et le BALAYAGE — c'est lui qui alimente l'inventaire d'administration,
        // et lui qui, sans cloison, remontait les jetons de tout le serveur.
        assert.deepEqual(
          (await boutique.listAll()).map((t) => t.id),
          ["t-boutique"],
        );
        assert.deepEqual(
          (await intranet.listAll()).map((t) => t.id),
          ["t-intranet"],
        );
      });
    });
  },
);
