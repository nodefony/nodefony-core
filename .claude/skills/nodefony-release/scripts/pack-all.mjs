// Pack release des workspaces publiables (modèle B — N-packages lockstep).
//
// Pour chaque workspace non-private :
//   1. si `exports["."].types` pointe le SOURCE (`./index.ts`, pattern anti-race
//      des 7 packages cœur consommés en source dans le repo) → BASCULE au pack
//      vers `./dist/types/index.d.ts` (contrainte release §6bis, cf
//      docs/release/nodefony-10.md) — le tarball est dist-only, le source n'y
//      est pas : sans bascule, tsc des consommateurs = TS2307 ;
//   2. `npm pack` → `release/tarballs/*.tgz` ;
//   3. RESTAURE le package.json à l'octet près (backup mémoire, try/finally).
//
// Sorties : release/tarballs/*.tgz + release/tarballs/manifest.json
// (map nom → fichier tgz, consommée par le smoke test / l'app témoin).
//
// Usage (racine repo) : node .claude/skills/nodefony-release/scripts/pack-all.mjs
// Prérequis : `npm run build` (dist/ + dist/types/ à jour sur tous les packages).
import { execSync } from "node:child_process";
import {
  readFileSync,
  writeFileSync,
  existsSync,
  mkdirSync,
  rmSync,
} from "node:fs";
import path from "node:path";
import { fixDtsExtensions } from "./fix-dts-extensions.mjs";

const ROOT = path.resolve(import.meta.dirname, "../..");
const OUT = path.join(ROOT, "release", "tarballs");

// Contrainte release §6bis (2) : peers OPTIONNELS injectés au pack — npm ≥7
// auto-installe les peerDependencies : sans ce flag, toute app backend pure
// installerait react/react-dom (peers du sous-chemin client `nodefony/react`,
// jamais requis côté serveur). Injecté au pack (pas dans le source : le repo
// self-hosted a toujours react via le workspace Studio).
const PACK_PEER_OPTIONAL = {
  nodefony: ["react", "react-dom"],
};

// Workspaces publiables — résolus par npm (source de vérité, pas de liste en dur).
const workspaces = JSON.parse(
  execSync("npm query .workspace --json", { cwd: ROOT, encoding: "utf8" }),
).filter((w) => !w.private);

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

const manifest = {};
const failures = [];

for (const w of workspaces) {
  const dir = path.join(ROOT, w.location);
  const pkgPath = path.join(dir, "package.json");
  const original = readFileSync(pkgPath, "utf8");
  const pkg = JSON.parse(original);

  // Garde-fou : un tarball dist-only sans dist = paquet vide silencieux.
  if (Array.isArray(pkg.files) && pkg.files.includes("dist")) {
    if (!existsSync(path.join(dir, "dist"))) {
      failures.push(`${pkg.name}: dist/ absent — lancer npm run build d'abord`);
      continue;
    }
  }

  // Bascule exports.types source → .d.ts généré (détection auto, 0 liste en dur).
  const rootExport = pkg.exports?.["."];
  const needsSwitch = rootExport?.types === "./index.ts";
  if (needsSwitch) {
    const dts = path.join(dir, "dist", "types", "index.d.ts");
    if (!existsSync(dts)) {
      failures.push(
        `${pkg.name}: exports.types=./index.ts mais dist/types/index.d.ts absent — build types requis`,
      );
      continue;
    }
    rootExport.types = "./dist/types/index.d.ts";
  }

  // Peers optionnels au pack (§6bis) — merge sans écraser un meta existant.
  const optionalPeers = PACK_PEER_OPTIONAL[pkg.name];
  const needsPeerMeta =
    optionalPeers?.some((p) => pkg.peerDependencies?.[p]) ?? false;
  if (needsPeerMeta) {
    pkg.peerDependenciesMeta = { ...pkg.peerDependenciesMeta };
    for (const p of optionalPeers) {
      if (pkg.peerDependencies?.[p]) {
        pkg.peerDependenciesMeta[p] = { optional: true };
      }
    }
  }

  // Types publiés conformes node16/nodenext : extensionne les specifiers
  // relatifs de TOUS les .d.ts sous dist/ (arbres types/, client/types/, …).
  // EN PLACE et idempotent (Bundler interne accepte `.js`) — cf
  // fix-dts-extensions.mjs. Un specifier irrésolu = type fantôme → échec.
  if (existsSync(path.join(dir, "dist"))) {
    const r = fixDtsExtensions(path.join(dir, "dist"));
    if (r.unresolved.length) {
      failures.push(
        `${pkg.name}: ${r.unresolved.length} specifier(s) .d.ts irrésolus (types fantômes) — ` +
          r.unresolved.slice(0, 5).join(" · "),
      );
      continue;
    }
    if (r.rewrites > 0) {
      console.log(`  ${pkg.name}: ${r.rewrites} specifiers .d.ts extensionnés`);
    }
  }

  const mutated = needsSwitch || needsPeerMeta;
  try {
    if (mutated) {
      writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n");
    }
    const tgz = execSync(`npm pack --silent --pack-destination "${OUT}"`, {
      cwd: dir,
      encoding: "utf8",
    }).trim();
    manifest[pkg.name] = tgz;
    const notes = [
      needsSwitch ? "exports.types basculé" : null,
      needsPeerMeta ? "peers optional injectés" : null,
    ].filter(Boolean);
    console.log(
      `✓ ${pkg.name} → ${tgz}${notes.length ? `  (${notes.join(" + ")})` : ""}`,
    );
  } catch (e) {
    failures.push(`${pkg.name}: npm pack a échoué — ${e.message}`);
  } finally {
    if (mutated) {
      writeFileSync(pkgPath, original); // restauration à l'octet près
    }
  }
}

writeFileSync(
  path.join(OUT, "manifest.json"),
  JSON.stringify(manifest, null, 2) + "\n",
);

if (failures.length) {
  console.error(
    `\n✗ ÉCHECS (${failures.length}) :\n  - ${failures.join("\n  - ")}`,
  );
  process.exit(1);
}
console.log(
  `\n${Object.keys(manifest).length} tarballs → release/tarballs/ (+ manifest.json)`,
);
