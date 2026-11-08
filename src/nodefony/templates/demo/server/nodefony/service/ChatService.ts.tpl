import { randomUUID } from "node:crypto";
import { mkdir, open, readFile, rm, unlink } from "node:fs/promises";
import path from "node:path";
import { Service, Module, injectable } from "nodefony";
import type { IUploadedFile } from "@nodefony/http";
import { ATTACHMENT_MAX_BYTES } from "../../frontend/src/chat/chatContract";
import type {
  ChatAttachment,
  ChatMessage,
} from "../../frontend/src/chat/chatContract";
import { countLines, previewLines } from "../../frontend/src/chat/attachments";

/** Messages gardés en mémoire : au-delà, les plus anciens sortent. */
export const CHAT_HISTORY_LIMIT = 200;

/** Pièces gardées sur disque : au-delà, les plus anciennes sortent. */
export const CHAT_ATTACHMENT_LIMIT = 50;

/** Le dossier des pièces, sous le `tmp/` de l'application. */
export const CHAT_ATTACHMENT_DIR = "demo-chat";

/** Une pièce gardée : ce que le salon annonce, et de quoi la servir. */
export interface IStoredAttachment {
  meta: ChatAttachment;
  /** Chemin du fichier, choisi par le serveur (l'id), jamais par le client. */
  file: string;
  /** Le type servi, tiré des octets. */
  mime: string;
}

/**
 * Les seules images affichées DANS la page, reconnues à leurs premiers octets.
 * Un SVG n'y est pas : c'est un document, qui peut porter du script.
 */
const IMAGE_SIGNATURES: readonly {
  mime: string;
  at: number;
  bytes: readonly number[];
}[] = [
  { mime: "image/png", at: 0, bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a] },
  { mime: "image/jpeg", at: 0, bytes: [0xff, 0xd8, 0xff] },
  { mime: "image/gif", at: 0, bytes: [0x47, 0x49, 0x46, 0x38] },
  { mime: "image/webp", at: 8, bytes: [0x57, 0x45, 0x42, 0x50] },
];

/**
 * Le type d'image que prouvent les premiers octets, ou `null`.
 *
 * @param head - les premiers octets du fichier (12 suffisent)
 */
export function sniffImage(head: Uint8Array): string | null {
  for (const signature of IMAGE_SIGNATURES) {
    if (signature.bytes.every((byte, i) => head[signature.at + i] === byte)) {
      // WebP : « RIFF » en tête, en plus de « WEBP » à l'octet 8.
      if (signature.mime === "image/webp" && head[0] !== 0x52) continue;
      return signature.mime;
    }
  }
  return null;
}

/**
 * Le texte d'un fichier, s'il en est un : UTF-8 valide, sans octet nul.
 *
 * @returns le texte, ou `null` pour un fichier binaire
 */
export function decodeText(bytes: Uint8Array): string | null {
  if (bytes.includes(0)) return null;
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}

/** Un fichier reçu en multipart : `this.files` est typé `unknown[]`. */
export function isUploadedFile(value: unknown): value is IUploadedFile {
  return (
    typeof value === "object" &&
    value !== null &&
    "moveAsync" in value &&
    typeof value.moveAsync === "function" &&
    "filename" in value &&
    typeof value.filename === "string" &&
    "size" in value &&
    typeof value.size === "number"
  );
}

/**
 * L'historique du salon et ses pièces jointes — un service, parce que le
 * contrôleur temps réel est instancié PAR CONNEXION : l'historique doit
 * survivre à chacune.
 *
 * Guide pour un agent : ici en MÉMOIRE et BORNÉ (une démo ne suppose pas ta
 * base, et un stock sans borne est une fuite). Le persister : une entité et
 * son repository derrière ces méthodes — `npx nodefony create entity
 * message`, doc `@nodefony/realtime/docs/cookbook-chat.md` (étape 4). Le
 * contrôleur n'en saura rien. Les pièces vivent sur le disque de CE serveur :
 * avec plusieurs pods, un stockage partagé (objet, base) les remplace derrière
 * `saveAttachments` et `attachment`. Injecté par `@Inject("ChatService")`.
 */
@injectable()
class ChatService extends Service {
  readonly #messages: ChatMessage[] = [];
  readonly #attachments = new Map<string, IStoredAttachment>();
  readonly #dir: string | null;
  #ready: Promise<string> | null = null;

  /**
   * @param module - le module qui le déclare ; absent dans un test, qui le
   *   construit sans kernel
   * @param attachmentDir - le dossier des pièces ; par défaut
   *   `<tmp de l'application>/demo-chat`
   */
  constructor(module?: Module, attachmentDir?: string) {
    super("chat", module?.container ?? undefined, module?.notificationsCenter);
    this.#dir = attachmentDir ?? null;
  }

  // #region chat-store
  /** Garde un message ; le plus ancien sort au-delà de la borne. */
  add(message: ChatMessage): void {
    this.#messages.push(message);
    if (this.#messages.length > CHAT_HISTORY_LIMIT) this.#messages.shift();
  }

  /**
   * Les derniers messages, dans l'ordre d'envoi.
   *
   * @param limit - nombre maximal de messages rendus
   * @param since - seulement ceux envoyés après cet instant (rattrapage)
   */
  recent(limit: number, since?: number): ChatMessage[] {
    const kept =
      since === undefined
        ? this.#messages
        : this.#messages.filter((message) => message.sentAt > since);
    return kept.slice(-limit);
  }
  // #endregion

  // #region chat-attachments
  /**
   * Garde les pièces d'un message : chaque fichier est DÉPLACÉ (jamais lu en
   * entier, sauf un texte de 2 Mio au plus) sous un nom tiré par le serveur,
   * puis classé d'après ses octets — image reconnue, texte UTF-8, ou fichier.
   *
   * @returns ce que le salon annoncera de chaque pièce
   */
  async saveAttachments(
    files: readonly IUploadedFile[],
  ): Promise<ChatAttachment[]> {
    const dir = await this.#directory();
    const saved: ChatAttachment[] = [];
    for (const upload of files) {
      const id = randomUUID();
      const file = path.join(dir, id);
      await upload.moveAsync(file);
      const stored = await classify(id, upload.filename, upload.size, file);
      this.#attachments.set(id, stored);
      saved.push(stored.meta);
    }
    await this.#evict();
    return saved;
  }

  /** Une pièce gardée, par son id ; `undefined` si inconnue ou sortie. */
  attachment(id: string): IStoredAttachment | undefined {
    return this.#attachments.get(id);
  }

  /** Efface des fichiers reçus mais refusés : rien ne reste sur le disque. */
  async discard(files: readonly IUploadedFile[]): Promise<void> {
    const dir = await this.#directory();
    for (const upload of files) {
      const file = path.join(dir, randomUUID());
      await upload.moveAsync(file);
      await unlink(file);
    }
  }

  /** Au-delà de la borne, les plus anciennes pièces sortent : fichier effacé, annonce marquée. */
  async #evict(): Promise<void> {
    for (const [id, stored] of this.#attachments) {
      if (this.#attachments.size <= CHAT_ATTACHMENT_LIMIT) return;
      this.#attachments.delete(id);
      // L'objet est celui que porte le message de l'historique : il le dit.
      stored.meta.expired = true;
      await unlink(stored.file).catch(() => undefined);
    }
  }
  // #endregion

  /**
   * Le dossier des pièces, vidé au premier usage : l'index vit en mémoire, et
   * les fichiers d'un démarrage précédent n'y figurent plus. Un sous-dossier
   * par processus : sous `nodefony cluster`, un worker ne vide pas celui d'un
   * autre.
   */
  #directory(): Promise<string> {
    this.#ready ??= (async () => {
      const tmp = this.kernel?.tmpDir?.path;
      const dir =
        this.#dir ??
        (typeof tmp === "string"
          ? path.join(tmp, CHAT_ATTACHMENT_DIR, String(process.pid))
          : null);
      if (dir === null)
        throw new Error("ChatService : aucun dossier pour les pièces jointes");
      await rm(dir, { recursive: true, force: true });
      await mkdir(dir, { recursive: true });
      return dir;
    })();
    return this.#ready;
  }
}

/** Classe une pièce d'après ses octets. */
async function classify(
  id: string,
  name: string,
  size: number,
  file: string,
): Promise<IStoredAttachment> {
  const handle = await open(file, "r");
  const head = new Uint8Array(12);
  try {
    await handle.read(head, 0, head.length, 0);
  } finally {
    await handle.close();
  }
  const image = sniffImage(head);
  if (image !== null) {
    return { meta: { id, name, size, kind: "image" }, file, mime: image };
  }
  const text =
    size <= ATTACHMENT_MAX_BYTES ? decodeText(await readFile(file)) : null;
  if (text !== null) {
    return {
      meta: {
        id,
        name,
        size,
        kind: "text",
        lines: countLines(text),
        preview: previewLines(text),
      },
      file,
      mime: "text/plain; charset=utf-8",
    };
  }
  return {
    meta: { id, name, size, kind: "file" },
    file,
    mime: "application/octet-stream",
  };
}

export default ChatService;
