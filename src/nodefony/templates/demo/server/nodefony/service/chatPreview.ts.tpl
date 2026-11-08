import { createGunzip, createInflateRaw } from "node:zlib";
import type {
  ChatArchiveEntry,
  ChatAttachment,
  ChatAttachmentFormat,
} from "../../frontend/src/chat/chatContract";

/**
 * L'aperçu d'une pièce qu'on ne montre pas telle quelle : PDF, archive (zip,
 * tar, tar.gz), document Word ou ODT, tableur Excel ou ODS.
 *
 * Guide pour un agent : fonctions PURES, sans dépendance — une archive se
 * lit par son INDEX, rien n'est extrait sur le disque. Tout est borné : la
 * pièce fait 2 Mio au plus (`ATTACHMENT_MAX_BYTES`), et ce qui se
 * décompresse s'arrête à `INFLATE_LIMIT` — une « bombe » de quelques Ko qui
 * se déplierait en gigaoctets est coupée au premier mégaoctet. Hors
 * périmètre : la mise en page, les images d'un document, les présentations
 * (pptx, odp) — elles restent des fichiers à télécharger.
 */

/** Entrées d'archive annoncées au plus. */
export const PREVIEW_ENTRIES = 20;

/** Paragraphes d'un document annoncés au plus… */
export const PREVIEW_PARAGRAPHS = 8;

/** …de ce nombre de caractères chacun. */
export const PREVIEW_PARAGRAPH_CHARS = 300;

/** Le coin d'une feuille : lignes… */
export const PREVIEW_ROWS = 10;

/** …et colonnes. */
export const PREVIEW_COLUMNS = 6;

/** Caractères d'une cellule au plus. */
export const PREVIEW_CELL_CHARS = 60;

/** Octets décompressés au plus, par flux (1 Mio). */
export const INFLATE_LIMIT = 1_048_576;

/** Ce que l'aperçu ajoute à l'annonce d'une pièce, et le type à servir. */
export interface IPreview {
  fields: Omit<ChatAttachment, "id" | "name" | "size">;
  mime: string;
}

/** Ce qu'un flux compressé a rendu, coupé ou non au plafond. */
export interface IInflated {
  bytes: Buffer;
  truncated: boolean;
}

/** Une entrée de l'index central d'un zip. */
export interface IZipEntry extends ChatArchiveEntry {
  compressedSize: number;
  method: number;
  offset: number;
  encrypted: boolean;
}

/** Les types servis, par format. */
const MIME: Record<ChatAttachmentFormat, string> = {
  zip: "application/zip",
  tar: "application/x-tar",
  "tar.gz": "application/gzip",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  odt: "application/vnd.oasis.opendocument.text",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ods: "application/vnd.oasis.opendocument.spreadsheet",
};

const UTF8 = new TextDecoder("utf-8");

/** Vrai si `bytes` porte `signature` à partir de `at`. */
function startsWith(bytes: Uint8Array, signature: string, at = 0): boolean {
  for (let i = 0; i < signature.length; i += 1)
    if (bytes[at + i] !== signature.charCodeAt(i)) return false;
  return true;
}

// #region chat-preview
/**
 * Ce que prouvent les premiers octets : un PDF, un zip (Office compris), un
 * flux gzip, une archive tar — ou rien de tout ça.
 *
 * @param head - les premiers octets du fichier (512 suffisent pour tar)
 */
export function sniffContainer(
  head: Uint8Array,
): "pdf" | "zip" | "gzip" | "tar" | null {
  if (startsWith(head, "%PDF-")) return "pdf";
  // « PK » + en-tête local, ou fin d'index seule (zip vide).
  if (startsWith(head, "PK\u0003\u0004") || startsWith(head, "PK\u0005\u0006"))
    return "zip";
  if (head[0] === 0x1f && head[1] === 0x8b) return "gzip";
  if (startsWith(head, "ustar", 257)) return "tar";
  return null;
}

/**
 * L'aperçu d'une pièce entière, décidé d'après ses OCTETS : rien n'est cru du
 * nom ni du type déclaré. Un contenu illisible (zip tronqué, gzip qui n'est
 * pas un tar) rend `null` : la pièce reste un fichier à télécharger.
 *
 * @param bytes - la pièce (2 Mio au plus)
 */
export async function previewOf(bytes: Uint8Array): Promise<IPreview | null> {
  switch (sniffContainer(bytes)) {
    case "pdf":
      return { fields: { kind: "pdf" }, mime: "application/pdf" };
    case "zip":
      return previewZip(bytes);
    case "tar":
      return previewTar(bytes, "tar", false);
    case "gzip": {
      const tar = await inflateHead(bytes, "gzip", INFLATE_LIMIT);
      return previewTar(tar.bytes, "tar.gz", tar.truncated);
    }
    case null:
      return null;
  }
}
// #endregion

// #region chat-inflate-cap
/**
 * Décompresse au plus `limit` octets, puis COUPE le flux : la taille annoncée
 * par une archive n'est jamais crue, seule compte ce qui sort réellement.
 *
 * @param kind - `raw` (entrée de zip) ou `gzip`
 * @returns les octets obtenus, et s'il en restait
 */
export function inflateHead(
  data: Uint8Array,
  kind: "raw" | "gzip",
  limit: number,
): Promise<IInflated> {
  return new Promise((resolve) => {
    const stream = kind === "raw" ? createInflateRaw() : createGunzip();
    const chunks: Buffer[] = [];
    let total = 0;
    const finish = (truncated: boolean) => {
      stream.removeAllListeners();
      stream.destroy();
      resolve({ bytes: Buffer.concat(chunks, total), truncated });
    };
    stream.on("data", (chunk: Buffer) => {
      const room = limit - total;
      if (chunk.length > room) {
        chunks.push(chunk.subarray(0, room));
        total = limit;
        finish(true);
        return;
      }
      chunks.push(chunk);
      total += chunk.length;
    });
    stream.on("end", () => finish(false));
    // Flux corrompu : ce qui est déjà sorti suffit à l'aperçu.
    stream.on("error", () => finish(true));
    stream.end(data);
  });
}
// #endregion

/**
 * L'index central d'un zip : noms et tailles, sans rien décompresser.
 *
 * @returns les entrées, ou `null` si l'index est introuvable ou incohérent
 */
export function readZipIndex(bytes: Uint8Array): IZipEntry[] | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  // La fin d'index (22 octets) suit un commentaire de 64 Kio au plus.
  let end = -1;
  for (
    let at = bytes.length - 22;
    at >= Math.max(0, bytes.length - 22 - 0xffff);
    at -= 1
  ) {
    if (view.getUint32(at, true) === 0x06054b50) {
      end = at;
      break;
    }
  }
  if (end < 0) return null;
  const count = view.getUint16(end + 10, true);
  let at = view.getUint32(end + 16, true);
  const entries: IZipEntry[] = [];
  for (let n = 0; n < count; n += 1) {
    if (at + 46 > bytes.length || view.getUint32(at, true) !== 0x02014b50)
      return null;
    const nameLength = view.getUint16(at + 28, true);
    entries.push({
      name: UTF8.decode(bytes.subarray(at + 46, at + 46 + nameLength)),
      size: view.getUint32(at + 24, true),
      compressedSize: view.getUint32(at + 20, true),
      method: view.getUint16(at + 10, true),
      offset: view.getUint32(at + 42, true),
      encrypted: (view.getUint16(at + 8, true) & 1) === 1,
    });
    at +=
      46 +
      nameLength +
      view.getUint16(at + 30, true) +
      view.getUint16(at + 32, true);
  }
  return entries;
}

/**
 * Le contenu d'UNE entrée de zip, plafonné : stockée telle quelle ou
 * « deflate » — tout autre procédé, ou une entrée chiffrée, rend `null`.
 */
export async function readZipEntry(
  bytes: Uint8Array,
  entry: IZipEntry,
  limit = INFLATE_LIMIT,
): Promise<IInflated | null> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const at = entry.offset;
  if (entry.encrypted || at + 30 > bytes.length) return null;
  if (view.getUint32(at, true) !== 0x04034b50) return null;
  const start =
    at + 30 + view.getUint16(at + 26, true) + view.getUint16(at + 28, true);
  const data = bytes.subarray(start, start + entry.compressedSize);
  if (entry.method === 0)
    return {
      bytes: Buffer.from(data.subarray(0, limit)),
      truncated: data.length > limit,
    };
  if (entry.method === 8) return inflateHead(data, "raw", limit);
  return null;
}

/** Un zip : document Office, document ODF, ou simple archive. */
async function previewZip(bytes: Uint8Array): Promise<IPreview | null> {
  const index = readZipIndex(bytes);
  if (index === null) return null;
  const named = (name: string) => index.find((entry) => entry.name === name);
  const text = async (entry: IZipEntry | undefined) => {
    if (entry === undefined) return null;
    const read = await readZipEntry(bytes, entry);
    return read === null
      ? null
      : { xml: UTF8.decode(read.bytes), truncated: read.truncated };
  };

  const word = await text(named("word/document.xml"));
  if (word !== null)
    return document("docx", docxParagraphs(word.xml), word.truncated);

  const sheet =
    index.find((entry) => entry.name === "xl/worksheets/sheet1.xml") ??
    index.find((entry) => /^xl\/worksheets\/[^/]+\.xml$/.test(entry.name));
  if (named("xl/workbook.xml") !== undefined && sheet !== undefined) {
    const cells = await text(sheet);
    const strings = await text(named("xl/sharedStrings.xml"));
    if (cells !== null)
      return table(
        "xlsx",
        xlsxRows(cells.xml, sharedStrings(strings?.xml ?? "")),
        cells.truncated,
      );
  }

  // ODF : l'entrée `mimetype`, stockée en premier, dit le genre du document.
  const kind = (await text(named("mimetype")))?.xml.trim();
  if (kind === MIME.odt || kind === MIME.ods) {
    const content = await text(named("content.xml"));
    if (content !== null)
      return kind === MIME.odt
        ? document("odt", odtParagraphs(content.xml), content.truncated)
        : table("ods", odsRows(content.xml), content.truncated);
  }

  return {
    fields: {
      kind: "archive",
      format: "zip",
      entries: index
        .slice(0, PREVIEW_ENTRIES)
        .map((entry) => ({ name: entry.name, size: entry.size })),
      total: index.length,
    },
    mime: MIME.zip,
  };
}

/** Une chaîne C (terminée par un octet nul) d'un en-tête tar. */
function field(header: Uint8Array, at: number, length: number): string {
  const slice = header.subarray(at, at + length);
  const zero = slice.indexOf(0);
  return UTF8.decode(zero < 0 ? slice : slice.subarray(0, zero));
}

/**
 * L'index d'une archive tar (ustar), en parcourant ses en-têtes de 512 octets.
 *
 * @param truncated - les octets s'arrêtent avant la fin (gzip plafonné)
 */
export function previewTar(
  bytes: Uint8Array,
  format: "tar" | "tar.gz",
  truncated: boolean,
): IPreview | null {
  if (sniffContainer(bytes) !== "tar") return null;
  const entries: ChatArchiveEntry[] = [];
  let total = 0;
  let longName: string | null = null;
  let at = 0;
  while (at + 512 <= bytes.length) {
    const header = bytes.subarray(at, at + 512);
    if (header.every((byte) => byte === 0)) break;
    const size = Number.parseInt(field(header, 124, 12).trim() || "0", 8);
    if (!Number.isFinite(size) || size < 0) break;
    const type = String.fromCharCode(header.at(156) ?? 0);
    if (type === "L") {
      // Nom long GNU : il est le CONTENU de cette entrée, et vaut pour la suivante.
      longName = field(bytes, at + 512, size);
    } else if (type !== "x" && type !== "g" && type !== "K") {
      const prefix = field(header, 345, 155);
      const name =
        longName ??
        (prefix === ""
          ? field(header, 0, 100)
          : `${prefix}/${field(header, 0, 100)}`);
      longName = null;
      total += 1;
      if (entries.length < PREVIEW_ENTRIES)
        entries.push({ name, size: type === "5" ? 0 : size });
    }
    at += 512 + Math.ceil(size / 512) * 512;
  }
  return {
    fields: { kind: "archive", format, entries, total, truncated },
    mime: MIME[format],
  };
}

/** Les entités XML d'un texte. */
function decodeXml(text: string): string {
  return text.replace(
    /&(#x[0-9a-f]+|#[0-9]+|lt|gt|amp|quot|apos);/gi,
    (entity: string, name: string) => {
      const lower = name.toLowerCase();
      if (lower.startsWith("#x"))
        return String.fromCodePoint(Number.parseInt(lower.slice(2), 16));
      if (lower.startsWith("#"))
        return String.fromCodePoint(Number.parseInt(lower.slice(1), 10));
      const named: Record<string, string> = {
        lt: "<",
        gt: ">",
        amp: "&",
        quot: '"',
        apos: "'",
      };
      return named[lower] ?? entity;
    },
  );
}

/** Un texte borné, avec « … » s'il est coupé. */
function clip(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/** Les premiers paragraphes NON VIDES, bornés. */
function paragraphsOf(blocks: Iterable<string>): string[] {
  const out: string[] = [];
  for (const block of blocks) {
    const text = decodeXml(block).replace(/\s+/g, " ").trim();
    if (text !== "") out.push(clip(text, PREVIEW_PARAGRAPH_CHARS));
    if (out.length >= PREVIEW_PARAGRAPHS) break;
  }
  return out;
}

/** Les paragraphes d'un `word/document.xml` : le texte des `<w:t>`. */
export function docxParagraphs(xml: string): string[] {
  return paragraphsOf(
    xml.split("</w:p>").map((block) => {
      let text = "";
      for (const run of block.matchAll(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>/g))
        text += run.at(1) ?? "";
      return text;
    }),
  );
}

/** Le texte d'un fragment ODF : espaces et tabulations rendus, balises ôtées. */
function odfText(fragment: string): string {
  return fragment
    .replace(/<text:(?:s|tab|line-break)(?:\s[^>]*)?\/>/g, " ")
    .replace(/<[^>]*>/g, "");
}

/** Les paragraphes et titres d'un `content.xml` ODT. */
export function odtParagraphs(xml: string): string[] {
  return paragraphsOf(xml.split(/<\/text:(?:p|h)>/).map(odfText));
}

/** Les chaînes partagées d'un classeur Excel, dans l'ordre de leur index. */
export function sharedStrings(xml: string): string[] {
  return xml
    .split("</si>")
    .slice(0, -1)
    .map((item) => {
      let text = "";
      for (const run of item.matchAll(/<t(?:\s[^>]*)?>([^<]*)<\/t>/g))
        text += run.at(1) ?? "";
      return decodeXml(text);
    });
}

/** L'index de colonne d'une référence de cellule (`C7` → 2). */
function columnOf(reference: string): number {
  let index = 0;
  for (const char of reference) {
    const code = char.charCodeAt(0);
    if (code < 65 || code > 90) break;
    index = index * 26 + (code - 64);
  }
  return index - 1;
}

/** Retire les lignes et colonnes vides de la fin, borne chaque cellule. */
function trimGrid(rows: string[][]): string[][] {
  const kept = rows.map((row) =>
    row
      .slice(0, PREVIEW_COLUMNS)
      .map((cell) => clip(cell.trim(), PREVIEW_CELL_CHARS)),
  );
  while (kept.length > 0 && (kept.at(-1) ?? []).every((cell) => cell === ""))
    kept.pop();
  const width = Math.max(
    0,
    ...kept.map((row) => row.findLastIndex((cell) => cell !== "") + 1),
  );
  return kept.map((row) =>
    Array.from({ length: width }, (_, i) => row[i] ?? ""),
  );
}

/** Le coin haut-gauche d'une feuille Excel (`xl/worksheets/sheet1.xml`). */
export function xlsxRows(xml: string, strings: readonly string[]): string[][] {
  const rows: string[][] = [];
  for (const block of xml.split("</row>").slice(0, -1)) {
    const row: string[] = [];
    for (const cell of block.matchAll(
      /<c\s([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g,
    )) {
      const attrs = cell.at(1) ?? "";
      const column = columnOf(/\br="([A-Z]+)/.exec(attrs)?.[1] ?? "");
      if (column < 0 || column >= PREVIEW_COLUMNS) continue;
      // Groupe absent d'une cellule vide (`<c …/>`) : `at()` le dit.
      const body = cell.at(2) ?? "";
      const type = /\bt="([a-zA-Z]+)"/.exec(attrs)?.[1];
      const value = /<v>([^<]*)<\/v>/.exec(body)?.[1] ?? "";
      row[column] =
        type === "s"
          ? (strings[Number(value)] ?? "")
          : type === "inlineStr"
            ? decodeXml(/<t(?:\s[^>]*)?>([^<]*)<\/t>/.exec(body)?.[1] ?? "")
            : decodeXml(value);
    }
    rows.push(Array.from({ length: row.length }, (_, i) => row[i] ?? ""));
    if (rows.length >= PREVIEW_ROWS) break;
  }
  return trimGrid(rows);
}

/** Le coin haut-gauche de la PREMIÈRE feuille d'un `content.xml` ODS. */
export function odsRows(xml: string): string[][] {
  const start = xml.indexOf("<table:table ");
  const end = xml.indexOf("</table:table>", start);
  const sheet = start < 0 ? "" : xml.slice(start, end < 0 ? undefined : end);
  const rows: string[][] = [];
  for (const block of sheet.split("</table:table-row>").slice(0, -1)) {
    const open = block.lastIndexOf("<table:table-row");
    const rowXml = open < 0 ? block : block.slice(open);
    const row: string[] = [];
    for (const cell of rowXml.matchAll(
      /<table:(?:covered-)?table-cell(\s[^>]*?)?(?:\/>|>([\s\S]*?)<\/table:(?:covered-)?table-cell>)/g,
    )) {
      const repeat = Number(
        /table:number-columns-repeated="(\d+)"/.exec(cell.at(1) ?? "")?.[1] ??
          "1",
      );
      const text = decodeXml(
        odfText((cell.at(2) ?? "").replaceAll("</text:p>", " ")),
      );
      for (let i = 0; i < repeat && row.length < PREVIEW_COLUMNS; i += 1)
        row.push(text);
      if (row.length >= PREVIEW_COLUMNS) break;
    }
    const repeatRows = Number(
      /table:number-rows-repeated="(\d+)"/.exec(
        rowXml.slice(0, rowXml.indexOf(">") + 1),
      )?.[1] ?? "1",
    );
    for (let i = 0; i < repeatRows && rows.length < PREVIEW_ROWS; i += 1)
      rows.push([...row]);
    if (rows.length >= PREVIEW_ROWS) break;
  }
  return trimGrid(rows);
}

/** L'aperçu d'un document texte. */
function document(
  format: "docx" | "odt",
  paragraphs: string[],
  truncated: boolean,
): IPreview {
  return {
    fields: { kind: "document", format, paragraphs, truncated },
    mime: MIME[format],
  };
}

/** L'aperçu d'un tableur. */
function table(
  format: "xlsx" | "ods",
  rows: string[][],
  truncated: boolean,
): IPreview {
  return {
    fields: { kind: "sheet", format, rows, truncated },
    mime: MIME[format],
  };
}
