/**
 * Les services PORTÉS par le superviseur de développement (ADR-0030 §D3-§D7)
 * — Vite aujourd'hui, un serveur d'inférence demain. Ils survivent aux
 * redémarrages du serveur enfant : c'est tout leur intérêt.
 *
 * Le serveur déclare, par propriétaire, la liste COMPLÈTE de ce qu'il veut ;
 * ce registre réconcilie sur une empreinte, à la manière d'un `docker compose
 * up` : clé neuve → démarrée, empreinte changée → remplacée, identique →
 * gardée, absente → arrêtée. Il ne nomme aucun service et ne lit aucune
 * `spec` : un service porté n'est pour lui qu'un module hôte à tenir.
 *
 * Aucun import du noyau — le superviseur le charge (`devChannelBase.ts#DEV_CHILD_ENV`).
 */
import {
  DEV_CHANNEL,
  heldPlanProblem,
  type IDevHeldPlan,
  type IDevHeldPlanAck,
  type IHeldServiceDeclaration,
} from "./devChannel";
import {
  HostHolder,
  type HeldOutputStream,
  type IHeldHostStatus,
} from "./HostHolder";

/** Promesse déjà tenue, partagée : un service sans prédécesseur démarre sans attendre. */
const NO_PREDECESSOR: Promise<void> = Promise.resolve();

/** Ce que le registre demande à son propriétaire, le superviseur. */
export interface IHeldServiceRegistryOptions {
  /** Environnement de base de chaque hôte ; la déclaration y AJOUTE ses variables. */
  readonly baseEnv: NodeJS.ProcessEnv;
  /**
   * Un service a changé d'état — à pousser au serveur (`held-state`). Jamais
   * appelé pour une instance remplacée ou retirée : le serveur ne verrait
   * sinon passer « arrêté » pour un service qu'il vient de redemander.
   */
  readonly onState: (owner: string, status: IHeldHostStatus) => void;
  /**
   * Sortie d'un hôte, par lignes complètes (ADR-0030 §D8) — y compris celle
   * d'une instance qui s'arrête : ses derniers mots restent lisibles.
   */
  readonly onOutput: (
    key: string,
    stream: HeldOutputStream,
    lines: Buffer,
  ) => void;
}

/** Un service tenu : son propriétaire, l'empreinte qui l'a fait naître, son teneur. */
class HeldEntry {
  constructor(
    readonly owner: string,
    readonly fingerprint: string,
    readonly host: HostHolder,
    /**
     * Tenue quand l'instance que celle-ci REMPLACE est morte. Avant, pas de
     * démarrage : les deux voudraient le même port.
     */
    readonly predecessorGone: Promise<void>,
  ) {}
}

/**
 * Le registre des services portés : réconcilie les plans du serveur, tient
 * les hôtes, les arrête à la fin de la session.
 */
export class HeldServiceRegistry {
  readonly #opts: IHeldServiceRegistryOptions;
  /** Les instances vivantes, par clé — ajouts et retraits au fil des plans. */
  readonly #held = new Map<string, HeldEntry>();
  /** Les instances remplacées ou retirées, et la promesse de leur mort effective. */
  readonly #retiring = new Map<HeldEntry, Promise<void>>();
  #closing = false;

  constructor(options: IHeldServiceRegistryOptions) {
    this.#opts = options;
  }

  /**
   * Applique un plan. La décision est SYNCHRONE — l'acquittement rendu dit
   * déjà ce qui sera fait ; les démarrages et arrêts suivent en arrière-plan,
   * et leurs états partent par `onState`. Les services gardés voient leur
   * état courant rejoué : c'est ainsi qu'un nouveau serveur apprend où
   * écoute un Vite resté chaud.
   *
   * @param plan - l'état voulu pour un propriétaire.
   * @returns l'acquittement, accepté ou refusé en nommant la cause.
   */
  apply(plan: IDevHeldPlan): IDevHeldPlanAck {
    if (this.#closing) return planAck(plan, "supervisor is stopping");
    const problem = heldPlanProblem(plan);
    if (problem !== null) return planAck(plan, problem);
    for (const declaration of plan.services) {
      const held = this.#held.get(declaration.key);
      if (held !== undefined && held.owner !== plan.owner) {
        return planAck(
          plan,
          `service "${declaration.key}" is held by owner "${held.owner}"`,
        );
      }
    }
    // Ce que le plan ne déclare plus s'arrête : une famille retirée de la
    // config resterait sinon vivante toute la session (ADR-0030 §D3).
    const wanted = new Set<string>();
    for (const declaration of plan.services) wanted.add(declaration.key);
    for (const [key, entry] of this.#held) {
      if (entry.owner === plan.owner && !wanted.has(key)) {
        this.#held.delete(key);
        // Suivie dans `#retiring`, jamais rejetée : `stopAll` l'attend.
        void this.#retire(entry);
      }
    }
    for (const declaration of plan.services) {
      const held = this.#held.get(declaration.key);
      if (held !== undefined && held.fingerprint === declaration.fingerprint) {
        const status = held.host.status();
        // `errored` : relances épuisées — un plan neuf est la seule chose qui
        // lui redonne sa chance (ADR-0030 §D6, tempête de relances).
        if (status.state === "errored") this.#launch(held);
        else this.#opts.onState(plan.owner, status);
        continue;
      }
      const predecessorGone =
        held === undefined ? NO_PREDECESSOR : this.#retire(held);
      const entry = this.#create(plan.owner, declaration, predecessorGone);
      this.#held.set(declaration.key, entry);
      void predecessorGone.then(() => {
        if (this.#held.get(declaration.key) === entry) this.#launch(entry);
      });
    }
    return planAck(plan, null);
  }

  /**
   * Arrête tous les services et attend leur mort EFFECTIVE (ADR-0030 §D7) :
   * un dossier ne se libère pas avant, sous Windows. Tout plan reçu ensuite
   * est refusé.
   */
  async stopAll(): Promise<void> {
    this.#closing = true;
    const entries = [...this.#held.values()];
    this.#held.clear();
    for (const entry of entries) void this.#retire(entry);
    await Promise.all(this.#retiring.values());
  }

  /**
   * Arrêt FORCÉ, synchrone : SIGKILL à l'arbre de chaque hôte VIVANT, en
   * service ou en cours d'arrêt, et plus aucune relance. Pour la sortie
   * d'urgence du superviseur, qui n'attend rien. Le teneur vise son process
   * vivant, jamais le PID d'un instantané — rendu au système, il peut être
   * celui d'un étranger.
   */
  killAll(): void {
    this.#closing = true;
    for (const entry of this.#held.values()) entry.host.kill();
    for (const entry of this.#retiring.keys()) entry.host.kill();
  }

  #create(
    owner: string,
    declaration: IHeldServiceDeclaration,
    predecessorGone: Promise<void>,
  ): HeldEntry {
    const { key } = declaration;
    let entry: HeldEntry | null = null;
    const host = new HostHolder({
      key,
      module: declaration.module,
      spec: declaration.spec,
      cwd: declaration.cwd,
      env: { ...this.#opts.baseEnv, ...declaration.env },
      ...declaration.tuning,
      onOutput: (stream, lines) => this.#opts.onOutput(key, stream, lines),
      onStatus: (status) => {
        if (entry !== null && this.#held.get(key) === entry) {
          this.#opts.onState(owner, status);
        }
      },
    });
    entry = new HeldEntry(
      owner,
      declaration.fingerprint,
      host,
      predecessorGone,
    );
    return entry;
  }

  /** Démarre un hôte ; un échec est publié par son état (`errored`), jamais levé. */
  #launch(entry: HeldEntry): void {
    entry.host.start().catch(() => {});
  }

  /**
   * Arrête une instance sortie du plan. Jamais avant que SON prédécesseur
   * soit mort : remplacée deux fois de suite, elle n'a peut-être pas encore
   * démarré, et ne doit pas le faire après coup.
   *
   * @returns la promesse de sa mort effective.
   */
  #retire(entry: HeldEntry): Promise<void> {
    const pending = this.#retiring.get(entry);
    if (pending !== undefined) return pending;
    const gone = entry.predecessorGone
      .then(() => entry.host.stop())
      .catch(() => {})
      .finally(() => {
        this.#retiring.delete(entry);
      });
    this.#retiring.set(entry, gone);
    return gone;
  }
}

/** L'acquittement d'un plan : accepté si `reason` est `null`. */
function planAck(plan: IDevHeldPlan, reason: string | null): IDevHeldPlanAck {
  return {
    channel: DEV_CHANNEL,
    type: "held-plan-ack",
    id: plan.id,
    owner: plan.owner,
    accepted: reason === null,
    reason,
  };
}
