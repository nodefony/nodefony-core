/**
 * Ce qu'un exemplaire publie de lui-même : son pid et les ports qu'il sert,
 * HTTP en tête.
 */
export interface IPublishedPorts {
  readonly pid: number;
  readonly ports: readonly number[];
}

/**
 * Le port qu'un exemplaire jetable SERT — celui qu'il a publié, et non celui
 * qu'on lui a demandé.
 *
 * En développement, un port pris fait glisser l'exemplaire au suivant, et il
 * publie celui qu'il sert vraiment. Un port tiré d'avance (`listen(0)` puis
 * `close`) peut être repris par n'importe quel processus avant le démarrage :
 * attendre sur le port DEMANDÉ, c'était attendre jusqu'au délai un exemplaire
 * qui servait, sain, sur le port voisin (vécu en CI, banc e2e de la démo d'une
 * application générée : « pas répondu sur 46629 », journal « BOOT ok …
 * 127.0.0.1:46630 »).
 *
 * L'état publié n'est retenu que s'il porte le pid de l'exemplaire lancé :
 * celui de la suite, ou d'un run précédent, y figurait avant le démarrage.
 *
 * @param requested - le port demandé (`0` : à attribuer par le noyau).
 * @param published - l'état publié lu sur le disque, ou `null`.
 * @param childPid - le pid de l'exemplaire lancé.
 * @returns le port publié par CET exemplaire, sinon le port demandé.
 */
export function servedPort(
  requested: number,
  published: IPublishedPorts | null,
  childPid: number | undefined,
): number {
  if (published === null || published.pid !== childPid) return requested;
  return published.ports.at(0) ?? requested;
}
