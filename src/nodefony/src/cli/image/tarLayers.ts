/**
 * **Lire les COUCHES d'une image de conteneur** — pas son arborescence finale.
 *
 * `docker export` rend le système de fichiers APLATI. Or une couche reste
 * lisible par qui télécharge l'image, même quand une couche suivante efface le
 * fichier : `COPY secret .` puis `RUN rm secret` produit une image où le secret
 * est absent de l'export et **présent dans le dépôt d'images**. Un contrôle bâti
 * sur l'export serait donc vert précisément dans le cas le plus fautif — la
 * définition même d'une garde qui ne peut rien voir.
 *
 * On lit donc `docker save`, et l'on parcourt CHAQUE couche déclarée. Une couche
 * qu'on ne sait pas décoder fait ÉCHOUER la lecture : ne pas savoir regarder
 * n'est pas un verdict favorable — d'où {@link BlindCheckError}, distincte de
 * toute autre erreur.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import { spawnSync } from "node:child_process";
import type { Readable } from "node:stream";

const BLOCK_SIZE = 512;

/**
 * Le contrôle n'a pas pu regarder — distinct d'un verdict défavorable.
 *
 * Un appelant qui confond les deux publie une image que personne n'a vue : le
 * code de sortie qui en découle doit donc être non nul, comme un refus.
 */
export class BlindCheckError extends Error {}

/** Une entrée d'archive tar, avec la position de ses données dans le fichier. */
interface ITarEntry {
  /** Chemin de l'entrée, tel que l'archive le porte. */
  name: string;
  /** Taille des données, en octets. */
  size: number;
  /** Indicateur de type tar (`0` fichier, `L`/`x` en-têtes de nom long…). */
  type: string;
  /** Position des données dans le fichier, en octets depuis le début. */
  offset: number;
}

/**
 * Décode un en-tête tar de 512 octets.
 *
 * @param block - les 512 octets
 * @returns `null` sur un bloc de fin, sinon l'entrée sans sa position
 * @throws BlindCheckError quand la taille annoncée est illisible
 */
export function readTarHeader(block: Buffer): Omit<ITarEntry, "offset"> | null {
  // Un bloc entièrement nul marque la fin de l'archive.
  if (block.every((byte) => byte === 0)) return null;

  const field = (start: number, length: number): string => {
    const raw = block.subarray(start, start + length);
    const end = raw.indexOf(0);
    return raw.subarray(0, end === -1 ? raw.length : end).toString("latin1");
  };

  // La taille est en octal ASCII, sauf au-delà de 8 Go où GNU pose le bit haut
  // et écrit en base 256. Deviner l'un pour l'autre rendrait une taille absurde,
  // donc un saut faux, donc une archive lue de travers SANS erreur.
  let size: number;
  if (block[124] & 0x80) {
    size = 0;
    for (let i = 125; i < 136; i += 1) size = size * 256 + block[i];
  } else {
    const octal = field(124, 12).trim();
    size = octal ? Number.parseInt(octal, 8) : 0;
  }
  if (!Number.isFinite(size) || size < 0) {
    throw new BlindCheckError("en-tête tar illisible : taille invalide");
  }

  const name = field(0, 100);
  const prefix = field(345, 155);
  return {
    name: prefix ? `${prefix}/${name}` : name,
    size,
    type: String.fromCharCode(block[156] || 0x30),
  };
}

/** Taille occupée par des données, padding de bloc compris. */
const alignToBlock = (size: number): number =>
  Math.ceil(size / BLOCK_SIZE) * BLOCK_SIZE;

/**
 * Parcourt une archive tar NON compressée depuis un descripteur, sans charger
 * les données : on saute d'en-tête en en-tête.
 *
 * Sert à la première passe, sur le `docker save` lui-même — dont les entrées
 * (`blobs/sha256/<hex>`) sont de noms courts, mais dont les contenus pèsent des
 * centaines de mégaoctets.
 *
 * @param fd - descripteur ouvert en lecture
 * @returns les entrées avec la position de leurs données
 * @throws BlindCheckError sur une archive tronquée
 */
function shallowInventory(fd: number): ITarEntry[] {
  const entries: ITarEntry[] = [];
  const block = Buffer.alloc(BLOCK_SIZE);
  let offset = 0;
  for (;;) {
    const read = fs.readSync(fd, block, 0, BLOCK_SIZE, offset);
    if (read === 0) break;
    if (read < BLOCK_SIZE) {
      throw new BlindCheckError("archive tronquée dans un en-tête");
    }
    const header = readTarHeader(block);
    if (!header) break;
    offset += BLOCK_SIZE;
    entries.push({ ...header, offset });
    offset += alignToBlock(header.size);
  }
  return entries;
}

/** Une capture d'en-tête de nom long, en cours de lecture. */
interface ILongNameCapture {
  kind: "gnu" | "pax";
  size: number;
  chunks: Buffer[];
}

/**
 * Rend tous les chemins d'une archive tar lue en FLUX, mémoire bornée.
 *
 * Gère les trois façons d'écrire un nom long, parce que les couches d'image en
 * sont pleines (`node_modules/…`) : le champ `prefix` de ustar, l'entrée
 * `typeflag L` de GNU, et l'en-tête étendu PAX (`typeflag x`). En ignorer un
 * ne lèverait aucune erreur — le chemin manquerait, simplement, et un secret
 * au nom long deviendrait invisible.
 *
 * @param stream - le contenu de l'archive, déjà décompressé
 * @returns les chemins, sans `/` initial
 * @throws BlindCheckError sur une archive tronquée
 */
export async function tarPathsFromStream(
  stream: Readable | AsyncIterable<Buffer>,
): Promise<string[]> {
  const paths: string[] = [];
  // Typage EXPLICITE : `Buffer.alloc` infère `Buffer<ArrayBuffer>`, alors qu'un
  // morceau de flux arrive en `Buffer<ArrayBufferLike>` — sans cette annotation,
  // la réaffectation ne compile pas.
  let rest: Buffer = Buffer.alloc(0);
  // Ce qu'il reste à traverser des données de l'entrée courante.
  let toSkip = 0;
  let capture: ILongNameCapture | null = null;
  // Nom imposé à l'entrée SUIVANTE par un en-tête de nom long.
  let forcedName: string | null = null;

  const finishCapture = (): void => {
    if (!capture) return;
    const content = Buffer.concat(capture.chunks).subarray(0, capture.size);
    if (capture.kind === "gnu") {
      forcedName = content.toString("utf8").replace(/\0+$/, "");
    } else {
      // PAX : une suite d'enregistrements « <longueur> clé=valeur\n ».
      const text = content.toString("utf8");
      const found = /(?:^|\n)\d+ path=([^\n]*)/.exec(text);
      if (found) forcedName = found[1];
    }
    capture = null;
  };

  for await (const chunk of stream as AsyncIterable<Buffer>) {
    rest = rest.length ? Buffer.concat([rest, chunk]) : chunk;
    for (;;) {
      if (toSkip > 0) {
        const taken = Math.min(toSkip, rest.length);
        if (capture) capture.chunks.push(Buffer.from(rest.subarray(0, taken)));
        rest = rest.subarray(taken);
        toSkip -= taken;
        if (toSkip > 0) break;
        if (capture) finishCapture();
        continue;
      }
      if (rest.length < BLOCK_SIZE) break;
      const header = readTarHeader(rest.subarray(0, BLOCK_SIZE));
      rest = rest.subarray(BLOCK_SIZE);
      if (!header) return paths;

      if (header.type === "L" || header.type === "K") {
        // 'K' porte un nom de LIEN long : traversé proprement, mais il ne
        // renomme pas l'entrée suivante.
        capture =
          header.type === "L"
            ? { kind: "gnu", size: header.size, chunks: [] }
            : null;
        toSkip = alignToBlock(header.size);
        continue;
      }
      if (header.type === "x" || header.type === "X") {
        capture = { kind: "pax", size: header.size, chunks: [] };
        toSkip = alignToBlock(header.size);
        continue;
      }

      const name = forcedName ?? header.name;
      forcedName = null;
      // Un whiteout `.wh.<nom>` dit qu'une couche EFFACE un fichier des couches
      // précédentes. Le fichier effacé reste lisible dans la couche qui le
      // porte, et c'est elle qui nous intéresse : le marqueur, lui, n'est pas
      // un fichier de l'image.
      if (!/(^|\/)\.wh\./.test(name)) paths.push(name.replace(/^\.?\//, ""));
      toSkip = alignToBlock(header.size);
    }
  }
  if (toSkip > 0) throw new BlindCheckError("archive tronquée");
  return paths;
}

/**
 * Un flux décompressé pour la couche, choisi sur le MAGIC et non sur le nom.
 *
 * @param archive - le fichier produit par `docker save`
 * @param entry - l'entrée de la couche dans ce fichier
 * @returns le flux prêt à être parcouru comme un tar
 * @throws BlindCheckError quand ce Node ne sait pas décompresser la couche
 */
function decompressedLayer(archive: string, entry: ITarEntry): Readable {
  const magic = Buffer.alloc(4);
  const fd = fs.openSync(archive, "r");
  try {
    fs.readSync(fd, magic, 0, 4, entry.offset);
  } finally {
    fs.closeSync(fd);
  }
  const raw = fs.createReadStream(archive, {
    start: entry.offset,
    end: entry.offset + entry.size - 1,
  });
  if (magic[0] === 0x1f && magic[1] === 0x8b) {
    return raw.pipe(zlib.createGunzip());
  }
  if (magic.equals(Buffer.from([0x28, 0xb5, 0x2f, 0xfd]))) {
    // `createZstdDecompress` n'existe que depuis Node 24 : on le CONSTATE au
    // lieu de le déduire d'une version. Le type est donné ici parce que les
    // définitions publiées ne le portent pas encore partout.
    const zstd = (
      zlib as unknown as {
        createZstdDecompress?: () => Readable & NodeJS.WritableStream;
      }
    ).createZstdDecompress;
    if (typeof zstd !== "function") {
      throw new BlindCheckError(
        "couche compressée en zstd et ce Node ne sait pas la lire — " +
          "le contrôle serait aveugle, pas favorable",
      );
    }
    return raw.pipe(zstd());
  }
  // Ni gzip ni zstd : une couche peut être un tar nu.
  return raw;
}

/** Lit le contenu d'une entrée du tar externe (petits fichiers de métadonnées). */
function readEntry(archive: string, entry: ITarEntry): Buffer {
  const buffer = Buffer.alloc(entry.size);
  const fd = fs.openSync(archive, "r");
  try {
    fs.readSync(fd, buffer, 0, entry.size, entry.offset);
  } finally {
    fs.closeSync(fd);
  }
  return buffer;
}

/**
 * Les couches DÉCLARÉES par le manifeste du `docker save`.
 *
 * Les reconnaître en tentant de les lire serait plus court, et faux : un blob de
 * configuration n'est pas une archive, si bien que « ce n'est pas une couche » et
 * « cette couche est illisible » deviendraient le même événement — et le second
 * passerait en silence. Le manifeste tranche ; son absence est un refus, pas une
 * absence de couches.
 *
 * @param archive - le fichier produit par `docker save`
 * @param entries - l'inventaire de premier niveau
 * @returns les entrées qui sont des couches, dans l'ordre du manifeste
 * @throws BlindCheckError quand le manifeste manque, ment ou ne déclare rien
 */
function declaredLayers(archive: string, entries: ITarEntry[]): ITarEntry[] {
  const byName = new Map(entries.map((entry) => [entry.name, entry]));
  const manifest = byName.get("manifest.json");
  if (!manifest) {
    throw new BlindCheckError(
      "pas de manifest.json — ce n'est pas un `docker save`, " +
        "ou son format a changé et le contrôle ne sait plus quoi lire",
    );
  }
  let declared: unknown;
  try {
    declared = JSON.parse(readEntry(archive, manifest).toString("utf8"));
  } catch (error) {
    throw new BlindCheckError(
      `manifest.json illisible : ${(error as Error).message}`,
    );
  }

  const layers: ITarEntry[] = [];
  const seen = new Set<string>();
  // Une image multi-architecture porte plusieurs manifestes : chacun apporte ses
  // couches, et il faut TOUTES les regarder — c'est l'image entière qui est
  // publiée sous un tag, pas la seule variante de la machine qui construit.
  for (const image of Array.isArray(declared) ? declared : []) {
    const names = (image as { Layers?: unknown })?.Layers;
    for (const name of Array.isArray(names) ? (names as string[]) : []) {
      if (seen.has(name)) continue;
      const entry = byName.get(name);
      if (!entry) {
        throw new BlindCheckError(
          `couche déclarée mais absente de l'archive : ${name}`,
        );
      }
      seen.add(name);
      layers.push(entry);
    }
  }
  if (layers.length === 0) {
    throw new BlindCheckError("manifest.json ne déclare aucune couche");
  }
  return layers;
}

/** Ce qu'une lecture d'image rend : ses chemins, et combien de couches. */
export interface IImageContents {
  /** Tous les chemins de toutes les couches, dédoublonnés, sans `/` initial. */
  paths: string[];
  /** Nombre de couches effectivement parcourues. */
  layers: number;
}

/**
 * Tous les chemins de toutes les couches d'une image, dédoublonnés.
 *
 * @param archive - le fichier produit par `docker save`
 * @returns les chemins et le nombre de couches lues
 * @throws BlindCheckError dès qu'une couche déclarée n'a pas pu être lue
 */
export async function imageContents(archive: string): Promise<IImageContents> {
  const fd = fs.openSync(archive, "r");
  let entries: ITarEntry[];
  try {
    entries = shallowInventory(fd);
  } finally {
    fs.closeSync(fd);
  }

  const paths = new Set<string>();
  const layers = declaredLayers(archive, entries);
  for (const entry of layers) {
    let read: string[];
    try {
      read = await tarPathsFromStream(decompressedLayer(archive, entry));
    } catch (error) {
      // Une couche déclarée qu'on ne sait pas lire rend le contrôle aveugle :
      // c'est un refus, jamais un silence.
      throw error instanceof BlindCheckError
        ? error
        : new BlindCheckError(
            `couche ${entry.name} illisible : ${(error as Error).message}`,
          );
    }
    for (const found of read) paths.add(found);
  }
  return { paths: [...paths], layers: layers.length };
}

/** Ce qu'un `docker save` laisse derrière lui, à nettoyer par l'appelant. */
export interface ISavedImage {
  /** Dossier temporaire à supprimer. */
  dir: string;
  /** L'archive produite. */
  archive: string;
}

/**
 * `docker save` dans un fichier temporaire, supprimé par l'appelant.
 *
 * @param image - la référence de l'image (`nom:tag`)
 * @returns le dossier temporaire et l'archive
 * @throws BlindCheckError quand l'image est absente ou le démon injoignable
 */
export function saveImage(image: string): ISavedImage {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nf-image-check-"));
  const archive = path.join(dir, "image.tar");
  const run = spawnSync("docker", ["save", image, "-o", archive], {
    stdio: ["ignore", "inherit", "inherit"],
  });
  if (run.error || run.status !== 0) {
    fs.rmSync(dir, { recursive: true, force: true });
    throw new BlindCheckError(
      `\`docker save ${image}\` a échoué — image absente, ou démon injoignable`,
    );
  }
  return { dir, archive };
}
