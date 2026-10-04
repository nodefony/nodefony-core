/**
 * Le canal superviseur ⇄ serveur de développement — SEUL contrat de ce qui
 * transite entre les deux processus de `nodefony development`.
 *
 * Aujourd'hui il porte la coordination du terminal partagé : le serveur
 * annonce la hauteur de son bloc d'état, le superviseur dit qu'il l'a effacé
 * pour écrire. Il est fait pour grandir sans se disperser — l'invite de
 * commandes (#534) y ajoutera le texte du bloc, le redimensionnement relayé,
 * la sortie du serveur, les commandes à lancer : chacun sera un MEMBRE de
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

/** Le discriminant du canal. */
export const DEV_CHANNEL = "nf-dev";

/**
 * Serveur → superviseur : hauteur du bloc d'état affiché en bas du terminal
 * partagé (`0` = effacé). Le superviseur en a besoin pour effacer le bloc
 * ENTIER avant d'écrire.
 */
export interface IDevStatusShown {
  channel: typeof DEV_CHANNEL;
  type: "status";
  lines: number;
}

/**
 * Superviseur → serveur : « j'ai effacé ton bloc pour écrire » — le serveur ne
 * doit plus l'effacer lui-même (il emporterait les lignes du superviseur) ;
 * il le redessine sous elles à sa prochaine écriture.
 */
export interface IDevStatusErased {
  channel: typeof DEV_CHANNEL;
  type: "status-erased";
}

/** Tout ce qui peut transiter sur le canal. */
export type DevChannelMessage = IDevStatusShown | IDevStatusErased;

/** Les types connus — la seule liste que le garde consulte. */
const KNOWN_TYPES: ReadonlySet<string> = new Set<DevChannelMessage["type"]>([
  "status",
  "status-erased",
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
  const m = message as { channel?: unknown; type?: unknown; lines?: unknown };
  if (m.channel !== DEV_CHANNEL || typeof m.type !== "string") return false;
  if (!KNOWN_TYPES.has(m.type)) return false;
  if (m.type === "status") {
    return typeof m.lines === "number" && Number.isInteger(m.lines);
  }
  return true;
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
