/**
 * Auto-contrôle du juge « développer un MCP de A à Z ».
 *
 * Une application jouet par cause : une porte conforme (référence, en flux SSE
 * comme en réponse JSON pour la lecture), puis chacune des fautes que le juge
 * annonce — absente, non MCP, outil manquant, outil faux, progression muette,
 * garde d'origine absente, porte fermée — et enfin le port tenu et
 * l'application absente. Chaque cas doit sortir sur SON code : un juge qui
 * confondrait « progression absente » et « conforme » validerait exactement la
 * porte recodée à la main que la tâche existe pour distinguer.
 *
 * Ce que ce contrôle ne prouve PAS : la forme exacte qu'émet `defineMcpGate`.
 * Elle est relevée sur une application générée réelle (`--kind mcp`), au
 * passage d'agent.
 *
 * Usage : `node lib/gate-mcp-porte.selftest.mjs`
 * Sorties : `0` toutes les causes distinguées · `1` au moins un écart.
 *
 * ⚠️ `spawnSync` proscrit : le serveur jouet vit dans CE processus.
 *
 * @module
 */
import http from "node:http";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { portLibre } from "./http-probe.mjs";
import { OUTIL_REINDEX, OUTIL_STOCK, ROUTE_MCP_APP } from "./enonces.mjs";

const JUGE = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "gate-mcp-porte.mjs",
);
const PORT = String(await portLibre());

/** Ce que la porte jouet sait faire — chaque cas en retire ou en fausse un trait. */
const NORMAL = {
  route: ROUTE_MCP_APP,
  outils: [OUTIL_STOCK, OUTIL_REINDEX],
  stockNomme: true,
  reindexEchoue: false,
  progression: true,
  garde: true,
  ferme: false,
  nonMcp: false,
};

/** Un corps JSON-RPC lu en entier. */
const lire = (req) =>
  new Promise((resolve) => {
    let b = "";
    req.on("data", (c) => (b += c));
    req.on("end", () => {
      try {
        resolve(JSON.parse(b));
      } catch {
        resolve(null);
      }
    });
  });

const json = (res, statut, corps) => {
  res.writeHead(statut, { "content-type": "application/json" });
  res.end(JSON.stringify(corps));
};

/** Une porte jouet, conforme sauf ce que `trait` retire. */
const porte = (trait) => {
  const t = { ...NORMAL, ...trait };
  const servir = async (req, res) => {
    const url = new URL(req.url ?? "/", "http://local");
    if (url.pathname !== t.route || req.method !== "POST") {
      res.writeHead(404);
      return res.end();
    }
    if (t.ferme) return json(res, 401, { error: "unauthorized" });
    if (t.garde && req.headers.origin === "https://evil.example") {
      return json(res, 403, { error: "forbidden origin" });
    }
    const m = await lire(req);
    if (t.nonMcp) return json(res, 200, { hello: "mcp" });
    if (m?.method === "tools/list") {
      return json(res, 200, {
        jsonrpc: "2.0",
        id: m.id,
        result: { tools: t.outils.map((name) => ({ name })) },
      });
    }
    const nom = m?.params?.name;
    if (nom === OUTIL_STOCK) {
      const texte = t.stockNomme
        ? `${m.params.arguments?.sku} : 12 en stock`
        : "12 en stock";
      return json(res, 200, {
        jsonrpc: "2.0",
        id: m.id,
        result: { content: [{ type: "text", text: texte }] },
      });
    }
    if (nom === OUTIL_REINDEX) {
      const result = t.reindexEchoue
        ? { content: [{ type: "text", text: "boom" }], isError: true }
        : { content: [{ type: "text", text: "3 lots" }] };
      if (!t.progression)
        return json(res, 200, { jsonrpc: "2.0", id: m.id, result });
      const jeton = m.params?._meta?.progressToken;
      res.writeHead(200, { "content-type": "text/event-stream" });
      for (let i = 1; i <= 3; i += 1) {
        res.write(
          `event: message\ndata: ${JSON.stringify({
            jsonrpc: "2.0",
            method: "notifications/progress",
            params: { progressToken: jeton, progress: i, total: 3 },
          })}\n\n`,
        );
      }
      res.write(
        `event: message\ndata: ${JSON.stringify({ jsonrpc: "2.0", id: m.id, result })}\n\n`,
      );
      return res.end();
    }
    return json(res, 200, {
      jsonrpc: "2.0",
      id: m?.id ?? null,
      error: { code: -32601 },
    });
  };
  // `createServer` attend un écouteur synchrone : une panne du jouet coupe la
  // socket, et le juge la lit comme une absence de réponse.
  return (req, res) => {
    servir(req, res).catch(() => res.destroy());
  };
};

const CAS = {
  conforme: [0, porte({})],
  absente: [1, porte({ route: "/api/autre" })],
  nonMcp: [2, porte({ nonMcp: true })],
  outilAbsent: [3, porte({ outils: [OUTIL_STOCK] })],
  stockMuet: [6, porte({ stockNomme: false })],
  reindexEchoue: [6, porte({ reindexEchoue: true })],
  sansProgression: [7, porte({ progression: false })],
  sansGarde: [8, porte({ garde: false })],
  fermee: [9, porte({ ferme: true })],
};

const run = (args) =>
  new Promise((resolve) => {
    const p = spawn("node", args, { env: { ...process.env, NF_PORT: PORT } });
    let out = "";
    let err = "";
    p.stdout.on("data", (c) => (out += c));
    p.stderr.on("data", (c) => (err += c));
    p.on("close", (status) => resolve({ status, stdout: out, stderr: err }));
  });

let echecs = 0;
const dire = (ok, nom, attendu, obtenu, cause = "") => {
  if (!ok) echecs++;
  console.log(
    `${ok ? "✅" : "❌"} ${nom.padEnd(16)} attendu=${attendu} obtenu=${obtenu}  ${cause.slice(0, 90)}`,
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
{
  const srv = http.createServer(CAS.conforme[1]);
  await new Promise((r) => srv.listen(Number(PORT), "127.0.0.1", r));
  const res = await run([JUGE, "--check-port-free"]);
  await new Promise((r) => srv.close(r));
  dire(res.status === 5, "portTaken", 5, res.status, (res.stderr || "").trim());
}
{
  const res = await run([JUGE]);
  const cause = (res.stderr || "").trim().split("\n")[0] ?? "";
  dire(res.status === 4, "injoignable", 4, res.status, cause);
}

console.log(
  echecs
    ? `\n━━ ${echecs} écart(s) — le juge ne distingue PAS ce qu'il annonce`
    : `\n━━ toutes les causes distinguées, décor et agent séparés`,
);
process.exit(echecs ? 1 : 0);
