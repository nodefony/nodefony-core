/**
 * Le relevé des licences d'un arbre de production — et la décision de ce qui est acceptable.
 *
 * Deux publics, une seule implémentation. Le DÉPÔT s'en sert pour refuser une
 * licence incompatible avant de publier ; une APPLICATION générée s'en sert pour
 * écrire le relevé de ce qu'elle redistribue. Recopier la règle dans un gabarit
 * ferait diverger les deux en silence, chacune passant ses propres contrôles.
 *
 * Nodefony se distribue sous CeCILL-B, une licence permissive de type BSD. Elle
 * autorise l'incorporation de code permissif, et INTERDIT en pratique de dépendre
 * d'un copyleft fort (GPL, AGPL, SSPL) : redistribuer sous CeCILL-B ce qui exige
 * d'être redistribué sous GPL est contradictoire.
 *
 * Le risque n'est pas d'écrire une telle dépendance à la main — personne ne le
 * fait sciemment. Il est qu'elle entre TRANSITIVEMENT, par une mise à jour mineure
 * d'un paquet qui change lui-même de dépendance. Rien ne le signale : npm installe,
 * les tests passent, la publication part. Et le fait, une fois publié, est passé —
 * une version suivante retire la dépendance, elle ne retire pas les installations
 * faites entre-temps.
 *
 * **La source est `npm sbom`, pas une lecture de `node_modules`.** L'inventaire
 * SPDX est produit par npm lui-même à partir de l'arbre résolu : il connaît les
 * dépendances optionnelles, les recouvrements d'espace de travail et les paquets
 * dédupliqués, qu'un parcours de dossiers manque ou compte deux fois.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { portableSpawn } from "./execPortable";

/**
 * Licences acceptées dans l'arbre de production, par famille.
 *
 * Cette liste est la DÉCISION du projet, pas un constat : une licence absente
 * n'est pas « inconnue », elle est refusée tant que personne ne l'a examinée.
 * C'est ce qui rend la garde utile — une liste qui s'étend toute seule à ce
 * qu'elle rencontre ne garde rien.
 */
export const ALLOWED: ReadonlySet<string> = new Set([
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
export const ALLOWED_EXPRESSIONS: ReadonlyMap<string, string> = new Map([
  ["(BSD-3-Clause OR GPL-2.0)", "BSD-3-Clause"],
  ["(MIT OR CC0-1.0)", "MIT"],
  ["(MIT OR Apache-2.0)", "MIT"],
  ["(Apache-2.0 OR MPL-1.1)", "Apache-2.0"],
]);

/**
 * Le gabarit d'application, dont les dépendances de production atteignent
 * l'utilisateur sans passer par nos `package.json`.
 *
 * Contrôler une application une bonne fois serait une photo : elle se périmerait
 * au premier ajout. C'est l'INVARIANT qui est gardé — chaque dépendance de
 * production du gabarit doit être couverte par le relevé, faute de quoi une
 * licence entrerait chez l'utilisateur sans que rien ne l'ait lue.
 */
export const APP_TEMPLATE = path.join(
  "src",
  "nodefony",
  "templates",
  "app",
  "base",
  "package.json.tpl",
);

/** Un paquet du relevé : ce qu'on redistribue, et sous quelle licence. */
export interface ILicensedPackage {
  /** Nom npm du paquet. */
  name: string;
  /** Version résolue, ou `non installé` pour une dépendance de pair absente. */
  version: string;
  /** Expression SPDX déclarée, ou `NOASSERTION`. */
  license: string;
  /** Vrai quand le paquet vient des dépendances de pair, pas de l'inventaire npm. */
  peer?: boolean;
}

/** Le relevé complet — ce que rendent {@link surveyLicenses} et le mode `--json`. */
export interface ILicenseSurvey {
  /** Racine inspectée. */
  root: string;
  /** Nom du paquet racine, exclu du relevé : il est ce qu'on distribue. */
  rootName: string;
  /** Espaces de travail publiables couverts ; vide pour une application. */
  workspaces: string[];
  /** Les paquets relevés, dépendances de pair comprises. */
  packages: ILicensedPackage[];
  /** Nombre de dépendances de pair ajoutées à l'inventaire npm. */
  peerCount: number;
  /** Décompte par licence retenue, décroissant. */
  tally: Map<string, number>;
  /** Les paquets dont la licence n'est pas dans la liste d'acceptation. */
  refused: ILicensedPackage[];
  /** Dépendances de production du gabarit d'application absentes du relevé. */
  uncovered: string[];
}

/**
 * Décide si une licence déclarée est acceptable, et sous quel terme.
 *
 * @param declared - la chaîne SPDX du champ `licenseDeclared`.
 * @returns le terme retenu, ou `null` si la licence est refusée.
 */
export function accept(declared: string): string | null {
  if (ALLOWED.has(declared)) return declared;
  return ALLOWED_EXPRESSIONS.get(declared) ?? null;
}

/** Le peu qu'on lit d'un `package.json` — jamais `any`, jamais tout le manifeste. */
interface IManifest {
  name?: string;
  version?: string;
  private?: boolean;
  license?: string | { type?: string };
  licenses?: Array<string | { type?: string }>;
  workspaces?: string[];
  peerDependencies?: Record<string, string>;
}

/**
 * Lit un `package.json`, ou rend `null` s'il est absent ou illisible.
 *
 * @param file - chemin du manifeste.
 * @returns le manifeste, ou `null`.
 */
function readManifest(file: string): IManifest | null {
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as IManifest;
  } catch {
    return null;
  }
}

/**
 * Rend le champ `license` d'un manifeste sous forme d'expression SPDX.
 *
 * @param manifest - le contenu d'un `package.json`, ou `null` s'il est absent.
 * @returns l'expression SPDX, `NOASSERTION` si le paquet n'est pas installé.
 */
export function normalizeLicense(manifest: IManifest | null): string {
  if (manifest === null) return "NOASSERTION";
  if (typeof manifest.license === "string") return manifest.license;
  if (
    typeof manifest.license === "object" &&
    manifest.license.type !== undefined
  ) {
    return manifest.license.type;
  }
  if (Array.isArray(manifest.licenses)) {
    const termes = manifest.licenses.map((entry) =>
      typeof entry === "string" ? entry : (entry.type ?? "NOASSERTION"),
    );
    return `(${termes.join(" OR ")})`;
  }
  return "NOASSERTION";
}

/**
 * Les dépendances de production que le gabarit d'application peut poser.
 *
 * Le fichier est un modèle `eta` : ses clés sont lisibles telles quelles, ses
 * valeurs non. On ne lit donc que les NOMS, dans le seul bloc `dependencies` —
 * les `devDependencies` ne partent dans aucune image de production, et les
 * frontends n'ajoutent rien ici (leur table déclare `deps: {}`).
 *
 * @param file - le chemin du gabarit.
 * @returns les noms tiers, sans les paquets Nodefony (relevés par ailleurs).
 */
export function templateRuntimeDeps(file: string): string[] {
  if (!fs.existsSync(file)) return [];
  const source = fs.readFileSync(file, "utf8");
  const start = source.indexOf('"dependencies"');
  if (start === -1) return [];
  const block = source.slice(start, source.indexOf("\n  },", start));
  const names = [...block.matchAll(/"([a-z@][a-zA-Z0-9@/_.-]*)"\s*:/g)].map(
    (m) => m[1] ?? "",
  );
  return [...new Set(names)]
    .filter(
      (name) => name !== "" && name !== "dependencies" && name !== "nodefony",
    )
    .filter((name) => !name.startsWith("@nodefony/"))
    .sort();
}

/**
 * Les paquets dont l'arbre de production doit être contrôlé.
 *
 * Dans le dépôt du framework, ce sont les espaces de travail qui partent sur npm
 * — un espace `private` n'est jamais distribué, ses dépendances n'engagent
 * personne. Dans une application, il n'y a pas d'espace de travail : c'est
 * l'arbre du paquet courant qui compte, et le même contrôle vaut tel quel.
 *
 * @param root - la racine inspectée.
 * @returns les noms à passer en `-w`, et les répertoires correspondants.
 */
export function publishableWorkspaces(root: string): {
  names: string[];
  dirs: string[];
} {
  const manifest = readManifest(path.join(root, "package.json"));
  const patterns = manifest?.workspaces ?? [];
  if (patterns.length === 0) return { names: [], dirs: [] };

  const names: string[] = [];
  const dirs: string[] = [];
  for (const pattern of patterns) {
    // Le motif est écrit en `/` dans `package.json` — c'est sa grammaire, elle
    // VOYAGE. Le chemin qu'on OUVRE se compose, lui, en natif.
    const segments = pattern.endsWith("/*")
      ? pattern.slice(0, -2).split("/")
      : null;
    const candidats: string[] = [];
    if (segments === null) {
      candidats.push(path.join(root, ...pattern.split("/")));
    } else {
      const parent = path.join(root, ...segments);
      if (fs.existsSync(parent)) {
        for (const entry of fs.readdirSync(parent, { withFileTypes: true })) {
          if (entry.isDirectory())
            candidats.push(path.join(parent, entry.name));
        }
      }
    }
    for (const dir of candidats) {
      const pkg = readManifest(path.join(dir, "package.json"));
      if (pkg === null || pkg.private === true || pkg.name === undefined)
        continue;
      names.push(pkg.name);
      dirs.push(dir);
    }
  }
  return { names: names.sort(), dirs };
}

/**
 * Les dépendances de pair déclarées par les paquets contrôlés, au premier niveau.
 *
 * Elles n'apparaissent dans AUCUN inventaire `npm sbom` — npm ne les installe
 * pas, l'utilisateur le fait. C'est justement pourquoi elles engagent : nous les
 * lui prescrivons. Mesuré sur ce dépôt, `pg`, `mysql2`, `better-sqlite3`, `zod`,
 * `react` et `vue` étaient absents d'un relevé pourtant vert. Leur licence se lit
 * sur l'exemplaire installé ici, qui est le même que celui qu'il recevra.
 *
 * @param root - la racine inspectée.
 * @param dirs - les répertoires des paquets contrôlés.
 * @returns un paquet par entrée, dédupliqué par nom.
 */
export function peerPackages(
  root: string,
  dirs: readonly string[],
): ILicensedPackage[] {
  const seen = new Map<string, ILicensedPackage>();
  const roots = [
    path.join(root, "node_modules"),
    ...dirs.map((d) => path.join(d, "node_modules")),
  ];
  for (const dir of dirs) {
    const manifest = readManifest(path.join(dir, "package.json"));
    if (manifest === null) continue;
    for (const name of Object.keys(manifest.peerDependencies ?? {})) {
      if (
        seen.has(name) ||
        name.startsWith("@nodefony/") ||
        name === "nodefony"
      ) {
        continue;
      }
      let installed: IManifest | null = null;
      for (const base of roots) {
        installed = readManifest(
          path.join(base, ...name.split("/"), "package.json"),
        );
        if (installed !== null) break;
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

/** Levée quand npm refuse d'inventorier l'arbre — porte le remède, pas une trace. */
export class LicenseInventoryError extends Error {}

/**
 * Relève l'inventaire SPDX de production et le réduit à `nom → licence`.
 *
 * @param root - la racine inspectée.
 * @param workspaces - les espaces à couvrir ; vide = l'arbre du paquet courant.
 * @returns un paquet par entrée, dédupliqué par npm lui-même.
 * @throws LicenseInventoryError Si npm échoue — un inventaire partiel serait pire
 *   qu'aucun, puisqu'il se lirait comme un verdict.
 */
export function collect(
  root: string,
  workspaces: readonly string[],
): ILicensedPackage[] {
  const args = ["sbom", "--sbom-format", "spdx", "--omit=dev"];
  for (const name of workspaces) args.push("-w", name);
  // `npm` se résout en `npm.cmd` sous Windows, que Node refuse de lancer
  // directement depuis CVE-2024-27980 : la composition portable est la règle du
  // dépôt, jamais un `shell: true` posé ici.
  const portable = portableSpawn("npm", args);
  // `spawnSync` et non `execFileSync` : seul le premier accepte
  // `windowsVerbatimArguments`, que la composition portable impose quand la
  // commande passe par `cmd.exe`.
  const run = spawnSync(portable.file, portable.args, {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    windowsVerbatimArguments: portable.windowsVerbatimArguments,
  });
  if (run.error !== undefined || run.status !== 0) {
    // npm REFUSE d'inventorier un arbre incohérent (`ESBOMPROBLEMS`), et il a
    // raison : un inventaire partiel se lirait comme un verdict. Le dire en
    // clair, avec le remède — une trace d'exception ferait chercher le défaut
    // dans ce code, où il n'est pas.
    const detail = String(run.stderr ?? run.error?.message ?? "")
      .split("\n")
      .filter((line) => line.trim() !== "")
      .slice(0, 8)
      .join("\n");
    throw new LicenseInventoryError(
      `npm n'a pas pu inventorier l'arbre de ${root} :\n\n${detail}\n\n` +
        `Un arbre incohérent ne se contourne pas — l'inventaire serait partiel et\n` +
        `se lirait comme un verdict. Réparer l'arbre (« npm install »), puis relancer.\n` +
        `Cas connu : une application liée au dépôt du framework (« --link ») voit les\n` +
        `paquets du monorepo comme « extraneous » — c'est le décor, pas l'application.`,
    );
  }
  const raw = run.stdout;
  const sbom = JSON.parse(raw) as {
    packages?: Array<{
      name?: string;
      versionInfo?: string;
      licenseDeclared?: string;
    }>;
  };
  return (sbom.packages ?? []).map((pkg) => ({
    name: pkg.name ?? "?",
    version: pkg.versionInfo ?? "-",
    license: pkg.licenseDeclared ?? "NOASSERTION",
  }));
}

/**
 * Refuse un inventaire VIDE que le manifeste contredit.
 *
 * 🔴 Constaté sur une application fraîchement générée : `npm sbom --omit=dev` y
 * rend le seul paquet racine — SANS erreur et SANS code de sortie non nul —
 * alors que `npm ls --omit=dev` liste bien ses quatre dépendances de production.
 * Le relevé s'écrivait donc « 0 paquets », ce qui est pire qu'une panne : un
 * document d'apparence officielle qui affirme qu'on ne redistribue rien.
 *
 * Un inventaire qu'on ne peut pas croire ne se rend pas. La garde compare ce que
 * npm a rendu à ce que le manifeste DÉCLARE — deux sources indépendantes — et
 * lève quand elles se contredisent.
 *
 * @param root - la racine inspectée.
 * @param packages - ce que npm a inventorié.
 * @throws LicenseInventoryError Quand le manifeste déclare des dépendances de
 *   production et que l'inventaire n'en contient aucune.
 */
function assertInventoryPlausible(
  root: string,
  packages: readonly ILicensedPackage[],
): void {
  const manifest = readManifest(path.join(root, "package.json"));
  const declared = Object.keys(
    (manifest as { dependencies?: Record<string, string> } | null)
      ?.dependencies ?? {},
  );
  if (declared.length === 0) return;
  const rootName = manifest?.name ?? "";
  if (packages.some((pkg) => pkg.name !== rootName)) return;
  throw new LicenseInventoryError(
    `l'inventaire de ${root} est VIDE alors que son « package.json » déclare ` +
      `${declared.length} dépendance(s) de production (${declared.join(", ")}).\n\n` +
      `npm a répondu sans erreur, et n'a rendu que le paquet racine : son résultat\n` +
      `contredit le manifeste, donc il ne peut pas servir de relevé. Écrire\n` +
      `« 0 paquet » serait affirmer qu'on ne redistribue rien.\n\n` +
      `À constater : « npm ls --omit=dev --depth=0 » (l'arbre réel) et\n` +
      `« npm sbom --sbom-format spdx --omit=dev » (ce que lit cette commande).`,
  );
}

/**
 * Le relevé complet d'une racine — c'est l'unique porte d'entrée.
 *
 * @param root - la racine inspectée (dépôt du framework ou application).
 * @returns le relevé, ses refus et ce que le gabarit ne couvre pas.
 * @throws LicenseInventoryError Quand npm ne peut pas inventorier l'arbre.
 */
export function surveyLicenses(root: string): ILicenseSurvey {
  const rootManifest = readManifest(path.join(root, "package.json"));
  const rootName = rootManifest?.name ?? "";
  const { names: workspaces, dirs } = publishableWorkspaces(root);
  const inventory = collect(root, workspaces);
  // Avant toute composition : un inventaire que le manifeste contredit ne doit
  // pas devenir un document.
  assertInventoryPlausible(root, inventory);
  const known = new Set(inventory.map((pkg) => `${pkg.name}@${pkg.version}`));

  // Une dépendance de pair peut se trouver AUSSI installée comme dépendance de
  // production d'un autre paquet : la compter deux fois ferait apparaître un même
  // refus en double, et un relevé qu'on ne peut pas recouper avec `npm ls`.
  const peers = peerPackages(root, dirs.length > 0 ? dirs : [root]).filter(
    (pkg) => !known.has(`${pkg.name}@${pkg.version}`),
  );

  // Le paquet racine n'est pas une dépendance : il est ce qu'on distribue. Sa
  // licence relève d'une décision de projet, pas d'un contrôle de chaîne — et une
  // application générée a le droit de n'en déclarer aucune.
  const packages = [...inventory, ...peers].filter(
    (pkg) => pkg.name !== rootName,
  );

  const refused: ILicensedPackage[] = [];
  const tally = new Map<string, number>();
  for (const pkg of packages) {
    const retained = accept(pkg.license);
    if (retained === null) refused.push(pkg);
    const key = retained ?? pkg.license;
    tally.set(key, (tally.get(key) ?? 0) + 1);
  }

  // L'invariant du gabarit ne vaut que dans le dépôt du framework : une
  // application n'a pas de gabarit à garder.
  const covered = new Set(packages.map((pkg) => pkg.name));
  const uncovered =
    workspaces.length === 0
      ? []
      : templateRuntimeDeps(path.join(root, APP_TEMPLATE)).filter(
          (name) => !covered.has(name),
        );

  return {
    root,
    rootName,
    workspaces,
    packages,
    peerCount: peers.length,
    tally: new Map([...tally].sort((a, b) => b[1] - a[1])),
    refused,
    uncovered,
  };
}

/**
 * Le relevé rendu en texte, pour un humain qui lit un terminal.
 *
 * @param survey - le relevé.
 * @returns les lignes à imprimer, sans code de sortie — l'appelant décide.
 */
export function renderReport(survey: ILicenseSurvey): string {
  const scope =
    survey.workspaces.length === 0
      ? "l'arbre de production du paquet courant"
      : `${survey.workspaces.length} paquets publiables`;
  const out: string[] = [
    `Licences — ${survey.packages.length} paquets dans ${scope}` +
      ` (dont ${survey.peerCount} dépendance(s) de pair)\n`,
  ];
  for (const [license, count] of survey.tally) {
    const mark = accept(license) === null ? "❌" : "  ";
    out.push(`${mark} ${String(count).padStart(4)}  ${license}`);
  }
  out.push(
    `\nNon couvert : l'arbre transitif des dépendances de pair — npm l'installe` +
      `\nchez l'utilisateur avec la licence propre de chaque paquet.`,
  );

  if (survey.refused.length === 0 && survey.uncovered.length === 0) {
    out.push(`\n✅ toutes les licences sont dans la liste d'acceptation`);
    if (survey.workspaces.length > 0) {
      out.push(
        `   (dont les dépendances de production du gabarit d'application)`,
      );
    }
    return out.join("\n");
  }

  if (survey.refused.length > 0) {
    out.push(
      `\n❌ ${survey.refused.length} paquet(s) hors liste d'acceptation :\n`,
    );
    for (const pkg of survey.refused) {
      out.push(`   ${pkg.name}@${pkg.version} — ${pkg.license}`);
    }
  }
  if (survey.uncovered.length > 0) {
    out.push(
      `\n❌ ${survey.uncovered.length} dépendance(s) de production du gabarit d'application` +
        `\n   hors du relevé — une application générée les installerait sans que leur` +
        `\n   licence ait été lue :\n`,
    );
    for (const name of survey.uncovered)
      out.push(`   ${name}  (${APP_TEMPLATE})`);
    out.push(
      `\n   Les déclarer en dépendance de pair d'un paquet publiable les fait entrer` +
        `\n   dans le relevé — c'est aussi ce qui dit à l'utilisateur qui les exige.`,
    );
  }
  out.push(
    `\nUne licence hors liste n'est pas « inconnue » : elle n'a pas été examinée.` +
      `\nL'examiner, puis l'ajouter à ALLOWED (nodefony, src/cli/licenses.ts) —` +
      `\nou retirer la dépendance. Publier sans trancher est le seul choix qui ne se rattrape pas.`,
  );
  return out.join("\n");
}

/**
 * Le relevé rendu en Markdown — le `THIRD-PARTY-NOTICES.md` d'une application.
 *
 * Les licences permissives (MIT, BSD, Apache-2.0) imposent toutes de conserver
 * la notice de copyright et le texte de la licence dans les distributions. Ce
 * relevé dit ce qui est redistribué et sous quel terme ; il ne remplace pas les
 * textes eux-mêmes, que npm installe avec chaque paquet.
 *
 * Il est GÉNÉRÉ, jamais écrit à la main : un inventaire figé se périme au premier
 * `npm install`. D'où l'en-tête qui le dit, et la commande qui le régénère.
 *
 * @param survey - le relevé.
 * @returns le contenu du fichier.
 */
export function renderNotices(survey: ILicenseSurvey): string {
  const lignes = [
    `# Licences des dépendances`,
    ``,
    `> Fichier **généré** — ne pas l'éditer à la main : \`npx nodefony licenses --write\`.`,
    `> Un inventaire écrit à la main se périme au premier \`npm install\`.`,
    ``,
    `Cette application redistribue ${survey.packages.length} paquets tiers. Les licences`,
    `permissives qu'ils emploient imposent de conserver leur notice de copyright et le`,
    `texte de leur licence : npm les installe avec chaque paquet, sous \`node_modules\`.`,
    ``,
    `## Par licence`,
    ``,
    `| Licence | Paquets |`,
    `| --- | ---: |`,
  ];
  for (const [license, count] of survey.tally) {
    lignes.push(`| ${license} | ${count} |`);
  }
  lignes.push(
    ``,
    `## Par paquet`,
    ``,
    `| Paquet | Version | Licence |`,
    `| --- | --- | --- |`,
  );
  for (const pkg of [...survey.packages].sort((a, b) =>
    a.name.localeCompare(b.name),
  )) {
    lignes.push(`| \`${pkg.name}\` | ${pkg.version} | ${pkg.license} |`);
  }
  lignes.push(
    ``,
    `## Ce que ce relevé ne couvre pas`,
    ``,
    `L'arbre **transitif des dépendances de pair** : npm les installe chez vous avec la`,
    `licence propre de chaque paquet, et leur contenu appartient à leurs auteurs. Le`,
    `relevé nomme celles que l'application exige au premier niveau, pas ce qu'elles`,
    `entraînent à leur tour.`,
    ``,
  );
  return lignes.join("\n");
}

/** Le nom du relevé posé à la racine d'une application. */
export const NOTICES_FILE = "THIRD-PARTY-NOTICES.md";
