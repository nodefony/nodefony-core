/**
 * Observe une page VIVANTE : trafic WebSocket, requêtes réseau, console, et
 * arrêt sur CONDITION applicative.
 *
 * Complète `inspect.mjs`, qui photographie un instant. Celui-ci regarde ce qui
 * se PASSE — indispensable pour un framework dont le temps réel est le cœur :
 * une frame qui n'arrive pas, un canal qui pousse trop, une reconnexion en
 * boucle ne se voient sur aucune capture d'écran.
 *
 * `@usage` docker exec <app>-browser node /app/watch.mjs /tableau-de-bord 8000
 * `@env` NF_BROWSER_BASE origine vue DEPUIS le conteneur (défaut https://host.docker.internal:5152)
 * `@env` NF_BROWSER_LOGIN chemin du formulaire de connexion de TON application — requis dès qu'un identifiant est donné, aucun défaut n'est deviné
 * `@env` NF_BROWSER_USER identifiant ; sans lui, aucune authentification n'est tentée
 * `@env` NF_BROWSER_PASSWORD mot de passe associé
 * `@env` NF_BROWSER_UNTIL expression JS évaluée DANS la page ; l'observation s'arrête dès qu'elle est vraie (point d'arrêt applicatif)
 * `@env` NF_BROWSER_CUT coupure réseau `<début>:<durée>` en ms (`4000:3000`), comptée depuis l'ouverture de la page — éprouve la REPRISE d'un flux ; chaque socket dit alors quand il s'est fermé et rouvert
 * `@env` NF_BROWSER_MAXFRAMES nombre de frames WebSocket conservées par sens (défaut 12)
 * `@requires` conteneur du profil `browser` démarré · serveur Nodefony joignable
 * `@output` JSON : sockets et leurs frames (horodatées), requêtes non-2xx, erreurs console, verdict de la condition
 */
import { open, goTo } from "./lib/browser.mjs";
import { parseCut, sendableCloseCode } from "./lib/probes.mjs";

const PAGE = process.argv[2] ?? process.env.NF_BROWSER_PAGE ?? "/";
const DURATION = Number(process.argv[3] ?? 8000);
const UNTIL = process.env.NF_BROWSER_UNTIL ?? "";
const MAX = Number(process.env.NF_BROWSER_MAXFRAMES ?? 12);
const { cut: CUT, invalid: invalidCut } = parseCut(process.env.NF_BROWSER_CUT);
if (invalidCut) {
  console.error(
    `NF_BROWSER_CUT attend « <début>:<durée> » en ms (ex. 4000:3000), reçu « ${invalidCut} »`,
  );
  process.exit(64);
}
// Sockets que la coupure FERME (cf « La coupure réseau » plus bas).
const isRouted = (url) => !new URL(url).pathname.startsWith("/_vite/");

const { browser, ctx, page, reuse } = await open();

const t0 = Date.now();
const at = () => Date.now() - t0;

// ── Ce qu'on observe ────────────────────────────────────────────────────────
const sockets = [];
const httpErrors = [];
const consoleErrors = [];
const uncaughtErrors = [];

// Les frames sont TRONQUÉES et PLAFONNÉES : un canal temps réel pousse plus vite
// qu'on ne lit, et une sortie de plusieurs mégaoctets serait illisible — donc
// inexploitable pour décider. On garde les premières de chaque sens.
page.on("websocket", (ws) => {
  // Un socket routé pour la coupure est enregistré par la route : l'écouter
  // ici aussi le compterait deux fois.
  if (CUT && isRouted(ws.url())) return;
  const rec = { url: ws.url(), openedAt: at(), sent: [], received: [] };
  sockets.push(rec);
  ws.on("framesent", (f) => {
    if (rec.sent.length < MAX)
      rec.sent.push({ a: at(), payload: String(f.payload).slice(0, 160) });
  });
  ws.on("framereceived", (f) => {
    if (rec.received.length < MAX)
      rec.received.push({ a: at(), payload: String(f.payload).slice(0, 160) });
  });
  ws.on("close", () => (rec.closedAt = at()));
  ws.on("socketerror", (e) => (rec.error = String(e)));
});

page.on("response", (r) => {
  if (r.status() >= 400)
    httpErrors.push({
      a: at(),
      status: r.status(),
      url: r.url().slice(0, 120),
    });
});
page.on("console", (m) => {
  if (m.type() === "error")
    consoleErrors.push({ a: at(), text: m.text().slice(0, 200) });
});
// `pageerror` en plus de la console : une exception non capturée qui tue
// l'application ne passe pas toujours par console.error.
page.on("pageerror", (e) => {
  if (uncaughtErrors.length < 20)
    uncaughtErrors.push({ a: at(), text: String(e).slice(0, 200) });
});

// ── La coupure réseau : éprouver une REPRISE ────────────────────────────────
// `setOffline` seul ne suffit PAS : Chromium y coupe le HTTP mais laisse les
// WebSockets déjà ouverts vivre — mesuré, aucun `close` n'est émis, et l'on
// « éprouverait » une reprise sans qu'aucune connexion ait été perdue. Les
// sockets passent donc par `routeWebSocket` : à la coupure, la sonde ferme
// chaque connexion des deux côtés — 1006 vers la page, ce que voit un client
// qui perd le réseau ; 1000 vers le serveur, qui libère la connexion au lieu de
// la garder à demi ouverte — et refuse toute réouverture jusqu'au
// rétablissement.
// Le relais Vite (`/_vite/`) est épargné : son client de rechargement à chaud
// RECHARGE la page quand il retrouve le serveur, et la reprise observée serait
// celle d'une page neuve, pas celle de l'application.
let cut = null;
let cutActive = false;
const cutTimers = [];
const routed = new Set();
// Le côté SERVEUR d'une route est un vrai WebSocket de navigateur : son code
// de fermeture passe par `sendableCloseCode` (cf son TSDoc).
if (CUT) {
  cut = { requested: CUT, refused: 0 };
  await ctx.routeWebSocket(isRouted, (route) => {
    if (cutActive) {
      cut.refused += 1;
      route.close({ code: 1006, reason: "coupure réseau (sonde)" });
      return;
    }
    const server = route.connectToServer();
    const rec = { url: route.url(), openedAt: at(), sent: [], received: [] };
    sockets.push(rec);
    const pair = { route, server, rec };
    routed.add(pair);
    // Poser `onMessage` coupe le relais automatique : on relaie à la main.
    route.onMessage((m) => {
      if (rec.sent.length < MAX)
        rec.sent.push({ a: at(), payload: String(m).slice(0, 160) });
      server.send(m);
    });
    server.onMessage((m) => {
      if (rec.received.length < MAX)
        rec.received.push({ a: at(), payload: String(m).slice(0, 160) });
      route.send(m);
    });
    const closed = (code) => {
      rec.closedAt ??= at();
      rec.closeCode ??= code;
      routed.delete(pair);
    };
    route.onClose((code, reason) => {
      closed(code);
      server.close({ code: sendableCloseCode(code), reason });
    });
    server.onClose((code, reason) => {
      closed(code);
      route.close({ code, reason });
    });
  });
}

await goTo(page, ctx, PAGE, reuse);

if (CUT) {
  cutTimers.push(
    setTimeout(() => {
      cut.offlineAt = at();
      cutActive = true;
      ctx.setOffline(true).catch((e) => (cut.error = String(e)));
      for (const { route, server, rec } of routed) {
        rec.closedAt ??= at();
        rec.closeCode ??= 1006;
        server.close({ code: 1000, reason: "coupure réseau (sonde)" });
        route.close({ code: 1006, reason: "coupure réseau (sonde)" });
      }
      routed.clear();
    }, CUT.at),
    setTimeout(() => {
      cut.onlineAt = at();
      cutActive = false;
      ctx.setOffline(false).catch((e) => (cut.error = String(e)));
    }, CUT.at + CUT.duration),
  );
}

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

for (const t of cutTimers) clearTimeout(t);
if (cut && cut.onlineAt === undefined) {
  cutActive = false;
  await ctx.setOffline(false);
}

console.log(
  JSON.stringify(
    {
      url: page.url(),
      observeForMs: at(),
      verdict,
      cut,
      // Les totaux sont posés sur l'objet accumulé plutôt que recomposés par
      // étalement dans un `map` (règle `no-map-spread` : allocation inutile).
      sockets: sockets.map((s) =>
        Object.assign(s, {
          totalSent: s.sent.length,
          totalReceived: s.received.length,
        }),
      ),
      httpErrors,
      consoleErrors,
      uncaughtErrors,
    },
    null,
    2,
  ),
);
await browser.close();
