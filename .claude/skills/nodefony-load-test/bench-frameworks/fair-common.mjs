/**
 * Socle des camps « équitables » (`express-fair`, `nest-fair`) — le travail que
 * Nodefony fait à chaque requête en production, en UNE implémentation : deux
 * copies divergeraient, et l'écart publié mesurerait leur divergence (#489).
 *
 * Relevé sur un serveur `production` au décor du banc, prouvé cas par cas par
 * `fair-parity.mjs` : portée ALS + `X-Request-Id` (UUID), `traceparent` ÉMIS
 * (propagé ou neuf), CSP à nonce par requête, en-têtes de sécurité statiques,
 * `Server`, CORS par liste blanche, CSRF (Fetch Metadata, repli Origin), zones
 * du pare-feu fail-closed, pas d'ETag.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { randomFillSync, randomUUID } from "node:crypto";

export const als = new AsyncLocalStorage();

/* Pool CSPRNG amorti — la technique de Nodefony (et de `randomUUID`). */
const POOL_BYTES = 4096;
const pool = Buffer.allocUnsafe(POOL_BYTES);
let offset = POOL_BYTES;
function take(size, encoding) {
  if (offset + size > POOL_BYTES) {
    randomFillSync(pool);
    offset = 0;
  }
  const out = pool.toString(encoding, offset, offset + size);
  offset += size;
  return out;
}

/* W3C Trace Context — même validation que Nodefony (`service/trace.ts`). */
const TRACEPARENT =
  /^([0-9a-f]{2})-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})$/;
const ZEROS = /^0+$/;
function resolveTraceparent(header) {
  if (typeof header === "string") {
    const m = TRACEPARENT.exec(header.trim().toLowerCase());
    if (m && m[1] !== "ff" && !ZEROS.test(m[2]) && !ZEROS.test(m[3])) {
      return `${m[1]}-${m[2]}-${take(8, "hex")}-${m[4]}`;
    }
  }
  return `00-${take(16, "hex")}-${take(8, "hex")}-01`;
}

/*
 * Zones du pare-feu — les SEPT que l'application de banc déclare réellement
 * (`framework/nodefony/config/config.ts`, `modules/test/nodefony/config/config.ts`),
 * triées du motif le plus long au plus court comme le fait le pare-feu : la
 * route de banc n'en capture aucune, donc les parcourt TOUTES, comme chez
 * Nodefony. Pas de zone attrape-tout : hors zone = public.
 */
const AREAS = [
  { re: /^\/nodefony\/test\/foreign-audience/, secure: true },
  { re: /^\/nodefony\/kernel\/api\/livez$/, secure: false },
  { re: /^\/nodefony\/test\/self-external/, secure: true },
  { re: /^\/nodefony\/[^/]+\/api(\/|$)/, secure: true },
  { re: /^\/nodefony\/test\/external/, secure: true },
  { re: /^\/nodefony\/test\/secure/, secure: true },
  { re: /^\/nodefony\/test\/m2m/, secure: true },
];
function matchArea(path) {
  for (const a of AREAS) if (a.re.test(path)) return a;
  return null;
}

/* CSRF — Fetch Metadata en défense primaire, repli Origin. */
const SAFE = new Set(["GET", "HEAD", "OPTIONS"]);
function csrfOk(method, headers) {
  if (SAFE.has(method)) return true;
  const site = headers["sec-fetch-site"];
  if (site) return site === "same-origin" || site === "none";
  const origin = headers.origin;
  return !origin || origin === `http://${headers.host}`;
}

const CSP_HEAD = "default-src 'self'; script-src 'self' 'nonce-";
const CSP_TAIL =
  "'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https://www.gravatar.com https://*.googleusercontent.com https://avatars.githubusercontent.com; font-src 'self' data:; connect-src 'self'; worker-src 'self' blob:; object-src 'none'; base-uri 'self'; form-action 'self'";

/**
 * Réglages `helmet` qui émettent EXACTEMENT les en-têtes statiques de Nodefony —
 * ses défauts ajoutent HSTS, X-XSS-Protection, Origin-Agent-Cluster… et posent
 * `SAMEORIGIN` là où Nodefony pose `DENY`. La CSP est posée par requête.
 */
export const HELMET_OPTIONS = {
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false,
  crossOriginOpenerPolicy: { policy: "same-origin" },
  crossOriginResourcePolicy: { policy: "same-origin" },
  frameguard: { action: "deny" },
  referrerPolicy: { policy: "no-referrer" },
  noSniff: true,
  hsts: false,
  dnsPrefetchControl: false,
  originAgentCluster: false,
  ieNoOpen: false,
  permittedCrossDomainPolicies: false,
  xssFilter: false,
  hidePoweredBy: true,
};

/**
 * Le travail par requête : contexte, en-têtes dynamiques, pare-feu, CSRF.
 *
 * @param method - méthode HTTP
 * @param path - chemin (sans requête)
 * @param headers - en-têtes de la requête (noms en minuscules)
 * @returns `{ store, headers, status }` — `status` non nul = refus à rendre
 */
export function perRequest(method, path, headers) {
  const store = {
    requestId: randomUUID(),
    traceparent: resolveTraceparent(headers.traceparent),
    user: null,
  };
  const out = {
    server: "nodefony",
    "permissions-policy": "camera=(), microphone=(), geolocation=()",
    "content-security-policy": CSP_HEAD + take(16, "base64") + CSP_TAIL,
    "x-request-id": store.requestId,
    traceparent: store.traceparent,
  };
  const area = matchArea(path);
  let status = 0;
  if (area?.secure && !store.user) status = 401;
  else if (!csrfOk(method, headers)) status = 403;
  return { store, headers: out, status };
}
