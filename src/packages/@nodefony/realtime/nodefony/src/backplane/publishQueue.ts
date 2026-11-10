/**
 * **File d'envoi bornée d'un backplane** — protège la mémoire du pod quand le bus
 * n'absorbe pas le débit publié. Mutualisée ici (comme le sceau d'enveloppe) pour
 * qu'un driver à transport réseau — Redis, et tout driver userland : NATS, Kafka,
 * RabbitMQ — hérite de la garantie sans la réécrire.
 *
 * Pourquoi : `IBackplane.publish` est **fire-and-forget** par contrat (il rend
 * `void`). Un client réseau met alors la commande dans SA file tant que la socket
 * n'est pas drainée — file interne, invisible, sans limite. Une rafale y accumule
 * des mégaoctets : 583 MB observés sur le banc multi-pods, pour 152 MB au repos.
 * Aucune fuite (tout redescend), mais rien ne borne le pic → OOM sous rafale plus
 * longue.
 *
 * Doctrine — la MÊME que le transport WS (seuil, compteur de jetés, avertissement),
 * parce que le problème est le même : un pair qui ne draine pas. Deux règles en
 * découlent :
 *  - **on protège la mémoire** : au-delà du seuil, les publications suivantes sont
 *    jetées (sémantique at-most-once déjà assumée par le port — le client realtime
 *    re-synchronise) ;
 *  - **on ne jette jamais en silence** : compteurs exposés dans la carte d'identité
 *    du backplane (donc sonde + Studio) et transitions annoncées.
 *    Cf `project_resilience_no_silent_degradation`.
 *
 * Ce qui est jeté est le message **nouveau**, pas le plus ancien : contrairement au
 * WS (drop latest-wins sur une file qu'on possède), ce qui est déjà remis au client
 * réseau ne peut plus être repris.
 *
 * **Les ordres de contrôle ne sont JAMAIS jetés** (#762) : terminer un canal ou
 * éjecter un compte passe hors quota, même file saturée. Sinon, sous charge, un
 * modérateur éjecte un compte sur un serveur et ce compte continue de lire sur un
 * autre, sans que personne le sache. Les ordres sont rares et petits (une décision
 * du serveur, quelques dizaines d'octets) : les exempter ne rouvre pas la mémoire.
 * La **preuve de vie** de la présence répartie passe aussi hors quota (ADR-0025
 * P2) : jetée, elle ferait oublier un pod vivant chez ses pairs ; elle est petite
 * et d'intervalle borné. Liste des canaux prioritaires : `isPriorityBusChannel`
 * (cœur), seule source.
 * Un ordre que le bus REFUSE malgré tout (bus injoignable) est compté à part
 * (`controlLostTotal`) et annoncé une fois par épisode.
 */

import { isPriorityBusChannel, PLATFORM_BUS_CHANNELS } from "nodefony";
import type { IBackplaneQueueInfo } from "../../interfaces/IBackplane.js";
import { isThenable } from "../guards.js";

/** Sévérité d'une transition de la file — mappée telle quelle sur le syslog. */
export type BackplaneNoticeSeverity = "WARNING" | "INFO";

/** Annonce d'une transition (saturation / retour à la normale). */
export type BackplaneNotice = (
  message: string,
  severity: BackplaneNoticeSeverity,
) => void;

/** Canal des ordres de contrôle, lu une fois au chargement (pas d'accès de propriété par envoi). */
const CONTROL_CHANNEL: string = PLATFORM_BUS_CHANNELS.control;

/** Seuil par défaut (8 MiB) — voir `DEFAULT_MAX_QUEUE_BYTES`. */
const DEFAULT_MAX_BYTES = 1 << 23;

/**
 * Seuil par défaut d'octets en vol vers le bus : **8 MiB**, aligné sur le seuil de
 * coupure d'un slow-consumer WS. Un bus sain acquitte en quelques millisecondes
 * (3 ms mesurés cross-pod) : 8 MiB d'arriéré, c'est déjà trois ordres de grandeur
 * au-dessus du régime nominal — le pod a un problème bien avant d'y arriver.
 */
export const DEFAULT_MAX_QUEUE_BYTES = DEFAULT_MAX_BYTES;

/**
 * File d'envoi bornée : décide d'admettre ou de jeter une publication, puis suit
 * son acquittement pour rendre la place.
 *
 * Un transport **synchrone** (bus mémoire des tests, IPC) ne rend pas de promesse :
 * il n'a donc pas de file, la garde reste alors inerte et ne jette jamais rien.
 */
export class BackplanePublishQueue {
  readonly #maxBytes: number;
  readonly #notice: BackplaneNotice | null;
  #bytes = 0;
  #droppedTotal = 0;
  #failedTotal = 0;
  /** Vrai entre le franchissement du seuil et le retour à la normale (1 log par épisode). */
  #saturated = false;
  /** Jetés de l'épisode de saturation courant — chiffre annoncé au retour à la normale. */
  #droppedInEpisode = 0;
  /** Ordres de contrôle refusés par le transport (monotone). */
  #controlLostTotal = 0;
  /** Ordres perdus de l'épisode courant ; `> 0` = épisode ouvert (1 log par épisode). */
  #controlLostInEpisode = 0;
  /** Publications réseau en vol (un entier : le compte, pas les octets — un message vide compte). */
  #inFlight = 0;
  /** Attentes de {@link BackplanePublishQueue.settled} ; `null` tant que personne n'attend (arrêt seulement). */
  #idle: (() => void)[] | null = null;

  /**
   * @param maxBytes - seuil d'octets en vol ; `0` (ou négatif) = illimité.
   * @param notice - annonce des transitions ; omis = silencieux (tests unitaires).
   */
  constructor(
    maxBytes: number = DEFAULT_MAX_QUEUE_BYTES,
    notice: BackplaneNotice | null = null,
  ) {
    this.#maxBytes = maxBytes > 0 ? maxBytes : 0;
    this.#notice = notice;
  }

  /**
   * Admet ou jette une publication, et suit son acquittement.
   *
   * L'admission regarde l'état de la file **avant** l'envoi, pas la taille du
   * message : une charge plus grosse que le seuil part quand la file est vide
   * (sinon elle ne partirait jamais — famine silencieuse), quitte à dépasser
   * transitoirement. Même règle que le drop WS, qui teste `bufferedAmount` seul.
   *
   * Un canal prioritaire (`isPriorityBusChannel` du cœur : ordre de contrôle,
   * preuve de vie de la présence) est admis hors quota : la file l'applique, pas
   * le driver, pour qu'un driver qui emploie la file la porte sans y penser.
   *
   * @param channel - canal logique de la publication.
   * @param bytes - taille de la charge sérialisée.
   * @param emit - envoi réel ; appelé UNIQUEMENT si la publication est admise.
   *   Son retour est suivi s'il s'agit d'une promesse (transport asynchrone).
   * @returns `true` si la publication est partie, `false` si elle a été jetée.
   */
  send(channel: string, bytes: number, emit: () => unknown): boolean {
    // Chemin chaud : le canal n'est comparé QUE file saturée — en régime sain,
    // deux comparaisons de nombres et aucune de chaîne.
    if (
      this.#maxBytes > 0 &&
      this.#bytes >= this.#maxBytes &&
      !isPriorityBusChannel(channel)
    ) {
      this.#droppedTotal += 1;
      this.#droppedInEpisode += 1;
      if (!this.#saturated) {
        this.#saturated = true;
        this.#notice?.(
          `backplane : file d'envoi saturée (${this.#bytes} octets en vol ≥ ` +
            `seuil ${this.#maxBytes}) — publications JETÉES tant que le bus ne ` +
            `draine pas. Le fan-out cross-pod est incomplet. Causes : bus lent ou ` +
            `injoignable, débit publié trop élevé. Levier : backplane.maxQueueBytes.`,
          "WARNING",
        );
      }
      return false;
    }
    const result = emit();
    // Transport synchrone → rien à suivre : pas de file, donc pas de borne à tenir.
    if (!isThenable(result)) return true;
    this.#bytes += bytes;
    this.#inFlight += 1;
    // 1 closure + 1 `.then` par publication réseau : le transport a déjà alloué sa
    // promesse, et ce chemin n'existe que sur le fan-out cross-pod (jamais sur le
    // hot path HTTP, ni en mono-process où le hub n'a aucun backplane).
    const settle = (failed: boolean): void => {
      this.#bytes -= bytes;
      if (failed) this.#failedTotal += 1;
      // Acquittement sain hors épisode : rien à suivre, le canal n'est pas lu.
      if (
        (failed || this.#controlLostInEpisode > 0) &&
        channel === CONTROL_CHANNEL
      )
        this.#controlSettled(failed);
      this.#drain();
      this.#inFlight -= 1;
      if (this.#inFlight === 0 && this.#idle !== null) {
        const waiting = this.#idle;
        this.#idle = null;
        for (const resolve of waiting) resolve();
      }
    };
    result.then(
      () => settle(false),
      // Un rejet du bus est absorbé ICI : sans ce handler, un `publish` refusé
      // (Redis coupé) remonterait en `unhandledRejection` — et la place ne serait
      // jamais rendue, figeant la file en saturation permanente.
      () => settle(true),
    );
    return true;
  }

  /**
   * Retour à la normale — annoncé une seule fois, avec le bilan des pertes.
   *
   * Hystérésis à la moitié du seuil : repasser sous le seuil tout court ferait
   * osciller l'état (et les logs) à chaque acquittement en régime saturé.
   */
  #drain(): void {
    if (!this.#saturated) return;
    if (this.#maxBytes > 0 && this.#bytes * 2 > this.#maxBytes) return;
    const lost = this.#droppedInEpisode;
    this.#saturated = false;
    this.#droppedInEpisode = 0;
    this.#notice?.(
      `backplane : file d'envoi drainée (${this.#bytes} octets en vol) — ` +
        `${lost} publication(s) perdue(s) pendant la saturation.`,
      "INFO",
    );
  }

  /**
   * Suit l'acquittement d'un ordre de contrôle : un refus ouvre un épisode,
   * annoncé une fois ; le premier ordre de nouveau acquitté le ferme, avec le
   * bilan des pertes.
   */
  #controlSettled(failed: boolean): void {
    if (failed) {
      this.#controlLostTotal += 1;
      this.#controlLostInEpisode += 1;
      if (this.#controlLostInEpisode === 1) {
        this.#notice?.(
          `backplane : un ordre de contrôle (terminer un canal, éjecter un compte) ` +
            `a été REFUSÉ par le bus — les autres serveurs ne l'appliqueront pas. ` +
            `Cause : bus injoignable. Compteur : controlLostTotal.`,
          "WARNING",
        );
      }
      return;
    }
    if (this.#controlLostInEpisode === 0) return;
    const lost = this.#controlLostInEpisode;
    this.#controlLostInEpisode = 0;
    this.#notice?.(
      `backplane : ordres de contrôle de nouveau acquittés — ${lost} ordre(s) ` +
        `perdu(s) pendant la coupure.`,
      "INFO",
    );
  }

  /**
   * Attend que toutes les publications en vol soient acquittées ou refusées par le bus — à l'arrêt, pour que ce qui est déjà émis (la preuve de vie finale de la présence) parte avant la sortie du processus.
   *
   * Ne borne rien : un bus qui ne répond plus ne la résout jamais. L'appelant
   * pose la limite (l'arrêt du noyau a la sienne).
   */
  settled(): Promise<void> {
    if (this.#inFlight === 0) return Promise.resolve();
    return new Promise((resolve) => {
      (this.#idle ??= []).push(resolve);
    });
  }

  /** Compteurs pour la carte d'identité du backplane (sonde + Studio). */
  describe(): IBackplaneQueueInfo {
    return {
      bytes: this.#bytes,
      maxBytes: this.#maxBytes,
      droppedTotal: this.#droppedTotal,
      failedTotal: this.#failedTotal,
      controlLostTotal: this.#controlLostTotal,
    };
  }
}

export default BackplanePublishQueue;
