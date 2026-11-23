/**
 * Le canal TENEUR ⇄ HÔTE d'un service de longue durée (ADR-0030).
 *
 * Un hôte est un process Node, lancé par `fork`, qui pilote UN service par son
 * API (Vite par `createServer`, demain un serveur d'inférence) et en rapporte
 * l'état à celui qui le tient : le superviseur de développement en mode porté,
 * le serveur lui-même ailleurs. Ce fichier est le SEUL contrat entre les deux.
 *
 * Choix figés :
 * - **Module FEUILLE, sans import** : l'hôte le charge à son démarrage ; il ne
 *   doit tirer ni le noyau ni le superviseur (même règle que `devChannelBase.ts`).
 * - **Un discriminant propre** (`nf-held`), distinct de `nf-dev` : un hôte n'est
 *   pas un serveur, et ne doit jamais être pris pour lui.
 * - **L'hôte RAPPORTE, il ne commande jamais** : rien de ce qu'il envoie ne
 *   déclenche une action chez le teneur, hormis la lecture de son état.
 * - **Formes bornées** : tout message hors canal, de type inconnu ou démesuré
 *   est ignoré — jamais interprété (ADR-0030 §D6).
 */

/** Le discriminant du canal. */
export const HELD_CHANNEL = "nf-held";

/** Une valeur JSON — ce que l'IPC transporte sans perte. */
export type HeldJson =
  | string
  | number
  | boolean
  | null
  | readonly HeldJson[]
  | { readonly [key: string]: HeldJson };

/** Un objet JSON — la forme d'une spécification ou d'une donnée d'état. */
export type HeldJsonObject = { readonly [key: string]: HeldJson };

/** L'état d'un hôte, vu par son teneur. */
export type HeldHostState =
  | "idle"
  | "starting"
  | "ready"
  | "restarting"
  | "crashed"
  | "errored"
  | "stopping"
  | "stopped";

/** Les états connus — la seule liste que les gardes consultent. */
export const HELD_HOST_STATES: ReadonlySet<string> = new Set<HeldHostState>([
  "idle",
  "starting",
  "ready",
  "restarting",
  "crashed",
  "errored",
  "stopping",
  "stopped",
]);

/**
 * Instantané de l'état d'un hôte — figé, remplacé en bloc à chaque changement :
 * le lire ne coûte ni allocation ni appel (ADR-0030 §D5). Il traverse tel quel
 * le canal `nf-dev` quand le superviseur tient l'hôte.
 */
export interface IHeldHostStatus {
  readonly key: string;
  readonly state: HeldHostState;
  readonly pid: number | null;
  /** La donnée rapportée par l'hôte prêt (adresse, port…), sinon `null`. */
  readonly data: HeldJsonObject | null;
  readonly lastError: string | null;
  readonly restartCount: number;
}

/** Au-delà, une clé de service n'est plus un identifiant. */
export const MAX_HELD_KEY_LENGTH = 128;

/**
 * Rappel d'envoi PARTAGÉ. Sans rappel, un envoi qui échoue (pair déjà sorti)
 * émet `'error'` sur le process — sans écouteur, c'est une exception non
 * rattrapée (doc `child_process`, `subprocess.send`). Une seule fonction pour
 * tous les envois : rien n'est alloué par message.
 */
export const IGNORE_SEND_ERROR = (): void => {};

/** Teneur → hôte : démarre le service décrit par `spec` (une seule fois). */
export interface IHeldStart {
  channel: typeof HELD_CHANNEL;
  type: "start";
  spec: HeldJsonObject;
}

/** Teneur → hôte : arrête le service, puis sors. */
export interface IHeldStop {
  channel: typeof HELD_CHANNEL;
  type: "stop";
}

/**
 * Teneur → hôte : preuve de vie demandée. Une boucle d'évènements gelée ne
 * répond pas — c'est ce qu'aucun code de sortie ne dit.
 */
export interface IHeldPing {
  channel: typeof HELD_CHANNEL;
  type: "ping";
  seq: number;
}

/** Hôte → teneur : le service est prêt (`data`), ou n'a pas pu l'être (`reason`). */
export interface IHeldReport {
  channel: typeof HELD_CHANNEL;
  type: "report";
  state: "ready" | "failed";
  data: HeldJsonObject | null;
  reason: string | null;
}

/** Hôte → teneur : réponse à un {@link IHeldPing}. */
export interface IHeldPong {
  channel: typeof HELD_CHANNEL;
  type: "pong";
  seq: number;
}

/** Ce que le teneur envoie. */
export type HeldHolderMessage = IHeldStart | IHeldStop | IHeldPing;

/** Ce que l'hôte envoie. */
export type HeldHostMessage = IHeldReport | IHeldPong;

/** Au-delà, une raison d'échec n'est plus un message mais un déversement. */
export const MAX_HELD_REASON_LENGTH = 4096;

/**
 * Au-delà (en caractères JSON), la donnée d'un hôte prêt n'est plus un état
 * (adresse, port) mais un déversement — et elle repartirait telle quelle vers
 * le serveur à chaque rejeu (`held-state`).
 */
export const MAX_HELD_DATA_LENGTH = 16 * 1024;

/**
 * La donnée d'un hôte prêt tient-elle dans sa borne ? Hors chemin chaud : un
 * hôte ne rapporte `ready` qu'une fois par démarrage.
 *
 * @param data - la donnée rapportée.
 * @returns `true` si sa forme JSON tient dans {@link MAX_HELD_DATA_LENGTH}.
 */
export function isHeldDataBounded(data: HeldJsonObject): boolean {
  return JSON.stringify(data).length <= MAX_HELD_DATA_LENGTH;
}

/**
 * Un numéro de séquence valide : entier positif sûr.
 *
 * @param value - la valeur reçue.
 * @returns `true` si exploitable.
 */
function isSeq(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

/**
 * Un objet JSON simple (ni tableau, ni `null`).
 *
 * @param value - la valeur reçue.
 * @returns `true` si c'est un objet au sens JSON.
 */
export function isJsonObject(value: unknown): value is HeldJsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Un instantané d'état bien formé — ce que le superviseur pousse à l'enfant.
 *
 * @param value - la valeur reçue.
 * @returns `true` si c'est un {@link IHeldHostStatus} exploitable.
 */
export function isHeldHostStatus(value: unknown): value is IHeldHostStatus {
  if (!isJsonObject(value)) return false;
  const { key, state, pid, data, lastError, restartCount } = value;
  return (
    typeof key === "string" &&
    key.length > 0 &&
    key.length <= MAX_HELD_KEY_LENGTH &&
    typeof state === "string" &&
    HELD_HOST_STATES.has(state) &&
    (pid === null || (isSeq(pid) && pid > 0)) &&
    (data === null || (isJsonObject(data) && isHeldDataBounded(data))) &&
    (lastError === null ||
      (typeof lastError === "string" &&
        lastError.length <= MAX_HELD_REASON_LENGTH)) &&
    isSeq(restartCount)
  );
}

/**
 * Ce message vient-il du canal, avec une forme que le teneur peut LIRE ?
 *
 * @param message - ce que l'IPC a livré, depuis l'hôte.
 * @returns `true` si c'est un {@link HeldHostMessage} exploitable.
 */
export function isHeldHostMessage(
  message: unknown,
): message is HeldHostMessage {
  if (!isJsonObject(message) || message.channel !== HELD_CHANNEL) return false;
  if (message.type === "pong") return isSeq(message.seq);
  if (message.type !== "report") return false;
  const { state, data, reason } = message;
  if (state !== "ready" && state !== "failed") return false;
  if (data !== null && !(isJsonObject(data) && isHeldDataBounded(data)))
    return false;
  if (reason === null) return true;
  return typeof reason === "string" && reason.length <= MAX_HELD_REASON_LENGTH;
}

/**
 * Ce message vient-il du teneur, avec une forme que l'hôte peut exécuter ?
 *
 * @param message - ce que l'IPC a livré, depuis le teneur.
 * @returns `true` si c'est un {@link HeldHolderMessage} exploitable.
 */
export function isHeldHolderMessage(
  message: unknown,
): message is HeldHolderMessage {
  if (!isJsonObject(message) || message.channel !== HELD_CHANNEL) return false;
  if (message.type === "stop") return true;
  if (message.type === "ping") return isSeq(message.seq);
  return message.type === "start" && isJsonObject(message.spec);
}

/**
 * Ce qu'un module hôte implémente : démarrer le service, l'arrêter.
 * Un échec APRÈS `ready` se signale en sortant (`process.exit(1)`) : le teneur
 * voit la sortie et relance avec recul.
 */
export interface IHeldServiceImpl {
  /**
   * Démarre le service décrit par `spec`.
   *
   * @returns la donnée d'état rapportée au teneur (adresse, port…).
   * @throws si le service n'a pas pu démarrer — la raison part au teneur.
   */
  start(spec: HeldJsonObject): Promise<HeldJsonObject>;
  /**
   * Arrête le service ; borné par le teneur, qui tue l'arbre au-delà. Un
   * service qui lance ses propres process (serveur d'inférence) les arrête
   * ICI : sous Windows, l'arbre d'un hôte déjà sorti est inatteignable.
   */
  stop(): Promise<void>;
}

/**
 * Ce que l'hôte touche de son process — injectable pour l'éprouver sans
 * `fork`. `process` le satisfait structurellement.
 */
export interface IHeldHostEndpoint {
  readonly connected?: boolean;
  send?(
    message: HeldHostMessage,
    callback?: (error: Error | null) => void,
  ): boolean;
  on(event: "message", listener: (message: unknown) => void): unknown;
  on(event: "disconnect", listener: () => void): unknown;
  exit(code?: number): never | void;
}

/** Délai laissé au service pour s'arrêter après une demande ou une déconnexion. */
const HOST_STOP_GRACE_MS = 5_000;

/**
 * Côté HÔTE : sert le protocole autour d'une implémentation.
 *
 * - `start` (une seule fois) → `report` `ready` + donnée, ou `failed` + raison ;
 * - `ping` → `pong`, sans délai : la réponse prouve la boucle d'évènements ;
 * - `stop` OU perte du canal (teneur mort, même tué net) → arrêt borné du
 *   service, puis sortie. C'est ce qui interdit l'orphelin (ADR-0030 §D6).
 *
 * @param impl - le service.
 * @param endpoint - le process porteur du canal ; `process` par défaut.
 */
export function serveHeldService(
  impl: IHeldServiceImpl,
  endpoint: IHeldHostEndpoint = process,
): void {
  let started = false;
  let leaving = false;
  const send = (message: HeldHostMessage): void => {
    if (typeof endpoint.send !== "function" || endpoint.connected === false)
      return;
    try {
      endpoint.send(message, IGNORE_SEND_ERROR);
    } catch {
      // canal en cours de fermeture : la déconnexion suivra
    }
  };
  const leave = (code: number): void => {
    if (leaving) return;
    leaving = true;
    const grace = setTimeout(() => endpoint.exit(code), HOST_STOP_GRACE_MS);
    grace.unref();
    impl.stop().then(
      () => endpoint.exit(code),
      () => endpoint.exit(code),
    );
  };
  endpoint.on("message", (message: unknown) => {
    if (!isHeldHolderMessage(message)) return;
    if (message.type === "ping") {
      send({ channel: HELD_CHANNEL, type: "pong", seq: message.seq });
      return;
    }
    if (message.type === "stop") {
      leave(0);
      return;
    }
    if (started) return;
    started = true;
    const failed = (text: string): void => {
      send({
        channel: HELD_CHANNEL,
        type: "report",
        state: "failed",
        data: null,
        reason: text.slice(0, MAX_HELD_REASON_LENGTH),
      });
      leave(1);
    };
    impl.start(message.spec).then(
      (data) => {
        // Arrêt demandé pendant le démarrage : le service part, il n'est pas prêt.
        if (leaving) return;
        // Une donnée démesurée serait ignorée par le teneur, qui conclurait
        // au silence après son délai : la cause se nomme ici.
        if (!isHeldDataBounded(data)) {
          failed(`ready data exceeds ${MAX_HELD_DATA_LENGTH} JSON characters`);
          return;
        }
        send({
          channel: HELD_CHANNEL,
          type: "report",
          state: "ready",
          data,
          reason: null,
        });
      },
      (error: unknown) => {
        if (leaving) return;
        failed(error instanceof Error ? error.message : String(error));
      },
    );
  });
  endpoint.on("disconnect", () => leave(0));
}
