import { Service, Module, injectable } from "nodefony";
import type { ChatMessage } from "../../frontend/src/chat/chatContract";

/** Messages gardés en mémoire : au-delà, les plus anciens sortent. */
export const CHAT_HISTORY_LIMIT = 200;

/**
 * L'historique du salon — un service, parce que le contrôleur temps réel est
 * instancié PAR CONNEXION : l'historique doit survivre à chacune.
 *
 * Guide pour un agent : ici en MÉMOIRE et BORNÉ (une démo ne suppose pas ta
 * base, et un stock sans borne est une fuite). Le persister : une entité et
 * son repository derrière ces deux méthodes — `npx nodefony create entity
 * message`, doc `@nodefony/realtime/docs/cookbook-chat.md` (étape 4). Le
 * contrôleur n'en saura rien. Injecté par `@Inject("ChatService")`.
 */
@injectable()
class ChatService extends Service {
  readonly #messages: ChatMessage[] = [];

  /**
   * @param module - le module qui le déclare ; absent dans un test, qui le
   *   construit sans kernel
   */
  constructor(module?: Module) {
    super("chat", module?.container ?? undefined, module?.notificationsCenter);
  }

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
}

export default ChatService;
