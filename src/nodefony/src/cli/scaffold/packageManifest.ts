/**
 * Lecture du `package.json` d'un projet par le scaffold — UNE frontière, UN lecteur.
 *
 * Le manifeste appartient à l'utilisateur : il l'écrit à la main, un autre outil
 * le réécrit, un conflit de fusion le casse. Le moteur ne SUPPOSE donc jamais sa
 * forme par une conversion de type : la racine est vérifiée (un objet JSON, sinon
 * une erreur qui nomme le fichier), et chaque champ se lit par une garde.
 *
 * ⚠️ Plusieurs scaffolds RÉÉCRIVENT le manifeste lu. L'objet rendu ici est donc
 * l'objet PARSÉ lui-même, champs inconnus compris : les compléter en place puis
 * le sérialiser ne perd rien de ce que l'utilisateur y a mis.
 */
import { isPlainObject } from "../../runtime/isPlainObject";
import type { ScaffoldWriter } from "./writer";

/** Les trois blocs où un paquet déclare ce dont il dépend. */
export const DEPENDENCY_BLOCKS = [
  "dependencies",
  "devDependencies",
  "peerDependencies",
] as const;

/** Nom d'un bloc de dépendances. */
export type TDependencyBlock = (typeof DEPENDENCY_BLOCKS)[number];

/**
 * Un `package.json` relu : racine vérifiée, champs à lire par garde.
 *
 * Le chemin voyage avec les données, pour que toute erreur levée plus loin
 * nomme le fichier fautif — le seul geste utile à qui la lit.
 */
export interface IPackageManifest {
  /** Chemin du fichier lu. */
  readonly file: string;
  /** Contenu parsé, complété en place par les scaffolds qui réécrivent. */
  readonly data: Record<string, unknown>;
}

/**
 * Parse le texte d'un `package.json` et en vérifie la racine.
 *
 * @param text - contenu du fichier.
 * @param file - chemin du fichier, cité par les erreurs.
 * @returns le manifeste, racine vérifiée.
 * @throws si le texte n'est pas du JSON, ou si sa racine n'est pas un objet.
 */
export function parsePackageManifest(
  text: string,
  file: string,
): IPackageManifest {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`${file} : JSON illisible — ${reason}`, { cause: error });
  }
  if (!isPlainObject(parsed)) {
    throw new Error(`${file} : le manifeste n'est pas un objet JSON`);
  }
  return { file, data: parsed };
}

/**
 * Lit un `package.json` par la transaction du scaffold, qui voit les écritures
 * en attente.
 *
 * @param file - chemin du `package.json`.
 * @param writer - transaction du scaffold.
 * @returns le manifeste, racine vérifiée.
 * @throws si le fichier est illisible, n'est pas du JSON, ou si sa racine n'est
 *   pas un objet.
 */
export function readPackageManifest(
  file: string,
  writer: ScaffoldWriter,
): IPackageManifest {
  return parsePackageManifest(writer.read(file), file);
}

/**
 * Un champ texte du manifeste (`name`, `version`…), absent s'il n'est pas une
 * chaîne.
 *
 * @param manifest - manifeste relu.
 * @param key - nom du champ.
 * @returns la valeur si c'est une chaîne, sinon `undefined`.
 */
export function manifestString(
  manifest: IPackageManifest,
  key: string,
): string | undefined {
  const value = manifest.data[key];
  return typeof value === "string" ? value : undefined;
}

/**
 * Les noms de paquets déclarés dans les blocs demandés.
 *
 * Un bloc absent, ou qui n'est pas un objet, ne déclare rien : on ne refuse pas
 * de LIRE un manifeste imparfait, seulement de l'écraser (cf
 * {@link ensureObjectField}).
 *
 * @param manifest - manifeste relu.
 * @param blocks - blocs consultés (les trois par défaut).
 * @returns les noms déclarés, tous blocs confondus.
 */
export function dependencyNames(
  manifest: IPackageManifest,
  blocks: readonly TDependencyBlock[] = DEPENDENCY_BLOCKS,
): Set<string> {
  const names = new Set<string>();
  for (const block of blocks) {
    const deps = manifest.data[block];
    if (isPlainObject(deps)) {
      for (const name of Object.keys(deps)) names.add(name);
    }
  }
  return names;
}

/**
 * Le champ objet `key` du manifeste (`scripts`, un bloc de dépendances…), créé
 * vide s'il manque, à compléter EN PLACE.
 *
 * @param manifest - manifeste relu, complété si le champ manquait.
 * @param key - nom du champ.
 * @returns l'objet du manifeste lui-même (pas une copie).
 * @throws si le champ existe mais n'est pas un objet : le remplacer détruirait
 *   ce que l'utilisateur y a écrit.
 */
export function ensureObjectField(
  manifest: IPackageManifest,
  key: string,
): Record<string, unknown> {
  const value = manifest.data[key];
  if (value === undefined) {
    const created: Record<string, unknown> = {};
    manifest.data[key] = created;
    return created;
  }
  if (!isPlainObject(value)) {
    throw new Error(
      `${manifest.file} : le champ « ${key} » n'est pas un objet — corrige-le avant de relancer`,
    );
  }
  return value;
}

/**
 * Réécrit le manifeste par la transaction du scaffold, au format de npm
 * (indentation de deux espaces, saut de ligne final).
 *
 * @param manifest - manifeste à écrire.
 * @param writer - transaction du scaffold.
 */
export function writePackageManifest(
  manifest: IPackageManifest,
  writer: ScaffoldWriter,
): void {
  writer.write(manifest.file, `${JSON.stringify(manifest.data, null, 2)}\n`);
}
