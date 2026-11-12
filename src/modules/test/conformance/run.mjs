// Suite de conformité officielle de Connect contre le serveur de
// DÉVELOPPEMENT (#695) — tous les cas normatifs gRPC, gRPC-Web et Connect,
// HTTP/1.1 et HTTP/2, binaire et JSON, compressions, flux, erreurs, en-têtes.
//
// Décor : le serveur de dev démarré (skill `nodefony-start-server`) et le
// module `test` bâti (`dist/`, d'où `server.mjs` lit le code généré).
//
// Usage : node src/modules/test/conformance/run.mjs [options du runner…]
//   ex.   node src/modules/test/conformance/run.mjs -v
//         node src/modules/test/conformance/run.mjs --run '**/unary/**' --trace
//
// Charge : le runner lance par défaut jusqu'à 4 « serveurs » en parallèle,
// 48 appels simultanés chacun. Le serveur de référence en démarre 4 ; ici les 4
// lanceurs désignent le MÊME serveur de dev, qui recevrait 4× la charge d'un
// serveur de référence (constaté : 1 cas « Deadline Propagation » sur 4 passes
// voyait la requête 700 ms après l'envoi). `--max-servers 1` rend la charge
// de référence ; le surcoût du pipeline par appel se mesure en PRODUCTION
// (#695, critère 8), pas ici.
//
// Le binaire `connectconformance` (version ÉPINGLÉE, celle du contrat généré)
// est téléchargé une fois dans `node_modules/.cache/`, et refusé si sa somme
// SHA-256 diffère de celle que publie la release.
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const VERSION = "v1.0.7";
const here = path.dirname(fileURLToPath(import.meta.url));
const moduleRoot = path.join(here, "..");
const repoRoot = path.join(moduleRoot, "..", "..", "..");
const cacheDir = path.join(
  repoRoot,
  "node_modules",
  ".cache",
  "connectconformance",
  VERSION,
);

/** Nom de l'archive et du binaire pour CETTE plateforme. */
function artifact() {
  const arch = {
    x64: "x86_64",
    arm64: os.platform() === "linux" ? "aarch64" : "arm64",
  }[os.arch()];
  const system = { darwin: "Darwin", linux: "Linux", win32: "Windows" }[
    os.platform()
  ];
  if (arch === undefined || system === undefined) {
    throw new Error(`plateforme non publiée : ${os.platform()}/${os.arch()}`);
  }
  const windows = system === "Windows";
  return {
    archive: `connectconformance-${VERSION}-${system}-${arch}${windows ? ".zip" : ".tar.gz"}`,
    bin: windows ? "connectconformance.exe" : "connectconformance",
  };
}

async function download(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} : HTTP ${res.status}`);
  return new Uint8Array(await res.arrayBuffer());
}

/** Le binaire, téléchargé et vérifié au premier appel. */
async function ensureRunner() {
  const { archive, bin } = artifact();
  const binPath = path.join(cacheDir, bin);
  if (existsSync(binPath)) return binPath;
  mkdirSync(cacheDir, { recursive: true });
  const base = `https://github.com/connectrpc/conformance/releases/download/${VERSION}`;
  const sums = new TextDecoder().decode(
    await download(
      `${base}/connectconformance_${VERSION.slice(1)}_checksums.txt`,
    ),
  );
  const expected = sums
    .split("\n")
    .map((line) => line.trim().split(/\s+/))
    .find(([, name]) => name === archive)?.[0];
  if (expected === undefined) {
    throw new Error(`${archive} absent des sommes publiées`);
  }
  const bytes = await download(`${base}/${archive}`);
  const actual = createHash("sha256").update(bytes).digest("hex");
  if (actual !== expected) {
    throw new Error(
      `${archive} : SHA-256 ${actual} ≠ ${expected} publié — téléchargement refusé`,
    );
  }
  const archivePath = path.join(cacheDir, archive);
  writeFileSync(archivePath, bytes);
  // `tar` sait lire .tar.gz ET .zip sur les trois plateformes (bsdtar sous
  // Windows 10+) : la capacité se CONSTATE.
  const tar = spawnSync("tar", ["-xf", archivePath, "-C", cacheDir], {
    stdio: "inherit",
  });
  if (tar.error !== undefined || tar.status !== 0 || !existsSync(binPath)) {
    throw new Error(
      `extraction de ${archive} impossible (tar absent ou en échec) — ` +
        `l'extraire à la main dans ${cacheDir}`,
    );
  }
  return binPath;
}

/** Le décor : serveur de dev qui répond, module `test` bâti. */
async function assertEnvironment() {
  const generated = path.join(
    moduleRoot,
    "dist",
    "nodefony",
    "gen",
    "connectrpc",
    "conformance",
    "v1",
    "server_compat_pb.js",
  );
  if (!existsSync(generated)) {
    throw new Error(
      "module test non bâti (code généré absent de dist/) — `npm run build`",
    );
  }
  try {
    const res = await fetch("http://127.0.0.1:5151/livez");
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
  } catch (e) {
    throw new Error(
      `serveur de dev injoignable sur 5151 (${e instanceof Error ? e.message : String(e)}) — ` +
        "bash .claude/skills/nodefony-start-server/start.sh",
      { cause: e },
    );
  }
}

try {
  await assertEnvironment();
  const runner = await ensureRunner();
  const cert = path.join(
    repoRoot,
    "nodefony",
    "config",
    "certificates",
    "server",
    "fullchain.pem",
  );
  const child = spawn(
    runner,
    [
      "--mode",
      "server",
      "--conf",
      path.join(here, "config.yaml"),
      "--max-servers",
      "1",
      "--known-failing",
      `@${path.join(here, "known-failing.txt")}`,
      ...process.argv.slice(2),
      "--",
      process.execPath,
      path.join(here, "server.mjs"),
      "--cert",
      cert,
    ],
    { stdio: "inherit" },
  );
  child.on("exit", (code, signal) => {
    process.exitCode = code ?? (signal === null ? 1 : 128);
  });
} catch (e) {
  process.stderr.write(
    `conformance : ${e instanceof Error ? e.message : String(e)}\n`,
  );
  process.exitCode = 78;
}
