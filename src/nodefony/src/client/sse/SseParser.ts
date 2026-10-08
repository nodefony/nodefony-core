/**
 * L'analyseur du format `text/event-stream` — classe {@link SseParser}, publiée
 * par `nodefony/client`.
 *
 * Il n'en existe qu'UN dans le dépôt : {@link NodefonySse} le lit en réception,
 * et les tests d'intégration du serveur s'en servent pour relire ce qu'émet
 * `renderSse()`. Un second analyseur écrit dans un test validerait le serveur
 * contre sa propre lecture de la norme, pas contre celle du client.
 *
 * Norme : WHATWG HTML §9.2.5 (grammaire) et §9.2.6 (interprétation) — copie hors
 * ligne `nodefony-framework-dev/references/rfc/specs/whatwg-sse.md`.
 *
 * @module nodefony/client
 */

/** Un événement reçu, une fois sa ligne vide atteinte (WHATWG §9.2.6). */
export interface ISseEvent {
  /** Le champ `event`, ou `"message"` quand le bloc n'en portait pas. */
  readonly type: string;
  /** Les champs `data` du bloc, joints par un saut de ligne. */
  readonly data: string;
  /** L'identifiant courant du flux, après ce bloc — `""` s'il n'y en a jamais eu. */
  readonly lastEventId: string;
}

/** Taille maximale d'un événement par défaut, en unités UTF-16 : 4 Mi. */
export const SSE_MAX_EVENT_SIZE = 4 * 1024 * 1024;

/**
 * Un événement — ou une ligne — dépasse la taille admise.
 *
 * Le flux est alors hostile ou cassé : un serveur qui n'envoie jamais de fin de
 * ligne ferait grossir le tampon sans limite. Rien de raisonnable ne suit, donc
 * {@link NodefonySse} ferme sans reconnecter.
 */
export class SseLimitError extends RangeError {
  constructor(limit: number) {
    super(`Événement SSE au-delà de ${limit} caractères`);
    this.name = "SseLimitError";
  }
}

/** Ce que l'analyseur rend à mesure qu'il lit. */
export interface ISseParserHandlers {
  /** Un bloc complet, porteur de données. */
  onEvent(event: ISseEvent): void;
  /** Le serveur demande un autre délai de reconnexion (champ `retry`, en ms). */
  onRetry?(ms: number): void;
}

/** Le champ `retry` n'est retenu que s'il ne porte QUE des chiffres ASCII. */
const ASCII_DIGITS = /^[0-9]+$/;

/**
 * Lit un flux `text/event-stream` déjà décodé en texte, morceau par morceau.
 *
 * Un morceau peut couper n'importe où — au milieu d'une ligne, d'un champ, ou
 * entre le CR et le LF d'une fin de ligne : l'analyseur garde la ligne
 * inachevée et l'état du bloc jusqu'au morceau suivant.
 */
export class SseParser {
  readonly #handlers: ISseParserHandlers;
  /**
   * Fin de ligne : CRLF, CR ou LF — les trois sont admises (§9.2.5). Propre à
   * l'instance : une regex globale partagée porte son `lastIndex`, et un
   * gestionnaire qui analyse un AUTRE flux pendant la lecture le corromprait.
   */
  readonly #endOfLine = /\r\n|\r|\n/g;
  /** Ligne commencée dans un morceau précédent, pas encore terminée. */
  #pending = "";
  /** Le morceau précédent finissait par CR : un LF en tête du suivant le complète. */
  #skipLeadingLf = false;
  /** Aucun caractère lu : un BOM initial est encore à écarter. */
  #atStart = true;
  #data = "";
  #hasData = false;
  #type = "";
  #idBuffer = "";
  #lastEventId = "";

  /**
   * @param handlers - qui reçoit les événements et les délais de reconnexion.
   * @param lastEventId - l'identifiant connu avant ce flux (reprise après
   *   une reconnexion) : un bloc sans `id` le conserve.
   * @param maxEventSize - taille maximale d'une ligne inachevée ou des données
   *   d'un bloc, en unités UTF-16 ; au-delà, `push` lève {@link SseLimitError}.
   */
  readonly #maxEventSize: number;

  constructor(
    handlers: ISseParserHandlers,
    lastEventId = "",
    maxEventSize: number = SSE_MAX_EVENT_SIZE,
  ) {
    this.#handlers = handlers;
    this.#maxEventSize = maxEventSize;
    this.#idBuffer = lastEventId;
    this.#lastEventId = lastEventId;
  }

  /** L'identifiant courant du flux — celui qu'une reconnexion renverra. */
  get lastEventId(): string {
    return this.#lastEventId;
  }

  /**
   * Lit un morceau du flux.
   *
   * @param chunk - texte déjà décodé (UTF-8, §9.2.5).
   * @throws SseLimitError quand une ligne ou un bloc dépasse la taille admise.
   */
  push(chunk: string): void {
    let text = chunk;
    if (this.#skipLeadingLf && text.length > 0) {
      this.#skipLeadingLf = false;
      if (text.charCodeAt(0) === 0x0a) text = text.slice(1);
    }
    if (this.#atStart && text.length > 0) {
      this.#atStart = false;
      if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
    }
    let start = 0;
    this.#endOfLine.lastIndex = 0;
    for (
      let match = this.#endOfLine.exec(text);
      match !== null;
      match = this.#endOfLine.exec(text)
    ) {
      const line =
        start === 0 && this.#pending.length > 0
          ? this.#pending + text.slice(0, match.index)
          : text.slice(start, match.index);
      if (start === 0) this.#pending = "";
      start = match.index + match[0].length;
      // Un CR en DERNIÈRE position ne dit pas encore s'il est suivi d'un LF.
      if (match[0] === "\r" && start === text.length) {
        this.#skipLeadingLf = true;
      }
      this.#line(line);
    }
    if (start < text.length) {
      this.#pending = start === 0 ? this.#pending + text : text.slice(start);
      if (this.#pending.length > this.#maxEventSize) {
        throw new SseLimitError(this.#maxEventSize);
      }
    }
  }

  /**
   * Fin du flux : la ligne et le bloc inachevés sont jetés — un bloc que
   * n'a pas clos une ligne vide n'est jamais rendu (§9.2.6).
   */
  end(): void {
    this.#pending = "";
    this.#skipLeadingLf = false;
    this.#data = "";
    this.#hasData = false;
    this.#type = "";
    this.#idBuffer = this.#lastEventId;
  }

  /** Une ligne complète, sans sa fin de ligne. */
  #line(line: string): void {
    if (line.length === 0) {
      this.#dispatch();
      return;
    }
    if (line.charCodeAt(0) === 0x3a) return; // `:` — commentaire
    const colon = line.indexOf(":");
    if (colon === -1) {
      this.#field(line, "");
      return;
    }
    let value = line.slice(colon + 1);
    if (value.charCodeAt(0) === 0x20) value = value.slice(1);
    this.#field(line.slice(0, colon), value);
  }

  /** Un champ — noms comparés tels quels, sans repli de casse (§9.2.6). */
  #field(name: string, value: string): void {
    switch (name) {
      case "event":
        this.#type = value;
        break;
      case "data":
        this.#data = this.#hasData ? `${this.#data}\n${value}` : value;
        this.#hasData = true;
        if (this.#data.length > this.#maxEventSize) {
          throw new SseLimitError(this.#maxEventSize);
        }
        break;
      case "id":
        if (!value.includes("\0")) this.#idBuffer = value;
        break;
      case "retry":
        if (ASCII_DIGITS.test(value)) {
          this.#handlers.onRetry?.(Number.parseInt(value, 10));
        }
        break;
      default:
        // Champ inconnu : ignoré.
        break;
    }
  }

  /** Ligne vide : le bloc se referme, et se rend s'il portait des données. */
  #dispatch(): void {
    this.#lastEventId = this.#idBuffer;
    if (!this.#hasData) {
      this.#type = "";
      return;
    }
    const event: ISseEvent = {
      type: this.#type === "" ? "message" : this.#type,
      data: this.#data,
      lastEventId: this.#lastEventId,
    };
    this.#data = "";
    this.#hasData = false;
    this.#type = "";
    this.#handlers.onEvent(event);
  }
}
