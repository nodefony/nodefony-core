import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

/**
 * Les paquets que CE projet produit lui-même — ses espaces de travail.
 *
 * ⚠️ Ce n'est PAS « le paquet est un lien symbolique ». Une application créée
 * avec `--link` pointe elle aussi vers un checkout du framework, et elle, elle
 * VEUT ses pointeurs : elle consomme le framework sans le produire. Le
 * discriminant est la propriété — un paquet déclaré comme espace de travail
 * appartient à ce dépôt, sa source y est versionnée et éditable, et lui poser un
 * pointeur vers `node_modules` reviendrait à s'envoyer chercher le double de ce
 * qu'on a sous la main.
 *
 * Lecture volontairement tolérante : un `package.json` illisible ou sans
 * `workspaces` rend un ensemble vide — c'est le cas d'une application ordinaire,
 * et le comportement doit alors être exactement celui d'avant.
 *
 * @param projectRoot - racine du projet.
 * @returns les noms de paquets produits ici.
 */
function packagesBuiltByThisProject(projectRoot: string): Set<string> {
  const produced = new Set<string>();
  let patterns: unknown;
  try {
    const manifeste = JSON.parse(
      readFileSync(path.join(projectRoot, "package.json"), "utf8"),
    ) as { workspaces?: unknown };
    patterns = manifeste.workspaces;
  } catch {
    return produced;
  }
  const list = Array.isArray(patterns)
    ? patterns
    : Array.isArray((patterns as { packages?: unknown } | null)?.packages)
      ? (patterns as { packages: unknown[] }).packages
      : [];
  for (const pattern of list) {
    if (typeof pattern !== "string") continue;
    // Un motif d'espace de travail est soit un dossier, soit un dossier suivi
    // de `/*`. On n'implémente pas un moteur de motifs : ces deux formes
    // couvrent ce que npm résout réellement, et toute autre est ignorée plutôt
    // que devinée.
    const etoile = pattern.endsWith("/*");
    const base = path.join(
      projectRoot,
      etoile ? pattern.slice(0, -2) : pattern,
    );
    for (const folder of etoile ? listDir(base) : [""]) {
      const dir = etoile ? path.join(base, folder) : base;
      try {
        const name = (
          JSON.parse(readFileSync(path.join(dir, "package.json"), "utf8")) as {
            name?: unknown;
          }
        ).name;
        if (typeof name === "string") produced.add(name);
      } catch {
        // Un dossier sans manifeste n'est pas un espace de travail : on passe.
      }
    }
  }
  return produced;
}

/**
 * Les paquets installés qu'une application peut interroger : ce qu'ils livrent
 * (skills d'agent, contributions au squelette) se découvre ici, en un seul
 * exemplaire.
 *
 * On scanne `node_modules/@nodefony/*` ET les modules LOCAUX de l'application
 * (`modules/<nom>`) : rien dans la mécanique n'est propre à un paquet, et un
 * module tiers qui livre quelque chose doit être servi par le même geste. Coder
 * un paquet en dur aurait fait de cette généralité un cas particulier, et
 * obligé à toucher au cœur le jour où quelqu'un d'autre en livre.
 *
 * Limite connue : sous yarn PnP il n'y a pas de `node_modules` — rien n'est
 * découvert, et l'appelant doit le dire plutôt que le taire.
 *
 * @param projectRoot - racine de l'application.
 * @returns les paquets, avec leur dossier et leur nom.
 */
export function installedPackageRoots(
  projectRoot: string,
): { dir: string; name: string }[] {
  const roots: { dir: string; name: string }[] = [];
  const scope = path.join(projectRoot, "node_modules", "@nodefony");
  const producedHere = packagesBuiltByThisProject(projectRoot);
  for (const name of listDir(scope)) {
    if (name.startsWith(".")) continue;
    // 🔴 Un paquet que CE dépôt PRODUIT ne livre rien : sa source est déjà là.
    // Pour les skills, le pointeur
    // dit « le contenu vit dans `node_modules`, ne l'édite pas ici » — un
    // contresens quand `node_modules/<pkg>` n'est qu'un lien vers un workspace
    // de l'arbre : la source est là, versionnée et éditable. Le doublon n'est
    // pas seulement inutile, il NUIT — le pointeur (quelques lignes) entre en
    // concurrence avec le vrai skill dans tout ce qui indexe `.claude/skills/`,
    // et c'est le pauvre qui gagne parfois.
    if (producedHere.has(`@nodefony/${name}`)) continue;
    roots.push({ dir: path.join(scope, name), name: `@nodefony/${name}` });
  }
  const locaux = path.join(projectRoot, "modules");
  for (const name of listDir(locaux)) {
    if (name.startsWith(".")) continue;
    roots.push({ dir: path.join(locaux, name), name });
  }
  return roots;
}

/**
 * Le contenu d'un dossier, ou rien s'il n'existe pas.
 *
 * @param dir - chemin absolu.
 * @returns les entrées, ou `[]` — un dossier absent est un cas NORMAL ici.
 */
export function listDir(dir: string): string[] {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
}
