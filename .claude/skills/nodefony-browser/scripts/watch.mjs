/**
 * Observe une page VIVANTE : trafic WebSocket, requêtes réseau, console, et
 * arrêt sur CONDITION applicative.
 *
 * Complète `inspect.mjs`, qui photographie un instant. Celui-ci regarde ce qui
 * se PASSE — indispensable pour un framework dont le temps réel est le cœur :
 * une frame qui n'arrive pas, un canal qui pousse trop, une reconnexion en
 * boucle ne se voient sur aucune capture d'écran.
 *
 * `@usage` docker exec nodefony-browser node /app/watch.mjs /nodefony/supervision 8000
 * `@env` NF_BROWSER_BASE origine vue DEPUIS le conteneur (défaut https://host.docker.internal:5152)
 * `@env` NF_BROWSER_USER identifiant ; sans lui, aucune authentification n'est tentée
 * `@env` NF_BROWSER_PASSWORD mot de passe associé
 * `@env` NF_BROWSER_UNTIL expression JS évaluée DANS la page ; l'observation s'arrête dès qu'elle est vraie (point d'arrêt applicatif)
 * `@env` NF_BROWSER_MAXFRAMES nombre de frames WebSocket conservées par sens (défaut 12)
 * `@requires` conteneur `nodefony-browser` démarré · serveur Nodefony joignable
 * `@output` JSON : sockets et leurs frames (horodatées), requêtes non-2xx, erreurs console, verdict de la condition
 */
import { chromium } from "playwright";
import { existsSync } from "node:fs";

const BASE = process.env.NF_BROWSER_BASE ?? "https://host.docker.internal:5152";
const PAGE = process.argv[2] ?? "/nodefony";
const DURATION = Number(process.argv[3] ?? 8000);
const USER = process.env.NF_BROWSER_USER ?? "";
const PASSWORD = process.env.NF_BROWSER_PASSWORD ?? "";
const UNTIL = process.env.NF_BROWSER_UNTIL ?? "";
const MAX = Number(process.env.NF_BROWSER_MAXFRAMES ?? 12);

const browser = await chromium.launch({
  channel: "chromium",
  args: ["--no-sandbox"],
});
const STATE = "/output/.auth-state.json";
const reuse = USER && existsSync(STATE);
const ctx = await browser.newContext({
  ignoreHTTPSErrors: true,
  viewport: { width: 1440, height: 900 },
  ...(reuse ? { storageState: STATE } : {}),
});
const page = await ctx.newPage();

const t0 = Date.now();
const at = () => Date.now() - t0;

// ── Ce qu'on observe ────────────────────────────────────────────────────────
const sockets = [];
const httpErrors = [];
const consoleErrors = [];

// Les frames sont TRONQUÉES et PLAFONNÉES : un canal temps réel pousse plus vite
// qu'on ne lit, et une sortie de plusieurs mégaoctets serait illisible — donc
// inexploitable pour décider. On garde les premières de chaque sens.
page.on("websocket", (ws) => {
  const rec = { url: ws.url(), ouvertA: at(), envoyees: [], recues: [] };
  sockets.push(rec);
  ws.on("framesent", (f) => {
    if (rec.envoyees.length < MAX)
      rec.envoyees.push({ a: at(), charge: String(f.payload).slice(0, 160) });
  });
  ws.on("framereceived", (f) => {
    if (rec.recues.length < MAX)
      rec.recues.push({ a: at(), charge: String(f.payload).slice(0, 160) });
  });
  ws.on("close", () => (rec.fermeA = at()));
  ws.on("socketerror", (e) => (rec.erreur = String(e)));
});

page.on("response", (r) => {
  if (r.status() >= 400)
    httpErrors.push({
      a: at(),
      statut: r.status(),
      url: r.url().slice(0, 120),
    });
});
page.on("console", (m) => {
  if (m.type() === "error")
    consoleErrors.push({ a: at(), texte: m.text().slice(0, 200) });
});

// ── Connexion éventuelle ────────────────────────────────────────────────────
if (USER && !reuse) {
  await page.goto(`${BASE}/nodefony/login`, { waitUntil: "domcontentloaded" });
  const id = page.getByRole("textbox", { name: /identifiant|username/i });
  await id.fill(USER);
  await id.press("Enter");
  const pw = page.getByRole("textbox", { name: /mot de passe|password/i });
  await pw.fill(PASSWORD, { timeout: 15000 });
  await pw.press("Enter");
  await page.waitForURL((u) => !u.pathname.endsWith("/login"), {
    timeout: 20000,
  });
  await ctx.storageState({ path: STATE });
}

await page.goto(`${BASE}${PAGE}`, { waitUntil: "domcontentloaded" });

// ── Le « point d'arrêt » : une CONDITION, pas une ligne de code ──────────────
// `waitForFunction` réévalue l'expression dans la page à chaque animation frame.
// C'est ce qui remplace utilement un breakpoint dans un pilotage automatisé :
// on ne suspend pas l'exécution, on attend un ÉTAT — « le compteur a bougé »,
// « le socket est connecté », « la table contient 3 lignes ». Sans condition, on
// observe simplement pendant la durée demandée.
let verdict = "durée écoulée";
if (UNTIL) {
  // ⚠️ Une chaîne passée à `waitForFunction` est évaluée comme une EXPRESSION.
  // Donner « () => x » y définit une fonction sans jamais l'appeler : l'objet
  // fonction est truthy, donc l'attente réussit TOUJOURS — y compris sur une
  // condition impossible. Faux vert vécu, découvert seulement en éprouvant le
  // sens négatif. On invoque donc explicitement les formes fonction.
  const expr = /^\s*(\(|function\b|async\b)/.test(UNTIL)
    ? `(${UNTIL})()`
    : UNTIL;
  try {
    await page.waitForFunction(expr, null, { timeout: DURATION });
    verdict = `condition VRAIE après ${at()} ms`;
  } catch {
    verdict = `condition JAMAIS vraie en ${DURATION} ms — ${UNTIL}`;
  }
} else {
  await page.waitForTimeout(DURATION);
}

console.log(
  JSON.stringify(
    {
      url: page.url(),
      observePendantMs: at(),
      verdict,
      // Les totaux sont posés sur l'objet accumulé plutôt que recomposés par
      // étalement dans un `map` (règle `no-map-spread` : allocation inutile).
      sockets: sockets.map((s) =>
        Object.assign(s, {
          totalEnvoyees: s.envoyees.length,
          totalRecues: s.recues.length,
        }),
      ),
      httpErrors,
      consoleErrors,
    },
    null,
    2,
  ),
);
await browser.close();
