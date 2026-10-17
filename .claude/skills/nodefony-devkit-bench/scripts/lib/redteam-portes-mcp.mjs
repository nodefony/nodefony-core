#!/usr/bin/env node
/**
 * Red-team des portes MCP GÉNÉRÉES (`create controller --kind mcp`, #602) —
 * attaques sur serveur réel contre les trois expositions : locale, protégée
 * par jeton, mixte.
 *
 * Lancé DANS l'application témoin du banc de vérité, serveur démarré : il ne
 * lit aucun fichier de la porte, il la frappe comme le ferait un attaquant —
 * depuis la machine, en posant les en-têtes qu'il veut, avec des jetons émis
 * par l'application (`security:token`) ou forgés à la main.
 *
 * La matrice a été conçue SANS lire la mécanique (`@nodefony/ai`), depuis la
 * spec MCP et les RFC 6750 / 8707 / 9728 / 8725 : chaque vecteur dit ce que la
 * NORME exige, pas ce que le code fait. Un vecteur rouge est une faille de la
 * porte générée, ou de la mécanique qu'elle emploie.
 *
 * Usage : `node redteam-portes-mcp.mjs` (cwd = l'application témoin)
 * Variables : `NF_PORT`, `NF_PORT_HTTPS` (ports du décor) ; `NF_REDTEAM_ONLY`
 * (identifiants séparés par des virgules) pour rejouer un vecteur.
 * Sorties : `0` tout résiste · `1` au moins une faille · `70` le juge n'a pas
 * pu monter son décor (jetons, compte témoin, session) — un vecteur abstenu
 * n'est jamais compté vert.
 *
 * @module
 */
import { spawnSync } from "node:child_process";
import { generateKeyPairSync, sign as signer, createHmac } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CookieJar, request, PORT } from "./http-probe.mjs";
import { TEMOIN, TEMOIN_ADMIN, ouvrirSession } from "./identites.mjs";

const PORT_HTTPS = process.env.NF_PORT_HTTPS ?? "5362";
const BIN = path.join(
  process.cwd(),
  "node_modules",
  "nodefony",
  "bin",
  "nodefony",
);

/**
 * Les trois portes que le banc de vérité génère, et leurs outils — SEULE
 * source : `verify-generated.mjs` en tire les noms qu'il passe au générateur.
 */
export const PORTES = {
  locale: { route: "/api/outils", prefixe: "outils" },
  protegee: { route: "/api/agent", prefixe: "agent" },
  mixte: { route: "/api/vitrine", prefixe: "vitrine" },
};

/** L'audience d'une porte : l'URI publique que ses jetons doivent porter. */
export const audience = (porte) =>
  `https://localhost:${PORT_HTTPS}${PORTES[porte].route}`;

// ── Jetons ──────────────────────────────────────────────────────────────────

const jetons = new Map();

/**
 * Un jeton émis par l'application — mis en cache par (compte, ressource,
 * scope) : chaque émission boote une commande.
 *
 * @returns {string} le jeton, ou lève si l'émission échoue (décor).
 */
export function jeton({ compte = "admin", ressource, scope } = {}) {
  const cle = `${compte}|${ressource}|${scope ?? ""}`;
  if (jetons.has(cle)) return jetons.get(cle);
  const args = [
    BIN,
    "security:token",
    compte,
    "--json",
    "--ttl",
    "15",
    "--resource",
    ressource,
  ];
  if (scope) args.push("--scope", scope);
  const r = spawnSync(process.execPath, args, {
    encoding: "utf8",
    env: { ...process.env, NODE_ENV: "development" },
    timeout: 120_000,
  });
  let valeur = "";
  try {
    valeur = JSON.parse(r.stdout).access_token ?? "";
  } catch {
    valeur = "";
  }
  if (!valeur) {
    throw new Error(
      `émission refusée (${compte}, ${ressource}, ${scope ?? "—"}) : ${(r.stderr || r.stdout).slice(0, 300)}`,
    );
  }
  jetons.set(cle, valeur);
  return valeur;
}

/** Les scopes ACCORDÉS par l'émetteur pour une demande — pas ceux demandés. */
export function scopesAccordes({ compte = "admin", ressource, scope }) {
  const args = [
    BIN,
    "security:token",
    compte,
    "--json",
    "--ttl",
    "15",
    "--resource",
    ressource,
  ];
  if (scope) args.push("--scope", scope);
  const r = spawnSync(process.execPath, args, {
    encoding: "utf8",
    env: { ...process.env, NODE_ENV: "development" },
    timeout: 120_000,
  });
  try {
    return JSON.parse(r.stdout).scopes ?? [];
  } catch {
    return null;
  }
}

const b64 = (o) =>
  Buffer.from(typeof o === "string" ? o : JSON.stringify(o)).toString(
    "base64url",
  );

/** En-tête et charge utile d'un jeton, sans vérifier la signature. */
export function decoder(t) {
  const [h, p] = t.split(".");
  return {
    header: JSON.parse(Buffer.from(h, "base64url").toString()),
    payload: JSON.parse(Buffer.from(p, "base64url").toString()),
  };
}

const AUTRE_CLE = generateKeyPairSync("ed25519");

/**
 * Un jeton FORGÉ à partir d'un vrai : en-tête et charge modifiés, puis signé
 * par `mode` — `none` (sans signature), `hs256` (clé symétrique arbitraire),
 * `autre-cle` (EdDSA d'une clé inconnue), `originale` (signature d'origine
 * conservée : toute modification la rend invalide).
 */
export function forger(
  base,
  { header = {}, payload = {}, mode = "autre-cle" } = {},
) {
  const d = decoder(base);
  const h = { ...d.header, ...header };
  const p = { ...d.payload, ...payload };
  for (const [k, v] of Object.entries(payload))
    if (v === undefined) delete p[k];
  if (mode === "none") {
    return `${b64({ ...h, alg: "none" })}.${b64(p)}.`;
  }
  if (mode === "hs256") {
    const tete = b64({ ...h, alg: "HS256" });
    const corps = b64(p);
    const sig = createHmac("sha256", "cle-publique-devinee")
      .update(`${tete}.${corps}`)
      .digest("base64url");
    return `${tete}.${corps}.${sig}`;
  }
  if (mode === "originale") {
    return `${b64(h)}.${b64(p)}.${base.split(".")[2]}`;
  }
  const tete = b64({ ...h, alg: "EdDSA" });
  const corps = b64(p);
  const sig = signer(
    null,
    Buffer.from(`${tete}.${corps}`),
    AUTRE_CLE.privateKey,
  ).toString("base64url");
  return `${tete}.${corps}.${sig}`;
}

// ── Requêtes ────────────────────────────────────────────────────────────────

/** Un message JSON-RPC (ou un corps brut) posté à une porte. */
export function poster(
  porte,
  message,
  { headers = {}, raw, method = "POST", jar, path: chemin } = {},
) {
  const opts = {
    headers: { accept: "application/json, text/event-stream", ...headers },
  };
  if (raw !== undefined) {
    opts.raw = raw;
    opts.headers["content-type"] ??= "application/json";
  } else if (message !== undefined) {
    opts.body = message;
  }
  return request(
    method,
    chemin ?? PORTES[porte].route,
    jar ?? new CookieJar(),
    opts,
  );
}

/** Les messages JSON-RPC d'une réponse (corps JSON, ou chaque `data:` SSE). */
export function messages(r) {
  if (!r.body) return [];
  const type = String(r.headers?.["content-type"] ?? "");
  const textes = type.includes("text/event-stream")
    ? r.body
        .split(/\r?\n/u)
        .filter((l) => l.startsWith("data:"))
        .map((l) => l.slice(5).trim())
    : [r.body];
  const lus = [];
  for (const t of textes) {
    try {
      const m = JSON.parse(t);
      if (Array.isArray(m)) lus.push(...m);
      else if (m && typeof m === "object") lus.push(m);
    } catch {
      // illisible
    }
  }
  return lus;
}

/** Un appel d'outil JSON-RPC. */
export const appel = (nom, args = {}, id = 1, extra = {}) => ({
  jsonrpc: "2.0",
  id,
  method: "tools/call",
  params: { name: nom, arguments: args, ...extra },
});

export const LISTE = { jsonrpc: "2.0", id: 1, method: "tools/list" };

/** Le résultat d'un `tools/call` a-t-il été EXÉCUTÉ avec succès ? */
export function execute(r) {
  return messages(r).some(
    (m) => m.result && m.result.isError !== true && m.result.content,
  );
}

/** Les noms d'outils d'un catalogue servi. */
export function catalogue(r) {
  const m = messages(r).find((x) => Array.isArray(x.result?.tools));
  return m ? m.result.tools.map((t) => t.name) : null;
}

/** Le texte complet d'une réponse — en-têtes compris — pour chercher une fuite. */
export const texteComplet = (r) =>
  `${JSON.stringify(r.headers ?? {})}\n${r.body ?? ""}`;

// ── La matrice ──────────────────────────────────────────────────────────────
// Chaque vecteur rend `null` s'il résiste, sinon la description de la faille.
// L'identifiant reprend celui de la matrice de conception (passe 1).

const E = (p) => `${PORTES[p].prefixe}_echo`;
const B = (p) => `${PORTES[p].prefixe}_batch`;
const bearer = (t) => ({ authorization: `Bearer ${t}` });
const statutEst = (r, ...ok) =>
  ok.includes(r.status)
    ? null
    : `statut ${r.status} (attendu ${ok.join("|")}) : ${String(r.body).slice(0, 160)}`;
const nonExecute = (r) =>
  execute(r) ? `OUTIL EXÉCUTÉ : ${String(r.body).slice(0, 160)}` : null;
const premier = (...v) => v.find((x) => x !== null) ?? null;
/** Le nom d'une ligne de matrice `[nom, réglages]` — le premier élément, en texte. */
const nomme = (n) => (typeof n === "string" ? n : JSON.stringify(n));

/** Le jeton admin d'une porte (scope de l'outil réservé compris pour la mixte). */
const tokPorte = (p, scope) => jeton({ ressource: audience(p), scope });

export const VECTEURS = [
  // 1. Garde de transport
  ...["locale", "protegee", "mixte"].map((p) => ({
    id: `T01-${p}`,
    titre: `Origin étranger refusé (${p})`,
    run: async () => {
      const r = await poster(p, LISTE, {
        headers: { origin: "https://evil.example" },
      });
      return premier(
        statutEst(r, 403),
        catalogue(r) ? "catalogue servi" : null,
      );
    },
  })),
  {
    id: "T02",
    titre: "Origin null refusé (locale)",
    run: async () => {
      const r = await poster("locale", appel(E("locale"), { text: "x" }), {
        headers: { origin: "null" },
      });
      return premier(statutEst(r, 403), nonExecute(r));
    },
  },
  ...[
    "http://127.0.0.1.evil.com",
    `http://127.0.0.1:${PORT}@evil.com`,
    "http://localhost.evil.com",
    "http://127.0.0.1:9999",
    `https://127.0.0.1:${PORT}.evil.com`,
  ].map((o, i) => ({
    id: `T03-${i + 1}`,
    titre: `Origin voisine refusée : ${o}`,
    run: async () => {
      const r = await poster("locale", appel(E("locale"), { text: "x" }), {
        headers: { origin: o },
      });
      return premier(statutEst(r, 403), nonExecute(r));
    },
  })),
  // DNS rebinding, tel qu'un NAVIGATEUR le joue : le nom de l'attaquant résout
  // vers 127.0.0.1, la page poste à sa propre origine — et un navigateur pose
  // TOUJOURS `Origin` sur un POST (Fetch, « append a request Origin header »),
  // son nom, ou `null` sous `no-referrer`. Un Host forgé SANS Origin ne vient
  // que d'un process déjà sur la machine, à qui la porte locale est ouverte par
  // conception ; la barrière Host (`domainCheck`) reste un choix d'application.
  ...["http://evil.example:" + PORT, "null"].map((o) => ({
    id: `T04-${o === "null" ? "null" : "nom"}`,
    titre: `rebinding navigateur (Host + Origin ${o}) refusé — locale`,
    run: async () => {
      const r = await poster("locale", appel(E("locale"), { text: "x" }), {
        headers: { host: `evil.example:${PORT}`, origin: o },
      });
      return premier(statutEst(r, 403), nonExecute(r));
    },
  })),
  ...[
    { "x-forwarded-for": "203.0.113.9" },
    { forwarded: "for=203.0.113.9;proto=https;host=evil.example" },
    { "x-real-ip": "8.8.8.8" },
  ].map((h, i) => ({
    id: `T05-${i + 1}`,
    titre: `porte locale appelée « par un relais » : ${Object.keys(h)[0]}`,
    run: async () => {
      const r = await poster("locale", appel(E("locale"), { text: "x" }), {
        headers: h,
      });
      return premier(statutEst(r, 403), nonExecute(r));
    },
  })),
  ...["GET", "DELETE", "PUT", "PATCH"].map((m) => ({
    id: `T08-${m}`,
    titre: `${m} refusé (405) sur la porte locale`,
    run: async () => {
      const r = await poster("locale", undefined, {
        method: m,
        headers: { accept: "text/event-stream" },
      });
      return premier(
        statutEst(r, 405),
        m === "GET" || m === "DELETE"
          ? /POST/u.test(String(r.headers?.allow ?? ""))
            ? null
            : `Allow absent : ${r.headers?.allow}`
          : null,
      );
    },
  })),
  ...["text/plain", "application/x-www-form-urlencoded"].map((ct) => ({
    id: `T10-${ct.split("/")[1]}`,
    titre: `requête « simple » CORS (${ct}) n'exécute rien — locale`,
    run: async () => {
      const r = await poster("locale", undefined, {
        raw: JSON.stringify(appel(E("locale"), { text: "x" })),
        headers: { "content-type": ct },
      });
      return nonExecute(r);
    },
  })),

  // 2. Jeton — porte protégée
  {
    id: "T12",
    titre: "sans jeton : 401 + défi resource_metadata (protégée)",
    run: async () => {
      const r = await poster("protegee", appel(E("protegee"), { text: "x" }));
      const defi = String(r.headers?.["www-authenticate"] ?? "");
      return premier(
        statutEst(r, 401),
        nonExecute(r),
        /resource_metadata="/u.test(defi)
          ? null
          : `défi sans resource_metadata : ${defi}`,
      );
    },
  },
  ...[
    { n: "vide", v: () => "Bearer " },
    { n: "Basic", v: () => "Basic dXNlcjpwYXNz" },
    {
      n: "double",
      v: () => `Bearer ${tokPorte("protegee")} ${tokPorte("protegee")}`,
    },
  ].map(({ n, v }) => ({
    id: `T13-${n}`,
    titre: `Authorization ${n} refusé (protégée)`,
    run: async () => {
      const valeur = v();
      const r = await poster("protegee", appel(E("protegee"), { text: "x" }), {
        headers: { authorization: valeur },
      });
      return premier(statutEst(r, 400, 401), nonExecute(r));
    },
  })),
  {
    id: "T13-casse",
    titre:
      "schéma `bearer` en minuscules admis (RFC 9110 §11.1) — contrôle positif",
    run: async () => {
      const r = await poster("protegee", appel(E("protegee"), { text: "x" }), {
        headers: { authorization: `bearer ${tokPorte("protegee")}` },
      });
      return execute(r)
        ? null
        : `jeton valide refusé en « bearer » : ${r.status}`;
    },
  },
  {
    id: "T-positif",
    titre: "jeton valide de la porte : outil servi — contrôle positif",
    run: async () => {
      const r = await poster("protegee", appel(E("protegee"), { text: "x" }), {
        headers: bearer(tokPorte("protegee")),
      });
      return execute(r)
        ? null
        : `jeton valide refusé : ${r.status} ${String(r.body).slice(0, 160)}`;
    },
  },
  ...[
    ["none", { mode: "none" }],
    ["autre-cle", { mode: "autre-cle" }],
    ["hs256", { mode: "hs256" }],
    ["kid-inconnu", { mode: "autre-cle", header: { kid: "inconnu" } }],
    [
      "jwk-embarque",
      {
        mode: "autre-cle",
        header: { jwk: { kty: "OKP", crv: "Ed25519", x: "AAAA" } },
      },
    ],
    [
      "aud-modifiee-sig-origine",
      { mode: "originale", payload: { aud: audience("protegee") + "/" } },
    ],
    [
      "scope-ajoute-sig-origine",
      { mode: "originale", payload: { scope: "admin:read admin:write" } },
    ],
  ].map(([n, f]) => ({
    id: `T15-${nomme(n)}`,
    titre: `jeton forgé (${nomme(n)}) refusé (protégée)`,
    run: async () => {
      const r = await poster("protegee", appel(E("protegee"), { text: "x" }), {
        headers: bearer(forger(tokPorte("protegee"), f)),
      });
      return premier(statutEst(r, 401), nonExecute(r));
    },
  })),
  {
    id: "T16",
    titre:
      "jeton d'une AUTRE porte de l'app (audience mixte) refusé à la protégée",
    run: async () => {
      const r = await poster("protegee", appel(E("protegee"), { text: "x" }), {
        headers: bearer(tokPorte("mixte")),
      });
      return premier(statutEst(r, 401), nonExecute(r));
    },
  },
  {
    id: "T16-dev",
    titre: "jeton de la porte de DÉVELOPPEMENT refusé à la protégée",
    run: async () => {
      const t = jeton({
        ressource: `https://localhost:${PORT_HTTPS}/nodefony/mcp`,
      });
      const r = await poster("protegee", appel(E("protegee"), { text: "x" }), {
        headers: bearer(t),
      });
      return premier(statutEst(r, 401), nonExecute(r));
    },
  },
  {
    id: "T21-typ",
    titre: "typ JWT au lieu de at+jwt — signature d'origine conservée, refusé",
    run: async () => {
      const r = await poster("protegee", appel(E("protegee"), { text: "x" }), {
        headers: bearer(
          forger(tokPorte("protegee"), {
            mode: "originale",
            header: { typ: "JWT" },
          }),
        ),
      });
      return premier(statutEst(r, 401), nonExecute(r));
    },
  },
  {
    id: "T25-query",
    titre:
      "jeton en query string ignoré (RFC 6750 §2.3, MCP : jamais dans l'URI)",
    run: async () => {
      const r = await poster("protegee", appel(E("protegee"), { text: "x" }), {
        path: `${PORTES.protegee.route}?access_token=${tokPorte("protegee")}`,
      });
      return premier(statutEst(r, 401), nonExecute(r));
    },
  },
  {
    id: "T25-cookie",
    titre: "jeton en cookie ignoré",
    run: async () => {
      const r = await poster("protegee", appel(E("protegee"), { text: "x" }), {
        headers: { cookie: `access_token=${tokPorte("protegee")}` },
      });
      return premier(statutEst(r, 401), nonExecute(r));
    },
  },
  {
    id: "T25-corps",
    titre: "jeton dans le corps JSON ignoré",
    run: async () => {
      const r = await poster("protegee", {
        ...appel(E("protegee"), { text: "x" }),
        access_token: tokPorte("protegee"),
      });
      return premier(statutEst(r, 401), nonExecute(r));
    },
  },

  {
    id: "T24",
    titre:
      "compte sans rôle : ni admin:write ni le scope réservé de la porte mixte (RFC 6749 §3.3)",
    run: async () => {
      const accordes = scopesAccordes({
        compte: TEMOIN.username,
        ressource: audience("mixte"),
        scope: "admin:write vitrine:write vitrine:read",
      });
      if (accordes === null)
        return "ABSTENTION — émission impossible pour le témoin (compte absent ?)";
      // `vitrine:write` est réservé à ROLE_ADMIN par la déclaration que
      // `--expose mixte` écrit dans `grantableScopes` (#604) ; la retirer
      // rouvre ce vecteur.
      const fautes = ["admin:write", "vitrine:write"].filter((s) =>
        accordes.includes(s),
      );
      if (fautes.length > 0)
        return `accordé(s) au témoin : ${fautes.join(" ")} (jeton : ${accordes})`;
      // Contrôle positif dans le même jeton : un scope NON déclaré reste
      // accordé — sans lui, « tout refuser » passerait pour un vert.
      return accordes.includes("vitrine:read")
        ? null
        : `scope libre vitrine:read refusé au témoin : ${accordes}`;
    },
  },
  {
    id: "T24-positif",
    titre: "administrateur : le scope réservé de la porte mixte reste accordé",
    run: async () => {
      const accordes = scopesAccordes({
        compte: TEMOIN_ADMIN.username,
        ressource: audience("mixte"),
        scope: "vitrine:write",
      });
      if (accordes === null)
        return "ABSTENTION — émission impossible pour l'administrateur (compte absent ?)";
      return accordes.includes("vitrine:write")
        ? null
        : `vitrine:write refusé à l'administrateur : ${accordes}`;
    },
  },

  // 3. Mixte
  {
    id: "T27",
    titre: "mixte, anonyme : l'outil réservé ne s'exécute pas",
    run: async () =>
      nonExecute(await poster("mixte", appel(B("mixte"), { batches: 1 }))),
  },
  {
    id: "T27-positif",
    titre: "mixte, anonyme : l'outil public répond — contrôle positif",
    run: async () => {
      const r = await poster("mixte", appel(E("mixte"), { text: "x" }));
      return execute(r) ? null : `outil public refusé : ${r.status}`;
    },
  },
  {
    id: "T28",
    titre: "mixte, jeton sans le scope : l'outil réservé ne s'exécute pas",
    run: async () =>
      nonExecute(
        await poster("mixte", appel(B("mixte"), { batches: 1 }), {
          headers: bearer(tokPorte("mixte")),
        }),
      ),
  },
  {
    id: "T28-positif",
    titre: "mixte, jeton au scope : l'outil réservé répond — contrôle positif",
    run: async () => {
      const r = await poster("mixte", appel(B("mixte"), { batches: 1 }), {
        headers: bearer(tokPorte("mixte", "vitrine:write")),
      });
      return execute(r)
        ? null
        : `jeton au scope refusé : ${r.status} ${String(r.body).slice(0, 160)}`;
    },
  },
  {
    id: "T17",
    titre: "mixte, jeton au scope mais d'une AUTRE audience : vaut anonyme",
    run: async () =>
      nonExecute(
        await poster("mixte", appel(B("mixte"), { batches: 1 }), {
          headers: bearer(
            jeton({ ressource: audience("protegee"), scope: "vitrine:write" }),
          ),
        }),
      ),
  },
  ...[
    ["forge-none", { mode: "none" }],
    ["forge-autre-cle", { mode: "autre-cle" }],
    ["expire", { mode: "originale", payload: { exp: 1 } }],
  ].map(([n, f]) => ({
    id: `T30-${nomme(n)}`,
    titre: `mixte, jeton rejeté (${nomme(n)}) portant le scope : jamais plus qu'anonyme`,
    run: async () =>
      nonExecute(
        await poster("mixte", appel(B("mixte"), { batches: 1 }), {
          headers: bearer(forger(tokPorte("mixte", "vitrine:write"), f)),
        }),
      ),
  })),
  {
    id: "T29-liste",
    titre: "mixte, anonyme : le catalogue ne nomme pas l'outil réservé",
    run: async () => {
      const r = await poster("mixte", LISTE);
      const noms = catalogue(r);
      if (!noms) return `catalogue illisible : ${r.status}`;
      return noms.includes(B("mixte"))
        ? `outil réservé listé à l'anonyme : ${noms}`
        : null;
    },
  },
  {
    id: "T29-indiscernable",
    titre:
      "mixte, anonyme : appeler l'outil réservé = appeler un outil inexistant",
    run: async () => {
      const a = await poster("mixte", appel(B("mixte"), { batches: 1 }, 7));
      const b = await poster("mixte", appel("vitrine_inexistant", {}, 7));
      const norm = (r) =>
        String(r.body)
          .replaceAll(B("mixte"), "§")
          .replaceAll("vitrine_inexistant", "§");
      return a.status === b.status && norm(a) === norm(b)
        ? null
        : `réponses distinctes : ${a.status} ${String(a.body).slice(0, 120)} ≠ ${b.status} ${String(b.body).slice(0, 120)}`;
    },
  },
  {
    id: "T31-lot",
    titre:
      "mixte, lot JSON-RPC [public, réservé] : rien du réservé ne s'exécute",
    run: async () => {
      const r = await poster("mixte", undefined, {
        raw: JSON.stringify([
          appel(E("mixte"), { text: "x" }, 1),
          appel(B("mixte"), { batches: 1 }, 2),
        ]),
      });
      const m = messages(r);
      return m.some((x) => x.id === 2 && x.result && !x.result.isError)
        ? `outil réservé exécuté en lot : ${String(r.body).slice(0, 160)}`
        : null;
    },
  },
  {
    id: "T49",
    titre: "mixte, session d'admin sans jeton : vaut anonyme",
    run: async () => {
      const jar = await sessionAdmin();
      if (!jar)
        return `ABSTENTION — session admin non ouverte : ${motifSession}`;
      return nonExecute(
        await poster("mixte", appel(B("mixte"), { batches: 1 }), { jar }),
      );
    },
  },
  {
    id: "T48",
    titre: "protégée, session d'admin sans jeton : 401",
    run: async () => {
      const jar = await sessionAdmin();
      if (!jar)
        return `ABSTENTION — session admin non ouverte : ${motifSession}`;
      const r = await poster("protegee", appel(E("protegee"), { text: "x" }), {
        jar,
      });
      return premier(statutEst(r, 401), nonExecute(r));
    },
  },

  // 4. Protocole
  {
    id: "T32-null",
    titre: "id null refusé, outil non exécuté",
    run: async () =>
      nonExecute(
        await poster("locale", {
          ...appel(E("locale"), { text: "x" }),
          id: null,
        }),
      ),
  },
  {
    id: "T32-objet",
    titre: "id objet refusé, outil non exécuté",
    run: async () =>
      nonExecute(
        await poster("locale", {
          ...appel(E("locale"), { text: "x" }),
          id: { a: 1 },
        }),
      ),
  },
  ...[
    "nodefony_card",
    "__proto__",
    "constructor",
    "OUTILS_ECHO",
    "outils_echo\u0000x",
  ].map((n) => ({
    id: `T34-${n.replace(/\W/gu, "_")}`,
    titre: `outil « ${JSON.stringify(n)} » inconnu`,
    run: async () =>
      nonExecute(await poster("locale", appel(n, { text: "x" }))),
  })),
  ...[{}, { text: 123 }, { text: { $ne: 1 } }].map((a, i) => ({
    id: `T35-${i + 1}`,
    titre: `arguments hors schéma ${JSON.stringify(a)} : erreur, pas de pile`,
    run: async () => {
      const r = await poster("locale", appel(E("locale"), a));
      return premier(nonExecute(r), fuite(r));
    },
  })),
  {
    id: "T36",
    titre: "notification sans id : 202 sans corps, aucun résultat",
    run: async () => {
      const { id, ...sansId } = appel(E("locale"), { text: "x" });
      void id;
      const r = await poster("locale", sansId);
      return r.status === 202 && !r.body
        ? null
        : `notification répondue : ${r.status} ${String(r.body).slice(0, 120)}`;
    },
  },
  {
    id: "T37-inconnue",
    titre: "MCP-Protocol-Version inconnue : 400",
    run: async () => {
      const r = await poster("locale", appel(E("locale"), { text: "x" }), {
        headers: { "mcp-protocol-version": "1999-01-01" },
      });
      return premier(statutEst(r, 400), nonExecute(r));
    },
  },
  ...[0, -1, 11, 1e9, 2.5, "5"].map((n) => ({
    id: `T38-${String(n)}`,
    titre: `batches=${JSON.stringify(n)} : borné, réponse rapide`,
    run: async () => {
      const t0 = Date.now();
      const r = await poster("locale", appel(B("locale"), { batches: n }));
      const ms = Date.now() - t0;
      return ms > 2500 ? `réponse en ${ms} ms : borne non appliquée` : null;
    },
  })),
  {
    id: "T39-corps",
    titre: "corps de 20 Mo : refusé sans faire tomber le serveur",
    run: async () => {
      const r = await poster("locale", undefined, {
        raw: JSON.stringify(
          appel(E("locale"), { text: "x".repeat(20 * 1024 * 1024) }),
        ),
      });
      const apres = await poster(
        "locale",
        appel(E("locale"), { text: "vivant" }),
      );
      return premier(
        execute(r) ? "corps de 20 Mo accepté et exécuté" : null,
        execute(apres)
          ? null
          : `serveur muet après : ${apres.status ?? apres.error}`,
      );
    },
  },
  {
    id: "T39-profond",
    titre: "JSON imbriqué sur 100 000 niveaux : pas de plantage",
    run: async () => {
      const raw = `${"[".repeat(100_000)}${"]".repeat(100_000)}`;
      await poster("locale", undefined, { raw });
      const apres = await poster(
        "locale",
        appel(E("locale"), { text: "vivant" }),
      );
      return execute(apres)
        ? null
        : `serveur muet après : ${apres.status ?? apres.error}`;
    },
  },
  {
    id: "T40",
    titre: "JSON malformé : -32700, pas de pile",
    run: async () => {
      const r = await poster("locale", undefined, { raw: "{" });
      return premier(
        fuite(r),
        /-32700/u.test(String(r.body))
          ? null
          : `pas d'erreur -32700 : ${r.status} ${String(r.body).slice(0, 120)}`,
      );
    },
  },
  {
    id: "T43-objet",
    titre: "progressToken objet : aucune progression émise sous ce jeton",
    run: async () => {
      const r = await poster(
        "locale",
        appel(B("locale"), { batches: 1 }, 1, {
          _meta: { progressToken: { a: 1 } },
        }),
      );
      return messages(r).some(
        (m) =>
          m.method === "notifications/progress" &&
          typeof m.params?.progressToken === "object",
      )
        ? "progression émise sous un jeton objet"
        : null;
    },
  },

  // 6. Fuites et document RFC 9728
  {
    id: "T46",
    titre: "document RFC 9728 : resource exacte, aucun secret ni chemin",
    run: async () => {
      const r = await poster("protegee", appel(E("protegee"), { text: "x" }));
      const meta = /resource_metadata="([^"]+)"/u.exec(
        String(r.headers?.["www-authenticate"] ?? ""),
      )?.[1];
      if (!meta) return "défi sans resource_metadata";
      const doc = await httpsGet(meta);
      if (doc.status !== 200) return `document ${meta} → ${doc.status}`;
      let j = null;
      try {
        j = JSON.parse(doc.body);
      } catch {
        return "document illisible";
      }
      return premier(
        j.resource === audience("protegee")
          ? null
          : `resource ${j.resource} ≠ ${audience("protegee")}`,
        fuite(doc),
      );
    },
  },
  {
    id: "T47",
    titre: "défi 401 avec Host forgé : resource_metadata ne suit pas le Host",
    run: async () => {
      const r = await poster("protegee", appel(E("protegee"), { text: "x" }), {
        headers: { host: "evil.example", "x-forwarded-host": "evil.example" },
      });
      return /evil\.example/u.test(
        String(r.headers?.["www-authenticate"] ?? ""),
      )
        ? `défi empoisonné : ${r.headers["www-authenticate"]}`
        : null;
    },
  },
];

/** Une réponse qui trahit l'intérieur : pile, chemin absolu, secret. */
function fuite(r) {
  const t = texteComplet(r);
  if (/\bat\s+\S+\s+\(?\/|node:internal|\.ts:\d+:\d+/u.test(t))
    return `pile exposée : ${t.slice(0, 160)}`;
  if (/\/(?:Users|home|var\/folders|private)\//u.test(t))
    return `chemin absolu exposé : ${t.slice(0, 160)}`;
  if (/BEGIN [A-Z ]*PRIVATE KEY|NF_JWT|password/iu.test(t))
    return `secret exposé : ${t.slice(0, 160)}`;
  return null;
}

/** Un GET https sur le certificat de développement (document RFC 9728). */
async function httpsGet(url) {
  const { default: https } = await import("node:https");
  return new Promise((resolve) => {
    https
      .get(url, { rejectUnauthorized: false }, (res) => {
        let body = "";
        res.on("data", (c) => (body += c));
        res.on("end", () =>
          resolve({ status: res.statusCode, body, headers: res.headers }),
        );
      })
      .on("error", (e) => resolve({ error: e.message, body: "" }));
  });
}

let jarAdmin;
let motifSession = "";
/** Une session d'administrateur ouverte par la vraie page de connexion de l'app. */
async function sessionAdmin() {
  if (jarAdmin !== undefined) return jarAdmin;
  const ouverte = await ouvrirSession(TEMOIN_ADMIN);
  jarAdmin = ouverte.jar ?? null;
  motifSession = ouverte.echec ?? ouverte.injoignable ?? "";
  return jarAdmin;
}

// ── Exécution ───────────────────────────────────────────────────────────────
// Seulement lancé directement : le banc de vérité importe `PORTES`, et une
// importation ne doit rien frapper.
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  await lancer();
}

/** Déroule la matrice et sort sur le verdict. */
async function lancer() {
  const seul = (process.env.NF_REDTEAM_ONLY ?? "").split(",").filter(Boolean);
  const lot = seul.length
    ? VECTEURS.filter((v) => seul.some((s) => v.id.startsWith(s)))
    : VECTEURS;
  let failles = 0;
  let abstentions = 0;
  for (const v of lot) {
    let verdict;
    try {
      verdict = await v.run();
    } catch (e) {
      console.error(`💥 ${v.id} — le juge a levé : ${e.message}`);
      process.exit(70);
    }
    if (verdict === null) console.log(`✅ ${v.id.padEnd(22)} ${v.titre}`);
    else if (verdict.startsWith("ABSTENTION")) {
      abstentions++;
      console.log(`⏭ ${v.id.padEnd(22)} ${v.titre} — ${verdict}`);
    } else {
      failles++;
      console.log(`⛔ ${v.id.padEnd(22)} ${v.titre}\n     → ${verdict}`);
    }
  }
  console.log(
    `\n━━ ${lot.length} vecteurs · ${failles} faille(s) · ${abstentions} abstention(s)`,
  );
  // Une abstention est un vecteur NON joué : le compter vert serait le piège du
  // banc sauté qui passe pour réussi. Le décor est incomplet — on le dit.
  process.exit(failles ? 1 : abstentions ? 70 : 0);
}
