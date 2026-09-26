/**
 * Détache un timer de la boucle d'événements quand la plateforme le permet.
 *
 * Isomorphe : sous Node, `setTimeout`/`setInterval` rendent un `Timeout` doté de
 * `unref()` — le timer n'empêche plus le process de sortir. Dans le navigateur,
 * ils rendent un `number` sans méthode, et il n'y a rien à détacher. Le type vu
 * par le compilateur est celui de `@types/node`, qui déclare `unref` toujours
 * présent : c'est lui qui ment pour le code partagé, d'où l'élargissement ici,
 * en UN seul endroit, plutôt qu'un `?.()` que le lint typé juge inutile.
 *
 * Code exécuté seulement sous Node : appeler `timer.unref()` directement.
 *
 * @param timer - la valeur rendue par `setTimeout` ou `setInterval`.
 */
export function unrefTimer(timer: unknown): void {
  (timer as { unref?: () => void } | null | undefined)?.unref?.();
}
