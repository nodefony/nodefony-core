/**
 * Décor ISOLÉ — ce qu'un installeur npm reçoit, et rien de plus.
 *
 * Un banc qui mesure ce qu'un agent trouve doit lui donner exactement ce qu'un
 * utilisateur possède. Vécu : l'application témoin vivait sous le checkout,
 * paquets symlinkés — l'agent est allé lire `src/packages/@nodefony/…`, un
 * savoir qu'aucun `npm install` ne procure puisqu'un tarball ne contient que
 * `dist/`. Le banc mesurait un agent MIEUX SERVI que l'utilisateur réel, et le
 * seul chiffre qui comptait en dépendait.
 *
 * Deux gestes, tous deux nécessaires — l'un sans l'autre ne suffit pas : le
 * décor SORT du dépôt (sinon `../..` y ramène) et les paquets s'installent
 * depuis les TARBALLS (sinon le lien expose les sources malgré la distance).
 * L'isolation est ensuite CONSTATÉE, jamais supposée.
 *
 * Ce module est partagé par les bancs de schéma et de découvrabilité. Le
 * recopier les ferait diverger en silence : chacun passerait ses propres
 * contrôles avec sa propre idée de ce qu'« isolé » veut dire.
 */
import { execFileSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  lstatSync,
  readFileSync,
  readdirSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

const sh = (cmd, args, opts = {}) =>
  execFileSync(cmd, args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    ...opts,
  });

/**
 * Tarballs des paquets publiables — l'outil de la RELEASE, pas un packer de plus.
 *
 * `pack-all.mjs` porte des subtilités qu'une copie perdrait sans le dire : la
 * bascule des `exports.types` du source vers les `.d.ts` générés au moment du
 * pack (sans elle, le typecheck du consommateur casse), les peers rendus
 * optionnels, la restauration des `package.json` à l'octet près.
 *
 * Re-packer coûte une minute ; on ne le refait donc que si un `dist/` a bougé
 * depuis le dernier pack — la fraîcheur se CONSTATE, elle ne se suppose pas.
 *
 * @param {string} repo - racine du dépôt Nodefony.
 * @param {boolean} force - re-packer même si les tarballs semblent à jour.
 * @returns {{dir: string, manifest: Record<string,string>}}
 */
export function packTarballs(repo, force) {
  const outDir = path.join(repo, "release", "tarballs");
  const manifestPath = path.join(outDir, "manifest.json");
  const newestDist = () => {
    let newest = 0;
    const roots = [
      path.join(repo, "src", "nodefony"),
      ...readdirSync(path.join(repo, "src", "packages", "@nodefony"), {
        withFileTypes: true,
      })
        .filter((e) => e.isDirectory())
        .map((e) => path.join(repo, "src", "packages", "@nodefony", e.name)),
    ];
    for (const r of roots) {
      const f = path.join(r, "dist", "index.js");
      if (existsSync(f)) newest = Math.max(newest, lstatSync(f).mtimeMs);
    }
    return newest;
  };

  const fresh =
    !force &&
    existsSync(manifestPath) &&
    lstatSync(manifestPath).mtimeMs >= newestDist();
  if (fresh) {
    console.log("• tarballs à jour (aucun dist plus récent) — pack ignoré");
  } else {
    console.log("• npm pack des paquets publiables (release/tarballs)…");
    sh(process.execPath, [
      path.join(
        repo,
        ".claude",
        "skills",
        "nodefony-release",
        "scripts",
        "pack-all.mjs",
      ),
    ]);
  }
  if (!existsSync(manifestPath)) {
    throw new Error(
      `pack : manifeste absent (${manifestPath}) — le checkout est-il bâti ? (npm run build)`,
    );
  }
  return {
    dir: outDir,
    manifest: JSON.parse(readFileSync(manifestPath, "utf8")),
  };
}

/**
 * Réécrit les dépendances du scope `nodefony` vers les tarballs COPIÉS dans
 * l'app, puis installe.
 *
 * Les tarballs sont copiés (et référencés en relatif) plutôt que pointés dans le
 * dépôt : un `file:` absolu vers `release/tarballs` rebrancherait l'application
 * sur le checkout par un autre chemin, ce qu'on vient précisément de couper.
 *
 * @param {string} app - racine de l'application témoin.
 * @param {{dir: string, manifest: Record<string,string>}} packed - sortie de {@link packTarballs}.
 * @returns {string[]} les noms de paquets installés depuis un tarball.
 */
export function installFromTarballs(app, packed) {
  const local = path.join(app, "tarballs");
  cpSync(packed.dir, local, { recursive: true });
  const pkgPath = path.join(app, "package.json");
  const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
  const installed = [];
  for (const block of ["dependencies", "devDependencies"]) {
    for (const name of Object.keys(pkg[block] ?? {})) {
      if (name !== "nodefony" && !name.startsWith("@nodefony/")) continue;
      const tgz = packed.manifest[name];
      if (!tgz) {
        throw new Error(
          `tarball absent pour ${name} — le paquet est-il publiable (non private) ?`,
        );
      }
      pkg[block][name] = `file:./tarballs/${tgz}`;
      installed.push(name);
    }
  }
  writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);
  console.log(`• npm install (${installed.length} paquets depuis tarballs)…`);
  sh("npm", ["install", "--no-audit", "--no-fund"], { cwd: app });
  return installed.sort();
}

/**
 * CONSTATE l'isolation du décor — ne la suppose pas.
 *
 * Trois faits, chacun suffisant à fausser le verdict s'il est faux : le run
 * vit hors du dépôt (sinon `../..` y ramène), aucun paquet du framework n'est
 * un lien qui sorte de l'app (sinon les sources sont à un `cd` de distance), et
 * aucun `.ts` de source n'est atteignable dans `node_modules` (un `.d.ts` l'est
 * légitimement — un installeur les reçoit).
 *
 * @param {string} repo - racine du dépôt Nodefony.
 * @param {string} app - racine de l'application témoin.
 * @returns {{ok: boolean, facts: string[]}}
 */
export function assertIsolated(repo, app) {
  const facts = [];
  let ok = true;
  const note = (good, text) => {
    if (!good) ok = false;
    facts.push(`${good ? "✅" : "❌"} ${text}`);
  };

  const realApp = realpathSync(app);
  const realRepo = realpathSync(repo);
  note(
    !realApp.startsWith(realRepo + path.sep),
    `l'application vit hors du dépôt (${realApp})`,
  );

  const scopes = [
    path.join(app, "node_modules", "nodefony"),
    ...(existsSync(path.join(app, "node_modules", "@nodefony"))
      ? readdirSync(path.join(app, "node_modules", "@nodefony")).map((n) =>
          path.join(app, "node_modules", "@nodefony", n),
        )
      : []),
  ].filter((p) => existsSync(p));

  const escaping = scopes.filter((p) => {
    const st = lstatSync(p);
    return st.isSymbolicLink() && !realpathSync(p).startsWith(realApp);
  });
  note(
    escaping.length === 0,
    `aucun paquet du framework ne sort de l'app par un lien` +
      (escaping.length ? ` (${escaping.length} en sortent)` : ""),
  );

  // Un `.ts` qui n'est pas une déclaration EST une source : sa présence dit que
  // l'agent peut lire l'implémentation du framework, ce qu'un installeur ne
  // peut pas.
  let sources = 0;
  let sample = "";
  const walk = (dir, depth) => {
    if (depth > 6 || sources > 0) return;
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (sources > 0) return;
      const p = path.join(dir, e.name);
      if (e.isSymbolicLink()) continue;
      if (e.isDirectory()) {
        if (e.name === "node_modules") continue;
        walk(p, depth + 1);
      } else if (e.name.endsWith(".ts") && !e.name.endsWith(".d.ts")) {
        sources += 1;
        sample = path.relative(app, p);
      }
    }
  };
  for (const s of scopes) walk(s, 0);
  note(
    sources === 0,
    `aucune source .ts du framework atteignable` +
      (sample ? ` (${sample})` : ""),
  );

  return { ok, facts };
}
