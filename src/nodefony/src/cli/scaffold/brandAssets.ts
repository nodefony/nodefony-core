import { readFileSync } from "node:fs";
import path from "node:path";
import type { ScaffoldWriter } from "./writer";

/**
 * Le logo officiel Nodefony — SOURCE UNIQUE, relative à la racine du paquet
 * `nodefony`, publiée (`files`) et exposée par `exports`
 * (`nodefony/assets/nodefony-logo.png`).
 *
 * Tout ce qui montre le logo en dérive : Studio l'importe, une application
 * générée en reçoit une copie dans `public/`, le favicon en est l'enveloppe ICO.
 * Les copies que le dépôt garde encore (adresse GitHub des README, thème
 * Keycloak) sont tenues identiques par `src/tests/brandAssets.test.ts`.
 */
export const BRAND_LOGO_PATH = path.join("assets", "nodefony-logo.png");

/** Où une application sert ses fichiers statiques par défaut (`statics.web`). */
const PUBLIC_DIR = "public";

/** Les fichiers de marque qu'une application peut recevoir dans `public/`. */
export type TBrandAsset = "logo" | "favicon";

/**
 * Lit le logo officiel depuis le paquet `nodefony`.
 *
 * @param packageRoot - racine du paquet `nodefony` (celle qui porte `templates/`)
 * @returns les octets du PNG
 */
export function readBrandLogo(packageRoot: string): Buffer {
  return readFileSync(path.join(packageRoot, BRAND_LOGO_PATH));
}

/** Signature d'un fichier PNG (RFC 2083 §3.1). */
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/**
 * Enveloppe un PNG dans un fichier ICO d'une seule image.
 *
 * Le format ICO accepte une image PNG telle quelle depuis Windows Vista, et
 * tous les navigateurs la lisent : le favicon n'est donc pas une seconde image
 * à maintenir, c'est le logo dans une autre boîte. `/favicon.ico` reste
 * nécessaire même quand une page déclare son icône — un navigateur le demande
 * pour toute réponse qui n'est pas du HTML (la page d'accueil JSON d'une
 * application sans front, par exemple).
 *
 * @param png - les octets d'un PNG valide, d'au plus 256 pixels de côté
 * @returns le fichier ICO : en-tête de 6 octets, une entrée de 16, puis le PNG
 * @throws Si les octets ne sont pas un PNG, ou si l'image dépasse 256 pixels
 */
export function pngToIco(png: Uint8Array): Uint8Array {
  const data = Buffer.from(png);
  const isPng =
    data.length > 24 &&
    PNG_SIGNATURE.every((byte, i) => data[i] === byte) &&
    data.toString("latin1", 12, 16) === "IHDR";
  if (!isPng) {
    throw new Error("pngToIco : les octets reçus ne sont pas un PNG");
  }
  const width = data.readUInt32BE(16);
  const height = data.readUInt32BE(20);
  if (width === 0 || height === 0 || width > 256 || height > 256) {
    throw new Error(
      `pngToIco : ${String(width)}×${String(height)} hors du format ICO (1 à 256 pixels)`,
    );
  }
  const header = Buffer.alloc(6 + 16);
  header.writeUInt16LE(0, 0); // réservé
  header.writeUInt16LE(1, 2); // type : icône
  header.writeUInt16LE(1, 4); // une image
  header.writeUInt8(width === 256 ? 0 : width, 6); // 0 signifie 256
  header.writeUInt8(height === 256 ? 0 : height, 7);
  header.writeUInt8(0, 8); // pas de palette
  header.writeUInt8(0, 9); // réservé
  header.writeUInt16LE(1, 10); // plans
  header.writeUInt16LE(32, 12); // bits par pixel
  header.writeUInt32LE(data.length, 14); // taille de l'image
  header.writeUInt32LE(header.length, 18); // position de l'image
  return Buffer.concat([header, data]);
}

/**
 * Le contenu d'un fichier de marque, dérivé du logo officiel.
 *
 * @param asset - le fichier voulu
 * @param logo - les octets du logo officiel
 * @returns le nom du fichier dans `public/` et ses octets
 */
export function brandAssetContent(
  asset: TBrandAsset,
  logo: Uint8Array,
): { name: string; content: Uint8Array } {
  return asset === "logo"
    ? { name: "nodefony-logo.png", content: logo }
    : { name: "favicon.ico", content: pngToIco(logo) };
}

/**
 * Pose les fichiers de marque dans le `public/` d'une application, dans la
 * transaction du scaffold (donc visibles en `--dry-run`).
 *
 * `public/` est le répertoire que le framework sert à la racine par défaut
 * (`statics.web`), que l'image de production embarque et que le frontal nginx
 * sert sans joindre Node : un fichier posé là est servi partout, sans réglage.
 *
 * @param writer - la transaction du scaffold
 * @param packageRoot - racine du paquet `nodefony`
 * @param appRoot - racine de l'application
 * @param assets - les fichiers voulus
 * @param onlyMissing - `true` : un fichier déjà présent n'est jamais remplacé
 *   (c'est l'application qui l'a choisi)
 * @returns les chemins posés, relatifs à `appRoot`
 */
export function writeBrandAssets(
  writer: ScaffoldWriter,
  packageRoot: string,
  appRoot: string,
  assets: readonly TBrandAsset[],
  onlyMissing = false,
): string[] {
  const logo = readBrandLogo(packageRoot);
  const written: string[] = [];
  for (const asset of assets) {
    const { name, content } = brandAssetContent(asset, logo);
    const rel = path.join(PUBLIC_DIR, name);
    const abs = path.join(appRoot, rel);
    if (onlyMissing && writer.exists(abs)) {
      continue;
    }
    writer.writeBinary(abs, content);
    written.push(rel);
  }
  return written;
}
