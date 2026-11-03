// ─────────────────────────────────────────────────────────────────────────────
// Relevé des BLOCS D'EN-TÊTES qu'un serveur rend sur des réponses types — page,
// JSON, 404, 401, fichier statique, sonde de santé, HEAD, CORS — en HTTP/1.1
// ET en HTTP/2. Les valeurs qui changent à chaque requête (date, identifiant de
// requête, nonce, cookie) sont masquées : deux relevés du même code sont
// identiques, deux relevés de deux codes se comparent ligne à ligne.
//
// Sert à prouver qu'une refonte de l'écriture des en-têtes ne change RIEN sur
// le fil (#727) : relever avant, relever après, comparer.
//
//   node .claude/skills/nodefony-load-test/scripts/header-snapshot.mjs avant
//   node .claude/skills/nodefony-load-test/scripts/header-snapshot.mjs apres
//   node .claude/skills/nodefony-load-test/scripts/header-snapshot.mjs --diff avant apres
//
// Sortie : tmp/runs/header-snapshot-<nom>.json. Code 1 si une cible ne répond
// pas (un relevé vide ne prouve rien), code 3 si --diff trouve un écart.
// ENV : NF_PORT_HTTP (5151), NF_PORT_HTTPS (5152), HOST (127.0.0.1).
// ─────────────────────────────────────────────────────────────────────────────
import http from "node:http";
import http2 from "node:http2";
import fs from "node:fs";
import path from "node:path";

const HOST = process.env.HOST ?? "127.0.0.1";
const PH = Number(process.env.NF_PORT_HTTP ?? 5151);
const PS = Number(process.env.NF_PORT_HTTPS ?? 5152);
const DIR = path.join(process.cwd(), "tmp", "runs");
const fileOf = (name) => path.join(DIR, `header-snapshot-${name}.json`);

const ORIGIN = `http://${HOST}:${PH}`;
/** Réponses types : chaque ligne exerce un chemin d'écriture différent. */
const CASES = [
  { label: "page HTML", method: "GET", path: "/" },
  { label: "JSON", method: "GET", path: "/nodefony/kernel/api/health" },
  { label: "JSON 200", method: "GET", path: "/nodefony/test/als-test/scopes" },
  { label: "redirection", method: "GET", path: "/nodefony/test/html/redirect" },
  {
    label: "erreur après redirection",
    method: "GET",
    path: "/nodefony/test/crash/after-redirect/async",
  },
  {
    label: "fichier en flux",
    method: "GET",
    path: "/nodefony/test/html/stream",
  },
  {
    label: "téléchargement",
    method: "GET",
    path: "/nodefony/test/html/download",
  },
  { label: "média", method: "GET", path: "/nodefony/test/html/media" },
  {
    label: "média Range",
    method: "GET",
    path: "/nodefony/test/html/media",
    headers: { range: "bytes=0-9" },
  },
  { label: "contrôleur de test", method: "GET", path: "/test/context" },
  { label: "404", method: "GET", path: "/api/nope-404" },
  { label: "statique", method: "GET", path: "/favicon.ico" },
  { label: "HEAD page", method: "HEAD", path: "/" },
  { label: "sonde liveness", method: "GET", path: "/livez" },
  {
    label: "admin sans session",
    method: "GET",
    path: "/nodefony/kernel/api/config",
  },
  { label: "console admin", method: "GET", path: "/nodefony" },
  {
    label: "CORS réel",
    method: "GET",
    path: "/nodefony/kernel/api/health",
    headers: { origin: ORIGIN },
  },
  {
    label: "CORS preflight",
    method: "OPTIONS",
    path: "/nodefony/kernel/api/health",
    headers: { origin: ORIGIN, "access-control-request-method": "GET" },
  },
];

/** Valeurs propres à une requête : masquées pour comparer deux relevés. */
const DYNAMIC = new Set([
  "date",
  "x-request-id",
  "traceparent",
  "x-response-time",
  "keep-alive",
  "connection",
]);
function normalize(name, value) {
  if (DYNAMIC.has(name)) return "<dyn>";
  let v = Array.isArray(value) ? value.join("\n") : String(value);
  if (name === "content-security-policy")
    v = v.replace(/'nonce-[^']+'/g, "'nonce-<dyn>'");
  if (name === "set-cookie") v = v.replace(/^([^=]+)=[^;]*/gm, "$1=<dyn>");
  if (name === "content-length" && /^\d+$/.test(v)) return v;
  return v;
}
function block(status, headers) {
  const out = {};
  for (const name of Object.keys(headers).sort()) {
    const lower = name.toLowerCase();
    if (lower.startsWith(":")) continue;
    out[lower] = normalize(lower, headers[name]);
  }
  return { status, headers: out };
}

function h1(c) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: HOST,
        port: PH,
        method: c.method,
        path: c.path,
        headers: c.headers ?? {},
      },
      (res) => {
        res.resume();
        res.on("end", () => resolve(block(res.statusCode, res.headers)));
      },
    );
    req.on("error", reject);
    req.end();
  });
}

function h2(session, c) {
  return new Promise((resolve, reject) => {
    const req = session.request({
      ":method": c.method,
      ":path": c.path,
      ...c.headers,
    });
    let head = null;
    req.on("response", (h) => (head = h));
    req.on("data", () => {});
    req.on("end", () => resolve(block(Number(head?.[":status"]), head ?? {})));
    req.on("error", reject);
    req.end();
  });
}

if (process.argv[2] === "--diff") {
  const [a, b] = process.argv.slice(3);
  const A = JSON.parse(fs.readFileSync(fileOf(a), "utf8"));
  const B = JSON.parse(fs.readFileSync(fileOf(b), "utf8"));
  let gaps = 0;
  for (const key of Object.keys(A)) {
    const x = A[key];
    const y = B[key];
    if (!y) {
      console.log(`✗ ${key} : absent de « ${b} »`);
      gaps++;
      continue;
    }
    if (x.status !== y.status) {
      console.log(`✗ ${key} : statut ${x.status} → ${y.status}`);
      gaps++;
    }
    for (const n of new Set([
      ...Object.keys(x.headers),
      ...Object.keys(y.headers),
    ])) {
      if (x.headers[n] !== y.headers[n]) {
        console.log(
          `✗ ${key} : ${n} « ${x.headers[n] ?? "∅"} » → « ${y.headers[n] ?? "∅"} »`,
        );
        gaps++;
      }
    }
  }
  console.log(
    gaps === 0
      ? `✓ ${Object.keys(A).length} réponses, blocs identiques`
      : `${gaps} écart(s)`,
  );
  process.exit(gaps === 0 ? 0 : 3);
}

const name = process.argv[2] ?? "releve";
const result = {};
const session = http2.connect(`https://${HOST}:${PS}`, {
  rejectUnauthorized: false,
});
session.on("error", () => {});
try {
  for (const c of CASES) {
    result[`h1 ${c.label}`] = await h1(c);
    result[`h2 ${c.label}`] = await h2(session, c);
  }
} catch (error) {
  console.error(`⛔ cible injoignable : ${error.message}`);
  process.exit(1);
} finally {
  session.close();
}
fs.mkdirSync(DIR, { recursive: true });
fs.writeFileSync(fileOf(name), JSON.stringify(result, null, 2));
for (const [k, v] of Object.entries(result)) {
  console.log(
    `${String(v.status).padEnd(4)} ${String(Object.keys(v.headers).length).padStart(2)} en-têtes · ${k}`,
  );
}
console.log(`→ ${path.relative(process.cwd(), fileOf(name))}`);
