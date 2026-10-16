/**
 * Les workspaces du dépôt, résolus par npm — seule implémentation pour scripts/.
 *
 * Six scripts recopiaient `npm query .workspace` (+ le filtre des privés) : deux
 * par `execFileSync("npm")`, qui ne trouve pas `npm.cmd` sous Windows. Ici la
 * commande passe par un shell (`execSync`), donc portable, et SANS dépendre du
 * cœur bâti : `generate-symbols` l'emploie sur un clone neuf, avant tout build.
 * Le produit a sa propre lecture (`src/nodefony/src/cli/licenses.ts`) : une
 * frontière de paquet le sépare des scripts du dépôt.
 *
 * @usage import { publishableWorkspaces, listWorkspaces } from "../lib/workspaces.mjs"
 * @usage import { releasableWorkspaces, readWorkspaceManifests } from "../lib/workspaces.mjs"
 */
import { execSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";

/**
 * Tous les workspaces, privés compris, tels que npm les déclare.
 *
 * @param {string} root - racine du dépôt.
 * @returns {Array<{ name: string, location: string, private?: boolean }>}
 */
export function listWorkspaces(root) {
  return JSON.parse(
    execSync("npm query .workspace --json", {
      cwd: root,
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
    }),
  );
}

/**
 * Les workspaces PUBLIÉS sur npm — ceux qui ne sont pas `private`.
 *
 * @param {string} root - racine du dépôt.
 * @returns {Array<{ name: string, location: string }>}
 */
export function publishableWorkspaces(root) {
  return listWorkspaces(root).filter((w) => !w.private);
}

/**
 * Ce qu'un gate lit d'un `package.json` de workspace.
 *
 * @typedef {{ name: string, version: string, private?: boolean,
 *   peerDependencies?: Record<string, string>, [key: string]: unknown }} IWorkspaceManifest
 */

/**
 * Les manifestes des workspaces tels qu'ils sont SUR LE DISQUE.
 *
 * `npm query` rend l'arbre INSTALLÉ, pas les fichiers : mesuré, un `*`
 * réintroduit dans un `package.json` restait invisible tant que `npm install`
 * n'avait pas tourné. Ce qu'un gate affirme des fichiers se lit donc ici.
 * Seuls les motifs `dossier` et `dossier/*` sont reconnus — ceux du dépôt.
 *
 * @param {string} root - racine du dépôt.
 * @returns {Array<{ location: string, manifest: IWorkspaceManifest }>}
 *   `location` en `/` (le motif tel que la racine l'écrit), quelle que soit la
 *   plateforme.
 */
export function readWorkspaceManifests(root) {
  const { workspaces = [] } = JSON.parse(
    readFileSync(path.join(root, "package.json"), "utf8"),
  );
  return workspaces
    .flatMap((motif) =>
      motif.endsWith("/*")
        ? readdirSync(path.join(root, motif.slice(0, -2)), {
            withFileTypes: true,
          })
            .filter((e) => e.isDirectory())
            .map((e) => `${motif.slice(0, -2)}/${e.name}`)
        : [motif],
    )
    .map((location) => ({
      location,
      file: path.join(root, ...location.split("/"), "package.json"),
    }))
    .filter(({ file }) => existsSync(file))
    .map(({ location, file }) => ({
      location,
      manifest: JSON.parse(readFileSync(file, "utf8")),
    }));
}

/**
 * L'écart entre les publiables du DISQUE et ceux de l'arbre INSTALLÉ.
 *
 * @param {string[]} onDisk - noms publiables lus dans les fichiers.
 * @param {string[]} installed - noms publiables rendus par `npm query`.
 * @returns {{ notInstalled: string[], notOnDisk: string[] } | null} `null` si
 *   les deux disent la même chose.
 */
export function workspaceDrift(onDisk, installed) {
  const disk = new Set(onDisk);
  const tree = new Set(installed);
  const notInstalled = [...disk].filter((n) => !tree.has(n)).sort();
  const notOnDisk = [...tree].filter((n) => !disk.has(n)).sort();
  return notInstalled.length || notOnDisk.length
    ? { notInstalled, notOnDisk }
    : null;
}

/**
 * Les workspaces qu'une RELEASE emporte — les publiables, après avoir prouvé
 * que l'arbre installé décrit encore les fichiers.
 *
 * Un module ajouté sans `npm install` derrière est sur le disque mais absent de
 * `npm query` : le pack l'oublierait, et le lot partirait amputé sans un mot.
 * L'inverse (un `private: true` posé depuis) publierait ce qu'on a retiré.
 * Réservé aux gestes de release : `generate-symbols` appelle
 * {@link publishableWorkspaces} depuis les hooks git, juste après un `pull`,
 * où un refus n'aurait personne pour le lire.
 *
 * @param {string} root - racine du dépôt.
 * @returns {Array<{ name: string, location: string }>}
 * @throws {Error} quand le disque et l'arbre installé divergent — le message
 *   nomme les paquets et le geste (`npm install`).
 */
export function releasableWorkspaces(root) {
  const installed = publishableWorkspaces(root);
  const drift = workspaceDrift(
    readWorkspaceManifests(root)
      .filter((w) => !w.manifest.private)
      .map((w) => w.manifest.name),
    installed.map((w) => w.name),
  );
  if (drift) {
    const ligne = (titre, noms) =>
      noms.length ? `\n  ${titre} : ${noms.join(", ")}` : "";
    throw new Error(
      "l'arbre installé ne décrit plus les fichiers — le lot partirait faux." +
        ligne(
          "publiable(s) sur le disque, absent(s) de npm",
          drift.notInstalled,
        ) +
        ligne(
          "publiable(s) pour npm, privé(s) ou absent(s) du disque",
          drift.notOnDisk,
        ) +
        "\n  Lancer `npm install`, puis recommencer.",
    );
  }
  return installed;
}
