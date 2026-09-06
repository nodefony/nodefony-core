#!/usr/bin/env node
/**
 * check-licenses — une licence incompatible publiée ne se retire jamais.
 *
 * Nodefony se distribue sous CeCILL-B, une licence permissive de type BSD. Elle
 * autorise l'incorporation de code permissif, et INTERDIT en pratique de
 * dépendre d'un copyleft fort (GPL, AGPL, SSPL) : redistribuer sous CeCILL-B ce
 * qui exige d'être redistribué sous GPL est contradictoire.
 *
 * Le risque n'est pas d'écrire une telle dépendance à la main — personne ne le
 * fait sciemment. Il est qu'elle entre TRANSITIVEMENT, par une mise à jour
 * mineure d'un paquet qui change lui-même de dépendance. Rien ne le signale :
 * npm installe, les tests passent, la publication part. Et le fait, une fois
 * publié, est passé — une version suivante retire la dépendance, elle ne retire
 * pas les installations faites entre-temps.
 *
 * **La source est `npm sbom`, pas une lecture de `node_modules`.** L'inventaire
 * SPDX est produit par npm lui-même à partir de l'arbre résolu : il connaît les
 * dépendances optionnelles, les recouvrements de workspace et les paquets
 * dédupliqués, qu'un parcours de dossiers manque ou compte deux fois.
 *
 * **Mais `npm sbom` NE REND PAS les dépendances de pair**, et c'est le trou qui
 * comptait : mesuré sur ce dépôt, `pg`, `mysql2`, `better-sqlite3`, `zod`,
 * `react` et `vue` étaient absents d'un relevé pourtant vert. Or une dépendance
 * de pair est précisément celle que NOUS imposons à l'utilisateur — il l'installe
 * parce que nous la déclarons. Elles sont donc relevées à part, au premier
 * niveau. Leur arbre transitif, lui, n'est pas couvert : il appartient à leur
 * auteur, npm l'installe avec les licences de chacun, et le script le DIT
 * plutôt que de laisser croire à une couverture totale.
 *
 * @usage    node scripts/check-licenses.mjs           # les paquets publiables du dépôt
 * @usage    node scripts/check-licenses.mjs --json    # pour un autre outil
 * @usage    node scripts/check-licenses.mjs --cwd <dir>   # une application générée
 * @output   le relevé par licence, les paquets refusés, et sortie 1 s'il y en a
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

/**
 * Licences acceptées dans l'arbre de production, par famille.
 *
 * Cette liste est la DÉCISION du projet, pas un constat : une licence absente
 * n'est pas « inconnue », elle est refusée tant que personne ne l'a examinée.
 * C'est ce qui rend la garde utile — une liste qui s'étend toute seule à ce
 * qu'elle rencontre ne garde rien.
 */
const ALLOWED = new Set([
  // Permissives sans obligation autre que l'attribution.
  "MIT",
  "MIT-0",
  "ISC",
  "0BSD",
  "BSD-2-Clause",
  "BSD-3-Clause",
  "Apache-2.0",
  "BlueOak-1.0.0",
  "Unlicense",
  "Python-2.0",
  // Copyleft de FICHIER : n'impose rien à ce qui l'utilise sans le modifier.
  // Nous ne modifions aucune dépendance — le bundler les externalise toutes.
  "MPL-2.0",
  // Domaine public et documentation. `caniuse-lite` (CC-BY-4.0) est une base de
  // données de compatibilité navigateur, consommée par browserslist au build.
  "CC0-1.0",
  "CC-BY-4.0",
  "CC-BY-3.0",
  // La nôtre.
  "CECILL-B",
]);

/**
 * Expressions SPDX composées que nous acceptons, avec le terme retenu.
 *
 * Une double licence laisse le CHOIX au redistributeur : `(BSD-3-Clause OR
 * GPL-2.0)` est acceptable parce que nous retenons BSD-3-Clause. Ce choix se
 * DÉCLARE ici plutôt que de se déduire d'un analyseur d'expressions — la clause
 * `AND`, elle, cumule les obligations et doit rester refusée par défaut.
 */
const ALLOWED_EXPRESSIONS = new Map([
  ["(BSD-3-Clause OR GPL-2.0)", "BSD-3-Clause"],
  ["(MIT OR CC0-1.0)", "MIT"],
  ["(MIT OR Apache-2.0)", "MIT"],
  ["(Apache-2.0 OR MPL-1.1)", "Apache-2.0"],
]);

/**
 * Le gabarit d'application, dont les dépendances de production atteignent
 * l'utilisateur sans passer par nos `package.json`.
 *
 * Une application générée installe nos paquets — donc l'arbre déjà relevé — plus
 * ce que ce gabarit déclare en propre. Contrôler une application une bonne fois
 * serait une photo : elle se périmerait au premier ajout. C'est l'INVARIANT qui
 * est gardé — chaque dépendance de production du gabarit doit être couverte par
 * le relevé, faute de quoi une licence entrerait chez l'utilisateur sans que
 * rien ne l'ait lue.
 */
const APP_TEMPLATE = "src/nodefony/templates/app/base/package.json.tpl";

/**
 * Les dépendances de production que le gabarit d'application peut poser.
 *
 * Le fichier est un modèle `eta` : ses clés sont lisibles telles quelles, ses
 * valeurs non. On ne lit donc que les NOMS, dans le seul bloc `dependencies` —
 * les `devDependencies` ne partent dans aucune image de production, et les
 * frontends n'ajoutent rien ici (leur table déclare `deps: {}`).
 *
 * @param file - le chemin du gabarit
 * @returns les noms tiers, sans les paquets Nodefony (relevés par ailleurs)
 */
function templateRuntimeDeps(file) {
  if (!fs.existsSync(file)) return [];
  const source = fs.readFileSync(file, "utf8");
  const start = source.indexOf('"dependencies"');
  if (start === -1) return [];
  const block = source.slice(start, source.indexOf("\n  },", start));
  const names = [...block.matchAll(/"([a-z@][a-zA-Z0-9@/_.-]*)"\s*:/g)].map(
    (m) => m[1],
  );
  return [...new Set(names)]
    .filter((name) => name !== "dependencies" && name !== "nodefony")
    .filter((name) => !name.startsWith("@nodefony/"))
    .sort();
}

const JSON_OUTPUT = process.argv.includes("--json");
const cwdIndex = process.argv.indexOf("--cwd");
const ROOT =
  cwdIndex === -1 ? process.cwd() : path.resolve(process.argv[cwdIndex + 1]);

/** Répertoires des paquets contrôlés — rempli par `publishableWorkspaces`. */
const publishableDirs = [];

/**
 * Les paquets dont l'arbre de production doit être contrôlé.
 *
 * Dans le dépôt du framework, ce sont les workspaces qui partent sur npm — un
 * workspace `private` n'est jamais distribué, ses dépendances n'engagent
 * personne. Dans une application, il n'y a pas de workspace : c'est l'arbre du
 * paquet courant qui compte, et le même contrôle vaut tel quel.
 *
 * @returns les noms à passer en `-w`, ou un tableau vide pour l'arbre courant
 */
function publishableWorkspaces() {
  const manifest = JSON.parse(
    fs.readFileSync(path.join(ROOT, "package.json"), "utf8"),
  );
  const patterns = manifest.workspaces ?? [];
  if (patterns.length === 0) return [];

  const names = [];
  publishableDirs.length = 0;
  for (const pattern of patterns) {
    const dirs = pattern.endsWith("/*")
      ? fs.existsSync(path.join(ROOT, pattern.slice(0, -2)))
        ? fs
            .readdirSync(path.join(ROOT, pattern.slice(0, -2)), {
              withFileTypes: true,
            })
            .filter((entry) => entry.isDirectory())
            .map((entry) => path.join(pattern.slice(0, -2), entry.name))
        : []
      : [pattern];
    for (const dir of dirs) {
      const file = path.join(ROOT, dir, "package.json");
      if (!fs.existsSync(file)) continue;
      const pkg = JSON.parse(fs.readFileSync(file, "utf8"));
      if (pkg.private === true || !pkg.name) continue;
      names.push(pkg.name);
      publishableDirs.push(path.join(ROOT, dir));
    }
  }
  return names.sort();
}

/**
 * Les dépendances de pair déclarées par les paquets contrôlés, au premier niveau.
 *
 * Elles n'apparaissent dans AUCUN inventaire `npm sbom` — npm ne les installe
 * pas, l'utilisateur le fait. C'est justement pourquoi elles engagent : nous les
 * lui prescrivons. Leur licence se lit sur l'exemplaire installé ici, qui est le
 * même que celui qu'il recevra.
 *
 * @param dirs - les répertoires des paquets contrôlés
 * @returns un paquet par entrée, dédupliqué par nom
 */
function peerPackages(dirs) {
  const seen = new Map();
  const roots = [
    path.join(ROOT, "node_modules"),
    ...dirs.map((d) => path.join(d, "node_modules")),
  ];
  for (const dir of dirs) {
    const manifest = JSON.parse(
      fs.readFileSync(path.join(dir, "package.json"), "utf8"),
    );
    for (const name of Object.keys(manifest.peerDependencies ?? {})) {
      if (
        seen.has(name) ||
        name.startsWith("@nodefony/") ||
        name === "nodefony"
      )
        continue;
      let installed = null;
      for (const root of roots) {
        const file = path.join(root, name, "package.json");
        if (fs.existsSync(file)) {
          installed = JSON.parse(fs.readFileSync(file, "utf8"));
          break;
        }
      }
      seen.set(name, {
        name,
        version: installed?.version ?? "non installé",
        license: normalizeLicense(installed),
        peer: true,
      });
    }
  }
  return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Rend le champ `license` d'un manifeste sous forme d'expression SPDX.
 *
 * @param manifest - le contenu d'un `package.json`, ou `null` s'il est absent
 * @returns l'expression SPDX, `NOASSERTION` si le paquet n'est pas installé
 */
function normalizeLicense(manifest) {
  if (!manifest) return "NOASSERTION";
  if (typeof manifest.license === "string") return manifest.license;
  if (manifest.license?.type) return manifest.license.type;
  if (Array.isArray(manifest.licenses)) {
    return `(${manifest.licenses.map((entry) => entry.type ?? entry).join(" OR ")})`;
  }
  return "NOASSERTION";
}

/**
 * Relève l'inventaire SPDX de production et le réduit à `nom → licence`.
 *
 * @param workspaces - les workspaces à couvrir ; vide = l'arbre du paquet courant
 * @returns un paquet par entrée, dédupliqué par npm lui-même
 * @throws Si npm échoue — un inventaire partiel serait pire qu'aucun, puisqu'il
 *   se lirait comme un verdict.
 */
function collect(workspaces) {
  const args = ["sbom", "--sbom-format", "spdx", "--omit=dev"];
  for (const name of workspaces) args.push("-w", name);
  let raw;
  try {
    raw = execFileSync("npm", args, {
      cwd: ROOT,
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
    });
  } catch (error) {
    // npm REFUSE d'inventorier un arbre incohérent (`ESBOMPROBLEMS`), et il a
    // raison : un inventaire partiel se lirait comme un verdict. Le dire en
    // clair, avec le remède — une trace d'exception ferait chercher le défaut
    // dans ce script, où il n'est pas.
    const detail = String(error.stderr ?? error.message)
      .split("\n")
      .filter((line) => line.trim() !== "")
      .slice(0, 8)
      .join("\n");
    console.error(
      `❌ npm n'a pas pu inventorier l'arbre de ${ROOT} :\n\n${detail}\n\n` +
        `Un arbre incohérent ne se contourne pas — l'inventaire serait partiel et\n` +
        `se lirait comme un verdict. Réparer l'arbre (\`npm install\`), puis relancer.\n` +
        `Cas connu : une application liée au dépôt du framework (\`--link\`) voit les\n` +
        `paquets du monorepo comme « extraneous » — c'est le décor, pas l'application.`,
    );
    process.exit(2);
  }
  const sbom = JSON.parse(raw);
  return sbom.packages.map((pkg) => ({
    name: pkg.name,
    version: pkg.versionInfo ?? "-",
    license: pkg.licenseDeclared ?? "NOASSERTION",
  }));
}

/**
 * Décide si une licence déclarée est acceptable, et sous quel terme.
 *
 * @param declared - la chaîne SPDX du champ `licenseDeclared`
 * @returns le terme retenu, ou `null` si la licence est refusée
 */
function accept(declared) {
  if (ALLOWED.has(declared)) return declared;
  const chosen = ALLOWED_EXPRESSIONS.get(declared);
  return chosen ?? null;
}

const rootName = JSON.parse(
  fs.readFileSync(path.join(ROOT, "package.json"), "utf8"),
).name;
const workspaces = publishableWorkspaces();
const inventory = collect(workspaces);
const known = new Set(inventory.map((pkg) => `${pkg.name}@${pkg.version}`));

/**
 * Les dépendances de pair que l'inventaire ne contenait pas déjà.
 *
 * Une dépendance de pair peut se trouver AUSSI installée comme dépendance de
 * production d'un autre paquet : la compter deux fois ferait apparaître un même
 * refus en double, et un relevé qu'on ne peut pas recouper avec `npm ls`.
 */
const peers = peerPackages(
  publishableDirs.length > 0 ? publishableDirs : [ROOT],
).filter((pkg) => !known.has(`${pkg.name}@${pkg.version}`));

// Le paquet racine n'est pas une dépendance : il est ce qu'on distribue. Sa
// licence relève d'une décision de projet, pas d'un contrôle de chaîne — et une
// application générée a le droit de n'en déclarer aucune.
const packages = [...inventory, ...peers].filter(
  (pkg) => pkg.name !== rootName,
);
const refused = [];
const tally = new Map();

// L'invariant du gabarit ne vaut que dans le dépôt du framework : une
// application n'a pas de gabarit à garder.
const covered = new Set(packages.map((pkg) => pkg.name));
const uncovered =
  workspaces.length === 0
    ? []
    : templateRuntimeDeps(path.join(ROOT, APP_TEMPLATE)).filter(
        (name) => !covered.has(name),
      );

for (const pkg of packages) {
  const retained = accept(pkg.license);
  if (retained === null) refused.push(pkg);
  const key = retained ?? pkg.license;
  tally.set(key, (tally.get(key) ?? 0) + 1);
}

if (JSON_OUTPUT) {
  console.log(
    JSON.stringify(
      {
        root: ROOT,
        workspaces,
        total: packages.length,
        tally: Object.fromEntries([...tally].sort((a, b) => b[1] - a[1])),
        refused,
        uncovered,
      },
      null,
      2,
    ),
  );
  process.exit(refused.length === 0 && uncovered.length === 0 ? 0 : 1);
}

const scope =
  workspaces.length === 0
    ? "l'arbre de production du paquet courant"
    : `${workspaces.length} paquets publiables`;
console.log(
  `Licences — ${packages.length} paquets dans ${scope}` +
    ` (dont ${peers.length} dépendance(s) de pair)\n`,
);
for (const [license, count] of [...tally].sort((a, b) => b[1] - a[1])) {
  const mark = accept(license) === null ? "❌" : "  ";
  console.log(`${mark} ${String(count).padStart(4)}  ${license}`);
}

console.log(
  `\nNon couvert : l'arbre transitif des dépendances de pair — npm l'installe` +
    `\nchez l'utilisateur avec la licence propre de chaque paquet.`,
);

if (refused.length === 0 && uncovered.length === 0) {
  console.log(`\n✅ toutes les licences sont dans la liste d'acceptation`);
  if (workspaces.length > 0) {
    console.log(
      `   (dont les dépendances de production du gabarit d'application)`,
    );
  }
  process.exit(0);
}

if (refused.length > 0) {
  console.log(`\n❌ ${refused.length} paquet(s) hors liste d'acceptation :\n`);
  for (const pkg of refused) {
    console.log(`   ${pkg.name}@${pkg.version} — ${pkg.license}`);
  }
}

if (uncovered.length > 0) {
  console.log(
    `\n❌ ${uncovered.length} dépendance(s) de production du gabarit d'application` +
      `\n   hors du relevé — une application générée les installerait sans que leur` +
      `\n   licence ait été lue :\n`,
  );
  for (const name of uncovered) console.log(`   ${name}  (${APP_TEMPLATE})`);
  console.log(
    `\n   Les déclarer en dépendance de pair d'un paquet publiable les fait entrer` +
      `\n   dans le relevé — c'est aussi ce qui dit à l'utilisateur qui les exige.`,
  );
}
console.log(
  `\nUne licence hors liste n'est pas « inconnue » : elle n'a pas été examinée.` +
    `\nL'examiner, puis l'ajouter à ALLOWED dans scripts/check-licenses.mjs —` +
    `\nou retirer la dépendance. Publier sans trancher est le seul choix qui ne se rattrape pas.`,
);
process.exit(1);
