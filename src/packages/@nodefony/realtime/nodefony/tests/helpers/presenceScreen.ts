import type { Serializable } from "node:child_process";

/** Ce qu'un worker renvoie au master — seuls les champs lus ici. */
export interface IScreenMessage {
  cmd?: string;
  op?: string;
  tab?: string;
  ready?: boolean;
  partial?: boolean | null;
  count?: number;
  unnamed?: number;
  members?: Record<string, number>;
}

/** Un worker forké vu du master : bancs IPC et Redis (#760). */
export interface IScreenWorker {
  child: { send(message: Serializable): boolean };
  events: IScreenMessage[];
  awaitEvent(
    predicate: (e: IScreenMessage) => boolean,
    timeoutMs?: number,
  ): Promise<unknown>;
}

/**
 * Ouvre sur `w` un onglet de navigateur (`user` absent = anonyme) qui affiche la
 * présence de `channel` (commande `presence-browser` de `presenceWorker.ts`).
 */
export async function openTab(
  w: IScreenWorker,
  tab: string,
  channel: string,
  user?: string,
): Promise<void> {
  w.child.send({ cmd: "presence-browser", tab, user: user ?? "", channel });
  await w.awaitEvent(
    (e) => e.cmd === "ack" && e.op === "presence-browser" && e.tab === tab,
  );
}

/** Les instantanés POUSSÉS à l'écran de `tab`, à partir de l'événement `from`. */
export function viewsOf(
  w: IScreenWorker,
  tab: string,
  from = 0,
): IScreenMessage[] {
  return w.events
    .slice(from)
    .filter((e) => e.cmd === "browser-view" && e.tab === tab);
}

/**
 * Ce que l'écran de `tab` affiche — le DERNIER instantané poussé, jamais une
 * lecture tirée — attendu jusqu'à `done` ou l'échéance, et rendu tel quel :
 * l'assertion qui suit dit l'écart.
 */
export async function screenOf(
  w: IScreenWorker,
  tab: string,
  done: (e: IScreenMessage) => boolean,
  timeoutMs = 5000,
): Promise<IScreenMessage> {
  const end = Date.now() + timeoutMs;
  for (;;) {
    const last = viewsOf(w, tab).at(-1) ?? {};
    if (done(last) || Date.now() > end) return last;
    await new Promise((r) => setTimeout(r, 20));
  }
}

/**
 * Vue synchronisée, complète, de ces présents-là. Les membres se comparent SANS
 * ordre : l'écran les range dans l'ordre d'arrivée, qui n'est pas un fait.
 */
export function settledOn(
  members: Record<string, number>,
  unnamed = 0,
): (e: IScreenMessage) => boolean {
  const wanted = Object.entries(members);
  return (e) =>
    e.ready === true &&
    e.partial === false &&
    e.unnamed === unnamed &&
    e.members !== undefined &&
    Object.keys(e.members).length === wanted.length &&
    wanted.every(([k, v]) => e.members?.[k] === v);
}
