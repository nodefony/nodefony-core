/**
 * **La règle de pagination `SCAN`, une seule fois pour tous les stores Redis**
 * (sessions, jetons d'accès, passkeys, idempotence).
 *
 * Deux propriétés la fondent, et chacune a déjà coûté une faille :
 *
 * 1. **Rien ne se perd.** Redis ne garantit PAS qu'un même curseur `SCAN` rende
 *    le même lot deux fois : une insertion, une suppression ou un rehash le
 *    recompose. Reprendre un lot « en sautant les N premières clés » perdait
 *    donc des clés — et « déconnecter partout », qui SUPPRIME pendant son
 *    parcours, pouvait laisser vivre une session. La reprise saute désormais les
 *    clés déjà parcourues PAR NOM (empreinte), jamais par position.
 * 2. **Le curseur ne transporte aucune clé.** Il vient du client : il ne peut
 *    donc rien faire lire que `SCAN` n'ait rendu, et il ne fait voyager aucun
 *    identifiant de session dans une URL (donc dans un journal d'accès).
 */
import { expect } from "vitest";
import {
  decodeCursor,
  encodeCursor,
  type IScanBatch,
  keyFingerprint,
  MAX_SCAN,
  scanOrZero,
  scanPage,
} from "../runtime/scanPage";

const keep = (k: string) => Promise.resolve(k);

/** Parcourt toutes les pages jusqu'au bout ; échoue si la pagination ne converge pas. */
async function drain(
  scan: (cursor: string) => Promise<IScanBatch>,
  limit: number,
  accept: (key: string) => Promise<string | null> = keep,
): Promise<{ items: string[]; pages: number }> {
  const items: string[] = [];
  let cursor: string | null | undefined;
  let pages = 0;
  do {
    const page = await scanPage(scan, cursor ?? undefined, limit, accept);
    expect(
      page.items.length,
      "une page ne déborde jamais sa limite",
    ).toBeLessThanOrEqual(limit);
    items.push(...page.items);
    cursor = page.nextCursor;
    pages += 1;
    expect(pages, "la pagination doit CONVERGER").toBeLessThan(50);
  } while (cursor);
  return { items, pages };
}

// ════════════════════════════════════════════════════════════════════════════
// 1. Le format du curseur
// ════════════════════════════════════════════════════════════════════════════
describe("scanPage — le curseur", () => {
  it("laisse passer un curseur Redis (des chiffres)", () => {
    expect(scanOrZero("4096")).toBe("4096");
  });

  it("ramène à 0 tout ce qui n'est pas un curseur", () => {
    for (const hostile of ["abc", "1;FLUSHALL", "-1", "1.5", "", "٤٢"]) {
      expect(scanOrZero(hostile), `curseur hostile : ${hostile}`).toBe("0");
    }
  });

  it("tolère l'absence de curseur (première page)", () => {
    expect(decodeCursor()).toEqual({ scanCursor: "0", seen: null });
    expect(decodeCursor("")).toEqual({ scanCursor: "0", seen: null });
  });

  it("honore un curseur nu valide", () => {
    expect(decodeCursor("4096")).toEqual({ scanCursor: "4096", seen: null });
  });

  it("encode/décode font l'aller-retour", () => {
    const seen = [keyFingerprint("s:a"), keyFingerprint("s:b")];
    expect(decodeCursor(encodeCursor("512", seen))).toEqual({
      scanCursor: "512",
      seen: new Set(seen),
    });
    expect(encodeCursor("512", [])).toBe("512");
  });

  it("n'emporte AUCUNE clé : seulement des empreintes", () => {
    const cursor = encodeCursor("0", [keyFingerprint("nf:sess:SECRET-ID")]);
    expect(cursor).not.toContain("SECRET");
    expect(cursor, "rien à échapper dans une URL").toMatch(
      /^[0-9]+\.[A-Za-z0-9_-]+$/,
    );
  });

  it("un curseur malformé repart du DÉBUT, empreintes comprises", () => {
    // Des empreintes appliquées à un autre lot que le leur sauteraient des clés
    // au hasard : quand une moitié est fausse, tout le curseur est jeté.
    const packed = encodeCursor("0", [keyFingerprint("s:a")]).slice(2);
    const tooMany = encodeCursor(
      "0",
      Array.from({ length: MAX_SCAN + 1 }, (_, i) => i),
    );
    for (const hostile of [
      `pwn.${packed}`,
      `0.${packed}.${packed}`, // un seul bloc d'empreintes
      `0.${packed.slice(1)}`, // pas un multiple de 7 octets
      `0.a:b${packed}`, // hors alphabet : le décodeur l'ignorerait en silence
      `0.`,
      `0.////////////`, // poids fort > 21 bits : pas une empreinte
      `0._________`, // idem, alphabet url
      `3:4096`,
      tooMany,
    ]) {
      expect(decodeCursor(hostile), hostile.slice(0, 40)).toEqual({
        scanCursor: "0",
        seen: null,
      });
    }
  });
});

// ════════════════════════════════════════════════════════════════════════════
// 2. Une page se REMPLIT à travers les lots
// ════════════════════════════════════════════════════════════════════════════
describe("scanPage — une page se REMPLIT à travers les lots", () => {
  /** Keyspace simulé à la manière du vrai Redis : COUNT examine, MATCH filtre ENSUITE. */
  function fakeScan(keys: readonly string[], count: number, prefix: string) {
    const calls: string[] = [];
    const scan = (cursor: string): Promise<IScanBatch> => {
      calls.push(cursor);
      const start = Number.parseInt(cursor, 10) || 0;
      const next = start + count;
      return Promise.resolve({
        cursor: next >= keys.length ? "0" : String(next),
        keys: keys.slice(start, next).filter((k) => k.startsWith(prefix)),
      });
    };
    return { scan, calls };
  }

  it("🔴 les sessions noyées dans 2 000 clés étrangères arrivent dès la PREMIÈRE page", async () => {
    const keys = [
      ...Array.from({ length: 2000 }, (_, i) => `autre:${i}`),
      "s:a",
      "s:b",
      "s:c",
    ];
    const { scan } = fakeScan(keys, 10, "s:");
    const page = await scanPage(scan, undefined, 10, keep);
    expect(page.items).toEqual(["s:a", "s:b", "s:c"]);
    expect(page.nextCursor).toBeNull();
  });

  it("page pleine au milieu d'un lot : la suite reprend au MÊME lot, sans perte ni doublon", async () => {
    const keys = Array.from({ length: 7 }, (_, i) => `s:${i}`);
    const { scan } = fakeScan(keys, 100, "s:"); // un seul lot de 7
    const { items, pages } = await drain(scan, 3);
    expect(items).toEqual(keys);
    expect(pages).toBe(3);
  });

  it("effort BORNÉ : au-delà de MAX_SCAN emplacements, la page part incomplète AVEC son curseur", async () => {
    const keys = Array.from({ length: MAX_SCAN * 2 }, (_, i) => `autre:${i}`);
    keys.push("s:loin");
    const { scan, calls } = fakeScan(keys, 100, "s:");
    const p1 = await scanPage(scan, undefined, 100, keep);
    expect(p1.items).toEqual([]);
    expect(p1.nextCursor, "de quoi reprendre").not.toBeNull();
    expect(calls.length).toBe(MAX_SCAN / 100);
    const p2 = await scanPage(scan, p1.nextCursor ?? undefined, 100, keep);
    expect(p2.items).toEqual([]);
    const p3 = await scanPage(scan, p2.nextCursor ?? undefined, 100, keep);
    expect(p3.items).toEqual(["s:loin"]);
  });

  it("un élément écarté par le filtre ne compte pas dans la page", async () => {
    const keys = ["s:1", "s:x", "s:2", "s:y", "s:3"];
    const { scan } = fakeScan(keys, 2, "s:");
    const page = await scanPage(scan, undefined, 3, (k) =>
      Promise.resolve(/\d$/.test(k) ? k : null),
    );
    expect(page.items).toEqual(["s:1", "s:2", "s:3"]);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// 3. 🔴 Le lot RECOMPOSÉ au rejeu (faille : session survivant à la révocation)
// ════════════════════════════════════════════════════════════════════════════
describe("scanPage — un lot recomposé entre deux pages ne perd AUCUNE clé", () => {
  it("lot RÉORDONNÉ au rejeu du même curseur : les 6 clés, chacune une fois", async () => {
    // Preuve déterministe, sans minutage : Redis rend le lot du curseur 0 dans
    // un autre ordre au second passage (rehash). Reprendre « en sautant les 2
    // premières » rendait a, b, e, f — c et d perdues.
    let calls0 = 0;
    const scan = (c: string): Promise<IScanBatch> =>
      Promise.resolve(
        c === "0"
          ? ++calls0 === 1
            ? { cursor: "7", keys: ["a", "b", "c", "d"] }
            : { cursor: "7", keys: ["c", "d", "a", "b"] }
          : { cursor: "0", keys: ["e", "f"] },
      );
    const { items } = await drain(scan, 2);
    expect([...items].sort()).toEqual(["a", "b", "c", "d", "e", "f"]);
    expect(items.length, "aucun doublon").toBe(6);
  });

  it("lot AMPUTÉ au rejeu (les clés rendues ont été SUPPRIMÉES) : rien ne se perd", async () => {
    // Le parcours destructeur de « déconnecter partout » : chaque session rendue
    // est détruite avant la page suivante. Le lot rejoué rétrécit, et sauter
    // « les 2 premières » sautait en réalité deux sessions encore vivantes.
    const alive = new Set(["a", "b", "c", "d", "e"]);
    const scan = (c: string): Promise<IScanBatch> =>
      Promise.resolve(
        c === "0"
          ? {
              cursor: "9",
              keys: ["a", "b", "c", "d", "e"].filter((k) => alive.has(k)),
            }
          : { cursor: "0", keys: [] },
      );
    const destroyed: string[] = [];
    const { items } = await drain(scan, 2, (k) => {
      alive.delete(k);
      destroyed.push(k);
      return Promise.resolve(k);
    });
    expect(items.sort()).toEqual(["a", "b", "c", "d", "e"]);
    expect([...alive], "aucune session ne survit").toEqual([]);
    expect(destroyed.length).toBe(5);
  });

  it("une clé ÉCARTÉE par le filtre n'est pas relue au rejeu", async () => {
    const reads: string[] = [];
    const scan = (c: string): Promise<IScanBatch> =>
      Promise.resolve(
        c === "0"
          ? { cursor: "0", keys: ["x1", "a", "x2", "b", "c"] }
          : { cursor: "0", keys: [] },
      );
    const { items } = await drain(scan, 2, (k) => {
      reads.push(k);
      return Promise.resolve(k.startsWith("x") ? null : k);
    });
    expect(items).toEqual(["a", "b", "c"]);
    expect(reads).toEqual(["x1", "a", "x2", "b", "c"]);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// 4. Un curseur FORGÉ ne fait rien lire que SCAN n'ait rendu
// ════════════════════════════════════════════════════════════════════════════
describe("scanPage — un curseur forgé", () => {
  it("aucune clé hors du lot SCAN n'atteint la lecture", async () => {
    const reads: string[] = [];
    const scan = (): Promise<IScanBatch> =>
      Promise.resolve({ cursor: "0", keys: ["nf:sess:a"] });
    for (const forged of [
      "0.nf:auth:secret",
      `0.${Buffer.from('["other:key"]').toString("base64url")}`,
      "3:4096",
      "4096",
    ]) {
      await scanPage(scan, forged, 10, (k) => {
        reads.push(k);
        return Promise.resolve(k);
      });
    }
    expect(new Set(reads)).toEqual(new Set(["nf:sess:a"]));
  });

  it("des empreintes forgées ne masquent que les clés de CELUI qui les forge", async () => {
    // Elles ne font que SAUTER des clés du lot rejoué : le pire est une page
    // incomplète pour ce client-là — jamais une lecture de plus.
    const scan = (): Promise<IScanBatch> =>
      Promise.resolve({ cursor: "0", keys: ["s:a", "s:b"] });
    const page = await scanPage(
      scan,
      encodeCursor("0", [keyFingerprint("s:a")]),
      10,
      keep,
    );
    expect(page.items).toEqual(["s:b"]);
  });
});
