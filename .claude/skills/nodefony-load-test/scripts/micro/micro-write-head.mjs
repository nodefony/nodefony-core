// ─────────────────────────────────────────────────────────────────────────────
// Micro-banc — ce que coûte la POSE des en-têtes d'une réponse : N `setHeader`
// puis `writeHead(status)` (forme actuelle de `Response`) contre un objet
// accumulé remis en UN `writeHead(status, headers)` (forme Fastify). Né de #508
// lot A ; à rejouer avant de toucher à `Response.setHeader` / `writeHead`.
//
//   actuel     : 13 × (toLowerCase + res.setHeader) + writeHead(200)
//   accumulé   : 13 clés dans un objet Object.create(null) + writeHead(200, obj)
//   base+dyn   : table constante précalculée copiée (for-in) + 4 dynamiques
//   mixte      : 3 setHeader BRUTS (socle transport sur la réponse brute) +
//                10 accumulés — Node retombe alors sur setHeader PAR CLÉ
//                (`writeHead` : « Slow-case: when progressive API … »)
//
// Chaque tour construit un `ServerResponse` neuf (coût commun, soustrait via
// la ligne « construction seule ») ; `writeHead` compose la chaîne d'en-têtes
// (`_storeHeader`) sans rien écrire sur le socket.
//
// Il ment dans l'autre sens (site monomorphe, tas froid) : l'arbitre reste la
// mesure in-situ (`wait-compare.sh`). Ce banc dit seulement si le geste vaut
// d'être tenté.
//
// Usage (depuis la racine) :
//   node .claude/skills/nodefony-load-test/scripts/micro/micro-write-head.mjs
// ─────────────────────────────────────────────────────────────────────────────
import http from "node:http";

const N = 5e5;
const RUNS = 5;
let sink = 0;
const req = {
  method: "GET",
  httpVersionMajor: 1,
  httpVersionMinor: 1,
  headers: {},
};

// Le jeu d'en-têtes d'un GET du banc nest-fair (HTTP clair, pas de HSTS).
const TRANSPORT = [
  ["Server", "nodefony"],
  ["X-Content-Type-Options", "nosniff"],
  ["X-Frame-Options", "SAMEORIGIN"],
];
const SECURITY = [
  ["Referrer-Policy", "strict-origin-when-cross-origin"],
  ["Cross-Origin-Opener-Policy", "same-origin"],
  ["Cross-Origin-Resource-Policy", "same-origin"],
  ["Origin-Agent-Cluster", "?1"],
  ["Permissions-Policy", "camera=(), microphone=(), geolocation=()"],
  ["Content-Security-Policy", "default-src 'self'; object-src 'none'"],
];
const ALL = [...TRANSPORT, ...SECURITY];
const BASE = Object.create(null);
for (const [k, v] of ALL) BASE[k.toLowerCase()] = v;

function dynamic(set, i) {
  set("x-request-id", "0af7651916cd43dd8448eb211c80319c");
  set("traceparent", "00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01");
  set("Content-Length", String(20 + (i & 7)));
  set("Content-Type", "application/json");
}

const variants = {
  "construction seule": () => {
    const res = new http.ServerResponse(req);
    return res.statusCode;
  },
  actuel: (i) => {
    const res = new http.ServerResponse(req);
    const set = (n, v) => res.setHeader(n.toLowerCase(), v);
    for (let k = 0; k < ALL.length; k++) set(ALL[k][0], ALL[k][1]);
    dynamic(set, i);
    res.writeHead(200);
    return res._header.length;
  },
  accumulé: (i) => {
    const res = new http.ServerResponse(req);
    const h = Object.create(null);
    const set = (n, v) => {
      h[n.toLowerCase()] = v;
    };
    for (let k = 0; k < ALL.length; k++) set(ALL[k][0], ALL[k][1]);
    dynamic(set, i);
    res.writeHead(200, h);
    return res._header.length;
  },
  "base+dyn": (i) => {
    const res = new http.ServerResponse(req);
    const h = Object.create(null);
    for (const k in BASE) h[k] = BASE[k];
    dynamic((n, v) => {
      h[n.toLowerCase()] = v;
    }, i);
    res.writeHead(200, h);
    return res._header.length;
  },
  mixte: (i) => {
    const res = new http.ServerResponse(req);
    for (let k = 0; k < TRANSPORT.length; k++)
      res.setHeader(TRANSPORT[k][0], TRANSPORT[k][1]);
    const h = Object.create(null);
    const set = (n, v) => {
      h[n.toLowerCase()] = v;
    };
    for (let k = 0; k < SECURITY.length; k++)
      set(SECURITY[k][0], SECURITY[k][1]);
    dynamic(set, i);
    res.writeHead(200, h);
    return res._header.length;
  },
};

// Les deux formes doivent produire le MÊME bloc d'en-têtes (à l'ordre près).
{
  const grab = (name) => {
    const res = new http.ServerResponse(req);
    const h = Object.create(null);
    if (name === "actuel") {
      for (const [k, v] of ALL) res.setHeader(k.toLowerCase(), v);
      dynamic((n, v) => res.setHeader(n.toLowerCase(), v), 0);
      res.writeHead(200);
    } else {
      for (const [k, v] of ALL) h[k.toLowerCase()] = v;
      dynamic((n, v) => {
        h[n.toLowerCase()] = v;
      }, 0);
      res.writeHead(200, h);
    }
    return res._header.split("\r\n").filter(Boolean).sort().join("\n");
  };
  if (grab("actuel") !== grab("accumulé")) {
    console.error(
      "⛔ blocs d'en-têtes différents :\n",
      grab("actuel"),
      "\n---\n",
      grab("accumulé"),
    );
    process.exit(1);
  }
}

function bench(fn) {
  for (let i = 0; i < 5e4; i++) sink ^= fn(i);
  const t = process.hrtime.bigint();
  for (let i = 0; i < N; i++) sink ^= fn(i);
  return Number(process.hrtime.bigint() - t) / N;
}

const results = {};
for (const name of Object.keys(variants)) results[name] = [];
for (let r = 0; r < RUNS; r++) {
  for (const [name, fn] of Object.entries(variants))
    results[name].push(bench(fn));
}
const median = (a) => [...a].sort((x, y) => x - y)[a.length >> 1];
const base = median(results["construction seule"]);
console.log(
  `node ${process.version} — médiane de ${RUNS} × ${N} tours, ns/réponse`,
);
for (const [name, a] of Object.entries(results)) {
  const m = median(a);
  const net =
    name === "construction seule" ? "" : `  (net ${(m - base).toFixed(0)})`;
  console.log(`${name.padEnd(20)} ${m.toFixed(0).padStart(6)}${net}`);
}
if (sink === 0.5) console.log(sink);
