import assert from "node:assert/strict";
import { SessionsService } from "@nodefony/http";
import { entityRegistry, ormRegistry } from "@nodefony/orm-core";
import type { IRepository } from "@nodefony/orm-core";
import { DrizzleOrm } from "../../nodefony/src/orm-core/index";
import DrizzleSessionStorage from "../../nodefony/src/SessionStorage";
import {
  registerSessionEntity,
  SESSION_CONNECTOR,
  type SessionRow,
} from "../../nodefony/entity/sessionEntity";
import type { SqlDialect } from "../../nodefony/interfaces/IDrizzleConfig";

/**
 * BANC DE PARITÉ DU CONTRAT `SessionStorage` — LA même suite sur les TROIS
 * dialectes (sqlite toujours ; postgres/mysql gatés par l'infra).
 *
 * Enjeu : la session porte l'identité de CHAQUE requête authentifiée. Deux
 * propriétés doivent tenir sur tout backend — `createdAt` est **insert-only**
 * (un upsert qui l'écrase ferait rajeunir la session à chaque écriture, donc
 * repousserait indéfiniment le timeout absolu NIST) et `listAll` **ne sort
 * jamais `Attributes`** (redaction par construction : l'écran d'admin ne doit
 * pas exfiltrer le contenu applicatif des sessions d'autrui).
 *
 * ⚠️ `SESSION_CONNECTOR` est une constante (`"default"`) : le storage résout son
 * ORM par ce nom. Les trois dialectes ne peuvent donc PAS cohabiter dans un même
 * process — d'où un fichier consommateur par dialecte (vitest isole par worker).
 *
 * **Divergence ASSUMÉE (hors banc)** : le NOMBRE de requêtes par verbe. En
 * sqlite/pg un `write` = 1 instruction (`ON CONFLICT … RETURNING`) ; en mysql il
 * en coûte 2 (ODKU puis relecture, faute de RETURNING). Les tests qui comptent
 * les requêtes vivent donc dans le fichier sqlite.
 */

export interface ISessionStoreContractOptions {
  dialect: SqlDialect;
  connection: { filename?: string; url?: string };
}

/** Manager minimal (le storage n'utilise que les timeouts session + `log`). */
const fakeManager = {
  options: { idleTimeoutS: 3600, absoluteTimeoutS: 0, store: "drizzle" },
  log: () => {},
} as unknown as SessionsService;

export function runSessionStoreContract(
  opts: ISessionStoreContractOptions,
): void {
  const { dialect } = opts;
  let orm: DrizzleOrm;
  let storage: DrizzleSessionStorage;
  const repo = (): IRepository<SessionRow> =>
    orm.getRepository<SessionRow>("session");

  const purge = async (): Promise<void> => {
    await repo().delete({});
  };

  beforeAll(async () => {
    registerSessionEntity(SESSION_CONNECTOR, dialect); // AVANT connect
    orm = new DrizzleOrm(SESSION_CONNECTOR, { dialect, ...opts.connection });
    await orm.connect();
    storage = new DrizzleSessionStorage(fakeManager);
    await purge(); // tables persistantes entre les runs (IF NOT EXISTS)
  });

  afterAll(async () => {
    await purge();
    await orm.disconnect();
    entityRegistry.unregister("session", SESSION_CONNECTOR);
    ormRegistry.unregister(SESSION_CONNECTOR);
  });

  describe("write / read", () => {
    it("write → read : round-trip complet des sacs JSON + user + dates", async () => {
      await purge();
      await storage.write("s-1", {
        Attributes: { cart: ["a", "b"], depth: { n: 1 } },
        metaBag: { ip: "10.0.0.1" },
        flashBag: { notice: "hello" },
        user: "alice",
      });
      const r = await storage.read("s-1");
      assert.deepEqual(r.Attributes, { cart: ["a", "b"], depth: { n: 1 } });
      assert.deepEqual(r.metaBag, { ip: "10.0.0.1" });
      assert.deepEqual(r.flashBag, { notice: "hello" });
      assert.equal(r.user, "alice");
      assert.ok(r.createdAt instanceof Date, "createdAt = Date, pas un number");
    });

    it("write rejoué = UPSERT : 1 seule ligne, et `createdAt` PRÉSERVÉ (insert-only)", async () => {
      // La propriété qui compte : `createdAt` sert au timeout ABSOLU (NIST). Si
      // l'upsert l'écrasait, la session rajeunirait à chaque écriture — donc à
      // chaque requête — et ne mourrait jamais.
      const before = (await storage.read("s-1")) as { createdAt: Date };
      await storage.write("s-1", {
        Attributes: { cart: [] },
        metaBag: {},
        flashBag: {},
        user: "alice2",
      });
      assert.equal(await repo().count({ session_id: "s-1" }), 1);
      const after = (await storage.read("s-1")) as {
        user: string;
        createdAt: Date;
      };
      assert.equal(after.user, "alice2");
      assert.equal(
        after.createdAt.getTime(),
        before.createdAt.getTime(),
        "createdAt = insert-only, jamais écrasé",
      );
    });

    it("read d'une session inconnue renvoie un objet VIDE (jamais une erreur)", async () => {
      // Un cookie périmé/forgé ne doit pas faire un 500 : la session repart vide.
      const r = await storage.read("jamais-vu");
      assert.deepEqual(r.Attributes ?? {}, {});
    });

    it("write CONCURRENT × 10 du même id : 0 rejet, 1 ligne, createdAt stable", async () => {
      // Cas réel : plusieurs requêtes d'un même navigateur écrivent la session
      // en parallèle (onglets, préchargement).
      await purge();
      const repoW = repo();
      await Promise.all(Array.from({ length: 10 }, () => repoW.count({}))); // pool chaud
      await storage.write("s-conc", {
        Attributes: {},
        metaBag: {},
        flashBag: {},
        user: "u0",
      });
      const born = (await storage.read("s-conc")) as { createdAt: Date };
      const results = await Promise.allSettled(
        Array.from({ length: 10 }, (_, i) =>
          storage.write("s-conc", {
            Attributes: { i },
            metaBag: {},
            flashBag: {},
            user: `u${i}`,
          }),
        ),
      );
      assert.deepEqual(
        results
          .filter((r) => r.status === "rejected")
          .map((r) => (r as PromiseRejectedResult).reason?.message),
        [],
        "aucun write concurrent rejeté",
      );
      assert.equal(await repo().count({ session_id: "s-conc" }), 1);
      const after = (await storage.read("s-conc")) as { createdAt: Date };
      assert.equal(
        after.createdAt.getTime(),
        born.createdAt.getTime(),
        "createdAt survit à 10 écritures concurrentes",
      );
    });

    it("sacs VIDES et session ANONYME : préservés (≠ absent)", async () => {
      await purge();
      // Le contrat type `user: string` : une session anonyme s'écrit `""`, que
      // le storage convertit en NULL (`serialize.user || null`) — c'est le
      // round-trip `"" → NULL → ""` qui est vérifié ici, sur les 3 dialectes.
      await storage.write("s-empty", {
        Attributes: {},
        metaBag: {},
        flashBag: {},
        user: "",
      });
      const r = await storage.read("s-empty");
      assert.deepEqual(r.Attributes, {});
      assert.deepEqual(r.flashBag, {});
      // NORMALISATION du contrat : la colonne est NULL en base, mais `read`
      // rend `""` (cf `SessionStorage.read`) → l'appelant n'a jamais à gérer
      // null ET "" pour dire « session anonyme ». Vrai sur les 3 dialectes.
      assert.equal(r.user, "", "session anonyme = chaîne vide, jamais null");
    });

    it("round-trip de valeurs hostiles : unicode, imbrication, tableau long", async () => {
      await purge();
      const Attributes = {
        "clé é👩‍💻": "chloé 日本語",
        deep: { a: [1, { b: null }, "x"] },
        liste: Array.from({ length: 40 }, (_, i) => i),
        vide: "",
      };
      await storage.write("s-uni", {
        Attributes,
        metaBag: {},
        flashBag: {},
        user: "é👩‍💻",
      });
      const r = await storage.read("s-uni");
      assert.deepEqual(r.Attributes, Attributes);
      assert.equal(r.user, "é👩‍💻");
    });
  });

  describe("touch / destroy", () => {
    it("touch met à jour la session sans la dupliquer (au plus 1 ligne)", async () => {
      await purge();
      await storage.write("s-t", {
        Attributes: {},
        metaBag: {},
        flashBag: {},
        user: "u",
      });
      await storage.touch("s-t");
      assert.equal(await repo().count({ session_id: "s-t" }), 1);
    });

    it("touch d'une session inconnue : no-op (ne crée rien, ne lève pas)", async () => {
      await storage.touch("jamais-vu");
      assert.equal(await repo().exists({ session_id: "jamais-vu" }), false);
    });

    it("destroy supprime ; read renvoie ensuite un objet vide", async () => {
      assert.equal(await storage.destroy("s-t"), true);
      const r = await storage.read("s-t");
      assert.deepEqual(r.Attributes ?? {}, {});
      assert.equal(await repo().exists({ session_id: "s-t" }), false);
    });

    it("destroy ne touche QUE la session visée", async () => {
      await purge();
      await storage.write("keep", {
        Attributes: {},
        metaBag: {},
        flashBag: {},
        user: "u",
      });
      await storage.write("drop", {
        Attributes: {},
        metaBag: {},
        flashBag: {},
        user: "u",
      });
      await storage.destroy("drop");
      assert.ok(await repo().exists({ session_id: "keep" }), "voisine intacte");
    });
  });

  describe("gc", () => {
    it("supprime les sessions expirées, garde les fraîches, et COMPTE juste", async () => {
      // Le compte remonté doit être le vrai (`changes` sqlite / `rowCount` pg /
      // `affectedRows` mysql) — sinon le log ment sur ce qui a été purgé.
      await purge();
      const now = Date.now();
      await repo().createMany([
        {
          session_id: "old",
          Attributes: {},
          flashBag: {},
          metaBag: {},
          user: null,
          createdAt: now - 60_000,
          updatedAt: now - 60_000,
        },
        {
          session_id: "fresh",
          Attributes: {},
          flashBag: {},
          metaBag: {},
          user: null,
          createdAt: now,
          updatedAt: now,
        },
      ]);
      const deleted = await repo().delete({
        updatedAt: { $lt: now - 30_000 },
      } as never);
      assert.equal(deleted, 1, "le compte de suppression est RÉEL");
      assert.ok(await repo().exists({ session_id: "fresh" }));
      assert.equal(await repo().exists({ session_id: "old" }), false);
    });

    it("gc() ne purge JAMAIS une session fraîche", async () => {
      await purge();
      await storage.write("vivante", {
        Attributes: {},
        metaBag: {},
        flashBag: {},
        user: "u",
      });
      await storage.gc();
      assert.ok(
        await repo().exists({ session_id: "vivante" }),
        "une session active survit au gc",
      );
    });
  });

  describe("listAll (énumération admin)", () => {
    it("filtre par user via WHERE réel, et NE SORT PAS Attributes (redaction)", async () => {
      // Redaction PAR CONSTRUCTION : `Attributes` (contenu applicatif) reste en
      // base. L'écran d'admin liste les sessions, il n'espionne pas leur contenu.
      await purge();
      await storage.write("ls1", {
        Attributes: { secret: "TOP" },
        metaBag: { ip: "1.1.1.1" },
        flashBag: {},
        user: "u-a",
      });
      await storage.write("ls2", {
        Attributes: { secret: "AUSSI" },
        metaBag: { ip: "2.2.2.2" },
        flashBag: {},
        user: "u-b",
      });
      const mine = await storage.listAll({ user: "u-a" });
      assert.equal(mine.length, 1, "filtre WHERE réel, pas un filtre JS");
      assert.equal(mine[0]?.id, "ls1");
      assert.deepEqual(
        mine[0]?.data.Attributes,
        {},
        "Attributes JAMAIS exposé",
      );
      assert.deepEqual(mine[0]?.data.metaBag, { ip: "1.1.1.1" }, "metaBag OK");
    });

    it("listAll sans filtre : toutes les sessions, toujours sans Attributes", async () => {
      const all = await storage.listAll();
      assert.deepEqual(all.map((s) => s.id).sort(), ["ls1", "ls2"]);
      assert.ok(
        all.every((s) => Object.keys(s.data.Attributes ?? {}).length === 0),
        "aucune fuite, même en liste complète",
      );
    });

    it("listAll d'un user sans session renvoie []", async () => {
      assert.deepEqual(await storage.listAll({ user: "ghost" }), []);
    });
  });

  describe("open", () => {
    it("compte les sessions persistées", async () => {
      await purge();
      await storage.write("o1", {
        Attributes: {},
        metaBag: {},
        flashBag: {},
        user: "u",
      });
      assert.equal(await storage.open(), 1);
    });
  });
}
