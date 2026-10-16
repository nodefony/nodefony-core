#!/usr/bin/env node
/**
 * Juge de la tâche « développer un MCP de A à Z » — l'application ouvre-t-elle
 * SA porte MCP, avec les deux outils demandés, et une opération longue qui
 * signale son avancement ?
 *
 * Le juge parle le protocole comme un client réel : `POST <route>` en JSON-RPC,
 * `Accept: application/json, text/event-stream`, depuis la machine, sans jeton.
 * Il ne lit AUCUN fichier : ce qu'un agent appellera est ce qui répond.
 *
 * Trois faits qu'une porte écrite à la main rate presque toujours, et qu'une
 * porte `defineMcpGate` tient d'office — c'est ce qui les rend discriminants :
 *  • le catalogue et l'appel suivent la forme JSON-RPC (`result.tools`,
 *    `result.content`) ;
 *  • l'opération longue envoie `notifications/progress` sur le flux SSE quand
 *    l'appelant fournit un `progressToken` ;
 *  • une page web (`Origin` étranger) est refusée en `403` — la garde du DNS
 *    rebinding. Servie, elle signe un protocole recodé à la main.
 *
 * | code | cause                  | qui est en tort                                      |
 * | ---: | ---------------------- | ---------------------------------------------------- |
 * |  `0` | conforme               | —                                                    |
 * |  `1` | porte-absente          | l'AGENT — `404` à l'adresse demandée                 |
 * |  `2` | porte-non-mcp          | l'AGENT — une réponse, mais pas un catalogue MCP     |
 * |  `3` | outil-absent           | l'AGENT — un des deux outils n'est pas publié        |
 * |  `4` | aucune-reponse         | INDÉTERMINÉ — l'application ne répond pas            |
 * |  `5` | port-deja-tenu         | le DÉCOR — serveur étranger                          |
 * |  `6` | outil-faux             | l'AGENT — l'appel échoue, ou ne rend pas le demandé  |
 * |  `7` | progression-absente    | l'AGENT — aucun `notifications/progress` sur le flux |
 * |  `8` | garde-origine-absente  | l'AGENT — une page web étrangère est servie          |
 * |  `9` | porte-fermee           | l'AGENT — `401`/`403` à un appel local sans jeton    |
 *
 * @module
 */
import { CookieJar, request, ensurePortFree, exit } from "./http-probe.mjs";
import {
  LOTS_REINDEX,
  OUTIL_REINDEX,
  OUTIL_STOCK,
  ROUTE_MCP_APP,
  SKU_TEMOIN,
} from "./enonces.mjs";

await ensurePortFree();

/** Un message JSON-RPC posté à la porte — en-têtes d'un client MCP réel. */
const poster = (message, extra = {}) =>
  request("POST", ROUTE_MCP_APP, new CookieJar(), {
    body: message,
    headers: { accept: "application/json, text/event-stream", ...extra },
  });

/**
 * Les messages JSON-RPC d'une réponse : le corps JSON, ou chaque `data:` d'un
 * flux SSE. Un message illisible est ignoré — le verdict se prend sur ce qui
 * se lit, pas sur ce qui casse le juge.
 */
const messages = (r) => {
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
      if (m && typeof m === "object") lus.push(m);
    } catch {
      // illisible : ignoré
    }
  }
  return lus;
};

/** La réponse finale (celle qui porte `id`) d'une requête JSON-RPC. */
const finale = (r, id) => messages(r).find((m) => m.id === id) ?? null;

// ── 1. Le catalogue ─────────────────────────────────────────────────────────
const liste = await poster({ jsonrpc: "2.0", id: 1, method: "tools/list" });
if (liste.error) exit(4, `CAUSE=aucune-reponse — ${liste.error}`);
if (liste.status === 404) {
  exit(
    1,
    `CAUSE=porte-absente — POST ${ROUTE_MCP_APP} rend 404 : aucune porte MCP à ` +
      "l'adresse demandée.",
  );
}
if (liste.status === 401 || liste.status === 403) {
  exit(
    9,
    `CAUSE=porte-fermee — POST ${ROUTE_MCP_APP} rend ${liste.status} à un appel ` +
      `LOCAL sans jeton : la porte demandée s'appelle depuis cette machine. ` +
      liste.body.slice(0, 160),
  );
}
const catalogue = finale(liste, 1);
const outils = catalogue?.result?.tools;
if (liste.status !== 200 || !Array.isArray(outils)) {
  exit(
    2,
    `CAUSE=porte-non-mcp — POST ${ROUTE_MCP_APP} (tools/list) rend ${liste.status} ` +
      `sans catalogue JSON-RPC (result.tools) : ${liste.body.slice(0, 160)}`,
  );
}
const noms = outils.map((o) => o?.name);
const manquants = [OUTIL_STOCK, OUTIL_REINDEX].filter((n) => !noms.includes(n));
if (manquants.length > 0) {
  exit(
    3,
    `CAUSE=outil-absent — ${manquants.join(", ")} absent(s) du catalogue ` +
      `(publiés : ${noms.join(", ") || "aucun"}).`,
  );
}

// ── 2. La lecture courte ────────────────────────────────────────────────────
const stock = await poster({
  jsonrpc: "2.0",
  id: 2,
  method: "tools/call",
  params: { name: OUTIL_STOCK, arguments: { sku: SKU_TEMOIN } },
});
if (stock.error) exit(4, `CAUSE=aucune-reponse — ${stock.error}`);
const lu = finale(stock, 2)?.result;
if (
  !lu ||
  lu.isError === true ||
  !JSON.stringify(lu.content ?? lu).includes(SKU_TEMOIN)
) {
  exit(
    6,
    `CAUSE=outil-faux — ${OUTIL_STOCK} { sku: "${SKU_TEMOIN}" } ne rend pas le stock ` +
      `de ce sku (résultat en erreur, ou qui ne le nomme pas) : ${stock.body.slice(0, 200)}`,
  );
}

// ── 3. L'opération longue, avec un jeton de progression ─────────────────────
const JETON = "banc-reindex";
const reindex = await poster({
  jsonrpc: "2.0",
  id: 3,
  method: "tools/call",
  params: {
    name: OUTIL_REINDEX,
    arguments: {},
    _meta: { progressToken: JETON },
  },
});
if (reindex.error) exit(4, `CAUSE=aucune-reponse — ${reindex.error}`);
const fin = finale(reindex, 3)?.result;
if (!fin || fin.isError === true) {
  exit(
    6,
    `CAUSE=outil-faux — ${OUTIL_REINDEX} échoue ou ne rend pas de résultat : ` +
      reindex.body.slice(0, 200),
  );
}
// Au moins UNE notification liée au jeton : la cadence est bornée par la
// porte (deux lots rapprochés peuvent n'en faire qu'une), le nombre exact ne
// se juge donc pas. Zéro, en revanche, c'est un avancement que l'agent ne voit
// jamais.
const avancement = messages(reindex).filter(
  (m) =>
    m.method === "notifications/progress" && m.params?.progressToken === JETON,
);
if (avancement.length === 0) {
  exit(
    7,
    `CAUSE=progression-absente — ${OUTIL_REINDEX} (${LOTS_REINDEX} lots) n'envoie aucun ` +
      `notifications/progress avec progressToken (réponse ` +
      `${reindex.headers?.["content-type"] ?? "?"}) : ${reindex.body.slice(0, 160)}`,
  );
}

// ── 4. La garde d'origine ───────────────────────────────────────────────────
const page = await poster(
  { jsonrpc: "2.0", id: 4, method: "tools/list" },
  { origin: "https://evil.example" },
);
if (page.error) exit(4, `CAUSE=aucune-reponse — ${page.error}`);
if (page.status !== 403) {
  exit(
    8,
    `CAUSE=garde-origine-absente — une page web étrangère (Origin: https://evil.example) ` +
      `reçoit ${page.status} au lieu de 403 : le protocole a été recodé sans sa garde.`,
  );
}

console.log(
  `ok — ${ROUTE_MCP_APP} : ${OUTIL_STOCK} rend le stock de ${SKU_TEMOIN}, ` +
    `${OUTIL_REINDEX} signale ${avancement.length} avancement(s), page étrangère refusée`,
);
process.exit(0);
