import { expect } from "chai";
import https from "node:https";
import WebSocket from "ws";
import fsp from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const BASE = { hostname: "localhost", port: 5152, rejectUnauthorized: false };
const WSS = "wss://localhost:5152";
const wsOpts = { rejectUnauthorized: false };

// Dossier où le service d'upload dépose les fichiers reçus (uploadDir défaut =
// « tmp » sous la racine projet). Le test « 200 multipart uploads » y crée des
// `<uuid>.txt` → un test ne doit JAMAIS laisser de résidu : on les nettoie en
// fin de suite (diff de snapshot, sans toucher au préexistant). Cf upload.test.ts.
const UPLOAD_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../../../../..",
  "tmp",
);

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

describe("Memory leaks — HTTP (requires server)", function () {
  beforeAll(() => warmup());

  // Hygiène : le test d'upload ne doit JAMAIS laisser de résidu dans tmp/.
  // Snapshot avant la suite, diff après → supprime UNIQUEMENT ce qu'elle a créé
  // (sans toucher au préexistant). Même pattern que upload.test.ts.
  let preexisting: Set<string>;
  beforeAll(async () => {
    preexisting = new Set(await fsp.readdir(UPLOAD_DIR).catch(() => []));
  });
  afterAll(async () => {
    const entries = await fsp
      .readdir(UPLOAD_DIR, { withFileTypes: true })
      .catch(() => [] as import("node:fs").Dirent[]);
    await Promise.all(
      entries
        .filter((d) => d.isFile() && !preexisting.has(d.name))
        .map((d) => fsp.unlink(path.join(UPLOAD_DIR, d.name)).catch(() => {})),
    );
  });

  it("1000 sequential GET requests — server heap delta < 35 MB", async () => {
    const before = await serverHeap();
    for (let i = 0; i < 1000; i++) await get("/nodefony/test/index");
    const after = await serverHeap();
    expect(after - before).to.be.below(
      35 * 1024 * 1024,
      `heap grew ${((after - before) / 1024 / 1024).toFixed(1)} MB`,
    );
  });

  it("100 consecutive sync crashes — server heap delta < 10 MB", async () => {
    const before = await serverHeap();
    for (let i = 0; i < 100; i++) await get("/nodefony/test/crash/sync");
    const after = await serverHeap();
    expect(after - before).to.be.below(
      10 * 1024 * 1024,
      `heap grew ${((after - before) / 1024 / 1024).toFixed(1)} MB`,
    );
  });

  it("100 consecutive async crashes — server heap delta < 10 MB", async () => {
    const before = await serverHeap();
    for (let i = 0; i < 100; i++) await get("/nodefony/test/crash/async");
    const after = await serverHeap();
    expect(after - before).to.be.below(
      10 * 1024 * 1024,
      `heap grew ${((after - before) / 1024 / 1024).toFixed(1)} MB`,
    );
  });

  it("100 consecutive native TypeError crashes — server heap delta < 15 MB", async () => {
    const before = await serverHeap();
    for (let i = 0; i < 100; i++) await get("/nodefony/test/crash/native");
    const after = await serverHeap();
    expect(after - before).to.be.below(
      15 * 1024 * 1024,
      `heap grew ${((after - before) / 1024 / 1024).toFixed(1)} MB`,
    );
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
    expect(after - before).to.be.below(
      20 * 1024 * 1024,
      `heap grew ${((after - before) / 1024 / 1024).toFixed(1)} MB`,
    );
  });

  it("200 sequential multipart uploads — server heap delta < 30 MB", async () => {
    // Hot path busboy : valide que streamMultipart (listeners file/field +
    // WriteStream + busboy par requête) ne fuit pas. Fichier minuscule → le
    // delta heap mesure les listeners/buffers, pas le contenu.
    const before = await serverHeap();
    for (let i = 0; i < 200; i++) await uploadSmall();
    const after = await serverHeap();
    expect(after - before).to.be.below(
      30 * 1024 * 1024,
      `heap grew ${((after - before) / 1024 / 1024).toFixed(1)} MB`,
    );
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
    expect(after - before).to.be.below(
      30 * 1024 * 1024,
      `heap grew ${((after - before) / 1024 / 1024).toFixed(1)} MB`,
    );
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
    expect(after - before).to.be.below(
      25 * 1024 * 1024,
      `heap grew ${((after - before) / 1024 / 1024).toFixed(1)} MB`,
    );
  });
});
