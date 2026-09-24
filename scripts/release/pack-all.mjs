// Pack release des workspaces publiables (modèle B — N-packages lockstep).
//
// Pour chaque workspace non-private :
//   1. vérifie que les types déclarés existent (les paquets du cœur lus en
//      source par le dépôt le font par la condition `nodefony-source`, jamais
//      par `types` : aucune réécriture) ;
//   2. `npm pack` → `release/tarballs/*.tgz` ;
//   3. RESTAURE le package.json à l'octet près quand des peers optionnels y
//      ont été injectés (backup mémoire, try/finally).
//
// Sorties : release/tarballs/*.tgz + release/tarballs/manifest.json
// (map nom → fichier tgz, consommée par le smoke test / l'app témoin).
//
// Usage (racine repo) : npm run release:pack
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
import { auditerMetadonnees, ciblesDeTypes } from "./release-core.mjs";

// `release/` → `scripts/` → racine du dépôt. Ce script fait partie du PRODUIT :
// la chaîne de publication ne peut pas dépendre de l'outillage d'agent, qui se
// réorganise pour d'autres raisons qu'elle.
const ROOT = path.resolve(import.meta.dirname, "../..");
const OUT = path.join(ROOT, "release", "tarballs");

// Contrainte release §6bis (2) : peers OPTIONNELS injectés au pack — npm ≥7
// auto-installe les peerDependencies : sans ce flag, toute app backend pure
// installerait react/react-dom (peers du sous-chemin client `nodefony/react`,
// jamais requis côté serveur). Injecté au pack (pas dans le source : le repo
// self-hosted a toujours react via le workspace Studio).
// ⚠️ Rien pour `vite` ici, et c'est délibéré : marquer une peer optionnelle ne
// suffit PAS à la faire sortir de l'image. Une fois INSTALLÉE (elle l'est, en
// devDependency de l'application), elle SATISFAIT la peer d'un paquet de
// production, et `npm prune --omit=dev` la garde — mesuré. La seule chose qui
// marche est de ne pas déclarer la peer du tout, ce que font désormais
// `@nodefony/frontend` et `@nodefony/studio` : Vite et ses plugins y sont
// chargés par `await import()`, donc rien n'exige de les déclarer.
const PACK_PEER_OPTIONAL = {
  nodefony: ["react", "react-dom"],
};

// Workspaces publiables — résolus par npm (source de vérité, pas de liste en dur).
const workspaces = JSON.parse(
  execSync("npm query .workspace --json", { cwd: ROOT, encoding: "utf8" }),
).filter((w) => !w.private);

// ── Ce qui fait REFUSER la publication, constaté AVANT d'empaqueter ────────
//
// `repository` discordant, `publishConfig.access` manquant sur un paquet scopé,
// `files` absent : aucun de ces défauts ne se voit dans le dépôt. Ils ne se
// manifestent qu'au `npm publish` — le jour J, au milieu d'un lot déjà
// partiellement parti, alors que les versions déjà publiées sont brûlées.
//
// Le gate vit ICI et pas seulement dans `release.mjs` parce que le pack a
// PLUSIEURS appelants : le banc de release l'invoque directement, et un gate
// posé chez un seul appelant ne garde que celui-là. C'est la MÊME fonction dans
// les deux cas — un seul lieu de décision, deux points d'appel.
const audit = auditerMetadonnees(
  workspaces.map((w) => ({
    nom: w.name,
    // `location` n'est pas décoratif : sans elle, la garde qui vérifie que le
    // texte de licence VOYAGE dans le tarball n'a aucun chemin où regarder et
    // ne peut que se déclarer aveugle. Un gate posé chez un seul appelant ne
    // garde que celui-là — et c'est le pack qui fabrique l'artefact.
    location: w.location,
    pkg: JSON.parse(
      readFileSync(path.join(ROOT, w.location, "package.json"), "utf8"),
    ),
  })),
  {
    depotAttendu:
      process.env.NF_RELEASE_REPO ?? "github.com/nodefony/nodefony-core",
    existe: (d) => existsSync(path.join(ROOT, d)),
  },
);
if (audit.bloquants.length) {
  console.error(
    `\n✗ ${audit.bloquants.length} métadonnée(s) empêcheraient la publication :\n` +
      audit.bloquants.map((b) => `    • ${b}`).join("\n") +
      "\n\n  Empaqueter ne servirait à rien : `npm publish` refuserait, ou publierait\n" +
      "  un paquet que personne ne peut installer. Corriger avant de packer.\n",
  );
  process.exit(1);
}

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

  // Même garde pour le graphe symbolique : il est GÉNÉRÉ (donc absent d'un
  // checkout frais) et un `files` qui désigne un dossier inexistant ne fait pas
  // échouer `npm pack` — il publie simplement sans lui. L'application installée
  // lirait alors un graphe absent, exactement le trou que sa publication ferme.
  if (Array.isArray(pkg.files) && pkg.files.includes(".ai")) {
    if (!existsSync(path.join(dir, ".ai", "symbols.json"))) {
      failures.push(
        `${pkg.name}: .ai/symbols.json absent — lancer npm run generate-symbols d'abord`,
      );
      continue;
    }
  }

  // Les types déclarés doivent EXISTER au pack. Qu'ils soient couverts par
  // `files` est une règle du manifeste, tranchée par `auditerMetadonnees`
  // avant la boucle ; ici on constate le disque : un `.d.ts` déclaré mais pas
  // encore bâti partirait absent sans que `npm pack` ne dise rien.
  //
  // Rien n'est RÉÉCRIT : le dépôt lit la source par la condition d'export
  // `nodefony-source` (ses tsconfigs la déclarent), l'installeur lit `types`.
  // Le tarball est donc le `package.json` du dépôt, tel quel.
  const missingDts = ciblesDeTypes(pkg).filter(
    (t) => !existsSync(path.join(dir, t)),
  );
  if (missingDts.length > 0) {
    failures.push(
      `${pkg.name}: types déclarés absents du disque (${missingDts.join(", ")}) — build types requis`,
    );
    continue;
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

  const mutated = needsPeerMeta;
  try {
    if (mutated) {
      writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n");
    }
    // `--ignore-scripts` : le tarball se prépare ICI — peers optionnels et
    // extension des specifiers `.d.ts` juste au-dessus. Un `prepack` qui
    // reconstruit (rolldown vide `dist`, puis `tsgo`) EFFACE cette préparation, et le
    // paquet part avec des specifiers relatifs nus, illégaux en node16/ESM. Le
    // défaut est resté invisible tant que le paquet concerné ne publiait aucun
    // type : personne n'avait de quoi le contrôler. Le tarball reflète donc le
    // `dist` bâti AVANT — comme pour tous les autres paquets, qui n'ont aucun
    // hook. Corollaire : `release:pack` exige un build à jour, il n'en fait pas.
    //
    // `--silent` fait taire NPM, pas les scripts qu'il déclenche : seule la
    // DERNIÈRE ligne non vide est le nom de fichier — le prendre en entier
    // écrivait un pavé de plusieurs kilo-octets comme valeur dans le manifeste,
    // et l'installation suivante échouait sur un `ENAMETOOLONG` incompréhensible.
    const out = execSync(
      `npm pack --silent --ignore-scripts --pack-destination "${OUT}"`,
      {
        cwd: dir,
        encoding: "utf8",
      },
    );
    // `findLast` et non `filter(Boolean).at(-1)` : c'est la DERNIÈRE ligne non
    // vide qui porte le nom d'archive, npm écrivant ses avertissements avant.
    const tgz = out
      .split("\n")
      .map((l) => l.trim())
      .findLast(Boolean);
    if (!tgz?.endsWith(".tgz")) {
      failures.push(
        `${pkg.name}: npm pack n'a pas rendu de nom d'archive (dernière ligne : « ${String(tgz).slice(0, 60)} »)`,
      );
      continue;
    }
    manifest[pkg.name] = tgz;
    const notes = [needsPeerMeta ? "peers optional injectés" : null].filter(
      Boolean,
    );
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
