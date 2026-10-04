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
import type { IStartupView, IStatusContext } from "./startupScreen";

/** Le discriminant du canal. */
export const DEV_CHANNEL = "nf-dev";

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
 * Superviseur → serveur : le terminal a changé de taille. Le serveur écrit
 * dans un tube et ne reçoit pas `SIGWINCH` : la porte (`terminalSize`, dans
 * `runtime/isTerminal.ts`) prend ces dimensions pour les siennes.
 */
export interface IDevResize {
  channel: typeof DEV_CHANNEL;
  type: "resize";
  columns: number;
  rows: number;
}

/** Tout ce qui peut transiter sur le canal. */
export type DevChannelMessage = IDevStatusView | IDevResize;

/** Les types connus — la seule liste que le garde consulte. */
const KNOWN_TYPES: ReadonlySet<string> = new Set<DevChannelMessage["type"]>([
  "status-view",
  "resize",
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
    columns?: unknown;
    rows?: unknown;
  };
  if (m.channel !== DEV_CHANNEL || typeof m.type !== "string") return false;
  if (!KNOWN_TYPES.has(m.type)) return false;
  if (m.type === "status-view") {
    return isStatusView(m.view) && isStatusContext(m.context);
  }
  if (m.type === "resize")
    return isTerminalDimension(m.columns) && isTerminalDimension(m.rows);
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
 * Une dimension de terminal valide : entier strictement positif. Partagée
 * avec la porte (`runtime/isTerminal.ts`), qui valide le verdict transmis.
 *
 * @param value - la valeur reçue.
 * @returns `true` si c'est un nombre de colonnes ou de lignes exploitable.
 */
export function isTerminalDimension(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

/**
 * Côté SERVEUR : envoie au superviseur. Sans superviseur (`--no-watch`, ou
 * lancé autrement), il n'y a pas de canal : rien n'est envoyé.
 *
 * @param message - le message.
 * @returns `true` s'il est parti.
 */
export function sendToSupervisor(message: DevChannelMessage): boolean {
  if (typeof process.send !== "function" || !process.connected) return false;
  try {
    return process.send(message);
  } catch {
    return false; // canal en cours de fermeture : le processus s'arrête
  }
}

/**
 * Côté SERVEUR : écoute le superviseur. Le canal est relâché (`unref`) : il ne
 * garde pas, à lui seul, le processus en vie.
 *
 * @param handler - appelé pour chaque message valide du canal.
 * @returns la désinscription — ou une fonction vide sans canal.
 */
export function listenToSupervisor(
  handler: (message: DevChannelMessage) => void,
): () => void {
  if (typeof process.send !== "function") return () => {};
  const listener = (message: unknown): void => {
    if (isDevChannelMessage(message)) handler(message);
  };
  process.on("message", listener);
  process.channel?.unref();
  return () => {
    process.removeListener("message", listener);
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
    return child.send(message);
  } catch {
    return false; // le serveur s'arrête
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
