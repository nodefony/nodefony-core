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
 * Dit si un item du tableau reste à faire : l'ÉTAT GitHub du ticket fait foi ;
 * le statut du tableau ne décide que pour un item sans état (brouillon).
 *
 * Le statut ne suffit pas, dans les DEUX sens : un ticket fermé à la main
 * (`gh issue close`, seule voie vers `release/*`) peut garder « In Progress »,
 * et la reprise proposait un ticket livré — vécu, `➡️ #797` fermé ; un ticket
 * OUVERT passé « Done » comptait comme livré, et `versionsToRelease` aurait dit
 * « lot soldé » avec un ticket ouvert dedans (revue #796, B5). L'incohérence se
 * signale (`board-lint` : `FERME-PAS-DONE`, `OUVERT-DONE`). SEULE
 * implémentation : la reprise et l'empreinte l'appellent, aucune ne recopie le
 * test.
 *
 * @param {{ state?: string, status?: string | null }} item
 * @returns {boolean}
 */
export const isOpenItem = (item) =>
  item.state ? item.state !== "CLOSED" : item.status !== "Done";

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

/**
 * La plus haute version FINALE étiquetée (`v10.0.1`, jamais `v10.1.0-beta.2`), sans son `v`.
 *
 * @param {Iterable<string>} tags - étiquettes git `v*`
 * @param {string} [line] - restreint à une ligne `x.y` (`10.0`)
 * @returns {string | null}
 */
export function newestStableVersion(tags, line) {
  let best = null;
  for (const tag of tags) {
    const m = /^v(\d+\.\d+)\.\d+$/u.exec(tag);
    if (m === null || (line !== undefined && m[1] !== line)) continue;
    const v = tag.slice(1);
    if (best === null || compareMilestoneTitles(v, best) > 0) best = v;
  }
  return best;
}

/**
 * Ce qui reste à faire APRÈS une publication — PURE : les faits sont constatés.
 *
 * Trois oublis, chacun silencieux jusqu'à la publication suivante :
 * l'estampille d'un correctif restée hors de `origin/release/x.y.x` (la
 * suivante partirait de manifestes périmés) ; la fusion arrière vers `dev`
 * pas faite (`refusDeMaintenance` refuserait la mineure, D9 de #796) ; npm
 * dont `latest` désigne encore la version d'avant (un `npm install` sans
 * version installerait l'ancienne).
 *
 * @param {object} facts
 * @param {string | null} facts.newestStable - plus haute version finale étiquetée
 * @param {string | null} facts.latest - étiquette npm `latest` de `nodefony`, `null` si non lue
 * Deux oublis de plus (revue #796, N6 et N8) : une étiquette posée en local
 * mais jamais poussée (le `pre-push` a pu échouer) se lisait « publiée » ; et
 * une `release/x.y.x` qui porte du travail absent de `dev` SANS publication
 * (l'outillage de pilotage, fusionné dans la maintenance) ne rappelait rien —
 * `dev` restait sans lui, à la mémoire de chacun.
 *
 * @param {Array<{ branch: string, version: string | null, inBranch: boolean, inDev: boolean, aheadOfDev?: number }>} facts.maintenance -
 *   par `release/x.y.x` distante : sa dernière version finale (`null` si aucune),
 *   où son étiquette est contenue, et ses commits absents de `origin/dev`
 * @param {string[]} [facts.unpushedTags] - étiquettes `v*` locales absentes d'origin
 * @returns {string[]} une ligne par geste dû
 */
export function afterReleaseReminders({
  newestStable,
  latest,
  maintenance,
  unpushedTags = [],
}) {
  const lines = [];
  for (const t of unpushedTags)
    lines.push(
      `📮 étiquette ${t} posée en LOCAL, absente d'origin → git push origin ${t} (la publication n'a pas démarré)`,
    );
  for (const m of maintenance) {
    if (m.version === null) {
      if (m.aheadOfDev)
        lines.push(
          `↩️ ${m.branch} porte ${m.aheadOfDev} commit(s) absents de dev → node .claude/skills/nodefony-ticket/scripts/release-sync.mjs`,
        );
      continue;
    }
    if (!m.inBranch)
      lines.push(
        `📮 estampille v${m.version} absente de origin/${m.branch} → git push origin ${m.branch} (la publication suivante partirait de manifestes périmés)`,
      );
    else if (!m.inDev)
      lines.push(
        `↩️ fusion arrière due : v${m.version} (${m.branch}) absente de dev → node .claude/skills/nodefony-ticket/scripts/release-sync.mjs`,
      );
    else if (m.aheadOfDev)
      lines.push(
        `↩️ ${m.branch} porte ${m.aheadOfDev} commit(s) absents de dev → node .claude/skills/nodefony-ticket/scripts/release-sync.mjs`,
      );
  }
  if (
    newestStable !== null &&
    latest !== null &&
    compareMilestoneTitles(newestStable, latest) > 0
  )
    lines.push(
      `🏷️ v${newestStable} étiquetée mais npm latest = ${latest} → publication incomplète ou dist-tag non posé (skill nodefony-release)`,
    );
  return lines;
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
