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
 */

import type { IBackplaneQueueInfo } from "../../interfaces/IBackplane.js";

/** Sévérité d'une transition de la file — mappée telle quelle sur le syslog. */
export type BackplaneNoticeSeverity = "WARNING" | "INFO";

/** Annonce d'une transition (saturation / retour à la normale). */
export type BackplaneNotice = (
  message: string,
  severity: BackplaneNoticeSeverity,
) => void;

/** Seuil par défaut (8 MiB) — voir `DEFAULT_MAX_QUEUE_BYTES`. */
const DEFAULT_MAX_BYTES = 1 << 23;

/**
 * Seuil par défaut d'octets en vol vers le bus : **8 MiB**, aligné sur le seuil de
 * coupure d'un slow-consumer WS. Un bus sain acquitte en quelques millisecondes
 * (3 ms mesurés cross-pod) : 8 MiB d'arriéré, c'est déjà trois ordres de grandeur
 * au-dessus du régime nominal — le pod a un problème bien avant d'y arriver.
 */
export const DEFAULT_MAX_QUEUE_BYTES = DEFAULT_MAX_BYTES;

/** Vrai si la valeur se comporte comme une promesse (transport asynchrone). */
function isThenable(v: unknown): v is Promise<unknown> {
  return (
    typeof v === "object" &&
    v !== null &&
    typeof (v as { then?: unknown }).then === "function"
  );
}

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
   * @param bytes - taille de la charge sérialisée.
   * @param emit - envoi réel ; appelé UNIQUEMENT si la publication est admise.
   *   Son retour est suivi s'il s'agit d'une promesse (transport asynchrone).
   * @returns `true` si la publication est partie, `false` si elle a été jetée.
   */
  send(bytes: number, emit: () => unknown): boolean {
    if (this.#maxBytes > 0 && this.#bytes >= this.#maxBytes) {
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
    // 1 closure + 1 `.then` par publication réseau : le transport a déjà alloué sa
    // promesse, et ce chemin n'existe que sur le fan-out cross-pod (jamais sur le
    // hot path HTTP, ni en mono-process où le hub n'a aucun backplane).
    const settle = (failed: boolean): void => {
      this.#bytes -= bytes;
      if (failed) this.#failedTotal += 1;
      this.#drain();
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

  /** Compteurs pour la carte d'identité du backplane (sonde + Studio). */
  describe(): IBackplaneQueueInfo {
    return {
      bytes: this.#bytes,
      maxBytes: this.#maxBytes,
      droppedTotal: this.#droppedTotal,
      failedTotal: this.#failedTotal,
    };
  }
}

export default BackplanePublishQueue;
