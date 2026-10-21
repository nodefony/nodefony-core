import { createHash, randomBytes } from "node:crypto";

/** Durée de vie d'un ticket : le temps d'une requête de connexion en boucle locale. */
export const PROFILE_TICKET_TTL_MS = 10_000;

/**
 * Tickets en attente au plus. Un profilage en émet UN et le rachète aussitôt :
 * en atteindre huit signale un usage anormal, refusé plutôt qu'accumulé.
 */
export const PROFILE_TICKET_MAX_PENDING = 8;

/** Longueur d'un ticket : 32 octets d'aléa en base64url, sans remplissage. */
export const PROFILE_TICKET_LENGTH = 43;

/** En-tête qui porte le ticket vers la route de connexion du profilage. */
export const PROFILE_TICKET_HEADER = "x-nodefony-profile-ticket";

const TICKET_SHAPE = /^[A-Za-z0-9_-]+$/u;

/** Réglages du magasin — injectés par les tests, défauts en production. */
export interface IProfileTicketStoreOptions {
  /** Horloge, en millisecondes. */
  readonly now?: () => number;
  /** Empreinte d'un ticket (instrumentée pour compter les hachages). */
  readonly fingerprint?: (ticket: string) => string;
}

interface IPendingTicket {
  readonly identifier: string;
  readonly expiresAt: number;
}

/** Empreinte sous laquelle un ticket est rangé : le ticket brut n'est jamais gardé. */
export function fingerprintTicket(ticket: string): string {
  return createHash("sha256").update(ticket).digest("hex");
}

/**
 * Tickets à usage unique qui autorisent l'ouverture d'UNE session de profilage
 * pour une identité donnée.
 *
 * Le ticket ne quitte jamais le process : l'outil qui l'émet est celui qui le
 * présente, en boucle locale, à la route `POST /nodefony/devkit/profile-session`.
 * L'identité est fixée à l'émission — la requête de rachat n'en porte aucune,
 * donc ne peut pas en choisir une autre.
 *
 * Aucune minuterie : les tickets expirés sont purgés à chaque émission et à
 * chaque rachat, sur au plus {@link PROFILE_TICKET_MAX_PENDING} entrées.
 */
export class ProfileTicketStore {
  readonly #now: () => number;
  readonly #fingerprint: (ticket: string) => string;
  readonly #pending = new Map<string, IPendingTicket>();

  /**
   * @param options - horloge et empreinte, injectées par les tests.
   */
  constructor(options: IProfileTicketStoreOptions = {}) {
    this.#now = options.now ?? Date.now;
    this.#fingerprint = options.fingerprint ?? fingerprintTicket;
  }

  /** Nombre de tickets émis, ni rachetés ni expirés. */
  get pending(): number {
    this.#purge();
    return this.#pending.size;
  }

  /**
   * Émet un ticket pour `identifier`, valable {@link PROFILE_TICKET_TTL_MS} ms.
   *
   * @param identifier - identifiant du compte pour lequel la session s'ouvrira.
   * @returns le ticket, à présenter dans {@link PROFILE_TICKET_HEADER}.
   * @throws Error - identifiant vide, ou plafond de tickets en attente atteint.
   */
  issue(identifier: string): string {
    if (identifier.length === 0) {
      throw new Error("ticket de profilage : identifiant vide");
    }
    this.#purge();
    if (this.#pending.size >= PROFILE_TICKET_MAX_PENDING) {
      throw new Error(
        `ticket de profilage : ${PROFILE_TICKET_MAX_PENDING} tickets déjà en attente`,
      );
    }
    const ticket = randomBytes(32).toString("base64url");
    this.#pending.set(this.#fingerprint(ticket), {
      identifier,
      expiresAt: this.#now() + PROFILE_TICKET_TTL_MS,
    });
    return ticket;
  }

  /**
   * Rachète un ticket : le retire, et rend l'identité pour laquelle il a été émis.
   *
   * La forme est contrôlée AVANT l'empreinte : une entrée hostile (1 Mo, autre
   * type) ne coûte pas un hachage.
   *
   * @param ticket - valeur reçue, non fiable.
   * @returns l'identifiant, ou `null` (absent, malformé, inconnu, expiré, déjà racheté).
   */
  redeem(ticket: unknown): string | null {
    if (
      typeof ticket !== "string" ||
      ticket.length !== PROFILE_TICKET_LENGTH ||
      !TICKET_SHAPE.test(ticket)
    ) {
      return null;
    }
    this.#purge();
    const key = this.#fingerprint(ticket);
    const entry = this.#pending.get(key);
    if (entry === undefined) return null;
    this.#pending.delete(key);
    return entry.identifier;
  }

  #purge(): void {
    const now = this.#now();
    for (const [key, entry] of this.#pending) {
      if (entry.expiresAt < now) this.#pending.delete(key);
    }
  }
}
