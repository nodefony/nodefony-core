/**
 * Capture des erreurs **non rattrapées** du navigateur (`error`, `unhandledrejection`)
 * et versement dans le `Syslog` client.
 *
 * C'est la source qui donne son intérêt à la voie montante : une exception qui remonte
 * jusqu'à `window` n'est vue par personne. Elle s'affiche dans une console que
 * l'utilisateur n'a pas ouverte, puis disparaît avec l'onglet. Côté serveur, la requête
 * qui l'a provoquée est pourtant journalisée, complète — il ne manquait que la moitié
 * navigateur.
 *
 * Rien n'est intercepté ni monkey-patché : deux écouteurs `window`, retirés au démontage.
 */

import type Syslog from "../../syslog/Syslog";

export interface ErrorCaptureOptions {
  /** Le journal client qui recevra les entrées. */
  syslog: Syslog;
  /**
   * Catégorie (`msgid`) des entrées produites. Défaut {@link BROWSER_ERROR_MSGID}.
   *
   * Le **module** émetteur, lui, n'est pas un paramètre : il appartient au `Syslog`
   * client (`settings.moduleName`) et `log()` ne permet pas de l'écraser par appel.
   */
  msgid?: string;
  /**
   * Fenêtre de déduplication des erreurs IDENTIQUES consécutives, en ms. Défaut `1000`.
   *
   * Une exception dans une boucle d'animation se lève soixante fois par seconde ; sans
   * cette fenêtre, elle chasse du tampon toutes les autres entrées et le journal ne
   * contient plus qu'elle. `0` désactive.
   */
  dedupeMs?: number;
}

/** Catégorie par défaut d'une exception non rattrapée. */
export const BROWSER_ERROR_MSGID = "BROWSER_ERROR";
/** Catégorie d'une promesse rejetée sans `catch`. */
export const BROWSER_REJECTION_MSGID = "BROWSER_REJECTION";

/**
 * Installe la capture des erreurs globales du navigateur.
 *
 * No-op hors navigateur (rendu serveur, test Node sans DOM) : le contrat isomorphe veut
 * qu'un code client puisse être chargé des deux côtés sans garde chez l'appelant.
 *
 * @param opts - journal cible et bornes.
 * @returns la fonction de retrait — retire les deux écouteurs.
 */
export function installErrorCapture(opts: ErrorCaptureOptions): () => void {
  if (typeof window === "undefined") return () => {};
  const { syslog, msgid = BROWSER_ERROR_MSGID, dedupeMs = 1000 } = opts;

  let lastKey: string | null = null;
  let lastAt = 0;

  /** Vrai si cette erreur répète la précédente dans la fenêtre — donc à taire. */
  const isRepeat = (key: string): boolean => {
    if (dedupeMs <= 0) return false;
    const now = Date.now();
    if (key === lastKey && now - lastAt < dedupeMs) return true;
    lastKey = key;
    lastAt = now;
    return false;
  };

  const onError = (event: ErrorEvent): void => {
    const source =
      event.filename !== undefined && event.filename !== ""
        ? `${event.filename}:${event.lineno}:${event.colno}`
        : undefined;
    const key = `error|${event.message}|${source ?? ""}`;
    if (isRepeat(key)) return;
    // Le payload est l'`Error` elle-même quand le navigateur la fournit : le transport
    // l'aplatit en {name, message, stack}. Sinon, le message seul. Le `msg` porte
    // l'emplacement — c'est un détail libre, sa place exacte.
    syslog.log(
      (event.error as unknown) ?? event.message,
      "ERROR",
      msgid,
      source ?? "",
    );
  };

  const onRejection = (event: PromiseRejectionEvent): void => {
    const reason: unknown = event.reason;
    const key = `rejection|${
      reason instanceof Error ? reason.message : String(reason)
    }`;
    if (isRepeat(key)) return;
    syslog.log(reason, "ERROR", BROWSER_REJECTION_MSGID, "");
  };

  window.addEventListener("error", onError);
  window.addEventListener("unhandledrejection", onRejection);

  return () => {
    window.removeEventListener("error", onError);
    window.removeEventListener("unhandledrejection", onRejection);
  };
}
