/**
 * Le choix du PROCHAIN ticket — la règle, isolée pour être éprouvable sans réseau.
 *
 * Elle ne se déduit pas du seul champ `Ordre` : l'ordre encode les DÉPENDANCES et
 * court à travers tous les jalons, si bien qu'un ticket d'une version ultérieure
 * peut porter un rang plus petit qu'un ticket de la version en cours. Le jalon,
 * lui, encode la CIBLE de livraison — et on ne prépare pas la version suivante
 * tant que la version courante a des tickets ouverts.
 */

/**
 * L'ordre de SÉQUENCE des jalons : échéance croissante, sans échéance en dernier,
 * puis le nom en comparaison numérique (`10.0.0-alpha` avant `10.1.0`).
 */
export const sortMilestones = (milestones) =>
  [...milestones].sort(
    (a, b) =>
      (a.dueOn ?? "9999-12-31").localeCompare(b.dueOn ?? "9999-12-31") ||
      a.title.localeCompare(b.title, "en", { numeric: true }),
  );

/** Les items ouverts d'un jalon, dans l'ordre de travail (sans ordre = en fin). */
export const openItemsOf = (items, milestoneTitle) =>
  items
    .filter((i) => i.milestone === milestoneTitle)
    .sort(
      (a, b) => (a.ordre ?? 9999) - (b.ordre ?? 9999) || a.number - b.number,
    );

/**
 * Le prochain ticket à prendre, et le jalon COURANT dont il vient.
 *
 * @param openItems - items du tableau dont le statut n'est pas « Done »
 * @param milestones - jalons du dépôt (`title`, `dueOn`)
 * @returns `{ ticket, milestone }`, ou `null` si le tableau n'a rien d'ouvert
 */
export function chooseNextTicket(openItems, milestones) {
  for (const jalon of sortMilestones(milestones)) {
    const [premier] = openItemsOf(openItems, jalon.title);
    if (premier) return { ticket: premier, milestone: jalon.title };
  }
  // Aucun jalon n'a de travail ouvert : restent les tickets hors jalon, qui ne
  // portent aucune livraison. On les rend plutôt que rien — mais en DERNIER,
  // jamais devant un jalon qui a encore du travail.
  const orphelins = openItemsOf(openItems, null);
  return orphelins.length ? { ticket: orphelins[0], milestone: null } : null;
}
