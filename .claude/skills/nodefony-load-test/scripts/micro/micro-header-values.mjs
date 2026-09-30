// ─────────────────────────────────────────────────────────────────────────────
// Micro-banc — ce que coûte la FABRICATION des valeurs d'en-têtes d'une
// réponse, forme d'origine contre forme optimisée, dans le même process.
// Chaque paire recopie le code de production (avant = version d'origine ;
// après = forme retenue) : un geste n'est gardé que si l'écart en ns est net et
// reproductible. Né de #508 ; à rejouer avant de toucher à l'un de ces sites.
//
//   Content-Type    : mime.contentType + split   ↔  cache borné (Response.ts)
//   traceparent     : 2 × toString("hex")        ↔  1 toString + 2 slice (trace.ts)
//   CSP à nonce     : parts.join(nonce)          ↔  prefix + nonce + suffix (securityHeaders.ts)
//   cookie session  : gabarit + lecture options  ↔  nom précalculé (écarté : 5 ns)
//   hostname        : split(":")[0] ×2           ↔  indexOf + slice ×1 (Request.ts)
//   labels du Host  : split(".") + boucle        ↔  boucle sur les codes (urlFastPath.ts)
//
// Il ment dans l'autre sens (site monomorphe, tas froid) : l'arbitre reste la
// mesure in-situ (`wait-compare.sh`). Ce banc dit seulement si le geste vaut
// d'être tenté.
//
// Usage (depuis la racine) :
//   node .claude/skills/nodefony-load-test/scripts/micro/micro-header-values.mjs
// ─────────────────────────────────────────────────────────────────────────────
import { randomFillSync } from "node:crypto";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../../..",
);
const require = createRequire(path.join(root, "src/packages/@nodefony/http/"));
const mime = require("mime-types");

const N = 2e6;
let sink = 0;
function bench(fn) {
  for (let i = 0; i < 2e5; i++) sink ^= fn(i).length;
  const t = process.hrtime.bigint();
  for (let i = 0; i < N; i++) sink ^= fn(i).length;
  return Number(process.hrtime.bigint() - t) / N;
}

// ── Content-Type ──
const types = ["json", "html", "application/json", "text/plain"];
const b1Before = (i) => {
  const full = mime.contentType(types[i & 3]);
  const mytype = full.split(";")[0] ?? full;
  return mytype === "application/json" ? mytype : `${mytype}; charset=utf-8`;
};
const cache = new Map();
const b1After = (i) => {
  const t = types[i & 3];
  let e = cache.get(t);
  if (e === undefined) {
    const full = mime.contentType(t);
    const semi = full.indexOf(";");
    e = { full, bare: semi === -1 ? full : full.slice(0, semi) };
    cache.set(t, e);
  }
  const mytype = e.bare;
  return mytype === "application/json" ? mytype : `${mytype}; charset=utf-8`;
};

// ── traceparent ──
const pool = Buffer.allocUnsafe(4096);
let off = 4096;
function hex(size) {
  if (off + size > 4096) {
    randomFillSync(pool);
    off = 0;
  }
  const h = pool.toString("hex", off, off + size);
  off += size;
  return h;
}
const b2Before = () => `00-${hex(16)}-${hex(8)}-01`;
const b2After = () => {
  const h = hex(24);
  return `00-${h.slice(0, 32)}-${h.slice(32)}-01`;
};

// ── CSP à nonce ──
const csp =
  "default-src 'self'; script-src 'self' 'nonce-{{nonce}}'; style-src 'self' 'unsafe-inline'; img-src 'self' data:";
const parts = csp.split("{{nonce}}");
const [pre, post] = parts;
const nonces = Array.from({ length: 1024 }, () =>
  randomFillSync(Buffer.alloc(16)).toString("base64"),
);
const b3Before = (i) => parts.join(nonces[i & 1023]);
const b3After = (i) => pre + nonces[i & 1023] + post;

// ── nom du cookie de session ──
const svc = { defaultSessionName: "nodefony", options: { cookie: {} } };
const ctx = { scheme: "https", sessionService: svc };
const b4Before = () => {
  const base = ctx.sessionService?.defaultSessionName ?? "nodefony";
  const mode = ctx.sessionService?.options.cookie?.hostPrefix ?? "auto";
  const tls = ctx.scheme === "https" || ctx.scheme === "wss";
  return mode === true || (mode === "auto" && tls) ? `__Host-${base}` : base;
};
const names = { plain: "nodefony", tls: "__Host-nodefony" };
const b4After = () =>
  ctx.scheme === "https" || ctx.scheme === "wss" ? names.tls : names.plain;

// ── hostname et labels du Host ──
const raw = Buffer.from("127.0.0.1:5151", "latin1");
const hosts = Array.from({ length: 1024 }, () => raw.toString("latin1"));
const b5Before = (i) => {
  const h = hosts[i & 1023];
  const a = h.split(":")[0];
  const b = h.split(":")[0];
  return a.length === b.length ? a : b;
};
const b5After = (i) => {
  const h = hosts[i & 1023];
  const c = h.indexOf(":");
  return c === -1 ? h : h.slice(0, c);
};
const names5 = hosts.map((h) => h.split(":")[0]);
const labelsBefore = (i) => {
  const labels = names5[i & 1023].split(".");
  for (const l of labels) if (l.length === 0) return "";
  return labels.at(-1);
};
const labelsAfter = (i) => {
  const name = names5[i & 1023];
  let count = 1;
  let start = 0;
  for (let k = 0; k < name.length; k++) {
    if (name.charCodeAt(k) === 0x2e) {
      if (k === start) return "";
      count++;
      start = k + 1;
    }
  }
  if (start === name.length) return "";
  return count === 4 ? name.slice(start) : name.slice(start);
};

const pairs = {
  "Content-Type": [b1Before, b1After],
  traceparent: [b2Before, b2After],
  "CSP à nonce": [b3Before, b3After],
  "nom du cookie": [b4Before, b4After],
  hostname: [b5Before, b5After],
  "labels du Host": [labelsBefore, labelsAfter],
};
const med = (xs) => [...xs].sort((a, b) => a - b)[2];
console.log(`médiane de 5 runs de ${N} appels (ns/appel)`);
console.log("                       avant    après    gain");
for (const [name, [before, after]] of Object.entries(pairs)) {
  const a = [];
  const b = [];
  for (let r = 0; r < 5; r++) {
    a.push(bench(before));
    b.push(bench(after));
  }
  const ma = med(a);
  const mb = med(b);
  console.log(
    `${name.padEnd(20)} ${ma.toFixed(1).padStart(7)}  ${mb.toFixed(1).padStart(7)}  ${(ma - mb).toFixed(1).padStart(6)}`,
  );
}
if (sink === 42) console.log("");
