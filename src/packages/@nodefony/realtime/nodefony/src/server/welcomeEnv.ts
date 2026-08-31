/**
 * Le mode d'exécution annoncé — ou non — dans `realtime:welcome`.
 *
 * Le client ne dispose sinon que d'`import.meta.env.DEV`, qui dit le mode du
 * BUNDLE : une application bâtie pour la production mais servie par un serveur
 * de développement (banc, cluster local, image essayée sur le poste) restait
 * muette dans la console alors qu'on avait tout intérêt à la faire parler.
 *
 * ⚠️ **En production, le champ est ABSENT** — et c'est la raison d'être de cette
 * fonction, isolée pour être éprouvée dans les deux sens. Ce n'est pas un
 * réglage que le client lit, c'est une permission de parler dans la console de
 * quelqu'un : on ne l'accorde pas par défaut, et une absence vaut production,
 * jamais l'inverse.
 *
 * @param env - le mode du kernel serveur (`kernel.environment`), s'il est connu.
 * @returns le fragment à étaler dans le welcome : `{ env }` hors production,
 *   sinon un objet vide.
 */
export function welcomeEnv(env: string | undefined | null): { env?: string } {
  if (!env || env === "production") return {};
  return { env };
}
