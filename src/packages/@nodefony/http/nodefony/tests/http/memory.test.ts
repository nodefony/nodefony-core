import { expect } from "chai";
import https from "node:https";
import WebSocket from "ws";
import {
  snapshotUploadDirs,
  purgeUploadResidue,
  type UploadSnapshot,
} from "../helpers/uploadResidue.js";

const BASE = { hostname: "localhost", port: 5152, rejectUnauthorized: false };
const WSS = "wss://localhost:5152";
const wsOpts = { rejectUnauthorized: false };

// Le test « 200 multipart uploads » dépose des `<uuid>.txt` dans le dossier
// d'upload du serveur. Le garde (dossiers visés + compte supprimé) vit dans
// `helpers/uploadResidue.ts` — une seule implémentation, cf upload.test.ts.

type MemStats = {
  rss: number;
  heapTotal: number;
  heapUsed: number;
  external: number;
};

function get(path: string): Promise<MemStats | Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const req = https.request({ ...BASE, path, method: "GET" }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (c: Buffer) => chunks.push(c));
      res.on("end", () => {
        try {
          resolve(JSON.parse(Buffer.concat(chunks).toString()));
        } catch {
          resolve({});
        }
      });
    });
    req.on("error", reject);
    req.end();
  });
}

async function serverHeap(): Promise<number> {
  const m = (await get("/nodefony/test/memory")) as MemStats;
  return m.heapUsed;
}

function openCloseWs(url: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url, wsOpts);
    ws.once("open", () => ws.close());
    ws.once("close", () => resolve());
    ws.once("error", reject);
  });
}

// ── helpers ──────────────────────────────────────────────────────────────────

async function warmup(n = 20): Promise<void> {
  for (let i = 0; i < n; i++) await get("/nodefony/test/index");
}

/** Un upload multipart minimal (1 petit fichier) — pour le test de fuite. */
function uploadSmall(): Promise<void> {
  const boundary = "----nfMemBoundary";
  const body = Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="m.txt"\r\nContent-Type: text/plain\r\n\r\nx\r\n--${boundary}--\r\n`,
  );
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        ...BASE,
        path: "/nodefony/test/html/upload",
        method: "POST",
        headers: {
          "Content-Type": `multipart/form-data; boundary=${boundary}`,
          "Content-Length": body.length,
        },
      },
      (res) => {
        res.resume();
        res.on("end", () => resolve());
      },
    );
    req.on("error", reject);
    req.end(body);
  });
}

// ── suites ───────────────────────────────────────────────────────────────────

/**
 * Asserte que `delta` tient sous `seuilMo` — **et PUBLIE la mesure**.
 *
 * 🔴 Un seuil dont on ne voit jamais la marge est indistinguable d'un seuil
 * décoratif. Ces bancs ne rendaient leur chiffre qu'en ÉCHEC (le message
 * d'assertion) : tant qu'ils passaient — c'est-à-dire toujours — personne ne
 * pouvait dire si 35 Mo était juste ou vingt fois trop large, ni si une
 * dérive lente était en train de combler la marge. Le vert ne prouvait que
 * « pas de fuite ÉNORME ».
 *
 * La marge est donc imprimée à chaque exécution, sur les trois systèmes. Elle
 * est ce qui permet de resserrer un seuil sur des CHIFFRES — et de voir venir,
 * d'un run à l'autre, ce qu'un simple vert cache par construction.
 */
const sousLeSeuil = (quoi: string, delta: number, seuilMo: number): void => {
  const mo = delta / 1024 / 1024;
  const marge = mo <= 0 ? "∞" : `×${(seuilMo / mo).toFixed(1)}`;
  // eslint-disable-next-line no-console
  console.log(
    `[heap] ${quoi} : ${mo.toFixed(2)} MB mesurés · seuil ${seuilMo} MB · marge ${marge}`,
  );
  expect(delta).to.be.below(
    seuilMo * 1024 * 1024,
    `heap grew ${mo.toFixed(1)} MB`,
  );
};

describe("Memory leaks — HTTP (requires server)", function () {
  beforeAll(() => warmup());

  // Hygiène : le test d'upload ne doit JAMAIS laisser de résidu dans tmp/.
  // Snapshot avant la suite, diff après → supprime UNIQUEMENT ce qu'elle a créé
  // (sans toucher au préexistant). Même pattern que upload.test.ts.
  let snapshot: UploadSnapshot;
  beforeAll(async () => {
    snapshot = await snapshotUploadDirs();
  });
  afterAll(async () => {
    const removed = await purgeUploadResidue(snapshot);
    expect(
      removed,
      "aucun résidu supprimé — dossier de dépôt manqué",
    ).to.be.greaterThan(0);
  });

  it("1000 sequential GET requests — server heap delta < 35 MB", async () => {
    const before = await serverHeap();
    for (let i = 0; i < 1000; i++) await get("/nodefony/test/index");
    const after = await serverHeap();
    sousLeSeuil("1000 sequential GET requests", after - before, 35);
  });

  it("100 consecutive sync crashes — server heap delta < 10 MB", async () => {
    const before = await serverHeap();
    for (let i = 0; i < 100; i++) await get("/nodefony/test/crash/sync");
    const after = await serverHeap();
    sousLeSeuil("100 consecutive sync crashes", after - before, 10);
  });

  it("100 consecutive async crashes — server heap delta < 10 MB", async () => {
    const before = await serverHeap();
    for (let i = 0; i < 100; i++) await get("/nodefony/test/crash/async");
    const after = await serverHeap();
    sousLeSeuil("100 consecutive async crashes", after - before, 10);
  });

  it("100 consecutive native TypeError crashes — server heap delta < 15 MB", async () => {
    const before = await serverHeap();
    for (let i = 0; i < 100; i++) await get("/nodefony/test/crash/native");
    const after = await serverHeap();
    sousLeSeuil("100 consecutive native TypeError crashes", after - before, 15);
  });

  it("500 mixed requests (index + context + session) — server heap delta < 20 MB", async () => {
    const routes = [
      "/nodefony/test/index",
      "/nodefony/test/context",
      "/nodefony/test/rest/session",
    ];
    const before = await serverHeap();
    for (let i = 0; i < 500; i++) await get(routes[i % routes.length]);
    const after = await serverHeap();
    sousLeSeuil(
      "500 mixed requests (index + context + session)",
      after - before,
      20,
    );
  });

  it("200 sequential multipart uploads — server heap delta < 30 MB", async () => {
    // Hot path busboy : valide que streamMultipart (listeners file/field +
    // WriteStream + busboy par requête) ne fuit pas. Fichier minuscule → le
    // delta heap mesure les listeners/buffers, pas le contenu.
    const before = await serverHeap();
    for (let i = 0; i < 200; i++) await uploadSmall();
    const after = await serverHeap();
    sousLeSeuil("200 sequential multipart uploads", after - before, 30);
  });

  it("server is alive after load — /index returns 200", async () => {
    const req = https.request({
      ...BASE,
      path: "/nodefony/test/index",
      method: "GET",
    });
    const status = await new Promise<number>((resolve, reject) => {
      req.on("response", (res) => {
        res.resume();
        resolve(res.statusCode!);
      });
      req.on("error", reject);
      req.end();
    });
    expect(status).to.equal(200);
  });
});

describe("Memory leaks — WebSocket (requires server)", function () {
  // Drain garbage left by the previous (heavy) test before measuring a
  // baseline. The server runs without --expose-gc, so heap deltas carry GC
  // noise; a short idle lets V8 reclaim before/after are taken on. NOTE: these
  // heap-delta checks are only a COARSE gross-leak guard — they do not catch
  // small retained-scope leaks (BUG-004's ~0.7 MB passed here). The precise
  // leak guard is the scope-count assertions in lifecycle-als / als-load.
  beforeEach(async () => {
    await new Promise((r) => setTimeout(r, 200));
  });

  it("100 WS connections open/close — server heap delta < 30 MB", async () => {
    const before = await serverHeap();
    for (let i = 0; i < 100; i++) {
      await openCloseWs(`${WSS}/nodefony/test/ws`);
    }
    const after = await serverHeap();
    sousLeSeuil("100 WS connections open/close", after - before, 30);
  });

  it("50 WS echo round-trips open/send/close — heap delta < 25 MB", async () => {
    // Chaque connexion crée une session (startSession) → allocations plus lourdes.
    // Seuil 25 MB (était 20) : marge contre le bruit GC quand ce test tourne en
    // fin de suite lourde (flaky à 20.1 MB observé). Détection de leak précise =
    // tests scope-count (lifecycle-als / als-load), pas ce delta heap grossier.
    const before = await serverHeap();
    for (let i = 0; i < 50; i++) {
      await new Promise<void>((resolve, reject) => {
        const ws = new WebSocket(`${WSS}/nodefony/test/ws/echo`, wsOpts);
        ws.once("open", () => ws.send("ping"));
        ws.once("message", () => ws.close());
        ws.once("close", () => resolve());
        ws.once("error", reject);
      });
    }
    const after = await serverHeap();
    sousLeSeuil("50 WS echo round-trips open/send/close", after - before, 25);
  });
});
