import { afterAll, describe, expect, it } from "vitest";
import { REPO_ROOT } from "./repo-root.mjs";
import {
  connectRedis,
  purgeTestSessions,
  redisDatabase,
  sessionPatterns,
} from "./redis-session-purge.mjs";

describe("redisDatabase — quelle base nomme l'URL ?", () => {
  it("lit l'index du chemin, 0 quand il est absent", () => {
    expect(redisDatabase("redis://:p@127.0.0.1:6379")).toBe(0);
    expect(redisDatabase("redis://:p@127.0.0.1:6379/")).toBe(0);
    expect(redisDatabase("redis://:p@127.0.0.1:6379/14")).toBe(14);
  });

  it("un chemin qui n'est pas un index lève, au lieu de valoir 0", () => {
    expect(() => redisDatabase("redis://127.0.0.1:6379/abc")).toThrow(
      /illisible/,
    );
  });
});

describe("sessionPatterns — ce que la purge vise", () => {
  it("toutes les cloisons, y compris l'absence de cloison", () => {
    expect(sessionPatterns()).toEqual(["nf:*sess:*", "nf:*sess~*"]);
  });

  it("une seule cloison quand elle est nommée", () => {
    expect(sessionPatterns("app")).toEqual(["nf:app:sess:*", "nf:app:sess~*"]);
  });
});

describe("purgeTestSessions — la base du développeur n'est jamais touchée", () => {
  it("🔴 refuse la base 0, nommée ou implicite, avant toute connexion", async () => {
    // Port fermé : une connexion tentée échouerait autrement qu'avec ce message.
    for (const url of ["redis://127.0.0.1:1", "redis://127.0.0.1:1/0"]) {
      await expect(purgeTestSessions(url, REPO_ROOT)).rejects.toThrow(/base 0/);
    }
  });
});

// Base de banc dédiée (`REDIS_GATE`, index 15) ; la cloison propre au run la
// partage sans heurter les suites de `@nodefony/redis` qui y tournent en même temps.
const URL_TEST = process.env.NF_REDIS_TEST_URL ?? "";
const NS = `t399-${process.pid}`;
const OTHER = `t399-other-${process.pid}`;
const SESSIONS = 2_500;

describe.skipIf(!URL_TEST)(
  "purgeTestSessions — Redis réel (NF_REDIS_TEST_URL)",
  () => {
    afterAll(async () => {
      const client = await connectRedis(URL_TEST, REPO_ROOT);
      for (const match of [`nf:${NS}:*`, `nf:${OTHER}:*`]) {
        for await (const keys of client.scanIterator({ MATCH: match })) {
          if (keys.length > 0) await client.unlink(keys);
        }
      }
      await client.close();
    });

    it("🔴 un tas de sessions disparaît, index compris ; le reste de la base demeure", async () => {
      const client = await connectRedis(URL_TEST, REPO_ROOT);
      const multi = client.multi();
      for (let i = 0; i < SESSIONS; i++) {
        multi.set(`nf:${NS}:sess:s${i}`, "{}", {
          expiration: { type: "EX", value: 600 },
        });
        multi.zAdd(`nf:${NS}:sess~{idx}:all`, { score: i, value: `s${i}` });
      }
      multi.set(`nf:${NS}:idem:x`, "1", {
        expiration: { type: "EX", value: 600 },
      });
      multi.set(`nf:${OTHER}:sess:keep`, "{}", {
        expiration: { type: "EX", value: 600 },
      });
      await multi.exec();

      const removed = await purgeTestSessions(URL_TEST, REPO_ROOT, NS);

      // Le balayage que fait le listing des sessions termine, et sur rien.
      let left = 0;
      for (const match of sessionPatterns(NS)) {
        for await (const keys of client.scanIterator({ MATCH: match })) {
          left += keys.length;
        }
      }
      const survivors = await client.exists([
        `nf:${NS}:idem:x`,
        `nf:${OTHER}:sess:keep`,
      ]);
      await client.close();

      expect(removed).toBe(SESSIONS + 1);
      expect(left).toBe(0);
      expect(survivors).toBe(2);
    });
  },
);
