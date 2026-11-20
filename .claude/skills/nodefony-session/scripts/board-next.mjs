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
 * Compare deux noms de jalon selon SemVer 2.0.0 §11 : le noyau `x.y.z` en
 * numérique, puis une pré-version (`-beta`) AVANT la version finale qui la
 * porte. Une comparaison de chaînes rangeait `10.0.0` avant `10.0.0-beta`
 * (préfixe plus court d'abord) : à échéance égale, la reprise sautait le lot
 * beta entier. Un nom hors SemVer (`outillage-agents`) passe après.
 */
export function compareMilestoneTitles(a, b) {
  const pa = /^(\d+(?:\.\d+)*)(?:-(.+))?$/.exec(a);
  const pb = /^(\d+(?:\.\d+)*)(?:-(.+))?$/.exec(b);
  if (pa === null || pb === null) {
    if (pa !== pb) return pa === null ? 1 : -1;
    return a.localeCompare(b, "en", { numeric: true });
  }
  const core = pa[1].localeCompare(pb[1], "en", { numeric: true });
  if (core !== 0) return core;
  if (pa[2] === undefined || pb[2] === undefined) {
    if (pa[2] === pb[2]) return 0;
    return pa[2] === undefined ? 1 : -1;
  }
  return pa[2].localeCompare(pb[2], "en", { numeric: true });
}

/**
 * L'ordre de SÉQUENCE des jalons : échéance croissante, sans échéance en dernier,
 * puis le nom selon SemVer (`10.0.0-alpha` < `10.0.0-beta` < `10.0.0` < `10.1.0`).
 */
export const sortMilestones = (milestones) =>
  [...milestones].sort(
    (a, b) =>
      (a.dueOn ?? "9999-12-31").localeCompare(b.dueOn ?? "9999-12-31") ||
      compareMilestoneTitles(a.title, b.title),
  );

/**
 * Dit si un item du tableau reste à faire : ticket NON fermé ET statut ≠ « Done ».
 *
 * Le statut seul ne suffit pas : un ticket fermé à la main (`gh issue close`,
 * seule voie vers `release/*`) peut garder « In Progress » sur le tableau, et la
 * reprise proposait alors un ticket déjà livré — vécu, `➡️ #797` fermé. SEULE
 * implémentation : la reprise et l'empreinte l'appellent, aucune ne recopie le
 * test.
 *
 * @param {{ state?: string, status?: string | null }} item
 * @returns {boolean}
 */
export const isOpenItem = (item) =>
  item.state !== "CLOSED" && item.status !== "Done";

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

/** Un nom de lot ou de jalon qui DÉSIGNE une version : `10.0.1`, `10.0.0-beta`. */
const VERSION_NAME = /^(\d+\.\d+\.\d+)(?:-[0-9A-Za-z.-]+)?$/;

/**
 * Dit si une version est déjà sortie, d'après les étiquettes git `v*`.
 *
 * Un canal de pré-version (`10.0.0-beta`) est sorti dès qu'une de ses
 * pré-versions numérotées l'est (`v10.0.0-beta.3`) ; toute version l'est aussi
 * quand sa version FINALE est étiquetée (`v10.0.0` solde `10.0.0-alpha`).
 *
 * @param {string} version - nom de lot ou de jalon, sans `v`
 * @param {Set<string>} tags - étiquettes git, avec leur `v`
 * @returns {boolean}
 */
function isReleased(version, tags) {
  const tag = `v${version}`;
  if (tags.has(tag)) return true;
  for (const t of tags) if (t.startsWith(`${tag}.`)) return true;
  const core = VERSION_NAME.exec(version)?.[1];
  return core !== undefined && tags.has(`v${core}`);
}

/**
 * Les versions dont TOUS les tickets sont livrés mais qui ne sont pas publiées
 * — « il faut faire la release ».
 *
 * Une version se lit sur un label de lot (`10.0.1` dans le jalon `10.0.x`) ou
 * sur un jalon qui porte un nom de version (`10.1.0`). Le prochain ticket ne le
 * dit jamais : quand le lot est soldé, `chooseNextTicket` passe au lot suivant
 * sans un mot, et la publication — la raison d'être du lot — s'oubliait. Vécu :
 * #797, #801 et #802 fermés, `v10.0.1` jamais étiquetée, la reprise proposait
 * déjà #794 du lot `10.0.2`.
 *
 * @param {Array<{ state?: string, status?: string | null, milestone?: string | null, labels?: string[] }>} items
 *   items de l'empreinte du tableau, fermés compris
 * @param {Iterable<string>} tags - étiquettes git `v*`
 * @returns {Array<{ version: string, closed: number }>} triées par version croissante
 */
export function versionsToRelease(items, tags) {
  /** @type {Map<string, { open: number, closed: number }>} */
  const lots = new Map();
  for (const item of items) {
    const names = new Set(
      [...(item.labels ?? []), item.milestone].filter(
        (v) => typeof v === "string" && VERSION_NAME.test(v),
      ),
    );
    const open = isOpenItem(item);
    for (const v of names) {
      let count = lots.get(v);
      if (count === undefined) lots.set(v, (count = { open: 0, closed: 0 }));
      if (open) count.open++;
      else count.closed++;
    }
  }
  const released = new Set(tags);
  return [...lots]
    .filter(
      ([v, c]) => c.open === 0 && c.closed > 0 && !isReleased(v, released),
    )
    .map(([version, c]) => ({ version, closed: c.closed }))
    .sort((a, b) => compareMilestoneTitles(a.version, b.version));
}
