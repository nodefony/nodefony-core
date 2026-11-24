import { hash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { IHeldServiceDeclaration } from "nodefony";
import type { IResolvedFrontendEntry } from "../interfaces/IFrontBuilder";
import { composePresets } from "../src/presets/compose";
import { getBuiltinPreset } from "../src/presets";
import { VITE_HOST_MODULE, type ViteFamily } from "./viteFamily";

/**
 * Le nom du paquet d'un spécificateur d'import : `@scope/nom` ou `nom`, sous-
 * chemin retiré (`@angular/build/vite` → `@angular/build`).
 *
 * @param specifier - le spécificateur, tel qu'un `import` l'écrit.
 * @returns le nom du paquet.
 */
export function packageNameOf(specifier: string): string {
  const parts = specifier.split("/");
  return specifier.startsWith("@")
    ? parts.slice(0, 2).join("/")
    : (parts[0] ?? specifier);
}

/**
 * La version INSTALLÉE d'un paquet, telle que Node la résoudrait depuis
 * `fromDir` : premier `node_modules/<nom>/package.json` en remontant. Lecture
 * du fichier plutôt que résolution : un paquet dont les `exports` ne publient
 * pas `package.json` y échapperait.
 *
 * @param name - le nom du paquet.
 * @param fromDir - le dossier d'où l'import part.
 * @returns la version, ou `null` si le paquet est introuvable.
 */
export async function installedVersion(
  name: string,
  fromDir: string,
): Promise<string | null> {
  let dir = path.resolve(fromDir);
  for (;;) {
    const file = path.join(dir, "node_modules", name, "package.json");
    const text = await readFile(file, "utf8").catch(() => null);
    if (text !== null) {
      try {
        const parsed: unknown = JSON.parse(text);
        return typeof parsed === "object" &&
          parsed !== null &&
          "version" in parsed &&
          typeof parsed.version === "string"
          ? parsed.version
          : null;
      } catch {
        return null;
      }
    }
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/**
 * Les versions installées de ce que l'hôte d'une famille CHARGE et que Vite ne
 * relit pas en se relançant lui-même : Vite (résolu depuis le module hôte, qui
 * l'importe) et chaque greffon de la famille (résolu depuis la racine du front,
 * d'où le `.mjs` généré l'importe). ADR-0030 §D4 : le chargeur ESM garde ces
 * paquets en cache sous la même URL — après leur mise à jour, seul un process
 * neuf charge le nouveau code.
 *
 * @param entries - les entrées de la famille.
 * @param root - la racine du front (`cwd` de l'hôte).
 * @returns `paquet → version` (`null` = introuvable), dans un ordre stable.
 */
export async function heldViteVersions(
  entries: ReadonlyArray<IResolvedFrontendEntry>,
  root: string,
): Promise<Record<string, string | null>> {
  const names = new Set<string>();
  for (const plugin of composePresets(entries, getBuiltinPreset).plugins) {
    names.add(packageNameOf(plugin.specifier));
  }
  const hostDir = path.dirname(VITE_HOST_MODULE);
  const [vite, ...plugins] = await Promise.all([
    installedVersion("vite", hostDir),
    ...[...names].map((name) => installedVersion(name, root)),
  ]);
  const versions: Record<string, string | null> = { vite: vite ?? null };
  let i = 0;
  for (const name of names) versions[name] = plugins[i++] ?? null;
  return versions;
}

/**
 * L'empreinte d'un service Vite porté (ADR-0030 §D4) : tout ce qui exige un
 * NOUVEL hôte — module, spécification SANS son titre, `cwd`, variables
 * ajoutées, réglage du teneur, versions installées. Jamais le texte du `.mjs` :
 * Vite se relance lui-même quand il change, dans son process ; l'y mettre
 * ferait tuer ce Vite en pleine relance. Le titre suit les entrées : il se met
 * à jour au prochain remplacement, pour la même raison.
 *
 * @param declaration - la déclaration sans empreinte.
 * @param versions - {@link heldViteVersions}.
 * @returns l'empreinte (SHA-256, hexadécimal).
 */
export function heldViteFingerprint(
  declaration: Omit<IHeldServiceDeclaration, "fingerprint" | "key">,
  versions: Readonly<Record<string, string | null>>,
): string {
  const { title: _title, ...spec } = declaration.spec;
  return hash(
    "sha256",
    JSON.stringify({
      module: declaration.module,
      spec,
      cwd: declaration.cwd,
      env: declaration.env,
      tuning: declaration.tuning ?? null,
      versions,
    }),
  );
}

/**
 * La déclaration d'une famille dans le plan envoyé au superviseur.
 *
 * @param family - la famille.
 * @param entries - ses entrées.
 * @param configFile - le `.mjs` écrit.
 * @returns la déclaration, empreinte comprise.
 */
export async function heldViteDeclaration(
  family: ViteFamily,
  entries: ReadonlyArray<IResolvedFrontendEntry>,
  configFile: string,
): Promise<IHeldServiceDeclaration> {
  const cwd = family.options.cwd;
  const base = {
    module: VITE_HOST_MODULE,
    spec: family.hostSpec(entries, configFile),
    cwd,
    env: family.addedEnv(),
    tuning: family.tuning(),
  };
  const versions = await heldViteVersions(entries, cwd);
  return {
    key: family.key,
    fingerprint: heldViteFingerprint(base, versions),
    ...base,
  };
}
