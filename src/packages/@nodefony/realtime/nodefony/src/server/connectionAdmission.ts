import { isPromise } from "nodefony";
import type { ChannelAllowFunction, ISubscriberIdentity } from "nodefony";
import { ADMISSION_GRANTED, type AdmissionBudget } from "./admissionBudget";
import { resolveBackplaneOriginId } from "../backplane/originId";

/**
 * Règle d'admission d'un canal telle que le hub la tient prête — construite UNE fois à l'inscription de la politique, lue au `subscribe`.
 */
export interface IChannelAdmissionRule {
  /** La règle, flèche ou méthode `allow` déjà liée à son instance. */
  readonly allow: ChannelAllowFunction;
  /** `anonymous: true` de la politique : l'anonyme est présenté à `allow` au lieu d'être refusé d'office. */
  readonly anonymous: boolean;
}

/**
 * Ce que la file d'admission demande à sa connexion — ouvrir le canal, le refuser, journaliser. Implémenté par `RealtimeController`, une fois par connexion.
 */
export interface IAdmissionHost {
  /** Ouvre l'abonnement admis (et l'acquitte). */
  open(channel: string): void;
  /** Rend le refus observable (`realtime:denied`) ; `detail` n'est rédigé qu'hors production. */
  deny(
    channel: string,
    reason: "forbidden" | "unavailable",
    detail: string | undefined,
    retryAfterMs?: number,
  ): void;
  /** Journal d'exploitation (déjà limité en fréquence par l'appelant). */
  warn(message: string): void;
}

const QUEUED = 0;
const IN_FLIGHT = 1;
const DONE = 2;

/** Une demande d'abonnement qui attend son verdict — créée seulement si elle doit attendre (file, ou `allow` qui rend une promesse). */
interface IPendingAdmission {
  readonly channel: string;
  readonly rule: IChannelAdmissionRule;
  /** Échéance (`performance.now()`) : réception du `subscribe` + `allowTimeoutMs`. */
  readonly deadline: number;
  status: typeof QUEUED | typeof IN_FLIGHT | typeof DONE;
  /** `unsubscribe` reçu pendant l'attente : le verdict sera jeté, sans réponse. */
  cancelled: boolean;
}

/**
 * Admission des abonnements d'UNE connexion aux canaux qui déclarent `allow` — appels bornés, file d'attente, délai, verdict (ADR-0021 §S10 et §S10 bis).
 *
 * Coûts, par construction :
 * - une règle qui répond `true`/`false` sans promesse ne crée ni minuteur, ni
 *   promesse, ni entrée d'attente ;
 * - au-delà de `maxPendingAllowsPerConnection` appels en vol, la demande ATTEND
 *   son tour (jamais `limit` : le rejeu au `welcome` renvoie tous les canaux
 *   d'un coup) ; la file reste `null` tant que personne n'attend ;
 * - un seul minuteur par connexion, armé sur l'échéance de tête : les demandes
 *   arrivent dans l'ordre de leurs échéances, la plus ancienne non tranchée est
 *   donc toujours la prochaine à expirer.
 *
 * Seul `=== true` admet ; une exception ou un rejet valent `forbidden` ; un
 * délai dépassé ou une saturation valent `unavailable`, et un verdict arrivé
 * après coup est ignoré.
 */
export class ConnectionAdmission {
  readonly #host: IAdmissionHost;
  readonly #budget: AdmissionBudget;
  readonly #who: ISubscriberIdentity;
  // Hors production seulement (`explainsDenials`) : en production, aucune
  // phrase de refus n'est composée — elle serait jetée avant l'envoi.
  readonly #explain: boolean;
  // Demandes non tranchées, clé = canal (au plus une par canal : un second
  // `subscribe` la ranime au lieu d'en créer une autre). `Map` et non objet
  // nu : l'ordre d'insertion EST l'ordre d'arrivée, donc celui des échéances
  // (un objet range d'abord les clés numériques, `"42"` passerait en tête) ;
  // retrait O(1) sans trou ni compactage, là où des `delete` répétés font
  // basculer un objet en dictionnaire lent. `null` tant que rien n'a attendu.
  #pending: Map<string, IPendingAdmission> | null = null;
  #inFlight = 0;
  #timer: ReturnType<typeof setTimeout> | null = null;
  #onTimer: (() => void) | null = null;

  /**
   * @param host - la connexion qui ouvre ou refuse.
   * @param budget - le budget de l'exemplaire (plafond global, coupe-circuit).
   * @param who - identité d'admission gelée de la connexion.
   * @param explain - rédiger le détail des refus (hors production).
   */
  constructor(
    host: IAdmissionHost,
    budget: AdmissionBudget,
    who: ISubscriberIdentity,
    explain: boolean,
  ) {
    this.#host = host;
    this.#budget = budget;
    this.#who = who;
    this.#explain = explain;
  }

  /** Demandes en attente de verdict — comptées dans le plafond de canaux de la connexion. */
  get unsettled(): number {
    return this.#pending === null ? 0 : this.#pending.size;
  }

  /**
   * Un abonnement à ce canal attend-il déjà son verdict ? S'il avait été annulé par un `unsubscribe`, il est ranimé : le verdict à venir répondra.
   *
   * @returns `true` si la demande est déjà en attente (rien d'autre à faire).
   */
  revive(channel: string): boolean {
    const record = this.#pending?.get(channel);
    if (record === undefined) return false;
    record.cancelled = false;
    return true;
  }

  /** `unsubscribe` pendant l'attente : le verdict à venir sera jeté sans réponse. */
  cancel(channel: string): void {
    const record = this.#pending?.get(channel);
    if (record !== undefined) record.cancelled = true;
  }

  /**
   * Demande l'admission sur `channel` selon sa règle — l'anonyme est refusé d'office sauf `anonymous: true`.
   *
   * @param channel - nom exact du canal demandé.
   * @param rule - règle résolue par le hub pour ce canal.
   */
  request(channel: string, rule: IChannelAdmissionRule): void {
    if (!this.#who.authenticated && !rule.anonymous) {
      this.#host.deny(
        channel,
        "forbidden",
        this.#explain
          ? `le canal « ${channel} » déclare une règle d'admission (allow) : une ` +
              `connexion anonyme n'y entre pas sans \`anonymous: true\` dans sa politique`
          : undefined,
      );
      return;
    }
    // Appels en vol au plafond : celle-ci prend son tour, derrière. Une file
    // non vide implique ce plafond — chaque place libérée la vide d'abord
    // (`#pump`) —, donc l'ordre d'arrivée tient sans autre test.
    if (this.#inFlight >= this.#budget.maxPerConnection) {
      this.#track(channel, rule, QUEUED);
      return;
    }
    this.#call(channel, rule, null);
  }

  /** Fermeture de la connexion : minuteur coupé, places rendues, verdicts à venir jetés. */
  close(): void {
    // `#pending = null` suffit à tout arrêter : la file vide (`#pump`), le
    // minuteur (`#expire`) et un verdict tardif (`#settle`, demande DONE)
    // n'ont plus rien à servir.
    if (this.#timer !== null) {
      clearTimeout(this.#timer);
      this.#timer = null;
    }
    const pending = this.#pending;
    if (pending !== null) {
      for (const record of pending.values()) {
        if (record.status === IN_FLIGHT) this.#budget.release();
        record.status = DONE;
      }
      this.#pending = null;
    }
    this.#inFlight = 0;
  }

  /** Appelle `allow` ; `record` est `null` pour une demande qui n'a pas attendu. */
  #call(
    channel: string,
    rule: IChannelAdmissionRule,
    record: IPendingAdmission | null,
  ): void {
    const granted = this.#budget.acquire();
    if (granted !== ADMISSION_GRANTED) {
      if (record !== null) this.#finish(record);
      this.#host.deny(
        channel,
        "unavailable",
        !this.#explain
          ? undefined
          : granted > 0
            ? `admissions suspendues pendant ${granted} ms après une série de ` +
              `règles allow sans réponse sur ce serveur — réessaie après ce délai`
            : `trop d'admissions en cours sur ce serveur ` +
              `(maxPendingAllowsTotal) — réessaie`,
        granted > 0 ? granted : undefined,
      );
      return;
    }
    let verdict: unknown;
    try {
      verdict = rule.allow(channel, this.#who);
    } catch (error) {
      this.#budget.release();
      if (record !== null) this.#finish(record);
      this.#refuseOnError(channel, error);
      return;
    }
    if (!isPromise(verdict)) {
      this.#budget.release();
      if (record !== null) this.#finish(record);
      this.#conclude(channel, verdict);
      return;
    }
    const tracked = record ?? this.#track(channel, rule, IN_FLIGHT);
    tracked.status = IN_FLIGHT;
    this.#inFlight += 1;
    verdict.then(
      (value) => {
        if (this.#settle(tracked)) this.#conclude(tracked.channel, value);
        this.#pump();
      },
      (error: unknown) => {
        if (this.#settle(tracked)) this.#refuseOnError(tracked.channel, error);
        this.#pump();
      },
    );
  }

  /** Verdict d'une règle : seul `true` admet. */
  #conclude(channel: string, verdict: unknown): void {
    if (verdict === true) {
      this.#open(channel);
      return;
    }
    this.#host.deny(
      channel,
      "forbidden",
      !this.#explain
        ? undefined
        : verdict === false
          ? `la règle d'admission (allow) du canal « ${channel} » a refusé cette identité`
          : `la règle d'admission (allow) du canal « ${channel} » a rendu une ` +
            `valeur de type ${typeof verdict} : seul \`true\` admet`,
    );
  }

  /** Une règle qui lève ou rejette refuse (fail-closed) ; le message ne part au client qu'hors production. */
  #refuseOnError(channel: string, error: unknown): void {
    const warn = this.#budget.shouldWarn("throw", performance.now());
    // Le message n'est lu que s'il sert : journal (une fois par fenêtre) ou
    // détail hors production.
    const message =
      warn || this.#explain
        ? error instanceof Error
          ? error.message
          : String(error)
        : "";
    if (warn) {
      this.#host.warn(
        `règle d'admission (allow) du canal « ${channel} » en échec : ${message}`,
      );
    }
    this.#host.deny(
      channel,
      "forbidden",
      this.#explain
        ? `la règle d'admission (allow) du canal « ${channel} » a levé : ${message}`
        : undefined,
    );
  }

  /** Ouvre le canal admis ; un échec d'ouverture est journalisé, jamais propagé (rappel de promesse ou de minuteur). */
  #open(channel: string): void {
    try {
      this.#host.open(channel);
    } catch (error) {
      this.#host.warn(
        `canal « ${channel} » admis mais non ouvert : ` +
          (error instanceof Error ? error.message : String(error)),
      );
    }
  }

  /**
   * Termine un appel en vol dont le verdict arrive.
   *
   * @returns `false` si la demande est déjà tranchée (délai dépassé, connexion
   *   fermée) ou annulée : le verdict est alors jeté.
   */
  #settle(record: IPendingAdmission): boolean {
    if (record.status === DONE) return false;
    this.#inFlight -= 1;
    this.#budget.release();
    this.#finish(record);
    return !record.cancelled;
  }

  /** Inscrit une demande qui attend ; arme le minuteur s'il ne l'est pas déjà sur une échéance plus proche. */
  #track(
    channel: string,
    rule: IChannelAdmissionRule,
    status: typeof QUEUED | typeof IN_FLIGHT,
  ): IPendingAdmission {
    const deadline = performance.now() + this.#budget.timeoutMs;
    const record: IPendingAdmission = {
      channel,
      rule,
      deadline,
      status,
      cancelled: false,
    };
    (this.#pending ??= new Map<string, IPendingAdmission>()).set(
      channel,
      record,
    );
    if (this.#timer === null) this.#arm(deadline);
    return record;
  }

  /** Marque une demande tranchée et la retire ; plus rien en attente → minuteur coupé. */
  #finish(record: IPendingAdmission): void {
    record.status = DONE;
    const pending = this.#pending;
    if (pending === null) return;
    pending.delete(record.channel);
    if (pending.size === 0 && this.#timer !== null) {
      clearTimeout(this.#timer);
      this.#timer = null;
    }
  }

  /** Lance les demandes en attente, dans l'ordre, tant que des places se libèrent. */
  #pump(): void {
    while (
      this.unsettled > this.#inFlight &&
      this.#inFlight < this.#budget.maxPerConnection
    ) {
      const record = this.#nextQueued();
      if (record === null) return;
      if (record.cancelled) {
        this.#finish(record);
        continue;
      }
      this.#call(record.channel, record.rule, record);
    }
  }

  /** Première demande qui n'a pas encore appelé `allow` — les appels en vol, au plus `maxPerConnection`, la précèdent. */
  #nextQueued(): IPendingAdmission | null {
    if (this.#pending === null) return null;
    for (const record of this.#pending.values()) {
      if (record.status === QUEUED) return record;
    }
    return null;
  }

  #arm(deadline: number): void {
    // `unref` : une admission en attente ne retient pas le processus.
    this.#timer = setTimeout(
      (this.#onTimer ??= () => this.#expire()),
      Math.max(1, Math.ceil(deadline - performance.now())),
    );
    this.#timer.unref();
  }

  /** Échéance de tête atteinte : tranche en `unavailable` toutes les demandes échues, puis réarme sur la suivante. */
  #expire(): void {
    this.#timer = null;
    const pending = this.#pending;
    if (pending === null) return;
    const now = performance.now();
    let timedOut: string | null = null;
    // Retirer l'entrée courante pendant l'itération d'une `Map` est défini :
    // le parcours continue sur la suivante.
    for (const record of pending.values()) {
      if (record.deadline > now) {
        // Ordre d'arrivée = ordre des échéances : la première non échue est la
        // prochaine à expirer.
        this.#arm(record.deadline);
        break;
      }
      const called = record.status === IN_FLIGHT;
      if (called) {
        this.#inFlight -= 1;
        this.#budget.release();
        this.#budget.recordTimeout(now);
        timedOut = record.channel;
      } else {
        this.#budget.recordQueueExpired();
      }
      this.#finish(record);
      if (!record.cancelled) {
        this.#host.deny(
          record.channel,
          "unavailable",
          !this.#explain
            ? undefined
            : called
              ? `la règle d'admission (allow) du canal « ${record.channel} » n'a ` +
                `pas répondu en ${this.#budget.timeoutMs} ms (allowTimeoutMs) — réessaie`
              : `demande d'abonnement à « ${record.channel} » restée en attente ` +
                `${this.#budget.timeoutMs} ms derrière les admissions de cette ` +
                `connexion (allowTimeoutMs) — réessaie`,
          this.#budget.retryAfter(now),
        );
      }
    }
    if (timedOut !== null && this.#budget.shouldWarn("timeout", now)) {
      this.#host.warn(
        `règle d'admission (allow) du canal « ${timedOut} » sans réponse en ` +
          `${this.#budget.timeoutMs} ms (exemplaire ${resolveBackplaneOriginId()})`,
      );
    }
    this.#pump();
  }
}
