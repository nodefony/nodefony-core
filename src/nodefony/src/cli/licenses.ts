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
 * **La source est `npm query .prod`, pas une lecture de `node_modules`.**
 * L'arbre est celui qu'Arborist résout : il connaît les dépendances
 * optionnelles, les recouvrements d'espace de travail et les paquets
 * dédupliqués, qu'un parcours de dossiers manque ou compte deux fois.
 *
 * **Pourquoi PAS `npm sbom --omit=dev`, qui semblait fait pour ça.** Il compose
 * le sélecteur `:root, :root *:not(.dev), :extraneous`, et `.dev` d'Arborist est
 * vrai dès qu'UN chemin de développement mène au paquet — même s'il est aussi,
 * et d'abord, une dépendance de production. Une `devDependency` qui déclare en
 * `peerDependencies` les paquets de production de l'application suffit donc à
 * les faire tous disparaître : mesuré sur une application générée, dont
 * `@nodefony/devkit` (outil de dev) prescrit `nodefony`, `@nodefony/http`,
 * `@nodefony/framework` et `zod`. L'inventaire tombait à un seul paquet — la
 * racine —, sans erreur et avec un code de sortie nul.
 *
 * `.prod` est l'autre prédicat, et c'est le juste : il rend `!node.dev`, où
 * `node.dev` signifie « joignable UNIQUEMENT par du développement »
 * (`@npmcli/arborist/lib/query-selector-all.js`, `depTypes`). C'est exactement
 * la question posée ici — ce paquet part-il chez l'utilisateur ?
 *
 * ⚠️ Ne rien fonder sur les CHEMINS que npm rend : `npm query` comme `npm ls`
 * passent leur sortie au masquage de secrets, qui remplace par `***` tout
 * segment ressemblant à un jeton. Un chemin d'application ayant la malchance
 * d'en contenir un devient inouvrable — constaté. Seuls `name`, `version` et
 * `license` sont lus ici.
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
 * Ce que chaque licence acceptée IMPOSE, en une ligne.
 *
 * Toutes celles de {@link ALLOWED} autorisent l'usage commercial, la
 * modification et la redistribution dans un produit propriétaire — c'est ce qui
 * les rend acceptables ici. Elles ne se distinguent donc que par ce qu'elles
 * EXIGENT en retour, et c'est la seule chose utile à lire en face d'un
 * décompte : personne ne relit quinze textes de licence.
 *
 * ⚠️ Ce n'est pas un avis juridique, et ça ne remplace pas le texte de la
 * licence — c'est un repère pour savoir laquelle mérite qu'on l'ouvre. Le texte
 * de chaque paquet voyage avec lui, sous `node_modules`.
 *
 * Le gate `licenses.test.ts` exige une entrée pour chaque licence acceptée :
 * une licence ajoutée sans son obligation laisserait une case vide dans un
 * document qui a l'air complet.
 */
export const LICENSE_DUTY: ReadonlyMap<string, string> = new Map([
  ["MIT", "garder la notice et le texte de la licence"],
  ["MIT-0", "rien — attribution non exigée"],
  ["ISC", "garder la notice et le texte de la licence"],
  ["0BSD", "rien — attribution non exigée"],
  ["BSD-2-Clause", "garder la notice et le texte de la licence"],
  [
    "BSD-3-Clause",
    "garder la notice ; ne pas invoquer le nom des auteurs pour promouvoir",
  ],
  [
    "Apache-2.0",
    "garder la notice et le fichier NOTICE ; signaler les fichiers modifiés (brevets concédés)",
  ],
  ["BlueOak-1.0.0", "garder la notice et le texte de la licence"],
  ["Unlicense", "rien — domaine public"],
  ["Python-2.0", "garder la notice et le texte de la licence"],
  [
    "MPL-2.0",
    "copyleft de FICHIER : un fichier MPL modifié reste MPL ; le reste du produit est libre",
  ],
  ["CC0-1.0", "rien — domaine public"],
  ["CC-BY-4.0", "créditer l'auteur (donnée, pas code)"],
  ["CC-BY-3.0", "créditer l'auteur (donnée, pas code)"],
  ["CECILL-B", "garder la notice et CITER les auteurs (BSD de droit français)"],
]);

/**
 * Les licences qu'on REFUSE, et la raison — celles qui arriveront un jour.
 *
 * Un refus qui dit seulement « hors liste » envoie chercher : l'utilisateur
 * ouvre un texte de licence pour découvrir ce que le relevé savait déjà. Ces
 * familles-là reviennent, elles sont connues, et la raison tient en une ligne.
 *
 * Elles ne sont PAS acceptées pour autant : cette table explique un refus, elle
 * ne l'assouplit pas. Une licence absente des DEUX tables reste refusée avec
 * « à EXAMINER » — c'est la règle de {@link ALLOWED}, et c'est ce qui la rend
 * utile : une liste qui s'étend toute seule à ce qu'elle rencontre ne garde rien.
 */
export const LICENSE_REFUSAL: ReadonlyMap<string, string> = new Map([
  [
    "GPL",
    "copyleft FORT : tout produit qui l'incorpore doit être publié sous GPL",
  ],
  [
    "LGPL",
    "copyleft de BIBLIOTHÈQUE : liaison dynamique tolérée, incorporation non",
  ],
  [
    "AGPL",
    "copyleft RÉSEAU : servir l'application par HTTP oblige à en publier la source",
  ],
  [
    "SSPL",
    "non libre : impose de publier toute l'infrastructure qui sert le logiciel",
  ],
  ["BUSL", "source disponible, PAS libre : usage en production restreint"],
  [
    "Elastic",
    "source disponible, PAS libre : revente et service managé interdits",
  ],
  ["CDDL", "copyleft de fichier, réputé incompatible avec la GPL"],
  ["EPL", "copyleft de fichier, avec clause de brevet et juridiction imposée"],
  ["CC-BY-SA", "partage à l'identique : l'œuvre dérivée hérite de la licence"],
  ["CC-BY-NC", "usage COMMERCIAL interdit"],
  ["CC-BY-ND", "œuvres dérivées interdites"],
  ["Commons-Clause", "non libre : la vente du logiciel est interdite"],
  [
    "JSON",
    "clause « Good, not Evil » — non libre, et refusée par plusieurs juristes",
  ],
  [
    "WTFPL",
    "validité juridique contestée — aucune garantie pour le redistributeur",
  ],
  [
    "NOASSERTION",
    "AUCUNE licence déclarée : par défaut, tous droits réservés — redistribuer est interdit",
  ],
]);

/**
 * La raison d'un refus, quand la famille est connue.
 *
 * Le rapprochement se fait sur le PRÉFIXE de l'expression SPDX : `GPL-3.0`,
 * `GPL-3.0-only` et `GPL-2.0-or-later` sont la même famille et appellent la
 * même phrase. Une correspondance exacte serait à refaire à chaque variante.
 *
 * @param license - l'expression telle qu'elle sort du relevé.
 * @returns la raison, ou `null` si la famille n'est pas répertoriée.
 */
export function refusalReason(license: string): string | null {
  for (const [family, reason] of LICENSE_REFUSAL) {
    // `AGPL` avant `GPL` : un simple `startsWith` ferait lire « AGPL-3.0 »
    // comme de la GPL si l'ordre s'inversait. On teste donc le nom de famille
    // entier, borné — jamais un fragment au milieu d'un mot.
    const re = new RegExp(`(^|[^A-Za-z])${family}([^A-Za-z]|$)`, "u");
    if (re.test(license)) return reason;
  }
  return null;
}

/**
 * Ce qu'impose une licence relevée, ou le constat qu'elle n'a pas été examinée.
 *
 * @param license - l'expression telle qu'elle sort du relevé.
 * @returns l'obligation en une ligne.
 */
export function duty(license: string): string {
  const retained = accept(license);
  if (retained === null) {
    return (
      refusalReason(license) ?? "hors liste — à EXAMINER avant de redistribuer"
    );
  }
  return LICENSE_DUTY.get(retained) ?? "acceptée, obligation non renseignée";
}

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
 * @param declared - l'expression SPDX déclarée par le paquet.
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
 * Elles n'apparaissent dans AUCUN inventaire de npm — il ne les installe
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
 * Relève l'arbre de production et le réduit à `nom → licence`.
 *
 * La portée est la RACINE inspectée, sans restriction aux espaces de travail :
 * `.prod` est un fait global de l'arbre (« ce paquet sert-il ailleurs qu'au
 * développement ? »), qu'un sélecteur de sous-arbre ne restreint pas. Composer
 * les deux mêlerait une structure locale à un drapeau global — c'est ce mélange
 * qui a produit un inventaire vide. Dans le dépôt du framework, la portée
 * couvre donc aussi les dépendances de production de l'application de
 * développement : un sur-ensemble, jamais un relevé amputé.
 *
 * ⚠️ **`npm query` rend un nœud par EMPLACEMENT, pas par paquet.** Un même
 * `nom@version` installé à plusieurs endroits de `node_modules` — ce que npm
 * fait dès qu'une contrainte de version empêche le hissage — sort autant de
 * fois qu'il est physiquement présent : mesuré ici, `@inquirer/core@12.0.3`
 * dix fois. C'est le même code sous la même licence, donc UNE obligation : le
 * relever dix fois gonflerait le décompte, ferait apparaître dix fois le même
 * refus, et rendrait le document incomparable d'une version à l'autre. La
 * déduplication porte donc sur `nom@version`, et sur rien de plus large — deux
 * versions d'un paquet sont deux paquets, chacun redistribué avec sa notice.
 *
 * @param root - la racine inspectée.
 * @returns un paquet par `nom@version`, dans l'ordre de première rencontre.
 * @throws LicenseInventoryError Si npm échoue — un inventaire partiel serait pire
 *   qu'aucun, puisqu'il se lirait comme un verdict.
 */
export function collect(root: string): ILicensedPackage[] {
  const args = ["query", ".prod"];
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
    // Un inventaire partiel se lirait comme un verdict. Le dire en clair, avec
    // le remède — une trace d'exception ferait chercher le défaut dans ce code,
    // où il n'est pas.
    const detail = String(run.stderr ?? run.error?.message ?? "")
      .split("\n")
      .filter((line) => line.trim() !== "")
      .slice(0, 8)
      .join("\n");
    throw new LicenseInventoryError(
      `npm n'a pas pu inventorier l'arbre de ${root} :\n\n${detail}\n\n` +
        `Un arbre incohérent ne se contourne pas — l'inventaire serait partiel et\n` +
        `se lirait comme un verdict. Réparer l'arbre (« npm install »), puis relancer.`,
    );
  }
  // Chaque nœud porte son manifeste : `license` peut donc être une chaîne, un
  // objet ou absent, exactement comme dans un `package.json`.
  const nodes = JSON.parse(run.stdout) as IManifest[];
  const seen = new Map<string, ILicensedPackage>();
  for (const node of nodes) {
    // Un paquet `private` n'est JAMAIS redistribué — npm refuse de le publier.
    // Dans un dépôt en espaces de travail, ce sont les paquets internes : les
    // relever reviendrait à refuser la publication parce qu'un banc d'essai ne
    // déclare pas de licence. Leurs propres dépendances, elles, restent dans
    // l'arbre et donc dans le relevé.
    if (node.private === true) continue;
    const pkg: ILicensedPackage = {
      name: node.name ?? "?",
      version: node.version ?? "-",
      license: normalizeLicense(node),
    };
    const key = `${pkg.name}@${pkg.version}`;
    if (!seen.has(key)) seen.set(key, pkg);
  }
  return [...seen.values()];
}

/**
 * Refuse un inventaire que le manifeste contredit.
 *
 * 🔴 Constaté sur une application fraîchement générée : `npm sbom --omit=dev` y
 * rendait le seul paquet racine — SANS erreur et SANS code de sortie non nul.
 * Le relevé s'écrivait donc « 0 paquets », ce qui est pire qu'une panne : un
 * document d'apparence officielle qui affirme qu'on ne redistribue rien. La
 * cause est nommée en tête de fichier, et la source a changé ; la garde reste,
 * parce qu'elle ne coûte rien et qu'elle a MORDU.
 *
 * Elle porte aussi ce que `npm query` ne fait plus : refuser un arbre à moitié
 * installé. Chaque dépendance de production DÉCLARÉE doit se retrouver dans
 * l'inventaire — deux sources indépendantes, le manifeste et l'arbre résolu.
 *
 * @param root - la racine inspectée.
 * @param packages - ce que npm a inventorié.
 * @throws LicenseInventoryError Quand une dépendance de production déclarée est
 *   absente de l'inventaire.
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
  const inventoried = new Set(packages.map((pkg) => pkg.name));
  const missing = declared.filter((name) => !inventoried.has(name));
  if (missing.length === 0) return;
  throw new LicenseInventoryError(
    `l'inventaire de ${root} ne contient pas ${missing.length} des ` +
      `${declared.length} dépendance(s) de production que son « package.json »\n` +
      `déclare : ${missing.join(", ")}.\n\n` +
      `npm a répondu sans erreur, et son résultat contredit le manifeste : il ne\n` +
      `peut donc pas servir de relevé. Écrire un inventaire amputé serait affirmer\n` +
      `qu'on ne redistribue pas ce qu'on redistribue.\n\n` +
      `À constater : « npm ls --omit=dev --depth=0 » (l'arbre réel) et\n` +
      `« npm query .prod » (ce que lit cette commande). Un arbre non installé se\n` +
      `répare par « npm install ».`,
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
  const inventory = collect(root);
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
  // Le décompte seul ne dit pas ce qu'il FAUT FAIRE. La colonne d'obligation
  // évite d'ouvrir quinze textes de licence pour savoir laquelle mérite qu'on
  // s'y arrête — c'est la seule différence utile entre elles, puisqu'elles
  // autorisent toutes l'usage commercial et la redistribution propriétaire.
  const width = Math.max(
    ...[...survey.tally.keys()].map((license) => license.length),
  );
  for (const [license, count] of survey.tally) {
    const mark = accept(license) === null ? "❌" : "  ";
    out.push(
      `${mark} ${String(count).padStart(4)}  ${license.padEnd(width)}  ${duty(license)}`,
    );
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
  const lines = [
    `# Licences des dépendances`,
    ``,
    `> Fichier **généré** — ne pas l'éditer à la main : \`npx nodefony licenses --write\`.`,
    `> Un inventaire écrit à la main se périme au premier \`npm install\`.`,
    ``,
    // Le même relevé sert deux sujets : une application, et le dépôt du
    // framework. Lui faire dire « cette application » dans le second cas serait
    // faux dès la première ligne — et c'est la ligne qu'on lit.
    `${survey.workspaces.length === 0 ? "Cette application redistribue" : `Ce dépôt redistribue`} ${survey.packages.length} paquets tiers. Les licences`,
    `permissives qu'ils emploient imposent de conserver leur notice de copyright et le`,
    `texte de leur licence : npm les installe avec chaque paquet, sous \`node_modules\`.`,
    ``,
    `## Par licence`,
    ``,
    `| Licence | Paquets | Ce qu'elle impose |`,
    `| --- | ---: | --- |`,
  ];
  for (const [license, count] of survey.tally) {
    lines.push(`| ${license} | ${count} | ${duty(license)} |`);
  }
  lines.push(
    ``,
    `> Toutes ces licences autorisent l'usage commercial, la modification et la`,
    `> redistribution dans un produit propriétaire — elles ne diffèrent que par ce`,
    `> qu'elles exigent en retour, résumé ci-dessus. Ce résumé n'est pas un avis`,
    `> juridique et ne remplace pas le texte de la licence, qui voyage avec chaque`,
    `> paquet sous \`node_modules\`.`,
  );
  lines.push(
    ``,
    `## Par paquet`,
    ``,
    `| Paquet | Version | Licence |`,
    `| --- | --- | --- |`,
  );
  for (const pkg of [...survey.packages].sort((a, b) =>
    a.name.localeCompare(b.name),
  )) {
    lines.push(`| \`${pkg.name}\` | ${pkg.version} | ${pkg.license} |`);
  }
  lines.push(
    ``,
    `## Ce que ce relevé ne couvre pas`,
    ``,
    `L'arbre **transitif des dépendances de pair** : npm les installe chez vous avec la`,
    `licence propre de chaque paquet, et leur contenu appartient à leurs auteurs. Le`,
    `relevé nomme celles que l'application exige au premier niveau, pas ce qu'elles`,
    `entraînent à leur tour.`,
    ``,
  );
  return lines.join("\n");
}

/** Le nom du relevé posé à la racine d'une application. */
export const NOTICES_FILE = "THIRD-PARTY-NOTICES.md";
