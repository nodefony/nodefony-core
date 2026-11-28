/**
 * Micro-banc A/B — ce que coûte le pair JSON-RPC (`JsonRpcPeer`) PAR APPEL,
 * entre deux arbres de sources du cœur (avant / après un diff du pair).
 *
 * Chaque arbre est BUNDLÉ par rolldown (le bundler du dépôt, minifié) : on
 * mesure ce qui s'exécute, pas les sources. Deux pairs reliés en mémoire, sans
 * transport ni codec : seul le moteur protocole est sur la balance.
 *
 * Chemins :
 * - `req-res`     : `request` → requête reçue → handler `register` → réponse
 *                   reçue → promesse tenue (les DEUX côtés d'un aller-retour) ;
 * - `notify-in`   : notification entrante → `onNotification` (le chemin d'une
 *                   frame de canal, le plus fréquent) ;
 * - `req-res-opts`: `request` avec `{ timeoutMs }` (forme longue du 3ᵉ argument) ;
 * - `req-res-call`: le même aller-retour servi par `registerCall` ;
 * - `req-res-signal` : `request` avec un `signal` neuf par appel (contrôleur
 *                   compris ; écouteur posé puis retiré).
 * Les trois derniers ne courent que sur un arbre qui les porte (capacité
 * constatée à l'exécution) — sinon « — ».
 *
 * Protocole : un PROCESS par mesure (JIT frais), variantes ALTERNÉES, médiane de
 * RUNS. Validité : chaque promesse doit être tenue avec la bonne valeur, chaque
 * notification vue — sinon exit 1, aucun chiffre publié.
 *
 * @usage node .claude/skills/nodefony-load-test/scripts/micro/micro-jsonrpc-peer-ab.mjs --a <src avant> --b <src après> [--runs 7]
 * @option --a dossier `src/nodefony/src` de référence (`git archive HEAD src/nodefony/src | tar -x -C …`)
 * @option --b dossier `src/nodefony/src` mesuré (l'arbre de travail)
 * @option --runs nombre de process par variante et par chemin (défaut 7)
 * @output tableau ns/appel A, B, écart %, étendue de B ; bundles sous tmp/bench/
 */
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const WARM = 20_000;
const N = 200_000;
const BATCH = 1000;
const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../../..",
);

const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(name);
  return i === -1 ? def : args[i + 1];
};

if (args[0] === "--child") {
  await child(args[1], args[2]);
} else {
  await parent();
}

/** Bundle le pair d'un arbre de sources → un module ESM. */
async function bundle(src, out) {
  const { rolldown } = await import(
    pathToFileURL(path.join(ROOT, "node_modules/rolldown/dist/index.mjs")).href
  );
  const entry = path.join(
    path.dirname(out),
    `${path.basename(out, ".mjs")}-entry.ts`,
  );
  fs.writeFileSync(
    entry,
    `export { JsonRpcPeer } from ${JSON.stringify(path.join(src, "realtime/JsonRpcPeer.ts"))};\n`,
  );
  const b = await rolldown({
    input: entry,
    platform: "neutral",
    onLog: () => {},
  });
  await b.write({
    file: out,
    format: "esm",
    minify: true,
    codeSplitting: false,
  });
  await b.close();
  fs.rmSync(entry);
}

/** Mesure UN chemin dans ce process ; imprime `{ ns }` (ou `{ ns: null }` si absent). */
async function child(file, which) {
  const { JsonRpcPeer } = await import(pathToFileURL(file).href);
  const toServer = [];
  const toClient = [];
  const client = new JsonRpcPeer({ send: (f) => void toServer.push(f) });
  let seen = 0;
  const server = new JsonRpcPeer({
    send: (f) => void toClient.push(f),
    onNotification: () => {
      seen++;
    },
  });
  const supportsCall = typeof server.registerCall === "function";
  const needsNew =
    which === "req-res-call" ||
    which === "req-res-signal" ||
    which === "req-res-opts";
  if (needsNew && !supportsCall) {
    console.log(JSON.stringify({ ns: null }));
    return;
  }
  if (which === "req-res-call") server.registerCall("work", (p) => p.n + 1);
  else server.register("work", (p) => p.n + 1);
  // Un signal PAR requête, comme un appelant réel : un signal partagé par mille
  // requêtes en vol mesurerait la recherche de doublons d'EventTarget (O(n)).
  const options = () =>
    which === "req-res-signal"
      ? { signal: new AbortController().signal }
      : which === "req-res-opts"
        ? { timeoutMs: 30000 }
        : undefined;

  const note = { jsonrpc: "2.0", method: "chan", params: { v: 1 } };

  async function roundTrips(count) {
    for (let done = 0; done < count; done += BATCH) {
      const ps = new Array(BATCH);
      for (let i = 0; i < BATCH; i++)
        ps[i] = client.request("work", { n: i }, options());
      for (let i = 0; i < toServer.length; i++) server.receive(toServer[i]);
      toServer.length = 0;
      // Les handlers répondent dans une microtâche : on les laisse partir.
      await new Promise((r) => setImmediate(r));
      for (let i = 0; i < toClient.length; i++) client.receive(toClient[i]);
      toClient.length = 0;
      const rs = await Promise.all(ps);
      for (let i = 0; i < BATCH; i++) {
        if (rs[i] !== i + 1) throw new Error(`réponse fausse : ${rs[i]}`);
      }
    }
  }

  function notifies(count) {
    for (let i = 0; i < count; i++) server.receive(note);
  }

  let ns;
  if (which === "notify-in") {
    notifies(WARM);
    seen = 0;
    const t0 = process.hrtime.bigint();
    notifies(N);
    ns = Number(process.hrtime.bigint() - t0) / N;
    if (seen !== N) throw new Error(`notifications vues ${seen}/${N}`);
  } else {
    await roundTrips(WARM);
    const t0 = process.hrtime.bigint();
    await roundTrips(N);
    ns = Number(process.hrtime.bigint() - t0) / N;
  }
  console.log(JSON.stringify({ ns }));
}

async function parent() {
  const a = opt("--a");
  const b = opt("--b");
  const runs = Number(opt("--runs", "7"));
  if (!a || !b) {
    console.error("usage : --a <src avant> --b <src après> [--runs 7]");
    process.exit(2);
  }
  const dir = path.join(ROOT, "tmp/bench");
  fs.mkdirSync(dir, { recursive: true });
  const bundleA = path.join(dir, "jsonrpc-peer-a.mjs");
  const bundleB = path.join(dir, "jsonrpc-peer-b.mjs");
  await bundle(path.resolve(a), bundleA);
  await bundle(path.resolve(b), bundleB);
  const self = fileURLToPath(import.meta.url);
  const measure = (file, which) => {
    const r = spawnSync(process.execPath, [self, "--child", file, which], {
      encoding: "utf8",
    });
    if (r.status !== 0) {
      console.error(r.stderr || r.stdout);
      process.exit(1);
    }
    return JSON.parse(r.stdout.trim().split("\n").pop()).ns;
  };
  const median = (xs) =>
    [...xs].sort((x, y) => x - y)[Math.floor(xs.length / 2)];
  const rows = [];
  for (const which of [
    "req-res",
    "notify-in",
    "req-res-opts",
    "req-res-call",
    "req-res-signal",
  ]) {
    const A = [];
    const B = [];
    for (let i = 0; i < runs; i++) {
      const na = measure(bundleA, which);
      const nb = measure(bundleB, which);
      if (na !== null) A.push(na);
      if (nb !== null) B.push(nb);
    }
    const ma = A.length ? median(A) : NaN;
    const mb = B.length ? median(B) : NaN;
    rows.push({
      chemin: which,
      "A ns/appel": A.length ? ma.toFixed(1) : "—",
      "B ns/appel": B.length ? mb.toFixed(1) : "—",
      "écart %":
        A.length && B.length ? (((mb - ma) / ma) * 100).toFixed(1) : "—",
      "A min–max": A.length
        ? `${Math.min(...A).toFixed(0)}–${Math.max(...A).toFixed(0)}`
        : "—",
      "B min–max": B.length
        ? `${Math.min(...B).toFixed(0)}–${Math.max(...B).toFixed(0)}`
        : "—",
    });
  }
  console.table(rows);
}
