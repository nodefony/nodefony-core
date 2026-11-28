/**
 * Le canal superviseur ⇄ serveur de développement — SEUL contrat de ce qui
 * transite entre les deux processus de `nodefony development`.
 *
 * Le superviseur est le SEUL propriétaire du terminal (ADR-0013 §1) : la
 * sortie du serveur lui arrive par des tubes, jamais par ce canal (un JSON
 * par ligne coûterait). Le canal ne porte que ce qu'un tube ne dit pas : le
 * bilan qui nourrit la barre d'état (`status-view`) et les dimensions du
 * terminal (`resize`). Chaque besoin neuf sera un MEMBRE de
 * {@link DevChannelMessage}, et le compilateur désignera tout aiguillage qui ne
 * le traite pas.
 *
 * Choix figés :
 * - **Un discriminant de canal** (`channel: "nf-dev"`) : l'IPC sert ailleurs
 *   dans le dépôt (messages de cluster `process:msg`, backplane temps réel,
 *   sonde de cluster). Un message de ce canal ne doit jamais être pris pour
 *   l'un d'eux, ni l'inverse.
 * - **Aucun numéro de version** : superviseur et serveur sont lancés depuis la
 *   MÊME installation, il n'existe pas de pair d'une autre version à tolérer.
 *   Un champ de version n'achèterait rien.
 * - **Un garde unique** ({@link isDevChannelMessage}) : tout ce qui n'est pas
 *   du canal, ou d'un type inconnu, est ignoré — jamais interprété.
 */
import type { ChildProcess } from "node:child_process";
import { isAbsolute } from "node:path";
import type { IQuestion, QuestionValue } from "../../cli/question";
import { isWireAnswer, isWireQuestion } from "../../cli/questionWire";
import type { RpcPart } from "../../realtime/JsonRpcPeer";
import type { IStartupView, IStatusContext } from "./startupScreen";
import {
  IGNORE_SEND_ERROR,
  isHeldHostStatus,
  isJsonObject,
  MAX_HELD_KEY_LENGTH,
  MAX_HELD_REASON_LENGTH,
  type HeldJsonObject,
  type IHeldHostStatus,
  type IHeldServiceDeclaration,
  type IHostTuning,
} from "./heldChannel";
import {
  DEV_CHANNEL,
  DEV_CHILD_ENV,
  DEV_PROMPT_ENV,
  isDevResize,
  isTerminalDimension,
  type IDevResize,
} from "./devChannelBase";

export {
  DEV_CHANNEL,
  DEV_CHILD_ENV,
  DEV_PROMPT_ENV,
  isTerminalDimension,
  type IDevResize,
  type IHeldServiceDeclaration,
};

/**
 * Serveur → superviseur : le bilan du serveur prêt, de quoi dessiner la barre
 * d'état. Des DONNÉES, jamais des lignes : c'est le superviseur qui connaît
 * la largeur, le jeu de caractères et la phase (un serveur qui redémarre ne
 * dit plus rien de vrai).
 */
export interface IDevStatusView {
  channel: typeof DEV_CHANNEL;
  type: "status-view";
  view: IStartupView;
  context: IStatusContext;
}

/**
 * Serveur → superviseur : l'étape du démarrage en cours, suivie sur le cycle
 * d'évènements du noyau (`onStart`, `onRegister`, `onBoot`, `onReady`,
 * `onServersReady`) puis sur les bundles Vite. La barre d'état la montre
 * pendant que le serveur démarre — elle survit au serveur, elle ne devine
 * pas.
 */
export interface IDevBootStep {
  channel: typeof DEV_CHANNEL;
  type: "boot-step";
  /** Libellé de l'étape (« Services & ORM », « Frontend (Vite) »). */
  step: string;
  /** Unités faites, sur `total`. */
  done: number;
  total: number;
}

/**
 * Serveur → superviseur : un échantillon runtime (mémoire, CPU, boucle
 * d'évènements), toutes les deux secondes une fois prêt — la barre d'état
 * le montre en direct.
 */
export interface IDevRuntime {
  channel: typeof DEV_CHANNEL;
  type: "runtime";
  rssBytes: number;
  cpuPercent: number;
  eluPercent: number;
}

/**
 * Serveur → superviseur : l'état VOULU des services d'un propriétaire
 * (`frontend`, demain `ai`), liste COMPLÈTE (ADR-0030 §D3). Clé neuve →
 * démarrée ; empreinte changée → remplacée ; identique → gardée ; absente →
 * arrêtée. Corrélé par `id` (JSON-RPC 2.0), acquitté par {@link IDevHeldPlanAck}.
 */
export interface IDevHeldPlan {
  channel: typeof DEV_CHANNEL;
  type: "held-plan";
  /** Entier croissant choisi par le serveur ; repris par l'acquittement. */
  id: number;
  owner: string;
  services: readonly IHeldServiceDeclaration[];
}

/** Superviseur → serveur : le plan `id` est appliqué, ou refusé en nommant la cause. */
export interface IDevHeldPlanAck {
  channel: typeof DEV_CHANNEL;
  type: "held-plan-ack";
  id: number;
  owner: string;
  accepted: boolean;
  reason: string | null;
}

/**
 * Superviseur → serveur : l'instantané d'un service porté, poussé à chaque
 * changement et rejoué à la réception d'un plan (ADR-0030 §D5). Le serveur le
 * garde tel quel : le lire ne coûte ni allocation ni aller-retour.
 */
export interface IDevHeldState {
  channel: typeof DEV_CHANNEL;
  type: "held-state";
  owner: string;
  status: IHeldHostStatus;
}

/**
 * Serveur → superviseur, UNE fois par démarrage, juste avant `onPostReady` :
 * les propriétaires qui ont déclaré, pendant ce démarrage, vouloir des
 * services portés — liste COMPLÈTE, vide comprise. Le superviseur arrête les
 * services de tout autre propriétaire (ADR-0030 §D3) : un module retiré de la
 * configuration n'envoie plus jamais de plan, et ses hôtes vivraient sinon
 * toute la session. Ce n'est pas un plan : il ne démarre rien, et ne touche
 * pas aux services d'un propriétaire qu'il nomme, dont le plan peut arriver
 * après lui.
 */
export interface IDevHeldOwners {
  channel: typeof DEV_CHANNEL;
  type: "held-owners";
  owners: readonly string[];
}

/**
 * Commande de l'invite → superviseur (#538, lot 2b-2) : une question à poser
 * à sa place, faute de terminal. Le superviseur la dessine dans l'onglet de la
 * commande et rend {@link IDevAnswer} sous le même `id`.
 */
export interface IDevQuestion {
  channel: typeof DEV_CHANNEL;
  type: "question";
  /** Entier croissant choisi par la commande ; repris par la réponse. */
  id: number;
  question: IQuestion;
}

/**
 * Superviseur → commande de l'invite : la réponse à la question `id`, ou
 * `null` si la personne l'a annulée (Échap, Ctrl+C, onglet fermé). La
 * commande la REVALIDE (`checkAnswer`) : le superviseur n'est pas juge.
 */
export interface IDevAnswer {
  channel: typeof DEV_CHANNEL;
  type: "answer";
  id: number;
  value: QuestionValue | null;
}

/**
 * Dans les deux sens : une trame JSON-RPC 2.0 entre le pair du superviseur et
 * celui du serveur (ADR-0013 §6). Le garde ne vérifie que « `frame` est un
 * objet » : la forme d'une trame est jugée par le pair
 * (`jsonrpc/index.ts#classifyJsonRpcFrame`), qui jette une trame invalide.
 */
export interface IDevRpc {
  channel: typeof DEV_CHANNEL;
  type: "rpc";
  frame: object;
}

/** Tout ce qui peut transiter sur le canal. */
export type DevChannelMessage =
  | IDevStatusView
  | IDevResize
  | IDevBootStep
  | IDevRuntime
  | IDevHeldPlan
  | IDevHeldPlanAck
  | IDevHeldState
  | IDevHeldOwners
  | IDevQuestion
  | IDevAnswer
  | IDevRpc;

/**
 * Ce que l'invite demande au serveur : les champs de
 * `workspace/executeCommand` (LSP), plus la largeur de l'onglet.
 */
export interface ICommandExecuteParams {
  /** Nom de la commande, tel que le manifeste le connaît (`env`, `inspect`). */
  readonly command: string;
  /** Arguments déjà découpés, sans le nom de la commande. */
  readonly arguments: readonly string[];
  /** Largeur de l'onglet : une part `text` est rendue à cette largeur. */
  readonly columns: number;
}

/**
 * La réponse du serveur. `live: false` dit que la commande ne se sert pas en
 * direct — une DONNÉE, pas une erreur : le superviseur la lance alors en
 * sous-processus. Une réponse `live: true` porte toujours au moins une part
 * `text`.
 */
export type CommandExecuteResult =
  | { readonly live: false }
  | {
      readonly live: true;
      readonly code: number;
      readonly parts: readonly RpcPart[];
    };

/** La réponse « cette commande ne se sert pas en direct », partagée et figée. */
export const NOT_LIVE: CommandExecuteResult = Object.freeze({ live: false });

/** Les actions que le serveur expose au superviseur — une seule. */
export type DevActions = {
  "command.execute": { in: ICommandExecuteParams; out: CommandExecuteResult };
};

/** Les notifications que le serveur émet vers le superviseur. */
export type DevEvents = {
  /** `command.execute` est servi : le serveur a fini de démarrer. */
  "dev.ready": undefined;
};

/** Nom de la notification « le serveur sert `command.execute` ». */
export const DEV_READY = "dev.ready" satisfies keyof DevEvents;

/**
 * Délai d'une requête en direct. Le défaut du pair (30 s) est celui d'un
 * réseau ; ici, `config`, la plus lourde lecture mesurée, répond en 3 ms.
 */
export const LIVE_COMMAND_TIMEOUT_MS = 5_000;

/** Borne d'une requête : nom et arguments, en octets UTF-8. */
export const MAX_LIVE_REQUEST_BYTES = 64 * 1024;

/**
 * Borne d'une réponse, en octets de JSON. Au-delà, un refus nommé
 * ({@link LIVE_RESULT_TOO_LARGE}), jamais une réponse amputée. Repères
 * mesurés : `env` 30 Kio, `inspect config` 195 Kio.
 */
export const MAX_LIVE_RESULT_BYTES = 1024 * 1024;

/**
 * Code d'erreur d'une réponse refusée pour sa taille (`data: { bytes, max }`).
 * Propre à ce canal — sa seule définition. Plage serveur de JSON-RPC 2.0 §5.1 ;
 * une porte MCP qui traduirait `command.execute` le traduirait aussi.
 */
export const LIVE_RESULT_TOO_LARGE = -32010;

/** Longueur maximale d'un nom de commande (`security:user:list`). */
const MAX_LIVE_COMMAND_LENGTH = 256;
/** Largeur maximale d'un onglet, en colonnes. */
const MAX_LIVE_COLUMNS = 10_000;

/**
 * Des paramètres de `command.execute` exploitables : nom non vide, arguments
 * en chaînes, largeur entière, le tout sous {@link MAX_LIVE_REQUEST_BYTES}.
 * Ils viennent du fil : le type du contrat les DÉCRIT, ce garde les VÉRIFIE.
 *
 * @param value - les `params` reçus.
 * @returns `true` si la requête peut être servie.
 */
export function isCommandExecuteParams(
  value: unknown,
): value is ICommandExecuteParams {
  if (!isJsonObject(value)) return false;
  const { command, arguments: args, columns } = value;
  if (
    typeof command !== "string" ||
    command.length === 0 ||
    command.length > MAX_LIVE_COMMAND_LENGTH ||
    typeof columns !== "number" ||
    !Number.isInteger(columns) ||
    columns < 1 ||
    columns > MAX_LIVE_COLUMNS ||
    !Array.isArray(args)
  )
    return false;
  let bytes = Buffer.byteLength(command);
  for (const arg of args) {
    if (typeof arg !== "string") return false;
    bytes += Buffer.byteLength(arg);
    if (bytes > MAX_LIVE_REQUEST_BYTES) return false;
  }
  return true;
}

/** Au-delà, un plan n'est plus une déclaration mais un déversement. */
export const MAX_HELD_SERVICES = 32;
/** Au-delà, une liste de propriétaires n'est plus une liste mais un déversement. */
export const MAX_HELD_OWNERS = 32;
/** Longueur maximale d'un nom de propriétaire. */
const MAX_HELD_OWNER_LENGTH = 64;
/** Longueur maximale d'une empreinte (un SHA-512 en hexadécimal tient en 128). */
const MAX_HELD_FINGERPRINT_LENGTH = 128;
/** Longueur maximale d'un chemin (module, répertoire de travail). */
const MAX_HELD_PATH_LENGTH = 4096;
/** Variables ajoutées : nombre et tailles bornés. */
const MAX_HELD_ENV_ENTRIES = 64;
const MAX_HELD_ENV_NAME_LENGTH = 256;
const MAX_HELD_ENV_VALUE_LENGTH = 8192;
/** Longueur maximale d’une `spec` une fois sérialisée (caractères JSON). */
const MAX_HELD_SPEC_LENGTH = 64 * 1024;

/**
 * Un identifiant de clé ou de propriétaire : lettres, chiffres, puis
 * `: . _ + @ -`. Sans quantificateur imbriqué ni alternance (ReDoS impossible).
 */
const HELD_IDENTIFIER = /^[A-Za-z0-9][\w:.+@-]*$/;

/**
 * Bornes du réglage d'un hôte — une entrée par champ de
 * {@link IHostTuning}, que le compilateur exige toutes.
 */
const HELD_TUNING_MAX = {
  startupTimeoutMs: 600_000,
  maxRestarts: 1_000,
  restartBackoffBaseMs: 600_000,
  restartBackoffMaxMs: 3_600_000,
  livenessIntervalMs: 3_600_000,
  livenessTimeoutMs: 600_000,
  livenessMissedLimit: 1_000,
  // L'arrêt d'un hôte retient le Ctrl-C de la session : une minute au plus.
  stopGraceMs: 60_000,
} as const satisfies Record<keyof IHostTuning, number>;

/**
 * Un champ de réglage connu.
 *
 * @param field - le nom reçu.
 * @returns `true` si c'est un champ de {@link IHostTuning}.
 */
function isTuningField(field: string): field is keyof IHostTuning {
  return Object.hasOwn(HELD_TUNING_MAX, field);
}

/**
 * Un identifiant (clé, propriétaire) bien formé.
 *
 * @param value - la valeur reçue.
 * @param max - longueur maximale.
 * @returns `true` si exploitable.
 */
function isHeldIdentifier(value: unknown, max: number): value is string {
  return (
    typeof value === "string" &&
    value.length <= max &&
    HELD_IDENTIFIER.test(value)
  );
}

/**
 * Un entier positif sûr (identifiant de plan ou de question).
 *
 * @param value - la valeur reçue.
 * @returns `true` si exploitable.
 */
function isPlanId(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

/**
 * Le premier défaut d'une déclaration de service, ou `null` si elle est
 * exploitable. Le texte NOMME le champ : il part tel quel dans l'acquittement.
 *
 * @param value - une entrée de `services`.
 * @returns la cause du refus, ou `null`.
 */
function heldDeclarationProblem(value: unknown): string | null {
  if (!isJsonObject(value)) return "a service is not an object";
  const { key, module, fingerprint, spec, cwd, env, tuning } = value;
  if (!isHeldIdentifier(key, MAX_HELD_KEY_LENGTH))
    return "a service has an invalid key";
  if (
    typeof module !== "string" ||
    module.length > MAX_HELD_PATH_LENGTH ||
    !isAbsolute(module)
  )
    return `service "${key}": module must be an absolute path`;
  if (
    typeof fingerprint !== "string" ||
    fingerprint.length === 0 ||
    fingerprint.length > MAX_HELD_FINGERPRINT_LENGTH
  )
    return `service "${key}": invalid fingerprint`;
  if (!isJsonObject(spec)) return `service "${key}": spec must be an object`;
  if (JSON.stringify(spec).length > MAX_HELD_SPEC_LENGTH)
    return `service "${key}": spec exceeds ${MAX_HELD_SPEC_LENGTH} JSON characters`;
  if (
    typeof cwd !== "string" ||
    cwd.length > MAX_HELD_PATH_LENGTH ||
    !isAbsolute(cwd)
  )
    return `service "${key}": cwd must be an absolute path`;
  if (!isJsonObject(env)) return `service "${key}": env must be an object`;
  const names = Object.keys(env);
  if (names.length > MAX_HELD_ENV_ENTRIES)
    return `service "${key}": more than ${MAX_HELD_ENV_ENTRIES} env entries`;
  for (const name of names) {
    const v = env[name];
    if (
      name.length === 0 ||
      name.length > MAX_HELD_ENV_NAME_LENGTH ||
      typeof v !== "string" ||
      v.length > MAX_HELD_ENV_VALUE_LENGTH
    )
      return `service "${key}": invalid env entry "${name.slice(0, 64)}"`;
  }
  if (tuning === undefined) return null;
  if (!isJsonObject(tuning))
    return `service "${key}": tuning must be an object`;
  for (const field of Object.keys(tuning)) {
    if (!isTuningField(field))
      return `service "${key}": unknown tuning "${field.slice(0, 64)}"`;
    const max = HELD_TUNING_MAX[field];
    const v = tuning[field];
    if (typeof v !== "number" || !Number.isSafeInteger(v) || v < 0 || v > max)
      return `service "${key}": tuning "${field}" must be an integer in [0, ${max}]`;
  }
  return null;
}

/**
 * Le premier défaut d'un plan, ou `null` s'il est applicable : chaque
 * déclaration bien formée, aucune clé en double. L'enveloppe (`id`, `owner`,
 * `services` tableau borné) a déjà passé {@link isDevChannelMessage}.
 *
 * @param plan - le plan reçu.
 * @returns la cause du refus, ou `null`.
 */
export function heldPlanProblem(plan: IDevHeldPlan): string | null {
  const seen = new Set<string>();
  for (const declaration of plan.services) {
    const problem = heldDeclarationProblem(declaration);
    if (problem !== null) return problem;
    if (seen.has(declaration.key))
      return `service "${declaration.key}" is declared twice`;
    seen.add(declaration.key);
  }
  return null;
}

/**
 * Un `held-plan` dont l'enveloppe est lisible — de quoi l'acquitter. Le
 * contenu de chaque service est jugé par {@link heldPlanProblem}, qui nomme
 * la cause d'un refus au lieu de taire le message.
 */
function isHeldPlan(m: HeldJsonObject): boolean {
  return (
    isPlanId(m.id) &&
    isHeldIdentifier(m.owner, MAX_HELD_OWNER_LENGTH) &&
    Array.isArray(m.services) &&
    m.services.length <= MAX_HELD_SERVICES
  );
}

/** Un `held-plan-ack` bien formé. */
function isHeldPlanAck(m: HeldJsonObject): boolean {
  return (
    isPlanId(m.id) &&
    isHeldIdentifier(m.owner, MAX_HELD_OWNER_LENGTH) &&
    typeof m.accepted === "boolean" &&
    (m.reason === null ||
      (typeof m.reason === "string" &&
        m.reason.length <= MAX_HELD_REASON_LENGTH))
  );
}

/** Un `held-state` bien formé. */
function isHeldState(m: HeldJsonObject): boolean {
  return (
    isHeldIdentifier(m.owner, MAX_HELD_OWNER_LENGTH) &&
    isHeldHostStatus(m.status)
  );
}

/** Un `held-owners` bien formé : liste bornée d'identifiants. */
function isHeldOwners(m: HeldJsonObject): boolean {
  const { owners } = m;
  return (
    Array.isArray(owners) &&
    owners.length <= MAX_HELD_OWNERS &&
    owners.every((owner) => isHeldIdentifier(owner, MAX_HELD_OWNER_LENGTH))
  );
}

/**
 * Un `runtime` bien formé : trois nombres finis, positifs, bornés.
 *
 * @param message - ce que l'IPC a livré, déjà reconnu comme du canal.
 * @returns `true` si la forme est exploitable.
 */
function isRuntime(message: object): boolean {
  const m = message as Record<string, unknown>;
  const bounded = (value: unknown, max: number): boolean =>
    typeof value === "number" &&
    Number.isFinite(value) &&
    value >= 0 &&
    value <= max;
  return (
    bounded(m.rssBytes, Number.MAX_SAFE_INTEGER) &&
    bounded(m.cpuPercent, 100_000) &&
    bounded(m.eluPercent, 100)
  );
}

/** Longueur maximale d'un libellé d'étape — au-delà, le message est refusé. */
const MAX_STEP_LENGTH = 80;

/**
 * Un `boot-step` bien formé : libellé court, compteurs entiers bornés.
 *
 * @param message - ce que l'IPC a livré, déjà reconnu comme du canal.
 * @returns `true` si la forme est exploitable.
 */
function isBootStep(message: object): boolean {
  const m = message as { step?: unknown; done?: unknown; total?: unknown };
  return (
    typeof m.step === "string" &&
    m.step.length > 0 &&
    m.step.length <= MAX_STEP_LENGTH &&
    Number.isInteger(m.done) &&
    Number.isInteger(m.total) &&
    (m.done as number) >= 0 &&
    (m.total as number) >= (m.done as number) &&
    (m.total as number) <= 1000
  );
}

/** Les types connus — la seule liste que le garde consulte. */
const KNOWN_TYPES: ReadonlySet<string> = new Set<DevChannelMessage["type"]>([
  "status-view",
  "resize",
  "boot-step",
  "runtime",
  "held-plan",
  "held-plan-ack",
  "held-state",
  "held-owners",
  "question",
  "answer",
  "rpc",
]);

/**
 * Ce message appartient-il au canal, avec un type connu et une forme valide ?
 *
 * @param message - ce que l'IPC a livré.
 * @returns `true` si c'est un {@link DevChannelMessage} exploitable.
 */
export function isDevChannelMessage(
  message: unknown,
): message is DevChannelMessage {
  if (typeof message !== "object" || message === null) return false;
  const m = message as {
    channel?: unknown;
    type?: unknown;
    view?: unknown;
    context?: unknown;
  };
  if (m.channel !== DEV_CHANNEL || typeof m.type !== "string") return false;
  if (!KNOWN_TYPES.has(m.type)) return false;
  if (m.type === "status-view") {
    return isStatusView(m.view) && isStatusContext(m.context);
  }
  if (m.type === "resize") return isDevResize(message);
  if (m.type === "boot-step") return isBootStep(message);
  if (m.type === "runtime") return isRuntime(message);
  if (m.type === "rpc") {
    const frame = "frame" in message ? message.frame : undefined;
    return typeof frame === "object" && frame !== null;
  }
  if (m.type === "question" || m.type === "answer") {
    if (!isJsonObject(message) || !isPlanId(message.id)) return false;
    return m.type === "question"
      ? isWireQuestion(message.question)
      : message.value === null || isWireAnswer(message.value);
  }
  if (m.type.startsWith("held-")) {
    if (!isJsonObject(message)) return false;
    if (m.type === "held-plan") return isHeldPlan(message);
    if (m.type === "held-plan-ack") return isHeldPlanAck(message);
    if (m.type === "held-owners") return isHeldOwners(message);
    return isHeldState(message);
  }
  return true;
}

/** Un bilan : la forme que la barre lit, sans relire chaque champ. */
function isStatusView(value: unknown): value is IStartupView {
  if (typeof value !== "object" || value === null) return false;
  const v = value as { notices?: unknown; open?: unknown; version?: unknown };
  return (
    Array.isArray(v.notices) &&
    Array.isArray(v.open) &&
    typeof v.version === "string"
  );
}

/** Le contexte de la barre : projet, heure de mise en route, rechargements. */
function isStatusContext(value: unknown): value is IStatusContext {
  if (typeof value !== "object" || value === null) return false;
  const c = value as {
    project?: unknown;
    readyAt?: unknown;
    reloads?: unknown;
  };
  return (
    typeof c.project === "string" &&
    typeof c.readyAt === "string" &&
    typeof c.reloads === "number"
  );
}

/**
 * Ce que le côté SERVEUR touche de son processus — la forme de `process` que
 * le canal lit et écrit, injectable pour éprouver le canal sans parler au vrai
 * parent. `process` la satisfait structurellement.
 */
export interface IDevChannelEndpoint {
  /** `true` tant que le canal IPC vers le parent est ouvert. */
  readonly connected?: boolean;
  /** Présent seulement si le processus a été lancé avec un canal IPC. */
  send?(
    message: DevChannelMessage,
    callback?: (error: Error | null) => void,
  ): boolean;
  on(event: "message", listener: (message: unknown) => void): unknown;
  removeListener(
    event: "message",
    listener: (message: unknown) => void,
  ): unknown;
  /**
   * La fermeture du canal : le superviseur est mort, même tué net. Optionnel —
   * une extrémité fictive qui ne l'éprouve pas n'a pas à le porter.
   */
  once?(event: "disconnect", listener: () => void): unknown;
  /** Le canal lui-même, pour le relâcher (`unref`). */
  readonly channel?: { unref(): void } | null;
}

/**
 * Ce que le côté SERVEUR arrête quand son superviseur disparaît — le noyau le
 * satisfait structurellement (`Kernel#isTerminating`, `Kernel#terminate`).
 */
export interface ISupervisorLossTarget {
  /** Vrai dès qu'un arrêt est demandé, par qui que ce soit. */
  readonly isTerminating: boolean;
  /** Arrêt propre du serveur, puis sortie du processus. */
  terminate(code?: number): Promise<unknown>;
}

/** Un flux de sortie du processus (`process.stdout`, `process.stderr`). */
export interface IOutputStream {
  on(event: "error", listener: (error: Error) => void): unknown;
}

/** Absorbe l'erreur d'écriture d'un tube dont le lecteur est mort. */
const IGNORE_OUTPUT_ERROR = (): void => {};

/**
 * Côté SERVEUR : arrête le serveur quand le canal vers le superviseur se ferme.
 *
 * Un superviseur tué net (SIGKILL, `TerminateProcess`, console fermée) ne
 * prévient personne, et le serveur naît dans son propre groupe de process :
 * sans cet écouteur, il garderait ses ports, sans plus rien recharger ni
 * afficher. La perte du canal est le seul signal qui lui parvient — le patron
 * des hôtes portés (`heldChannel.ts#serveHeldService`).
 *
 * Sous Windows, l'écouteur n'est qu'un filet : le serveur n'y naît pas détaché
 * (`devProcess.ts#spawnsAsGroupLeader`), et un enfant non détaché meurt avec
 * son parent (job object de libuv). Le système l'emporte avant que la perte
 * du canal ne lui parvienne — ports rendus, aucun arrêt propre (axiome 6).
 *
 * À la perte :
 * - les erreurs d'écriture de `outputs` sont absorbées : en rendu terminal, la
 *   sortie du serveur est un tube vers le superviseur, et la première ligne
 *   écrite après sa mort lèverait `EPIPE`, fatal sans écouteur — l'arrêt
 *   tomberait au milieu, sans fermer ses serveurs ;
 * - le serveur s'arrête, sauf si un arrêt est DÉJÀ en cours (signal du
 *   superviseur, `nodefony stop`) : un second arrêt ne se lance pas.
 *
 * Un seul écouteur, posé une fois (`once`) : il vit jusqu'à la sortie du
 * processus, qu'il provoque. Sans canal IPC, rien n'est posé.
 *
 * @param target - ce qui s'arrête ; le noyau.
 * @param endpoint - le processus porteur du canal ; `process` par défaut.
 * @param outputs - les flux dont le lecteur peut mourir avec le superviseur.
 * @param exit - sortie forcée si l'arrêt propre échoue ; `process.exit` par défaut.
 * @returns `true` si l'écouteur est posé.
 */
export function terminateOnSupervisorLoss(
  target: ISupervisorLossTarget,
  endpoint: IDevChannelEndpoint = process,
  outputs: readonly IOutputStream[] = [process.stdout, process.stderr],
  exit: (code: number) => void = (code) => process.exit(code),
): boolean {
  if (typeof endpoint.send !== "function" || endpoint.once === undefined)
    return false;
  endpoint.once("disconnect", () => {
    for (const output of outputs) output.on("error", IGNORE_OUTPUT_ERROR);
    if (target.isTerminating) return;
    // Un arrêt qui échoue laisserait l'orphelin que cet écouteur interdit :
    // personne ne lira la cause, la sortie est forcée.
    target.terminate(0).catch(() => exit(1));
  });
  return true;
}

/**
 * Côté SERVEUR : le canal vers le superviseur est-il ouvert ? Une variable
 * d'environnement héritée ne suffit pas — un process qui la reçoit sans canal
 * IPC (relancé à la main, lancé par un outil) n'a personne à qui parler.
 *
 * @param endpoint - le processus porteur du canal ; `process` par défaut.
 * @returns `true` si un message peut partir.
 */
export function hasSupervisorChannel(
  endpoint: IDevChannelEndpoint = process,
): endpoint is IDevChannelEndpoint &
  Required<Pick<IDevChannelEndpoint, "send">> {
  return typeof endpoint.send === "function" && endpoint.connected === true;
}

/**
 * Côté SERVEUR : envoie au superviseur. Sans superviseur (`--no-watch`, ou
 * lancé autrement), il n'y a pas de canal : rien n'est envoyé.
 *
 * @param message - le message.
 * @param endpoint - le processus porteur du canal ; `process` par défaut.
 * @returns `true` s'il est parti.
 */
export function sendToSupervisor(
  message: DevChannelMessage,
  endpoint: IDevChannelEndpoint = process,
): boolean {
  if (!hasSupervisorChannel(endpoint)) return false;
  try {
    // Rappel posé : un échec d'écriture (superviseur sorti) le reçoit, au lieu
    // d'un `'error'` émis sur le process, fatal sans écouteur.
    return endpoint.send(message, IGNORE_SEND_ERROR);
  } catch {
    return false; // canal en cours de fermeture : le processus s'arrête
  }
}

/**
 * Côté SERVEUR : la sortie du pair JSON-RPC vers le superviseur.
 *
 * 🔴 Elle ne relaie PAS la valeur de `process.send()` : sous arriéré, il rend
 * `false` alors que le message PART (constaté : 20 envois de 1 Mio, 20 `false`,
 * 20 reçus), et le pair lirait `false` comme « non émis » et rejetterait la
 * requête. `false` seulement quand le canal est fermé ou que l'envoi lève.
 *
 * @param frame - la trame que le pair émet.
 * @param endpoint - le processus porteur du canal ; `process` par défaut.
 * @returns `true` si la trame est partie.
 */
export function sendRpcToSupervisor(
  frame: unknown,
  endpoint: IDevChannelEndpoint = process,
): boolean {
  if (typeof frame !== "object" || frame === null) return false;
  if (!hasSupervisorChannel(endpoint)) return false;
  try {
    endpoint.send(
      { channel: DEV_CHANNEL, type: "rpc", frame },
      IGNORE_SEND_ERROR,
    );
    return true;
  } catch {
    return false;
  }
}

/**
 * Côté SERVEUR : écoute le superviseur. Le canal est relâché (`unref`) : il ne
 * garde pas, à lui seul, le processus en vie.
 *
 * @param handler - appelé pour chaque message valide du canal.
 * @param endpoint - le processus porteur du canal ; `process` par défaut.
 * @returns la désinscription — ou une fonction vide sans canal.
 */
export function listenToSupervisor(
  handler: (message: DevChannelMessage) => void,
  endpoint: IDevChannelEndpoint = process,
): () => void {
  if (typeof endpoint.send !== "function") return () => {};
  const listener = (message: unknown): void => {
    if (isDevChannelMessage(message)) handler(message);
  };
  endpoint.on("message", listener);
  endpoint.channel?.unref();
  return () => {
    endpoint.removeListener("message", listener);
  };
}

/**
 * Côté SUPERVISEUR : envoie au serveur, s'il est encore joignable.
 *
 * @param child - le processus serveur, ou `null`.
 * @param message - le message.
 * @returns `true` s'il est parti.
 */
export function sendToServer(
  child: ChildProcess | null,
  message: DevChannelMessage,
): boolean {
  if (!child?.connected) return false;
  try {
    // Le superviseur n'écoute pas `'error'` sur le serveur : sans ce rappel, un
    // envoi croisant la mort du serveur ferait tomber le superviseur.
    return child.send(message, IGNORE_SEND_ERROR);
  } catch {
    return false; // le serveur s'arrête
  }
}

/**
 * Ce que la sortie du pair touche du processus serveur — `ChildProcess` la
 * satisfait structurellement.
 */
export interface IServerChannel {
  /** `true` tant que le canal IPC vers le serveur est ouvert. */
  readonly connected: boolean;
  send(
    message: DevChannelMessage,
    callback: (error: Error | null) => void,
  ): boolean;
}

/**
 * Côté SUPERVISEUR : la sortie du pair JSON-RPC vers le serveur. Même règle
 * que {@link sendRpcToSupervisor} : le `false` de `send()` n'est pas relayé.
 *
 * @param child - le processus serveur, ou `null`.
 * @param frame - la trame que le pair émet.
 * @returns `true` si la trame est partie.
 */
export function sendRpcToServer(
  child: IServerChannel | null,
  frame: unknown,
): boolean {
  if (typeof frame !== "object" || frame === null) return false;
  if (!child?.connected) return false;
  try {
    child.send({ channel: DEV_CHANNEL, type: "rpc", frame }, IGNORE_SEND_ERROR);
    return true;
  } catch {
    return false;
  }
}

/**
 * Côté SUPERVISEUR : écoute un serveur. L'écouteur vit autant que le processus
 * enfant — qui est relancé à chaque rechargement : on s'abonne au nouveau.
 *
 * @param child - le processus serveur.
 * @param handler - appelé pour chaque message valide du canal.
 */
export function listenToServer(
  child: ChildProcess,
  handler: (message: DevChannelMessage) => void,
): void {
  child.on("message", (message: unknown) => {
    if (isDevChannelMessage(message)) handler(message);
  });
}
