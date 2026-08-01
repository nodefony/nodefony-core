/**
 * OÙ les modules d'un dépôt vivent, et sous quel NOM ils naissent.
 *
 * ## Le problème que ça règle
 *
 * `create module` posait ses modules dans `modules/<nom>` en dur, avec un scope
 * npm dérivé du nom de l'application. C'est juste pour une app générée — et faux
 * pour un monorepo qui range ses paquets ailleurs, à commencer par le dépôt du
 * framework lui-même (`src/packages/@nodefony/*`). Conséquence vécue : l'auteur
 * du framework écrivait à la main le squelette que sa propre commande sait
 * produire, et le squelette dérivait sans que rien ne le signale.
 *
 * ## La règle
 *
 * Le layout se **CONSTATE** dans les `workspaces` du `package.json` de la
 * racine — jamais ne se déduit d'un nom de dépôt ni d'un chemin en dur. Une
 * entrée de la forme `<prefixe>/@<scope>/*` déclare un dossier de **paquets
 * scopés** : un module qui y naît est un paquet publiable, et prend ce scope.
 * Sans une telle entrée, on est dans le layout d'une application : `modules/`,
 * scope dérivé du nom de l'app.
 *
 * Tout est DÉRIVÉ de la déclaration : rien n'est écrit en dur ici, pas même
 * `@nodefony` — le dépôt du framework n'est qu'un cas particulier de la règle.
 *
 * ⚠️ Les chemins rendus ici **voyagent** (messages, comparaisons, gabarits) :
 * ils sont donc en `/`, jamais en séparateur natif. Pour OUVRIR, l'appelant
 * recompose (`path.join(root, ...dir.split("/"))`).
 */

/** Manifeste racine, réduit à ce dont le layout dépend. */
export interface IRootManifest {
  name?: string;
  workspaces?: string[];
}

/** Où poser un module, sous quel nom, et ce que le dépôt déclare déjà. */
export interface IModuleLayout {
  /**
   * `packages` : dossier de paquets scopés déclaré en workspace → le module naît
   * PUBLIABLE (exports, types, `files`, peerDependencies).
   * `modules` : layout d'application → module local, privé.
   */
  kind: "packages" | "modules";
  /** Dossier où créer un module neuf, relatif à la racine, en `/`. */
  createDir: string;
  /** Scope npm des modules créés, `@` compris. */
  scope: string;
  /** Dossiers à balayer pour lister les cibles existantes, en `/`. */
  targetDirs: string[];
  /**
   * Le dépôt déclare-t-il DÉJÀ {@link createDir} en workspace npm ?
   *
   * `false` ⇒ l'appelant doit l'ajouter (sans le symlink de workspace, le Kernel
   * ne peut pas importer le module par son nom). `true` ⇒ ne toucher à rien : un
   * monorepo établi a ses propres scripts, et les chaîner par-dessus casserait sa
   * chaîne de construction.
   */
  workspaceDeclared: boolean;
}

/** `<prefixe>/@<scope>/*` — un dossier de paquets scopés déclaré en workspace. */
const SCOPED_WORKSPACE_RE = /^(.*)\/(@[a-z0-9][a-z0-9._-]*)\/\*$/u;

/**
 * Déduit le layout des modules à partir du manifeste de la racine.
 *
 * Fonction PURE (aucun accès disque) : le manifeste est lu par l'appelant, ce
 * qui la rend éprouvable sur des dépôts qu'on n'a pas.
 *
 * @param manifest - `package.json` de la racine du projet, déjà analysé.
 * @param projectDirName - nom du dossier racine, repli quand le manifeste n'a
 *   pas de `name` (le scope d'une app en dérive).
 * @returns le layout à appliquer.
 */
export function resolveModuleLayout(
  manifest: IRootManifest,
  projectDirName: string,
): IModuleLayout {
  // Normaliser AVANT de filtrer : un manifeste écrit sous Windows peut porter
  // des `\`, et un motif écrit en `/` ne mordrait pas dessus.
  const workspaces = (manifest.workspaces ?? []).map((w) =>
    w.replaceAll("\\", "/"),
  );
  // Tout dossier de workspaces (`<dir>/*`) est une cible possible pour les
  // scaffolds in-project : c'est là que vivent les modules déjà créés.
  const targetDirs = workspaces
    .filter((w) => w.endsWith("/*"))
    .map((w) => w.slice(0, -2));

  const scoped = workspaces
    .map((w) => SCOPED_WORKSPACE_RE.exec(w))
    .find((m) => m !== null);
  if (scoped) {
    const [, prefix, scope] = scoped;
    return {
      kind: "packages",
      createDir: `${prefix}/${scope}`,
      scope,
      targetDirs,
      workspaceDeclared: true,
    };
  }

  const appName = manifest.name ?? projectDirName;
  return {
    kind: "modules",
    createDir: "modules",
    // `mon-app` → `@mon-app` ; `@acme/site` → `@acme-site`. Un module naît paquet :
    // le jour où il doit être publié ou partagé, il n'y a rien à refaire.
    scope: `@${appName.replace(/^@/u, "").replaceAll("/", "-")}`,
    targetDirs: targetDirs.includes("modules")
      ? targetDirs
      : [...targetDirs, "modules"],
    workspaceDeclared: workspaces.includes("modules/*"),
  };
}
