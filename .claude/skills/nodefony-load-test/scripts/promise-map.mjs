#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// Carte des Promises d'UNE requête — OÙ chacune naît, pile par pile.
//
// Pilote de `promise-sites.mjs` : démarre une application de secours en
// `production` (ports à part, le serveur de dev peut tourner), précharge la
// sonde par `--import`, chauffe la route, puis n'enregistre QUE la requête
// mesurée. Le compte rendu est celui de la garde `promise-budget.test.ts`
// (Promises + suspensions `await`) ; celle-ci dit COMBIEN, ce script dit OÙ.
//
// Usage :
//   node promise-map.mjs [url] [--method POST] [--body '{"a":1}'] [KEY=VAL …]
//     url     défaut http://127.0.0.1:5397/nodefony/kernel/bench
//     KEY=VAL variables passées à l'application (ex. NF_BENCH_ORM=1
//             NF_WITH_DEV_MODULES=1 pour une route du module test)
//   Exemple — la route ORM postée :
//     node promise-map.mjs http://127.0.0.1:5397/nodefony/test/bench-orm/read-write-body \
//       --method POST --body '{"total_ht":200,"total_ttc":240}' \
//       NF_BENCH_ORM=1 NF_WITH_DEV_MODULES=1
//
// Lancé depuis la racine du dépôt (le `root` de l'application de secours).
// ─────────────────────────────────────────────────────────────────────────────
import path from "node:path";
import { pathToFileURL } from "node:url";
import { startSpareApp } from "nodefony/testing";

const PORT = 5397;
const HTTPS_PORT = 5396;
const COUNTER_PORT = 5398;

const args = process.argv.slice(2);
let target = `http://127.0.0.1:${PORT}/nodefony/kernel/bench`;
let method = "GET";
let body;
const extraEnv = {};
for (let i = 0; i < args.length; i++) {
  const arg = args[i];
  if (arg === "--method") method = args[++i].toUpperCase();
  else if (arg === "--body") body = args[++i];
  else if (/^[A-Z_][A-Z0-9_]*=/.test(arg)) {
    const eq = arg.indexOf("=");
    extraEnv[arg.slice(0, eq)] = arg.slice(eq + 1);
  } else target = arg;
}

const root = process.cwd();
// `import()`/`--import` prennent une URL, jamais un chemin (Windows : `D:\…`).
const sites = pathToFileURL(
  path.join(
    root,
    ".claude/skills/nodefony-load-test/scripts/promise-sites.mjs",
  ),
).href;

const init = {
  method,
  ...(body === undefined
    ? {}
    : { body, headers: { "content-type": "application/json" } }),
};

const app = await startSpareApp({
  port: PORT,
  httpsPort: HTTPS_PORT,
  root,
  env: {
    NODE_ENV: "production",
    NF_LOG_DRIVER: "null",
    NF_BENCH_ROUTE: "1",
    NF_PROMISE_COUNTER_PORT: String(COUNTER_PORT),
    ...extraEnv,
    NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ""} --import=${sites}`.trim(),
  },
});
try {
  // Chauffe : les Promises d'initialisation paresseuse (premier appel d'un
  // service, compilation d'une requête préparée) ne sont pas celles d'UNE requête.
  for (let i = 0; i < 50; i++) await (await fetch(target, init)).arrayBuffer();
  await (await fetch(`http://127.0.0.1:${COUNTER_PORT}/start`)).text();
  const response = await fetch(target, init);
  await response.arrayBuffer();
  const stacks = await (
    await fetch(`http://127.0.0.1:${COUNTER_PORT}/stop`)
  ).json();
  // Un statut inattendu rend la carte d'une AUTRE route (404, 403 CSRF…) :
  // la dire avant la carte, et sortir en erreur.
  console.log(
    `${method} ${target} → ${response.status} — ${stacks.length} créations`,
  );
  stacks.forEach((stack, i) =>
    console.log(`#${i + 1}\n   ` + stack.join("\n   ")),
  );
  if (response.status >= 400) process.exitCode = 1;
} finally {
  await app.stop();
}
