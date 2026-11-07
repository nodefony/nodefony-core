#!/usr/bin/env node
/**
 * bench-bases.mjs — compare les images de base d'une application Nodefony : poids, failles, Node embarqué, démarrage.
 *
 * Le `Dockerfile` que `create app` rend tient sa base en deux lignes `FROM`.
 * Ce banc les remplace pour chaque candidate, CONSTRUIT l'image d'une vraie
 * application `complete`, la scanne (`docker scout quickview`), puis la
 * DÉMARRE : `GET /livez`, `GET /`, et un arrêt dont le code doit valoir 0.
 * « Ça construit » ne prouve rien — c'est le démarrage qui a trouvé #419.
 *
 * Les bases sont tirées fraîches (`--pull`) : la version de Node relevée dit
 * aussi si une distribution s'est mise à jour depuis le dernier banc.
 *
 * Variante distroless — trois écarts au gabarit, et seulement trois : pas de
 * shell, donc les dossiers `tmp/` et `var/` naissent dans un étage
 * intermédiaire et se copient en `--chown` ; `node` n'est pas sur le PATH,
 * donc la sonde appelle `/nodejs/bin/node` ; le `CMD` reste tel quel, parce
 * que l'`ENTRYPOINT` de l'image est déjà `/nodejs/bin/node`. Chaque
 * substitution est VÉRIFIÉE : un gabarit qui a bougé arrête le banc au lieu de
 * mesurer l'image d'origine sous un autre nom.
 *
 *   node .claude/skills/nodefony-devops/scripts/bench-bases.mjs
 *   node .claude/skills/nodefony-devops/scripts/bench-bases.mjs --bases alpine,distroless13 --keep
 *
 * @usage node .claude/skills/nodefony-devops/scripts/bench-bases.mjs [--app <dossier>] [--bases <liste>] [--keep] [--json <fichier>]
 */
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
  "..",
);

/** Les candidates : base de l'étage de construction, base de l'étage d'exécution. */
const BASES = {
  alpine: { build: "node:24-alpine", run: "node:24-alpine", distroless: false },
  slim: { build: "node:24-slim", run: "node:24-slim", distroless: false },
  distroless12: {
    build: "node:24-slim",
    run: "gcr.io/distroless/nodejs24-debian12",
    distroless: true,
  },
  distroless13: {
    build: "node:24-slim",
    run: "gcr.io/distroless/nodejs24-debian13",
    distroless: true,
  },
};

function parseArgs(argv) {
  const opts = {
    app: null,
    bases: Object.keys(BASES),
    keep: false,
    json: null,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--app") opts.app = path.resolve(argv[++i]);
    else if (a === "--bases") opts.bases = argv[++i].split(",");
    else if (a === "--keep") opts.keep = true;
    else if (a === "--json") opts.json = path.resolve(argv[++i]);
    else throw new Error(`option inconnue : ${a}`);
  }
  const unknown = opts.bases.find((b) => !(b in BASES));
  if (unknown)
    throw new Error(
      `base inconnue : ${unknown} (connues : ${Object.keys(BASES).join(", ")})`,
    );
  return opts;
}

/** Lance une commande ; rend sa sortie, lève avec la sortie d'erreur. */
function run(cmd, args, options = {}) {
  return execFileSync(cmd, args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    ...options,
  });
}

/**
 * Remplace une occurrence UNIQUE, ou lève : une substitution qui ne mord pas
 * ferait mesurer l'image d'origine sous le nom d'une autre.
 */
function swap(text, from, to, label) {
  const count = text.split(from).length - 1;
  if (count !== 1)
    throw new Error(
      `Dockerfile : « ${label} » trouvé ${count} fois (attendu 1) — le gabarit a bougé`,
    );
  return text.replace(from, to);
}

/**
 * Rend le Dockerfile d'une candidate depuis celui de l'application.
 *
 * @param source - Dockerfile rendu par `create app`.
 * @param base - candidate de {@link BASES}.
 * @returns le Dockerfile de la candidate.
 */
export function variantDockerfile(source, base) {
  let out = swap(
    source,
    "\nFROM node:24-alpine AS build\n",
    `\nFROM ${base.build} AS build\n`,
    "FROM … AS build",
  );
  if (!base.distroless) {
    return swap(
      out,
      "\nFROM node:24-alpine\n",
      `\nFROM ${base.run}\n`,
      "FROM d'exécution",
    );
  }
  out = swap(
    out,
    "\nFROM node:24-alpine\n",
    `\nFROM ${base.build} AS nf-dirs\nRUN mkdir -p /out/tmp /out/var\n\nFROM ${base.run}\n`,
    "FROM d'exécution",
  );
  out = swap(
    out,
    "RUN mkdir -p /app/tmp /app/var \\\n && chown 1000:1000 /app/tmp /app/var\n",
    "COPY --from=nf-dirs --chown=1000:1000 /out/ /app/\n",
    "RUN mkdir/chown",
  );
  return swap(
    out,
    'CMD ["node", "-e",',
    'CMD ["/nodejs/bin/node", "-e",',
    "HEALTHCHECK node",
  );
}

/** Compte des failles par sévérité, lu sur la ligne « Target » de `docker scout quickview`. */
function scout(image) {
  const res = spawnSync("docker", ["scout", "quickview", `local://${image}`], {
    encoding: "utf8",
  });
  const text = `${res.stdout}\n${res.stderr}`;
  const m = /Target[^\n]*?(\d+)C\s+(\d+)H\s+(\d+)M\s+(\d+)L/.exec(text);
  if (!m) {
    // Sans connexion Docker Hub, scout ne scanne rien et le dit en une ligne
    // noyée : le banc le NOMME, une colonne vide se lirait comme « 0 faille ».
    if (/log in/i.test(text))
      return {
        error: "docker scout exige une connexion — lancer « docker login »",
      };
    return {
      error: (text.trim().split("\n").at(-1) ?? "sortie illisible").slice(
        0,
        120,
      ),
    };
  }
  return { critical: +m[1], high: +m[2], medium: +m[3], low: +m[4] };
}

async function probe(url) {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(2000) });
    return r.status;
  } catch {
    return null;
  }
}

/** Démarre l'image, attend `/livez`, lit `GET /`, puis l'arrête et lit son code. */
async function boot(image, name, port, envFile) {
  spawnSync("docker", ["rm", "-f", name], { stdio: "ignore" });
  const t0 = Date.now();
  run("docker", [
    "run",
    "-d",
    "--name",
    name,
    "-p",
    `${port}:5151`,
    "--env-file",
    envFile,
    image,
  ]);
  let livez = null;
  while (Date.now() - t0 < 90_000) {
    livez = await probe(`http://127.0.0.1:${port}/livez`);
    if (livez === 200) break;
    const state = run("docker", [
      "inspect",
      "-f",
      "{{.State.Status}}",
      name,
    ]).trim();
    if (state !== "running") break;
    await new Promise((r) => setTimeout(r, 500));
  }
  const bootMs = livez === 200 ? Date.now() - t0 : null;
  const home = livez === 200 ? await probe(`http://127.0.0.1:${port}/`) : null;
  spawnSync("docker", ["stop", "-t", "20", name], { stdio: "ignore" });
  const exitCode = Number(
    run("docker", ["inspect", "-f", "{{.State.ExitCode}}", name]).trim(),
  );
  const logs =
    livez === 200
      ? ""
      : spawnSync("docker", ["logs", "--tail", "15", name], {
          encoding: "utf8",
        }).stderr;
  spawnSync("docker", ["rm", "-f", name], { stdio: "ignore" });
  return { livez, home, bootMs, exitCode, logs };
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const stamp = new Date().toISOString().slice(0, 10);
  let app = opts.app;
  let created = false;
  if (!app) {
    const parent = path.join(ROOT, "tmp", "apps");
    mkdirSync(parent, { recursive: true });
    app = path.join(parent, `bench-bases-${process.pid}`);
    console.log(
      `▸ application complete → ${path.relative(ROOT, app)} (installation réelle depuis npm)`,
    );
    run(
      process.execPath,
      [
        path.join(ROOT, "src", "nodefony", "bin", "nodefony"),
        "create",
        "app",
        path.basename(app),
        "--preset",
        "complete",
        "--frontend",
        "react",
        "--license",
        "MIT",
        "--yes",
        "--no-git",
      ],
      { cwd: parent, stdio: ["ignore", "ignore", "inherit"] },
    );
    created = true;
  }
  const source = readFileSync(path.join(app, "Dockerfile"), "utf8");
  const results = [];
  let envFile = null;
  for (const [index, key] of opts.bases.entries()) {
    const base = BASES[key];
    const image = `nf-bench-${key}`;
    const file = path.join(app, `Dockerfile.bench-${key}`);
    writeFileSync(file, variantDockerfile(source, base));
    console.log(`▸ ${key} — construction (${base.run})`);
    const tb = Date.now();
    const built = spawnSync(
      "docker",
      ["build", "--pull", "-q", "-f", file, "-t", image, app],
      { encoding: "utf8" },
    );
    if (built.status !== 0) {
      results.push({
        key,
        run: base.run,
        error: `construction : ${built.stderr.trim().split("\n").slice(-3).join(" | ")}`,
      });
      continue;
    }
    const buildS = Math.round((Date.now() - tb) / 1000);
    const sizeMb = Math.round(
      Number(
        run("docker", ["image", "inspect", "-f", "{{.Size}}", image]).trim(),
      ) / 1e6,
    );
    const nodeBin = base.distroless ? "/nodejs/bin/node" : "node";
    const node = run("docker", [
      "run",
      "--rm",
      "--entrypoint",
      nodeBin,
      image,
      "--version",
    ]).trim();
    if (envFile === null) {
      // Les secrets de production, fabriqués par l'image elle-même — le geste
      // documenté sur la page Docker Hub. Une seule fois, pour toutes les bases.
      envFile = path.join(app, "bench.env");
      const secrets = run("docker", [
        "run",
        "--rm",
        "--entrypoint",
        nodeBin,
        image,
        "node_modules/.bin/nodefony",
        "security:secrets",
        "--env",
      ]);
      writeFileSync(
        envFile,
        `${secrets.trim()}\nNF_ADMIN_PASSWORD=bench-bases-only\n`,
      );
    }
    console.log(`  scan + démarrage`);
    const cves = scout(image);
    const started = await boot(image, image, 5191 + index, envFile);
    results.push({
      key,
      run: base.run,
      sizeMb,
      node,
      buildS,
      cves,
      ...started,
    });
    if (!opts.keep)
      spawnSync("docker", ["rmi", "-f", image], { stdio: "ignore" });
  }

  console.log(
    `\n| Base | Poids | Critiques | Hautes | Node | /livez | GET / | Démarrage | Arrêt |`,
  );
  console.log(`| --- | ---: | ---: | ---: | --- | --- | --- | ---: | --- |`);
  for (const r of results) {
    if (r.error) {
      console.log(`| \`${r.run}\` | — | — | — | — | ✗ ${r.error} | | | |`);
      continue;
    }
    const c = r.cves.error ? `? (${r.cves.error})` : r.cves.critical;
    const h = r.cves.error ? "?" : r.cves.high;
    console.log(
      `| \`${r.run}\` | ${r.sizeMb} Mo | ${c} | ${h} | ${r.node} | ${r.livez ?? "✗"} | ${r.home ?? "✗"} | ${r.bootMs === null ? "✗" : `${(r.bootMs / 1000).toFixed(1)} s`} | ${r.exitCode === 0 ? "0 ✓" : `${r.exitCode} ✗`} |`,
    );
    if (r.logs)
      console.log(`\n  journal ${r.key} :\n${r.logs.replace(/^/gm, "    ")}`);
  }
  const json =
    opts.json ?? path.join(ROOT, "tmp", "bench", `bench-bases-${stamp}.json`);
  mkdirSync(path.dirname(json), { recursive: true });
  writeFileSync(json, `${JSON.stringify({ date: stamp, results }, null, 2)}\n`);
  console.log(`\nDonnées : ${path.relative(ROOT, json)}`);
  if (created && !opts.keep) rmSync(app, { recursive: true, force: true });
  else console.log(`Application gardée : ${path.relative(ROOT, app)}`);
  process.exit(
    results.some((r) => r.error || r.exitCode !== 0 || r.livez !== 200) ? 1 : 0,
  );
}

if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
) {
  await main();
}
