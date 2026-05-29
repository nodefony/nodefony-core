/**
 * Borne une promesse par un délai maximum — utilitaire de **résilience de boot**
 * (et de tout `await` susceptible de pendre indéfiniment).
 *
 * Motivation : un `await` sur une opération réseau dont le pair est injoignable
 * peut **ne jamais se résoudre** (ex. l'offline-queue de `node-redis` met la
 * Promise en attente sans la rejeter). Sans garde, un seul de ces `await` gèle
 * tout le cycle de boot du Kernel → les serveurs ne montent jamais.
 *
 * ⚠️ **NE PAS utiliser dans le hot path HTTP/WS** : chaque appel alloue un timer
 * + une Promise de course. Réservé au **boot / lifecycle / jobs** (≪ 1×/process).
 * Le hot path utilise `Event.emitAsync` nu (aucun timer par requête).
 *
 * @module
 */

/**
 * Erreur levée par {@link withTimeout} quand le délai est dépassé — distincte
 * d'un rejet métier pour que l'appelant puisse différencier « lent/figé » de
 * « a échoué » (ex. politique de boot : timeout d'un module critique en prod).
 */
export class TimeoutError extends Error {
  /** Délai (ms) qui a été dépassé. */
  readonly timeoutMs: number;

  /**
   * @param timeoutMs - délai dépassé, en millisecondes.
   * @param label - libellé optionnel de l'opération (préfixe du message).
   */
  constructor(timeoutMs: number, label?: string) {
    super(`${label ? `${label}: ` : ""}timeout après ${timeoutMs}ms`);
    this.name = "TimeoutError";
    this.timeoutMs = timeoutMs;
  }
}

/**
 * Résout avec la valeur de `promise` si elle se règle avant `timeoutMs`,
 * sinon rejette avec une {@link TimeoutError}.
 *
 * Robustesse :
 * - le timer est `unref` (ne maintient pas l'event-loop vivant) et **toujours**
 *   nettoyé (`finally`) → aucun handle qui fuit ;
 * - un `.catch()` est posé sur la promesse d'origine : si elle rejette **après**
 *   que le timeout a gagné la course, le rejet ne remonte pas en
 *   `unhandledRejection` (qui crasherait le process) ;
 * - `timeoutMs ≤ 0` (ou non fini) → **aucune garde**, on attend la promesse telle
 *   quelle (permet de désactiver le timeout par config sans brancher de code).
 *
 * @typeParam T - type résolu par la promesse.
 * @param promise - opération à borner.
 * @param timeoutMs - délai max en millisecondes (≤ 0 = pas de timeout).
 * @param label - libellé optionnel pour le message d'erreur.
 * @returns la valeur résolue par `promise`.
 * @throws {@link TimeoutError} si `timeoutMs` est dépassé.
 * @throws l'erreur d'origine si `promise` rejette avant le timeout.
 */
export async function withTimeout<T>(
  promise: PromiseLike<T>,
  timeoutMs: number,
  label?: string,
): Promise<T> {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    return await promise;
  }
  const p = Promise.resolve(promise);
  // Un rejet APRÈS le timeout (course perdue) ne doit pas devenir unhandled.
  p.catch(() => {});
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      p,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new TimeoutError(timeoutMs, label)),
          timeoutMs,
        );
        timer.unref?.();
      }),
    ]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}
