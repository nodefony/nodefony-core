import dagre from "dagre";
import { type EntityNode, type ErdLink, NONE, groupKey } from "./erdModel";

/**
 * Marge intérieure d'une boîte, et hauteur de son bandeau de titre. La marge
 * est plus large que le détour d'une arête : à 24 px, les liens tirés entre
 * deux tables voisines sortaient de la boîte.
 */
export const GROUP_PAD = 56;
export const GROUP_HEADER = 40;
/** Réserve sous le bandeau : une boucle d'auto-référence passe AU-DESSUS de sa table. */
const LOOP_ROOM = 36;
/** Écart entre deux tables d'une même boîte — la place d'y faire passer un lien. */
const GAP = 64;

/** Une boîte de module, placée : ses tables vivent dedans, en coordonnées relatives. */
export interface GroupBox {
  /** Clé du groupe (domaine, sinon module ; `NONE` pour le non rattaché). */
  key: string;
  /** Libellé affiché (`—` pour le non rattaché). */
  label: string;
  /** Ce que la boîte regroupe : un domaine, un module, ou rien de déclaré. */
  kind: "domain" | "module" | "none";
  /**
   * L'AUTRE axe, présent dans la boîte : les modules d'un domaine, ou les
   * domaines d'un module. Vide quand il n'y en a pas.
   */
  also: string[];
  x: number;
  y: number;
  width: number;
  height: number;
  /** Tables de la boîte, dans l'ordre du schéma. */
  members: string[];
}

/** Placement d'un schéma groupé : les boîtes, et chaque table DANS sa boîte. */
export interface GroupedLayout {
  boxes: GroupBox[];
  /** Position de chaque table, relative au coin haut-gauche de sa boîte. */
  positions: Map<string, { x: number; y: number }>;
  /** Boîte de chaque table (clé de groupe). */
  boxOf: Map<string, string>;
}

type Size = (e: EntityNode) => { w: number; h: number };

/**
 * Place les tables d'UNE boîte : celles que relie un lien interne par dagre
 * (gauche → droite), les autres en grille dessous — dagre empilerait sinon
 * chaque table sans lien sur une seule colonne.
 */
function layoutMembers(
  members: readonly EntityNode[],
  internal: readonly ErdLink[],
  size: Size,
): { positions: Map<string, { x: number; y: number }>; w: number; h: number } {
  const positions = new Map<string, { x: number; y: number }>();
  // Une auto-référence ne relie la table à rien d'autre : elle n'entre pas
  // dans le placement par dagre, qui l'isolerait au-dessus de la grille.
  const linked = new Set<string>();
  for (const l of internal) {
    if (l.source !== l.target) linked.add(l.source).add(l.target);
  }
  let w = 0;
  let h = 0;
  if (linked.size > 0) {
    const g = new dagre.graphlib.Graph();
    g.setGraph({ rankdir: "LR", nodesep: GAP, ranksep: 70 });
    g.setDefaultEdgeLabel(() => ({}));
    for (const e of members) {
      if (!linked.has(e.name)) continue;
      const s = size(e);
      g.setNode(e.name, { width: s.w, height: s.h });
    }
    for (const l of internal) {
      if (l.source !== l.target) g.setEdge(l.source, l.target);
    }
    dagre.layout(g);
    for (const name of g.nodes()) {
      const p = g.node(name);
      const x = p.x - p.width / 2;
      const y = p.y - p.height / 2;
      positions.set(name, { x, y });
      w = Math.max(w, x + p.width);
      h = Math.max(h, y + p.height);
    }
  }
  const loose = members.filter((e) => !linked.has(e.name));
  if (loose.length > 0) {
    // Maçonnerie : la plus haute d'abord, chacune dans la colonne la plus
    // courte. En rangées, une table de 24 colonnes laissait sous ses voisines
    // courtes des trous qui allongeaient la boîte. Plus large que haute : un
    // écran l'est aussi.
    const cols = Math.max(1, Math.ceil(Math.sqrt(loose.length * 2)));
    const top = h > 0 ? h + GAP : 0;
    const colW = Math.max(...loose.map((e) => size(e).w));
    const heights = new Float64Array(Math.min(cols, loose.length));
    const order = [...loose].sort((a, b) => size(b).h - size(a).h);
    for (const e of order) {
      let k = 0;
      for (let i = 1; i < heights.length; i += 1) {
        if ((heights[i] ?? 0) < (heights[k] ?? 0)) k = i;
      }
      const y = top + (heights[k] ?? 0);
      positions.set(e.name, { x: k * (colW + GAP), y });
      heights[k] = (heights[k] ?? 0) + size(e).h + GAP;
    }
    w = Math.max(w, heights.length * (colW + GAP) - GAP);
    h = top + Math.max(...heights) - GAP;
  }
  return { positions, w, h };
}

/** Écart entre deux boîtes de module. */
const BOX_GAP = 80;

/**
 * Range les boîtes en RANGÉES, les plus grandes d'abord, sur une largeur qui
 * vise le 16/9 d'un écran. Dagre empilait sur une seule colonne toutes les
 * boîtes qu'aucun lien ne relie — le schéma devenait une tour, et le cadrage
 * le réduisait jusqu'à l'illisible.
 */
function packBoxes(
  sizes: ReadonlyArray<{ key: string; w: number; h: number }>,
): Map<string, { x: number; y: number }> {
  const placed = new Map<string, { x: number; y: number }>();
  const area = sizes.reduce((sum, b) => sum + b.w * b.h, 0);
  const widest = Math.max(0, ...sizes.map((b) => b.w));
  // Une rangée un peu plus large que le 16/9 exact : sans cette marge, la
  // deuxième boîte passait à la ligne derrière une grande, et le schéma
  // redevenait une tour.
  const rowWidth = Math.max(widest, Math.sqrt((area * 16) / 9) * 1.3);
  const order = [...sizes].sort((a, b) => b.w * b.h - a.w * a.h);
  let x = 0;
  let y = 0;
  let rowH = 0;
  for (const b of order) {
    if (x > 0 && x + b.w > rowWidth) {
      x = 0;
      y += rowH + BOX_GAP;
      rowH = 0;
    }
    placed.set(b.key, { x, y });
    x += b.w + BOX_GAP;
    rowH = Math.max(rowH, b.h);
  }
  return placed;
}

/**
 * Schéma COMPLET regroupé : une grande boîte par module (ou domaine), ses
 * tables dedans, et les boîtes rangées en rangées (`packBoxes`). Les liens
 * restent tirés de table à table, d'une boîte à l'autre.
 *
 * @param entities - le schéma.
 * @param links - ses liens (`canonicalLinks`).
 * @param size - taille d'une boîte de table.
 * @returns les boîtes (coordonnées absolues) et la place de chaque table dans la sienne.
 */
export function layoutGroups(
  entities: readonly EntityNode[],
  links: readonly ErdLink[],
  size: Size,
): GroupedLayout {
  const keyOf = new Map<string, string>();
  const groups = new Map<string, EntityNode[]>();
  for (const e of entities) {
    const key = groupKey(e) || NONE;
    keyOf.set(e.name, key);
    const list = groups.get(key);
    if (list) list.push(e);
    else groups.set(key, [e]);
  }
  const positions = new Map<string, { x: number; y: number }>();
  const inner = new Map<string, { w: number; h: number }>();
  for (const [key, members] of groups) {
    const internal = links.filter(
      (l) => keyOf.get(l.source) === key && keyOf.get(l.target) === key,
    );
    const laid = layoutMembers(members, internal, size);
    for (const [name, p] of laid.positions) {
      positions.set(name, {
        x: p.x + GROUP_PAD,
        y: p.y + GROUP_HEADER + LOOP_ROOM,
      });
    }
    inner.set(key, { w: laid.w, h: laid.h });
  }
  const sizes = [...inner].map(([key, m]) => ({
    key,
    w: m.w + GROUP_PAD * 2,
    h: m.h + GROUP_HEADER + LOOP_ROOM + GROUP_PAD,
  }));
  const placed = packBoxes(sizes);
  const boxes: GroupBox[] = [];
  for (const { key, w, h } of sizes) {
    const p = placed.get(key) ?? { x: 0, y: 0 };
    const members = groups.get(key) ?? [];
    const first = members[0];
    const kind: GroupBox["kind"] = first?.domain
      ? "domain"
      : first?.module
        ? "module"
        : "none";
    const also = [
      ...new Set(
        members
          .map((e) =>
            kind === "domain" ? e.module : kind === "module" ? e.domain : "",
          )
          .filter((v) => v !== ""),
      ),
    ].sort();
    boxes.push({
      key,
      label: key === NONE ? "—" : key,
      kind,
      also,
      x: p.x,
      y: p.y,
      width: w,
      height: h,
      members: members.map((e) => e.name),
    });
  }
  return { boxes, positions, boxOf: keyOf };
}
