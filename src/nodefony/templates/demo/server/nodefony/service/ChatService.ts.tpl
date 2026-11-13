import { randomUUID } from "node:crypto";
import { mkdir, open, readFile, rm, unlink } from "node:fs/promises";
import path from "node:path";
import { Service, Module, injectable } from "nodefony";
import type { IUploadedFile } from "@nodefony/http";
import { getRealtimeHub } from "@nodefony/realtime";
import { ATTACHMENT_MAX_BYTES } from "../../frontend/src/chat/chatContract";
import type {
  ChatAttachment,
  ChatMessage,
  RoomFrame,
} from "../../frontend/src/chat/chatContract";
import { roomChannel } from "../../frontend/src/chat/rooms";
import DemoPulseService, { DEMO_PULSE_SERVICE } from "./DemoPulseService";
import { describeFile, sniffImage } from "../../frontend/src/kit/preview";

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
  /** L'historique de chaque salon, borné salon par salon. */
  readonly #messages = new Map<string, ChatMessage[]>();
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
  /** Garde un message d'un salon ; le plus ancien sort au-delà de la borne. */
  add(roomId: string, message: ChatMessage): void {
    let kept = this.#messages.get(roomId);
    if (kept === undefined) {
      kept = [];
      this.#messages.set(roomId, kept);
    }
    kept.push(message);
    if (kept.length > CHAT_HISTORY_LIMIT) kept.shift();
  }

  /**
   * Publie un message au salon : gardé, diffusé à tous les abonnés de
   * `chat:room`, compté dans le pouls de l'accueil. SEULE voie d'écriture —
   * la route d'envoi, l'envoi de pièces et l'outil MCP `demo_chat_post`
   * l'appellent : trois copies de ces trois gestes divergeraient.
   */
  publish(roomId: string, message: ChatMessage): void {
    this.add(roomId, message);
    publishFrame(roomId, { kind: "message", message });
    const pulse = this.get<unknown>(DEMO_PULSE_SERVICE);
    if (pulse instanceof DemoPulseService) pulse.recordChatMessage();
  }

  /**
   * Les derniers messages, dans l'ordre d'envoi.
   *
   * @param limit - nombre maximal de messages rendus
   * @param since - seulement ceux envoyés après cet instant (rattrapage)
   */
  recent(roomId: string, limit: number, since?: number): ChatMessage[] {
    const all = this.#messages.get(roomId) ?? [];
    const kept =
      since === undefined
        ? all
        : all.filter((message) => message.sentAt > since);
    return kept.slice(-limit);
  }

  /**
   * « Untel écrit… » dans un salon : un message ÉPHÉMÈRE du canal, ni gardé ni
   * compté — il suit donc les droits du salon (un salon privé ne fuit pas sa
   * frappe), ce qu'un canal de frappe commun à tous ne ferait pas.
   */
  typing(roomId: string, author: string): void {
    publishFrame(roomId, { kind: "typing", author });
  }
  // #endregion

  // #region chat-attachments
  /**
   * Garde les pièces d'un message : chaque fichier est DÉPLACÉ (jamais lu en
   * entier, sauf une pièce de 2 Mio au plus à prévisualiser) sous un nom tiré
   * par le serveur, puis classé d'après ses octets — image, PDF, archive,
   * document, tableur, texte UTF-8, ou simple fichier.
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

/**
 * Classe une pièce d'après ses octets : image, puis conteneur reconnu (PDF,
 * archive, bureautique), puis texte, sinon fichier — `describeFile` du kit,
 * le MÊME code que l'aperçu du navigateur avant l'envoi. Le serveur le
 * rejoue : l'aperçu annoncé à tous ne vient jamais du navigateur.
 */
async function classify(
  id: string,
  name: string,
  size: number,
  file: string,
): Promise<IStoredAttachment> {
  if (size <= ATTACHMENT_MAX_BYTES) {
    const described = await describeFile(await readFile(file));
    return {
      meta: { id, name, size, ...described.fields },
      file,
      mime: described.mime,
    };
  }
  // Au-delà du plafond (filet : l'envoi l'a déjà refusé), la tête seule.
  const handle = await open(file, "r");
  const head = new Uint8Array(12);
  try {
    await handle.read(head, 0, head.length, 0);
  } finally {
    await handle.close();
  }
  const image = sniffImage(head);
  return image === null
    ? {
        meta: { id, name, size, kind: "file" },
        file,
        mime: "application/octet-stream",
      }
    : { meta: { id, name, size, kind: "image" }, file, mime: image };
}

/**
 * Publie une trame sur le canal d'un salon. Le hub type les canaux LITTÉRAUX
 * de son contrat, pas encore une famille (`chat:room:<id>`) : la trame est
 * donc typée ICI, à l'unique point d'émission, et la page la vérifie à la
 * réception (`isRoomFrame`).
 */
function publishFrame(roomId: string, frame: RoomFrame): void {
  getRealtimeHub().publish(roomChannel(roomId), frame);
}

export default ChatService;
