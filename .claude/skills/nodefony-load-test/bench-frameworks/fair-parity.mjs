/**
 * Preuve de parité d'un camp « équitable » (`nest-fair`, `express-fair`) face à
 * Nodefony (#489) — même comportement observable, cas par cas, avant de publier
 * le moindre écart de débit. Un camp équitable ne l'est que tant qu'il passe ici.
 *
 * Interroge les deux serveurs avec la MÊME matrice de requêtes (sans en-tête,
 * traceparent valide/invalide, origine connue/inconnue, préflight CORS, POST
 * cross-site, zone sécurisée, route inconnue, HEAD) et compare : statut, présence
 * de chaque en-tête de la liste surveillée, forme des valeurs dynamiques (nonce,
 * UUID, traceparent — PROPAGÉ ou NEUF), valeurs des statiques. Chaque écart est
 * nommé ; exit 1 s'il en reste un qui n'est pas déclaré dans `ACCEPTED`.
 *
 * Décor (depuis la racine du dépôt) :
 *   NODE_ENV=production NF_LOG_DRIVER=null NF_BENCH_ROUTE=1 NF_WITH_DEV_MODULES=1 \
 *     node src/nodefony/bin/nodefony production            # :5151
 *   NODE_ENV=production PORT=5170 node .claude/skills/nodefony-load-test/bench-frameworks/<camp>.mjs
 *   CAMP=<camp> node .claude/skills/nodefony-load-test/bench-frameworks/fair-parity.mjs
 *
 * Banc ORM (#507) — `PARITY_ROUTES=orm` remplace la matrice par celle des routes
 * `bench-orm` (serveur `NF_BENCH_ORM=1`, camps `*-fair-sqlite`) : lecture +
 * écriture, POST validé 200 ET 422, POST cross-site. Ces cas comparent EN PLUS
 * le `Content-Type` et la FORME du corps — clés triées, et pour le 422 la liste
 * triée des messages : un camp qui rendrait une erreur plus courte sérialiserait
 * moins, et l'écart mesuré serait celui du format.
 */
const NF = process.env.NF_URL ?? "http://127.0.0.1:5151";
const CAMP = process.env.CAMP ?? "camp";
const CAMP_URL = process.env.CAMP_URL ?? "http://127.0.0.1:5170";
const ROUTE = "/nodefony/test/als-test/state";
const TP_IN = "00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01";

/**
 * `hot: true` = le chemin que le banc MESURE : un écart y fausse le chiffre, il
 * fait échouer. Les autres cas sont affichés pour information : ils disent où
 * les frameworks diffèrent par conception (HEAD automatique, 405 avant CSRF,
 * routes `dummy-*` qui SIMULENT la taille de la table de Nodefony sans en être).
 */
const CASES = [
  { hot: true, name: "GET nu", path: ROUTE },
  {
    hot: true,
    name: "GET traceparent valide",
    path: ROUTE,
    headers: { traceparent: TP_IN },
  },
  {
    hot: true,
    name: "GET traceparent invalide",
    path: ROUTE,
    headers: { traceparent: "zz-garbage" },
  },
  {
    hot: true,
    name: "GET origine inconnue",
    path: ROUTE,
    headers: { origin: "http://evil.example" },
  },
  { hot: true, name: "zone sécurisée", path: "/nodefony/kernel/api/modules" },
  {
    name: "zone sécurisée, route inconnue",
    path: "/nodefony/test/secure/parity",
  },
  {
    name: "OPTIONS préflight inconnu",
    path: ROUTE,
    method: "OPTIONS",
    headers: {
      origin: "http://evil.example",
      "access-control-request-method": "GET",
    },
  },
  {
    name: "POST cross-site",
    path: ROUTE,
    method: "POST",
    headers: {
      "sec-fetch-site": "cross-site",
      "content-type": "application/json",
    },
    body: "{}",
  },
  { name: "HEAD", path: ROUTE, method: "HEAD" },
  { name: "route inconnue", path: "/nodefony/test/nope-parity" },
  { name: "route paramétrée", path: "/nodefony/test/dummy-b3/42" },
];

const ORM = "/nodefony/test/bench-orm";
const SAME_ORIGIN = {
  "sec-fetch-site": "same-origin",
  "content-type": "application/json",
};
const ORM_CASES = [
  { hot: true, shape: true, name: "GET read-write", path: `${ORM}/read-write` },
  { hot: true, shape: true, name: "GET read-lean", path: `${ORM}/read-lean` },
  {
    hot: true,
    shape: true,
    name: "POST validé — corps valide (200)",
    path: `${ORM}/read-write-valid`,
    method: "POST",
    headers: SAME_ORIGIN,
    body: '{"total_ht":200,"total_ttc":240,"ref":"FA-1"}',
  },
  {
    hot: true,
    shape: true,
    name: "POST validé — corps invalide (422)",
    path: `${ORM}/read-write-valid`,
    method: "POST",
    headers: SAME_ORIGIN,
    body: '{"total_ht":-1,"total_ttc":"x","ref":"0123456789012345678901234567890"}',
  },
  {
    hot: true,
    shape: true,
    name: "POST validé — règle croisée ttc < ht (422)",
    path: `${ORM}/read-write-valid`,
    method: "POST",
    headers: SAME_ORIGIN,
    body: '{"total_ht":10,"total_ttc":5}',
  },
  {
    hot: true,
    name: "POST validé — cross-site (403)",
    path: `${ORM}/read-write-valid`,
    method: "POST",
    headers: { ...SAME_ORIGIN, "sec-fetch-site": "cross-site" },
    body: '{"total_ht":200,"total_ttc":240}',
  },
];

/**
 * Forme d'un corps JSON : ses clés triées, et pour une liste de messages
 * d'erreur, les messages triés — les VALEURS (séquence, lignes lues) varient
 * d'un appel à l'autre, la forme non.
 */
function bodyShape(text) {
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    return `non-JSON(${text.length} o)`;
  }
  if (typeof json !== "object" || json === null) return typeof json;
  const keys = Object.keys(json).sort().join(",");
  return Array.isArray(json.message)
    ? `${keys} | ${[...json.message].sort().join(" ; ")}`
    : keys;
}

/** En-têtes surveillés, et la façon de comparer leur valeur. */
const WATCH = {
  "content-security-policy": (v) =>
    v?.replace(/'nonce-[A-Za-z0-9+/=]+'/, "'nonce-X'"),
  "x-content-type-options": (v) => v,
  "x-frame-options": (v) => v,
  "referrer-policy": (v) => v,
  "cross-origin-opener-policy": (v) => v,
  "cross-origin-resource-policy": (v) => v,
  "permissions-policy": (v) => v,
  server: (v) => v?.toLowerCase(),
  "x-request-id": (v) => (v && /^[0-9a-f-]{36}$/.test(v) ? "uuid" : v),
  traceparent: (v) =>
    !v
      ? v
      : v.includes("0af7651916cd43dd8448eb211c80319c")
        ? "propagé"
        : /^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/.test(v)
          ? "neuf"
          : v,
  "access-control-allow-origin": (v) => v,
  etag: (v) => (v ? "présent" : v),
  "set-cookie": (v) => (v ? "présent" : v),
  "strict-transport-security": (v) => v,
  "x-powered-by": (v) => v,
};

async function probe(base, c) {
  const res = await fetch(base + c.path, {
    method: c.method ?? "GET",
    headers: c.headers,
    body: c.body,
    redirect: "manual",
  });
  const text = await res.text();
  const out = { status: res.status };
  if (c.shape) {
    // Le TYPE de média, sans ses paramètres : `charset=utf-8` est une
    // convention d'Express et de Fastify que Nodefony n'écrit pas (JSON est
    // UTF-8 par définition, RFC 8259 §8.1) — quinze octets d'en-tête, pas un
    // travail différent. Un type différent, lui, en serait un.
    out["content-type"] = res.headers
      .get("content-type")
      ?.split(";")[0]
      ?.trim()
      .toLowerCase();
    out.body = bodyShape(text);
  }
  for (const [h, norm] of Object.entries(WATCH))
    out[h] = norm(res.headers.get(h) ?? undefined) ?? "—";
  return out;
}

let diffs = 0;
const matrix = process.env.PARITY_ROUTES === "orm" ? ORM_CASES : CASES;
for (const c of matrix) {
  const [a, b] = await Promise.all([probe(NF, c), probe(CAMP_URL, c)]);
  const lines = [];
  for (const k of Object.keys(a)) {
    if (a[k] !== b[k])
      lines.push(`    ${k}: nodefony=${a[k]}  ${CAMP}=${b[k]}`);
  }
  const mark = !lines.length ? "✓" : c.hot ? "✖" : "·";
  console.log(
    `${mark} ${c.name}${c.hot ? "" : "  [hors chemin mesuré]"}  (statut ${a.status}/${b.status})`,
  );
  for (const l of lines) console.log(l);
  if (c.hot) diffs += lines.length;
}
console.log(
  diffs
    ? `\n❌ ${diffs} écart(s) sur le chemin mesuré — ${CAMP} ne fait PAS la même chose`
    : `\n✅ ${CAMP} : parité observable sur tout le chemin mesuré`,
);
process.exitCode = diffs ? 1 : 0;
