/**
 * Auto-contrôle du juge « la page marche sans desserrer la politique de contenu ».
 *
 * Une application jouet sert la page mesurée avec, tour à tour, chaque politique
 * et chaque forme de script — et le juge doit rendre EXACTEMENT le code annoncé
 * par sa table. Aucun agent, aucun décor, quelques secondes, zéro jeton.
 *
 * Le cas qui justifie ce fichier à lui seul : `styleUnsafeInlineLegitime`. La
 * politique servie PAR DÉFAUT contient `style-src 'self' 'unsafe-inline'`, et un
 * juge écrit trop vite cherche `unsafe-inline` dans l'en-tête entier. Il
 * recalerait alors toutes les applications, intactes comprises, avec un rouge
 * parfaitement crédible — « l'agent a desserré la CSP ». C'est exactement la
 * famille de défaut qui a déjà coûté des heures ici : un instrument qui ment
 * dans le sens où on l'attend.
 *
 * Usage : `node lib/gate-csp-nonce.selftest.mjs`
 * Sorties : `0` toutes les causes distinguées · `1` au moins un écart.
 *
 * ⚠️ `spawnSync` est proscrit ici : le serveur jouet vit dans CE processus, et
 * un appel bloquant l'empêcherait de répondre — le juge sortirait en « aucune
 * réponse » partout, ce qui ressemble de loin à un contrôle vert.
 *
 * @module
 */
import http from "node:http";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { PAGE_WIDGET } from "./enonces.mjs";
import { portLibre } from "./http-probe.mjs";

const JUGE = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "gate-csp-nonce.mjs",
);

/**
 * Le port, obtenu du SYSTÈME et non écrit en dur.
 *
 * Un port fixe est un état PARTAGÉ : trois selftests écoutaient sur 5394,
 * trois sur 5395, deux sur 5393, et deux exécutions consécutives du lot
 * rendaient deux verdicts différents — des rouges qui n'accusaient personne.
 */
const PORT = String(await portLibre());

/** La politique que `@nodefony/security` sert sans qu'on écrive quoi que ce soit. */
const CSP_DEFAUT =
  "default-src 'self'; script-src 'self' 'nonce-{{n}}'; style-src 'self' 'unsafe-inline'; " +
  "img-src 'self' data:; object-src 'none'; base-uri 'self'";

const run = (args) =>
  new Promise((resolve) => {
    const p = spawn("node", args, { env: { ...process.env, NF_PORT: PORT } });
    let out = "";
    let err = "";
    p.stdout.on("data", (c) => (out += c));
    p.stderr.on("data", (c) => (err += c));
    p.on("close", (status) => resolve({ status, stdout: out, stderr: err }));
  });

/**
 * UNE application jouet paramétrable, pas une par cause.
 *
 * @param {{csp?: string|null, body?: Function, status?: number, fichiers?: object}} opts
 *   - `csp` porte `{{n}}` là où le nonce de la requête est substitué (`null` =
 *   aucun en-tête) ; `corps` reçoit ce nonce et rend le HTML ; `statut` force le
 *   code de la page ; `fichiers` sert les scripts externes.
 */
const app =
  ({ csp = CSP_DEFAUT, body = () => "", status = 200, fichiers = {} }) =>
  (req, res) => {
    const url = (req.url ?? "").split("?")[0];
    if (url === PAGE_WIDGET) {
      // Un nonce DIFFÉRENT à chaque requête, comme le framework : c'est ce qui
      // rend un nonce recopié dans un gabarit détectable.
      const nonce = `n${Math.floor(Math.random() * 1e9).toString(36)}`;
      const headers = { "content-type": "text/html" };
      if (csp) headers["content-security-policy"] = csp.replace("{{n}}", nonce);
      res.writeHead(status, headers);
      return res.end(body(nonce));
    }
    if (fichiers[url]) {
      res.writeHead(200, { "content-type": "text/javascript" });
      return res.end(fichiers[url]);
    }
    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "not found" }));
  };

/** La page telle qu'un agent qui a compris le nonce la rend. */
const pageSignee = (nonce) =>
  `<!doctype html><html><body><p id="c">0</p>` +
  `<script nonce="${nonce}">let n=0;setInterval(()=>{document.getElementById("c").textContent=++n},1000)</script>` +
  `</body></html>`;

const CAS = {
  // ── conformité, sous ses deux formes légitimes ───────────────────────────
  conforme: [0, app({ body: pageSignee })],
  // Le script sorti dans un fichier servi : aucune signature nécessaire.
  conformeExterne: [
    0,
    app({
      body: () =>
        `<!doctype html><html><body><p id="c">0</p><script src="/js/widget.js"></script></body></html>`,
      fichiers: { "/js/widget.js": "let n=0;" },
    }),
  ],
  // 🔴 LE faux rouge à ne pas écrire : `unsafe-inline` est dans la politique
  // par DÉFAUT, sur les styles. Chercher le mot dans l'en-tête entier
  // recalerait toute application intacte.
  styleUnsafeInlineLegitime: [0, app({ body: pageSignee })],
  // Un `<script>` vide (place tenue par un framework de vue) n'est pas un
  // script en ligne à signer : l'exiger recalerait un rendu courant.
  scriptVideIgnore: [
    0,
    app({
      body: (n) => `${pageSignee(n)}<script></script>`,
    }),
  ],

  // ── ce que l'AGENT a desserré ────────────────────────────────────────────
  scriptSrcDesserree: [
    1,
    app({
      csp: "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self'",
      body: () =>
        `<!doctype html><html><body><script>let n=0;</script></body></html>`,
    }),
  ],
  // Pas de `script-src` : c'est `default-src` qui gouverne les scripts.
  defaultSrcDesserree: [
    1,
    app({
      csp: "default-src 'self' 'unsafe-inline'; style-src 'self'",
      body: () =>
        `<!doctype html><html><body><script>let n=0;</script></body></html>`,
    }),
  ],
  evalDesserree: [
    1,
    app({
      csp: "default-src 'self'; script-src 'self' 'unsafe-eval'",
      body: () =>
        `<!doctype html><html><body><script>eval("1")</script></body></html>`,
    }),
  ],
  // Nonce ET `unsafe-inline` : le jeton ne répare rien sur un navigateur
  // récent (il est neutralisé par le nonce) et rouvre les anciens.
  nonceEtUnsafeInline: [
    1,
    app({
      csp: "default-src 'self'; script-src 'self' 'nonce-{{n}}' 'unsafe-inline'",
      body: pageSignee,
    }),
  ],

  // ── ce que l'AGENT a retiré ──────────────────────────────────────────────
  politiqueAbsente: [2, app({ csp: null, body: pageSignee })],
  // Une politique qui ne dit rien des scripts n'en gouverne aucun.
  politiqueSansScript: [
    2,
    app({
      csp: "img-src 'self'; style-src 'self'",
      body: () =>
        `<!doctype html><html><body><script>let n=0;</script></body></html>`,
    }),
  ],

  // ── la politique tient, mais la page ne marche pas ───────────────────────
  inlineNonSigne: [
    3,
    app({
      body: () =>
        `<!doctype html><html><body><script>let n=0;</script></body></html>`,
    }),
  ],
  // Nonce recopié dans le gabarit : bon pour la première requête, faux ensuite.
  inlineNonceFige: [
    3,
    app({
      body: () =>
        `<!doctype html><html><body><script nonce="fige-au-gabarit">let n=0;</script></body></html>`,
    }),
  ],
  scriptExterneIntrouvable: [
    8,
    app({
      body: () =>
        `<!doctype html><html><body><script src="/js/absent.js"></script></body></html>`,
    }),
  ],
  pageSansScript: [
    9,
    app({ body: () => `<!doctype html><html><body><p>0</p></body></html>` }),
  ],

  // ── la page elle-même ────────────────────────────────────────────────────
  pageAbsente: [6, app({ body: () => "", status: 404 })],
  pageEnErreur: [7, app({ body: () => "boom", status: 500 })],
};

let echecs = 0;
const dire = (ok, nom, attendu, obtenu, cause = "") => {
  if (!ok) echecs++;
  console.log(
    `${ok ? "✅" : "❌"} ${nom.padEnd(26)} attendu=${attendu} obtenu=${obtenu}  ${cause.slice(0, 84)}`,
  );
};

for (const [nom, [attendu, handler]] of Object.entries(CAS)) {
  const srv = http.createServer(handler);
  await new Promise((r) => srv.listen(Number(PORT), "127.0.0.1", r));
  const res = await run([JUGE]);
  await new Promise((r) => srv.close(r));
  const cause = (res.stderr || res.stdout).trim().split("\n")[0] ?? "";
  dire(res.status === attendu, nom, attendu, res.status, cause);
}

// ── la garde d'INSTRUMENT, dans les DEUX sens ──────────────────────────────
{
  const srv = http.createServer(app({ body: pageSignee }));
  await new Promise((r) => srv.listen(Number(PORT), "127.0.0.1", r));
  const res = await run([JUGE, "--check-port-free"]);
  await new Promise((r) => srv.close(r));
  dire(res.status === 5, "portTaken", 5, res.status, (res.stderr || "").trim());
}
{
  const res = await run([JUGE, "--check-port-free"]);
  dire(res.status === 0, "portLibre", 0, res.status);
}
{
  const res = await run([JUGE]);
  const cause = (res.stderr || "").trim().split("\n")[0] ?? "";
  dire(res.status === 4, "injoignable", 4, res.status, cause);
}

console.log(
  echecs
    ? `\n━━ ${echecs} écart(s) — le juge ne distingue PAS ce qu'il annonce`
    : `\n━━ toutes les causes distinguées, style et script séparés`,
);
process.exit(echecs ? 1 : 0);
