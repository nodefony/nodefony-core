#!/usr/bin/env node
/**
 * Le front que `nodefony create app --frontend <fw>` PRODUIT passe-t-il les
 * contrôles statiques que l'application générée exige d'elle-même ?
 *
 * 🔴 Pourquoi ce gate existe. Le banc de vérité génère son application témoin
 * en `--frontend vue` : les trois autres fronts n'étaient compilés ni lintés par
 * personne. La 10.0.0-beta.1 est partie avec un `App.tsx` React et un
 * composant Angular que leur propre `npm run lint` refusait (Promises non
 * gérées, `catch` non typé, assertions inutiles) — vu seulement par la CI de
 * la vitrine, APRÈS publication, quand les gabarits étaient déjà figés sur npm.
 *
 * Le décor est câblé sur le checkout local (`--link`), pour la raison que porte
 * `check-scaffold-format.mjs` : sur un commit d'estampille, la version épinglée
 * par le gabarit n'existe pas encore sur le registre.
 *
 * 🔴 Et un décor lié installe les dépendances de PAIR des DEUX côtés du lien.
 * Vécu : Vue 3.5.44 publiée un matin, l'app l'installe, `nodefony` (lié) lit
 * les types de la 3.5.43 du dépôt — deux exemplaires que TypeScript refuse
 * d'unifier, et le gate accusait le gabarit Vue. Chez un utilisateur, la pair
 * fait hisser UN exemplaire (constaté depuis les tarballs : typecheck vert).
 * Les pairs sont donc épinglées sur l'exemplaire du dépôt, puis l'unicité est
 * CONSTATÉE — par la même implémentation que le banc de vérité.
 *
 *   node scripts/scaffold/check-scaffold-frontends.mjs              # les quatre fronts
 *   node scripts/scaffold/check-scaffold-frontends.mjs react vue    # une sélection
 *   node scripts/scaffold/check-scaffold-frontends.mjs --keep       # garde les décors
 *
 * @usage node scripts/scaffold/check-scaffold-frontends.mjs [react vue angular svelte] [--keep]
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { REPO_ROOT as ROOT } from "../lib/repo-root.mjs";
import {
  assertPeerUnique,
  epinglerPairs,
  lockstepSiblings,
  peerOverrides,
} from "../../.claude/skills/nodefony-devkit-bench/scripts/lib/isolation.mjs";

const FRONTENDS = ["react", "vue", "angular", "svelte"];
// Les contrôles STATIQUES de `npm run verify` : ce que le gabarit décide seul.
// Tests, build et doctor exigent un serveur et une base — c'est le banc de
// vérité qui les porte.
const CHECKS = ["typecheck", "lint", "format:check"];
const NPM = process.platform === "win32" ? "npm.cmd" : "npm";

const args = process.argv.slice(2);
const keep = args.includes("--keep");
const asked = args.filter((a) => !a.startsWith("--"));
const unknown = asked.filter((a) => !FRONTENDS.includes(a));
if (unknown.length > 0) {
  console.error(
    `front inconnu : ${unknown.join(", ")} — attendus : ${FRONTENDS.join(", ")}`,
  );
  process.exit(2);
}
const selected = asked.length > 0 ? asked : FRONTENDS;

// Les pairs du framework, lues dans ses manifestes — jamais énumérées.
const PACKAGES = path.join(ROOT, "src", "packages", "@nodefony");
const FRAMEWORK_MANIFESTS = [
  path.join(ROOT, "src", "nodefony", "package.json"),
  ...(existsSync(PACKAGES)
    ? readdirSync(PACKAGES).map((n) => path.join(PACKAGES, n, "package.json"))
    : []),
].filter((p) => existsSync(p));
const PEER_VERSIONS = peerOverrides(ROOT, FRAMEWORK_MANIFESTS);

let failed = 0;
for (const fw of selected) {
  const dir = mkdtempSync(path.join(tmpdir(), `nf-scaffold-${fw}-`));
  const dest = path.join(dir, "app");
  const gen = spawnSync(
    process.execPath,
    [
      path.join(ROOT, "src", "nodefony", "bin", "nodefony"),
      "create",
      "app",
      `app${fw}`,
      "--dir",
      dest,
      "--yes",
      "--link",
      "--preset",
      "complete",
      "--frontend",
      fw,
    ],
    { cwd: ROOT, encoding: "utf8" },
  );
  if (gen.status !== 0) {
    console.error(`✗ ${fw} — la génération a échoué (code ${gen.status})`);
    console.error(
      (gen.stderr || gen.stdout || "").split("\n").slice(-12).join("\n"),
    );
    failed++;
    if (!keep) rmSync(dir, { recursive: true, force: true });
    continue;
  }

  // La pair ET ses frères de train : épingler `@angular/core` seul laisse
  // `@angular/common` monter au dernier patch du registre — ERESOLVE.
  epinglerPairs(dest, {
    ...lockstepSiblings(ROOT, dest, PEER_VERSIONS),
    ...PEER_VERSIONS,
  });
  // 🔴 L'arbre de la génération part AVANT de réinstaller : posé sur le
  // dernier patch du registre, il ne redescend pas vers l'épinglage — npm rend
  // `ERESOLVE` (ou plante sur `edgesOut` sans le verrou) le jour où l'amont
  // publie avant que le dépôt suive (vécu : Angular 22.2.4). La génération,
  // elle, garde son installation : c'est elle qui formate le rendu.
  rmSync(path.join(dest, "node_modules"), { recursive: true, force: true });
  rmSync(path.join(dest, "package-lock.json"), { force: true });
  const reinstall = spawnSync(NPM, ["install", "--no-audit", "--no-fund"], {
    cwd: dest,
    encoding: "utf8",
    shell: process.platform === "win32",
  });
  const peers = reinstall.status === 0 ? assertPeerUnique(ROOT, dest) : null;
  if (peers === null || !peers.ok) {
    // Un DÉCOR défaillant ne rend aucun verdict sur le gabarit : le dire tel
    // quel, plutôt que de laisser la compilation l'imputer au code généré.
    console.error(
      `✗ ${fw} — décor lié défaillant : ` +
        (peers === null
          ? `installation après épinglage en échec (code ${reinstall.status})`
          : `pair(s) en deux exemplaires : ${peers.doublons.map((d) => `${d.nom} (app ${d.app}, dépôt ${d.repo})`).join(", ")}`),
    );
    if (peers === null) {
      // Le refus de npm porte sa cause (ERESOLVE, réseau…) : la taire laissait
      // un « code 1 » qu'il fallait rejouer à la main pour lire.
      console.error(
        `${reinstall.stdout}${reinstall.stderr}`
          .split("\n")
          .slice(-25)
          .join("\n"),
      );
    }
    failed++;
    if (!keep) rmSync(dir, { recursive: true, force: true });
    continue;
  }

  const red = [];
  for (const check of CHECKS) {
    // `shell` sous Windows seulement : `npm.cmd` ne s'exécute pas sans lui.
    const r = spawnSync(NPM, ["run", check], {
      cwd: dest,
      encoding: "utf8",
      shell: process.platform === "win32",
    });
    if (r.status !== 0) {
      red.push(check);
      console.error(`✗ ${fw} — npm run ${check} (code ${r.status})`);
      console.error(`${r.stdout}${r.stderr}`.split("\n").slice(-25).join("\n"));
    }
  }
  if (red.length === 0) console.log(`✓ ${fw} — ${CHECKS.join(", ")}`);
  else failed++;

  if (keep) console.log(`  décor conservé : ${dest}`);
  else rmSync(dir, { recursive: true, force: true });
}

if (failed > 0) {
  console.error(
    `\n${failed} front(s) en échec. La correction va dans le GABARIT ` +
      "(src/nodefony/templates/), jamais dans l'application générée.",
  );
  process.exit(1);
}
