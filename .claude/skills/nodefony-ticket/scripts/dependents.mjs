/**
 * Les tickets OUVERTS qui dépendent d'un ticket — la règle, pure et éprouvable.
 *
 * Une fermeture ne relisait que le ticket fermé. Ceux qui en DÉPENDENT
 * continuaient d'afficher « bloqué par #N » après le déblocage, ou d'affirmer un
 * état que la fermeture venait de changer — #238 découvert par hasard. Une
 * dépendance vit ailleurs que dans le champ « Dépend de » : la prose d'un corps,
 * le « pas dans ce ticket » d'un voisin. Les deux se relèvent, et se DISTINGUENT :
 * une dépendance déclarée se relit toujours, une simple mention seulement si
 * elle affirme quelque chose sur l'état de #N.
 */

/**
 * @param {{number: number, title: string, body?: string|null}[]} tickets - ouverts.
 * @param {number} n - le ticket fermé (ou sur le point de l'être).
 * @returns {{declared: object[], mentioned: object[]}}
 */
export function dependentsOf(tickets, n) {
  const cite = new RegExp(`(?<![\\w/])#${n}(?!\\d)`, "u");
  const declared = [];
  const mentioned = [];
  for (const t of tickets) {
    if (t.number === n || !t.body || !cite.test(t.body)) continue;
    const onDependsLine = t.body
      .split("\n")
      .some((line) => /d[ée]pend de/iu.test(line) && cite.test(line));
    (onDependsLine ? declared : mentioned).push(t);
  }
  return { declared, mentioned };
}
