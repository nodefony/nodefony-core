import type { IFrameCodec } from "nodefony";
import type { IBackplaneMessage } from "../../interfaces/IBackplane.js";
import {
  BackplaneEcho,
  openBackplaneEnvelope,
  openBackplaneEnvelopeBytes,
} from "./envelope.js";
import type { BackplaneNotice } from "./publishQueue.js";

/**
 * **Entrée d'un bus partagé** — le tri de ce qu'un pilote reçoit, mutualisé pour
 * que tout pilote à transport réseau (Redis aujourd'hui ; Kafka, NATS, RabbitMQ…
 * demain) l'hérite sans le réécrire : écho de ce pod reconnu et compté, sceau
 * vérifié, refus comptés et annoncés.
 *
 * Le pilote ne garde que son transport : il passe chaque message reçu à
 * {@link text} ou {@link bytes} et remet au hub ce qui en sort.
 *
 * Ordre du tri, du moins cher au plus cher :
 *  1. l'ÉCHO de ce pod se reconnaît à la fin du message, sans le décoder — un HMAC
 *     sous un secret (cf {@link BackplaneEcho}) ;
 *  2. sinon, l'enveloppe est ouverte et son sceau vérifié sur la tranche reçue ;
 *  3. un message ouvert qui porte l'origine de ce pod sous une autre forme est
 *     encore un écho — compté, jamais réinjecté (anti-boucle).
 */
export class BackplaneIngress {
  readonly #originId: string;
  readonly #secret: string | null;
  readonly #echo: BackplaneEcho;
  readonly #notice: BackplaneNotice | null;
  #echoTotal = 0;
  #sealRejectedTotal = 0;

  /**
   * @param originId - identité de CE pod sur le bus.
   * @param secret - secret partagé, ou `null` sur un bus non scellé.
   * @param notice - annonce des sceaux refusés ; omis = silencieux (tests).
   */
  constructor(
    originId: string,
    secret: string | null,
    notice: BackplaneNotice | null = null,
  ) {
    this.#originId = originId;
    this.#secret = secret;
    this.#echo = new BackplaneEcho(originId, secret);
    this.#notice = notice;
  }

  /**
   * Trie un message reçu sur le sujet TEXTE du bus.
   *
   * @param raw - message brut tel que lu sur le transport.
   * @returns le message à remettre au hub, ou `null` s'il est jeté (écho de ce
   *   pod, malformé, sceau refusé — chacun compté).
   */
  text(raw: string): IBackplaneMessage | null {
    if (this.#echo.text(raw)) {
      this.#echoTotal += 1;
      return null;
    }
    return this.#admit(openBackplaneEnvelope(raw, this.#secret));
  }

  /**
   * Trie un message reçu sur le sujet BINAIRE du bus (ADR-0021 S6).
   *
   * @param raw - octets tels que lus sur le transport.
   * @param codec - le codec binaire du serveur.
   * @returns le message à remettre au hub, ou `null` s'il est jeté.
   */
  bytes(raw: Uint8Array, codec: IFrameCodec): IBackplaneMessage | null {
    if (this.#echo.bytes(raw, codec)) {
      this.#echoTotal += 1;
      return null;
    }
    return this.#admit(openBackplaneEnvelopeBytes(raw, codec, this.#secret));
  }

  /** Échos de ce pod reçus du bus (monotone) — le bus rend ce qu'on y publie. */
  get echoTotal(): number {
    return this.#echoTotal;
  }

  /** Messages jetés au sceau refusé, sous un secret (monotone). */
  get sealRejectedTotal(): number {
    return this.#sealRejectedTotal;
  }

  /** Fin du tri commune aux deux sujets : refus compté, écho tardif, ou message admis. */
  #admit(msg: IBackplaneMessage | null): IBackplaneMessage | null {
    if (msg === null) {
      // Sans secret, seul un message malformé est jeté : rien à voir avec un sceau.
      if (this.#secret !== null) this.#sealRejected();
      return null;
    }
    if (msg.originId === this.#originId) {
      this.#echoTotal += 1;
      return null;
    }
    return msg;
  }

  /** Compte un sceau refusé ; annonce le premier, puis un sur cent (pas d'inondation du journal). */
  #sealRejected(): void {
    this.#sealRejectedTotal += 1;
    const n = this.#sealRejectedTotal;
    if (n !== 1 && n % 100 !== 0) return;
    this.#notice?.(
      `backplane : ${n} message(s) reçu(s) au sceau refusé, JETÉS. Causes : rotation ` +
        `du secret en cours (des exemplaires n'ont pas le même NF_REALTIME_BACKPLANE_SECRET), ` +
        `producteur mal configuré, ou écriture tierce dans le bus. Compteur : sealRejectedTotal.`,
      "WARNING",
    );
  }
}
