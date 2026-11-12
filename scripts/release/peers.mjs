/**
 * Les pairs (`peerDependencies`) des paquets publiés tiennent-ils leur promesse ?
 *
 * Deux règles, que les types seuls ne prouvent pas :
 *
 * 1. **Un pair FACULTATIF ne se charge jamais depuis le point d'entrée
 *    principal.** « Facultatif » promet qu'une application qui ne s'en sert pas
 *    ne l'installe pas — et ne le paie pas. Un `import` statique depuis
 *    `exports["."]`, même au fond du graphe, casse l'application au démarrage
 *    (`ERR_MODULE_NOT_FOUND`) ; installé quand même, il coûte son chargement à
 *    chaque processus (gRPC : 171 ms et 6,6 Mo de tas, ADR-0026 D12). Le
 *    constat est fait à l'EXÉCUTION, dans un processus neuf, par un crochet de
 *    résolution (`module.registerHooks`) — jamais par le tas, qu'un ramasse-miettes
 *    rend illisible. Le côté types est tenu par `dts-deps.mjs`.
 * 2. **Un pair déclaré par plusieurs paquets publiés a UNE plage.** Deux plages
 *    divergent en silence : l'application satisfait l'une, npm refuse l'autre
 *    (`ERESOLVE`), et rien dans le dépôt ne le voit — chaque paquet passe ses
 *    propres tests.
 *
 * @usage node scripts/release/peers.mjs
 */
import { spawn } from "node:child_process";
import { builtinModules, registerHooks } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { releasableWorkspaces } from "../lib/workspaces.mjs";
import { packageNameOf } from "./dts-deps.mjs";

const SELF = fileURLToPath(import.meta.url);
const BUILTINS = new Set(builtinModules);

/**
 * Noms des pairs FACULTATIFS d'un manifeste.
 *
 * @param {{ peerDependenciesMeta?: Record<string, { optional?: boolean }> }} manifest
 * @returns {string[]}
 */
export function optionalPeerNames(manifest) {
  return Object.entries(manifest.peerDependenciesMeta ?? {})
    .filter(([, meta]) => meta?.optional === true)
    .map(([name]) => name);
}

/**
 * Pairs facultatifs présents parmi les paquets chargés.
 *
 * @param {object} input
 * @param {{ peerDependenciesMeta?: Record<string, { optional?: boolean }> }} input.manifest
 * @param {Iterable<string>} input.loaded - noms de paquets chargés.
 * @returns {string[]}
 */
export function loadedOptionalPeers({ manifest, loaded }) {
  const optional = new Set(optionalPeerNames(manifest));
  return [...loaded].filter((name) => optional.has(name)).sort();
}

/**
 * Pairs déclarés par plusieurs paquets avec des plages différentes.
 *
 * @param {Array<{ name: string, peerDependencies?: Record<string, string> }>} manifests
 * @returns {Array<{ peer: string, ranges: Record<string, string> }>}
 */
export function divergentPeerRanges(manifests) {
  const byPeer = new Map();
  for (const manifest of manifests) {
    for (const [peer, range] of Object.entries(
      manifest.peerDependencies ?? {},
    )) {
      let ranges = byPeer.get(peer);
      if (ranges === undefined) {
        ranges = {};
        byPeer.set(peer, ranges);
      }
      ranges[manifest.name] = range;
    }
  }
  const out = [];
  for (const [peer, ranges] of byPeer) {
    if (new Set(Object.values(ranges)).size > 1) out.push({ peer, ranges });
  }
  return out.sort((a, b) => a.peer.localeCompare(b.peer));
}

/**
 * Paquets chargés par l'import d'un spécificateur, constatés dans un processus
 * NEUF (le cache de modules du processus courant fausserait le relevé).
 *
 * @param {string} specifier - point d'entrée à importer (`@nodefony/http`).
 * @returns {Promise<{ loaded: string[] } | { error: string }>}
 */
export function probeLoadedPackages(specifier) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [SELF, "--probe", specifier], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "";
    let err = "";
    child.stdout.setEncoding("utf8").on("data", (chunk) => (out += chunk));
    child.stderr.setEncoding("utf8").on("data", (chunk) => (err += chunk));
    child.on("close", (code) => {
      if (code !== 0) {
        resolve({ error: `exit ${code} — ${err.trim().split("\n")[0] ?? ""}` });
        return;
      }
      try {
        resolve({ loaded: JSON.parse(out) });
      } catch {
        resolve({ error: `sortie illisible : ${out.slice(0, 120)}` });
      }
    });
  });
}

/**
 * Contrôle tous les paquets publiables du dépôt : chargement du point d'entrée
 * principal (sur le `dist` bâti), puis concordance des plages.
 *
 * @param {string} root - racine du dépôt.
 * @returns {Promise<Array<{ package: string, problem: string }>>}
 */
export async function checkRepository(root) {
  const workspaces = releasableWorkspaces(root);
  const problems = [];
  const withOptional = workspaces.filter(
    (ws) => optionalPeerNames(ws).length > 0,
  );
  const probes = await Promise.all(
    withOptional.map((ws) => probeLoadedPackages(ws.name)),
  );
  withOptional.forEach((ws, i) => {
    const probe = probes[i];
    if ("error" in probe) {
      problems.push({
        package: ws.name,
        problem: `import du point d'entrée principal impossible (${probe.error}) — \`npm run build\` d'abord`,
      });
      return;
    }
    for (const peer of loadedOptionalPeers({
      manifest: ws,
      loaded: probe.loaded,
    })) {
      problems.push({
        package: ws.name,
        problem: `le point d'entrée principal charge le pair FACULTATIF ${peer} — l'importer depuis un sous-chemin`,
      });
    }
  });
  for (const { peer, ranges } of divergentPeerRanges(workspaces)) {
    problems.push({
      package: Object.keys(ranges).join(", "),
      problem: `pair ${peer} déclaré avec des plages différentes : ${JSON.stringify(ranges)}`,
    });
  }
  return problems;
}

/**
 * Mode sonde : importe le spécificateur et écrit sur la sortie standard les
 * paquets que sa résolution a traversés (ESM et `require` CJS).
 */
async function runProbe(specifier) {
  const loaded = new Set();
  registerHooks({
    resolve(spec, context, next) {
      if (
        !spec.startsWith(".") &&
        !spec.startsWith("/") &&
        !spec.startsWith("file:") &&
        !spec.startsWith("node:") &&
        !BUILTINS.has(spec) &&
        !path.isAbsolute(spec)
      ) {
        loaded.add(packageNameOf(spec));
      }
      return next(spec, context);
    },
  });
  await import(specifier);
  process.stdout.write(JSON.stringify([...loaded].sort()));
}

if (process.argv[1] === SELF) {
  if (process.argv[2] === "--probe") {
    await runProbe(process.argv[3]);
  } else {
    const root = path.resolve(path.dirname(SELF), "..", "..");
    const problems = await checkRepository(root);
    for (const p of problems) console.error(`✗ ${p.package} : ${p.problem}`);
    if (problems.length > 0) process.exit(1);
    console.log(
      "✓ pairs : aucun pair facultatif chargé par un point d'entrée principal, plages concordantes",
    );
  }
}
