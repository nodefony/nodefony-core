import { readFileSync } from "node:fs";
import path from "node:path";
import type { ScaffoldWriter } from "./writer";

/**
 * Le logo officiel Nodefony — SOURCE UNIQUE, vectorielle, relative à la racine
 * du paquet `nodefony`, publiée (`files`) et exposée par `exports`
 * (`nodefony/assets/nodefony-logo.svg`).
 *
 * Tout le reste en DÉRIVE : le PNG et le favicon sont rastérisés depuis ce
 * fichier par `scripts/generate/brand-assets.mjs` (dépôt), qui inscrit l'empreinte de la
 * source et de chaque dérivé dans {@link BRAND_MANIFEST_PATH} ;
 * `src/tests/brandAssets.test.ts` refuse un SVG modifié sans régénération et un
 * dérivé retouché à la main.
 */
export const BRAND_SVG_PATH = path.join("assets", "nodefony-logo.svg");

/**
 * Le logo en PNG (256 pixels de haut, fond transparent) — dérivé du SVG, pour
 * les supports qui n'acceptent pas le vectoriel. Exposé par `exports`
 * (`nodefony/assets/nodefony-logo.png`).
 */
export const BRAND_LOGO_PATH = path.join("assets", "nodefony-logo.png");

/** Le favicon (ICO de 16, 32 et 48 pixels) — dérivé du SVG. */
export const BRAND_FAVICON_PATH = path.join("assets", "favicon.ico");

/** Empreintes de la source et des dérivés, écrites par le générateur. */
export const BRAND_MANIFEST_PATH = path.join("assets", "brand-assets.json");

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

/**
 * Lit le favicon officiel (dérivé du SVG) depuis le paquet `nodefony`.
 *
 * @param packageRoot - racine du paquet `nodefony`
 * @returns les octets du fichier ICO
 */
export function readBrandFavicon(packageRoot: string): Buffer {
  return readFileSync(path.join(packageRoot, BRAND_FAVICON_PATH));
}

/** Signature d'un fichier PNG (RFC 2083 §3.1). */
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** Lit les dimensions d'un PNG dans son en-tête IHDR, ou lève. */
function pngSize(data: Buffer): { width: number; height: number } {
  const isPng =
    data.length > 24 &&
    PNG_SIGNATURE.every((byte, i) => data[i] === byte) &&
    data.toString("latin1", 12, 16) === "IHDR";
  if (!isPng) {
    throw new Error("pngToIco : les octets reçus ne sont pas un PNG");
  }
  return { width: data.readUInt32BE(16), height: data.readUInt32BE(20) };
}

/**
 * Enveloppe une ou plusieurs images PNG dans un fichier ICO.
 *
 * Le format ICO accepte une image PNG telle quelle depuis Windows Vista, et
 * tous les navigateurs la lisent : chaque taille est un PNG dans une autre
 * boîte, et le navigateur choisit celle qui convient (16 pour un onglet, 32
 * pour un écran haute densité, 48 pour un raccourci). `/favicon.ico` reste
 * nécessaire même quand une page déclare son icône — un navigateur le demande
 * pour toute réponse qui n'est pas du HTML (la page d'accueil JSON d'une
 * application sans front, par exemple).
 *
 * @param pngs - les octets de PNG valides, chacun d'au plus 256 pixels de côté
 * @returns le fichier ICO : en-tête de 6 octets, une entrée de 16 par image,
 *   puis les PNG dans l'ordre reçu
 * @throws Si aucune image n'est fournie, si des octets ne sont pas un PNG, ou
 *   si une image dépasse 256 pixels
 */
export function pngToIco(...pngs: Uint8Array[]): Uint8Array {
  if (pngs.length === 0) {
    throw new Error("pngToIco : aucune image");
  }
  const images = pngs.map((png) => Buffer.from(png));
  const header = Buffer.alloc(6 + 16 * images.length);
  header.writeUInt16LE(0, 0); // réservé
  header.writeUInt16LE(1, 2); // type : icône
  header.writeUInt16LE(images.length, 4);
  let offset = header.length;
  images.forEach((data, i) => {
    const { width, height } = pngSize(data);
    if (width === 0 || height === 0 || width > 256 || height > 256) {
      throw new Error(
        `pngToIco : ${String(width)}×${String(height)} hors du format ICO (1 à 256 pixels)`,
      );
    }
    const entry = 6 + 16 * i;
    header.writeUInt8(width === 256 ? 0 : width, entry); // 0 signifie 256
    header.writeUInt8(height === 256 ? 0 : height, entry + 1);
    header.writeUInt8(0, entry + 2); // pas de palette
    header.writeUInt8(0, entry + 3); // réservé
    header.writeUInt16LE(1, entry + 4); // plans
    header.writeUInt16LE(32, entry + 6); // bits par pixel
    header.writeUInt32LE(data.length, entry + 8); // taille de l'image
    header.writeUInt32LE(offset, entry + 12); // position de l'image
    offset += data.length;
  });
  return Buffer.concat([header, ...images]);
}

/**
 * Le contenu d'un fichier de marque, lu dans le paquet `nodefony`.
 *
 * @param asset - le fichier voulu
 * @param packageRoot - racine du paquet `nodefony`
 * @returns le nom du fichier dans `public/` et ses octets
 */
export function brandAssetContent(
  asset: TBrandAsset,
  packageRoot: string,
): { name: string; content: Uint8Array } {
  return asset === "logo"
    ? { name: "nodefony-logo.png", content: readBrandLogo(packageRoot) }
    : { name: "favicon.ico", content: readBrandFavicon(packageRoot) };
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
  const written: string[] = [];
  for (const asset of assets) {
    const { name, content } = brandAssetContent(asset, packageRoot);
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
