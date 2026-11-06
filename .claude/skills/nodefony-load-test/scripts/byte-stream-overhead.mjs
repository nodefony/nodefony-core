// Surcoût d'un flux d'octets du framework face au plancher `source.pipe(res)`.
//
// Serveur ISOLÉ (aucun pipeline Nodefony) dans ce processus, client = curl
// (autre processus) : le CPU mesuré est celui du SERVEUR seul. Trois camps sur
// la MÊME source : `pipe` (une action écrite à la main), `stream`
// (`openByteStream`, chien de garde armé), `stream0` (`idleTimeout: 0`).
// Morceaux de 64 Kio (taille réelle d'un tube ou d'un fetch) et de 4 Kio (coût
// PAR MORCEAU grossi). Lit le `dist` de @nodefony/http : le rebâtir avant.
//
// Usage : node byte-stream-overhead.mjs [--runs 21] [--mb 256] [--quick]
// Lecture : 5 passes ne tranchent pas un écart de 5 % (bruit mesuré ~30 % d'un
// passage à l'autre) — 21 passes alternées, deux campagnes.
import http from "node:http";
import { Readable } from "node:stream";
import { execFile } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
import { promisify } from "node:util";
const run = promisify(execFile);

const ROOT = fileURLToPath(new URL("../../../../", import.meta.url));
// `import()` prend une URL, jamais un chemin (portabilité Windows).
const { openByteStream } = await import(
  pathToFileURL(
    path.join(
      ROOT,
      "src",
      "packages",
      "@nodefony",
      "http",
      "dist",
      "nodefony",
      "src",
      "context",
      "http",
      "ByteStream.js",
    ),
  ).href
);

const args = process.argv.slice(2);
const opt = (n, d) => {
  const i = args.indexOf(`--${n}`);
  return i < 0 ? d : Number(args[i + 1]);
};
const QUICK = args.includes("--quick");
const RUNS = QUICK ? 2 : opt("runs", 21);
const MB = QUICK ? 32 : opt("mb", 256);

/** Source : `total` octets en morceaux de `size`, tampon réutilisé (même coût des deux côtés). */
function source(total, size) {
  const chunk = Buffer.alloc(size, 0x61);
  let left = total;
  return new Readable({
    highWaterMark: size,
    read() {
      if (left <= 0) return this.push(null);
      left -= size;
      this.push(chunk);
    },
  });
}

/** Contexte réduit à ce que lit openByteStream (même forme que la parité unitaire). */
function fakeContext(req, res) {
  return {
    sended: false,
    finished: false,
    httpKernel: null,
    session: null,
    request: { request: req },
    response: {
      response: res,
      timeout: 30_000,
      isHeaderSent: () => res.headersSent,
      setHeader: (n, v) => res.setHeader(n, v),
      setHeaders: (h) => {
        for (const [n, v] of Object.entries(h)) res.setHeader(n, v);
      },
    },
    getMethod: () => req.method,
    saveSession: () => Promise.resolve(null),
    writeHead: (status) => res.writeHead(status),
    log: () => undefined,
    close: () => {
      res.end();
      return undefined;
    },
    _abortIfPending: () => undefined,
  };
}

let current = null;
const server = http.createServer((req, res) => {
  const url = new URL(req.url, "http://x");
  const size = Number(url.searchParams.get("size"));
  const total = MB * 1024 * 1024;
  const cpu0 = process.cpuUsage();
  const done = () => {
    const d = process.cpuUsage(cpu0);
    current = (d.user + d.system) / 1000;
  };
  const src = source(total, size);
  if (url.pathname === "/pipe") {
    // Plancher : ce qu'une action écrite à la main ferait.
    res.writeHead(200, { "content-type": "application/octet-stream" });
    res.once("close", done);
    src.pipe(res);
  } else {
    res.once("close", done);
    const idle = url.pathname === "/stream0" ? 0 : 30_000;
    void openByteStream(fakeContext(req, res), src, { idleTimeout: idle });
  }
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const port = server.address().port;

// Asynchrone : un appel synchrone bloquerait la boucle du serveur qui sert curl.
async function once(mode, size) {
  current = null;
  const { stdout } = await run("curl", [
    "-s",
    "-o",
    "/dev/null",
    "-w",
    "%{time_total} %{size_download}",
    `http://127.0.0.1:${port}/${mode}?size=${size}`,
  ]);
  const out = stdout.trim().split(" ");
  return { secs: Number(out[0]), bytes: Number(out[1]) };
}

const median = (a) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];
const rows = [];
for (const size of [65_536, 4_096]) {
  const acc = {
    pipe: { mbs: [], cpu: [] },
    stream: { mbs: [], cpu: [] },
    stream0: { mbs: [], cpu: [] },
  };
  await once("pipe", size);
  await once("stream", size);
  await once("stream0", size); // échauffement
  for (let i = 0; i < RUNS; i++) {
    for (const mode of i % 2
      ? ["stream0", "stream", "pipe"]
      : ["pipe", "stream", "stream0"]) {
      const r = await once(mode, size);
      await new Promise((res) => setTimeout(res, 50)); // laisser `close` arriver
      if (r.bytes !== MB * 1024 * 1024)
        throw new Error(`${mode} : ${r.bytes} octets reçus`);
      acc[mode].mbs.push(MB / r.secs);
      acc[mode].cpu.push((current ?? NaN) / (MB / 1024)); // ms CPU par Go
    }
  }
  for (const mode of ["pipe", "stream", "stream0"]) {
    rows.push({
      size,
      mode,
      mbs: median(acc[mode].mbs),
      cpuPerGB: median(acc[mode].cpu),
    });
  }
}
server.close();
console.log(
  `morceau  mode     débit MB/s   CPU serveur ms/Go   (médiane de ${RUNS}, ${MB} Mo)`,
);
for (const r of rows) {
  console.log(
    `${String(r.size).padStart(6)}  ${r.mode.padEnd(7)}  ${r.mbs.toFixed(0).padStart(9)}   ${r.cpuPerGB.toFixed(0).padStart(14)}`,
  );
}
for (const size of [65_536, 4_096]) {
  const p = rows.find((r) => r.size === size && r.mode === "pipe");
  const s = rows.find((r) => r.size === size && r.mode === "stream");
  console.log(
    `${size} o : débit ${(((s.mbs - p.mbs) / p.mbs) * 100).toFixed(1)} % · CPU ${(((s.cpuPerGB - p.cpuPerGB) / p.cpuPerGB) * 100).toFixed(1)} %`,
  );
}
