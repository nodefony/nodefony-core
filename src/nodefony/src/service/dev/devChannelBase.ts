/**
 * Le socle du canal superviseur ⇄ serveur (`devChannel.ts`) : ce qu'en lit
 * la porte du terminal (`runtime/isTerminal.ts`).
 *
 * Module FEUILLE, sans aucun import : la porte est atteinte par le journal,
 * donc par le bundle NAVIGATEUR. Le contrat complet du canal porte le bilan
 * de démarrage (`IStartupView`), dont les types tirent tout le graphe du
 * serveur — les faire entrer dans le typage client le casse (`lib` sans
 * Node). La règle reste UNE : `devChannel.ts` réexporte ce qui vit ici.
 */

/** Le discriminant du canal. */
export const DEV_CHANNEL = "nf-dev";

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

/**
 * Une dimension de terminal valide : entier strictement positif.
 *
 * @param value - la valeur reçue.
 * @returns `true` si c'est un nombre de colonnes ou de lignes exploitable.
 */
export function isTerminalDimension(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

/**
 * Ce message est-il un redimensionnement du canal, de forme valide ?
 *
 * @param message - ce que l'IPC a livré.
 * @returns `true` si c'est un {@link IDevResize}.
 */
export function isDevResize(message: unknown): message is IDevResize {
  if (typeof message !== "object" || message === null) return false;
  const m = message as {
    channel?: unknown;
    type?: unknown;
    columns?: unknown;
    rows?: unknown;
  };
  return (
    m.channel === DEV_CHANNEL &&
    m.type === "resize" &&
    isTerminalDimension(m.columns) &&
    isTerminalDimension(m.rows)
  );
}
