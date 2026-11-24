/**
 * Côté SERVEUR, la moitié du contrat des services portés (ADR-0030 §D3-§D5) :
 * composer le plan COMPLET d'un propriétaire, l'envoyer au superviseur,
 * attendre son acquittement, et aiguiller les états poussés vers qui les
 * attend. Le registre (`service/dev/heldServices.ts`) en est l'autre moitié.
 *
 * Générique : il ne nomme aucun service. Vite en est le premier client
 * (`@nodefony/frontend`), un serveur d'inférence le suivant — rien du cœur
 * n'est à ajouter pour lui (ADR-0030 §D9).
 *
 * Module FEUILLE à l'exécution : il ne parle au superviseur qu'au travers du
 * lien ({@link IHeldChannelLink}, que `SupervisorLink` satisfait), seule
 * entrée et seule sortie typées du canal côté noyau.
 */
import {
  DEV_CHANNEL,
  type DevChannelMessage,
  type IHeldServiceDeclaration,
} from "../service/dev/devChannel";
import type { IHeldHostStatus } from "../service/dev/heldChannel";
import type { IHeldServicesClient } from "../types/IHeldServicesClient";

export type { IHeldServicesClient };

/**
 * Délai d'acquittement d'un plan. Le superviseur décide de façon SYNCHRONE
 * (`HeldServiceRegistry.apply`) : au-delà, ce n'est pas une lenteur, c'est un
 * pair qui ne parle pas ce contrat.
 */
export const HELD_PLAN_ACK_TIMEOUT_MS = 5_000;

/** Ce que le client demande au lien noyau ⇄ superviseur. */
export interface IHeldChannelLink {
  /** Envoie un message ; `false` s'il n'est pas parti. */
  send(message: DevChannelMessage): boolean;
  /** Écoute le canal ; rend la désinscription. */
  listen(handler: (message: DevChannelMessage) => void): () => void;
}

/** Les promesses d'un plan, tenues ou rejetées ensemble. */
interface IPlanWaiter {
  resolve(): void;
  reject(error: Error): void;
}

/** Un plan envoyé, en attente de son acquittement. */
class InFlightPlan {
  constructor(
    readonly waiters: readonly IPlanWaiter[],
    readonly timer: NodeJS.Timeout,
  ) {}
}

/** Rejette tous les attendants d'un plan avec la même cause. */
function rejectAll(waiters: readonly IPlanWaiter[], error: Error): void {
  for (const waiter of waiters) waiter.reject(error);
}

/**
 * Implémentation de {@link IHeldServicesClient} sur le lien noyau ⇄
 * superviseur. Obtenue par `SupervisorLink.heldServices(owner)`, jamais
 * construite par un module.
 *
 * Verrouillé par `tests/heldServicesClient.test.ts`.
 */
export class HeldServicesClient implements IHeldServicesClient {
  readonly owner: string;
  readonly #link: IHeldChannelLink;
  readonly #ackTimeoutMs: number;
  #unlisten: (() => void) | null = null;
  #watchers: Map<string, (status: IHeldHostStatus) => void> | null = null;
  /** Les clés encore attendues par le plan en composition ; `null` hors composition. */
  #expected: Set<string> | null = null;
  #declared: IHeldServiceDeclaration[] = [];
  #waiting: IPlanWaiter[] = [];
  #inFlight: Map<number, InFlightPlan> | null = null;
  #nextId = 1;

  /**
   * @param owner - le propriétaire.
   * @param link - le lien noyau ⇄ superviseur.
   * @param ackTimeoutMs - délai d'acquittement d'un plan.
   */
  constructor(
    owner: string,
    link: IHeldChannelLink,
    ackTimeoutMs: number = HELD_PLAN_ACK_TIMEOUT_MS,
  ) {
    this.owner = owner;
    this.#link = link;
    this.#ackTimeoutMs = ackTimeoutMs;
  }

  expect(keys: Iterable<string>): void {
    if (this.#expected !== null) {
      throw new Error(
        `held services of "${this.owner}": a plan is already being composed`,
      );
    }
    // Écouter AVANT d'envoyer (ADR-0030 §D5) : un message reçu sans écouteur
    // part dans une file sans borne.
    this.#listen();
    this.#expected = new Set(keys);
    if (this.#expected.size === 0) this.#flush();
  }

  submit(declaration: IHeldServiceDeclaration): Promise<void> {
    const expected = this.#expected;
    if (expected === null || !expected.delete(declaration.key)) {
      return Promise.reject(
        new Error(
          `held services of "${this.owner}": service "${declaration.key}" is not expected by the plan`,
        ),
      );
    }
    const settled = new Promise<void>((resolve, reject) => {
      this.#waiting.push({ resolve, reject });
    });
    this.#declared.push(declaration);
    if (expected.size === 0) this.#flush();
    return settled;
  }

  withdraw(key: string): void {
    const expected = this.#expected;
    if (expected?.delete(key) === true && expected.size === 0) this.#flush();
  }

  watch(key: string, onStatus: (status: IHeldHostStatus) => void): () => void {
    this.#listen();
    this.#watchers ??= new Map();
    const watchers = this.#watchers;
    watchers.set(key, onStatus);
    return () => {
      if (watchers.get(key) === onStatus) watchers.delete(key);
    };
  }

  close(): void {
    this.#unlisten?.();
    this.#unlisten = null;
    this.#watchers = null;
    const inFlight = this.#inFlight;
    this.#inFlight = null;
    if (inFlight !== null) {
      for (const plan of inFlight.values()) {
        clearTimeout(plan.timer);
        rejectAll(
          plan.waiters,
          new Error(`held services of "${this.owner}": client closed`),
        );
      }
    }
    // Un plan en composition ne partira plus : ses attendants le sauront.
    rejectAll(
      this.#waiting,
      new Error(`held services of "${this.owner}": client closed`),
    );
    this.#expected = null;
    this.#declared = [];
    this.#waiting = [];
  }

  #listen(): void {
    this.#unlisten ??= this.#link.listen(this.#onMessage);
  }

  /** Envoie le plan composé, et arme l'attente de son acquittement. */
  #flush(): void {
    const id = this.#nextId++;
    const services = this.#declared;
    const waiters = this.#waiting;
    this.#expected = null;
    this.#declared = [];
    this.#waiting = [];
    const sent = this.#link.send({
      channel: DEV_CHANNEL,
      type: "held-plan",
      id,
      owner: this.owner,
      services,
    });
    if (!sent) {
      rejectAll(
        waiters,
        new Error(
          `held services of "${this.owner}": no channel to the supervisor`,
        ),
      );
      return;
    }
    // Un plan vide n'a personne à prévenir : son effet (arrêter) se lit au
    // superviseur, et un refus n'aurait aucun service à faire échouer.
    if (waiters.length === 0) return;
    const timer = setTimeout(() => {
      this.#inFlight?.delete(id);
      rejectAll(
        waiters,
        new Error(
          `held services of "${this.owner}": plan ${id} not acknowledged within ${this.#ackTimeoutMs} ms`,
        ),
      );
    }, this.#ackTimeoutMs);
    // L'attente ne garde pas le process en vie à elle seule.
    timer.unref();
    this.#inFlight ??= new Map();
    this.#inFlight.set(id, new InFlightPlan(waiters, timer));
  }

  readonly #onMessage = (message: DevChannelMessage): void => {
    if (message.type === "held-state") {
      if (message.owner !== this.owner) return;
      this.#watchers?.get(message.status.key)?.(message.status);
      return;
    }
    if (message.type !== "held-plan-ack" || message.owner !== this.owner) {
      return;
    }
    const plan = this.#inFlight?.get(message.id);
    if (plan === undefined) return;
    this.#inFlight?.delete(message.id);
    clearTimeout(plan.timer);
    if (message.accepted) {
      for (const waiter of plan.waiters) waiter.resolve();
    } else {
      rejectAll(
        plan.waiters,
        new Error(
          `supervisor refused the plan of "${this.owner}": ${message.reason ?? "no reason given"}`,
        ),
      );
    }
  };
}
