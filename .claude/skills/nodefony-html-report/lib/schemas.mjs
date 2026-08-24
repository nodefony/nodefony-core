/**
 * Les **SCHÉMAS** de la documentation — organigrammes et diagrammes de séquence —
 * rendus à la charte, depuis la source Mermaid qui vit déjà dans les `.md`.
 *
 * ## La règle qui commande tout : la source ne bouge pas
 *
 * Les 117 diagrammes de la documentation sont écrits en blocs ```mermaid. Cette
 * source est lue par **trois** consommateurs : la console d'administration, les
 * agents (et le RAG), et l'affichage de GitHub. La convertir dans un autre
 * langage les casserait tous les trois pour ne servir qu'un rendu. On lit donc
 * le Mermaid, et on le **dessine autrement** — la source reste la seule vérité.
 *
 * ## Pourquoi il n'a pas fallu de bibliothèque de plus
 *
 * Ce que Mermaid, D2 ou ELK apportent, c'est un **algorithme de placement**.
 * Mesuré sur le corpus réel avant d'écrire une ligne : 81 organigrammes, **16
 * nœuds au maximum**, 17 arêtes ; 40 d'entre eux sont des arbres stricts, 33 des
 * graphes sans cycle, 8 portent une boucle de retour. À cette taille, le
 * placement en couches tient en une centaine de lignes — rang par plus long
 * chemin, puis réduction des croisements par barycentre.
 *
 * Le DESSIN est fait ici, en SVG direct. Le type `graph` d'ECharts a été essayé
 * puis écarté sur pièce : il relie les CENTRES des nœuds (les traits passent
 * sous les boîtes) et fait pivoter l'étiquette d'une arête le long du trait.
 * Ces deux comportements sont ceux d'un moteur de RÉSEAUX, et ils sont faux
 * pour un organigramme, où l'on veut des bords, des coudes orthogonaux et des
 * étiquettes droites. Le placement étant déjà calculé, dessiner soi-même ne
 * coûte que le tracé — et ne demande, là encore, aucune bibliothèque.
 *
 * Les 33 diagrammes de séquence ne demandent même pas d'algorithme : des
 * participants en colonnes, des messages en lignes.
 *
 * ## Usage
 *
 * ```js
 * import { organigramme, sequence, schema } from "./schemas.mjs";
 *
 * const svg = schema({ source: blocMermaid, titre: "Pipeline de sécurité" });
 * ```
 *
 * `schema()` reconnaît le type et route ; `organigramme()` et `sequence()`
 * s'appellent directement quand on sait ce qu'on a.
 */
import { PALETTE, POLICE, THEMES } from "./echarts.mjs";

/* ────────────────────────── 1. Lire le Mermaid ─────────────────────────── */

/** Les formes du corpus, de la plus spécifique à la plus générale. */
const FORMES = [
  { re: /^\[\((.*)\)\]$/s, forme: "cylindre" },
  { re: /^\(\[(.*)\]\)$/s, forme: "stade" },
  { re: /^\{\{(.*)\}\}$/s, forme: "hexagone" },
  { re: /^\[(.*)\]$/s, forme: "rect" },
  { re: /^\((.*)\)$/s, forme: "arrondi" },
  { re: /^\{(.*)\}$/s, forme: "losange" },
];

/** Un libellé Mermaid : guillemets ôtés, `<br/>` devenu saut de ligne. */
const libelle = (t) =>
  t
    .trim()
    .replace(/^["']|["']$/g, "")
    .split(/<br\s*\/?>/i)
    .map((s) => s.trim())
    .filter(Boolean);

/**
 * Analyse un bloc Mermaid.
 *
 * Volontairement partiel : il couvre ce que le corpus emploie (5 formes, 3
 * flèches, étiquettes d'arêtes, `subgraph`, `participant`, `Note over`,
 * `loop`/`alt`/`opt`), et rien de plus. Une grammaire complète serait du code
 * que personne n'exerce.
 *
 * @param {string} src - le contenu du bloc, sans les délimiteurs.
 * @returns {{type: "flux"|"sequence"|"inconnu", …}}
 */
export function lireMermaid(src) {
  const lignes = src.split("\n");
  const tete = lignes[0].trim();
  if (tete.startsWith("sequenceDiagram")) return lireSequence(lignes.slice(1));
  if (/^(flowchart|graph)\b/.test(tete)) {
    const dir = /(TD|TB|LR|RL|BT)/.exec(tete)?.[1] ?? "TD";
    return { type: "flux", dir, ...lireFlux(lignes.slice(1)) };
  }
  return { type: "inconnu", src };
}

function lireFlux(lignes) {
  const noeuds = new Map();
  const aretes = [];
  const groupes = [];
  let groupeCourant = null;

  const declare = (brut) => {
    const m = /^([A-Za-z_][\w]*)\s*(.*)$/s.exec(brut.trim());
    if (!m) return null;
    const [, id, reste] = m;
    if (reste.trim()) {
      for (const { re, forme } of FORMES) {
        const t = re.exec(reste.trim());
        if (t) {
          noeuds.set(id, {
            id,
            forme,
            texte: libelle(t[1]),
            groupe: groupeCourant,
          });
          return id;
        }
      }
    }
    if (!noeuds.has(id))
      noeuds.set(id, { id, forme: "rect", texte: [id], groupe: groupeCourant });
    return id;
  };

  for (const brut of lignes) {
    const l = brut.trim();
    if (!l || l.startsWith("%%")) continue;
    if (/^subgraph\s+/.test(l)) {
      groupeCourant = libelle(l.replace(/^subgraph\s+/, "")).join(" ");
      groupes.push(groupeCourant);
      continue;
    }
    if (/^end\b/.test(l)) {
      groupeCourant = null;
      continue;
    }
    if (/^direction\s/.test(l)) continue;
    const m =
      /^(.+?)\s*(-->|-\.->|-\.-|==>|---|--)\s*(?:\|([^|]*)\|\s*)?(.+)$/s.exec(
        l,
      );
    if (m) {
      const [, g, fleche, etiquette, d] = m;
      const a = declare(g);
      const b = declare(d);
      if (a && b)
        aretes.push({
          de: a,
          vers: b,
          etiquette: etiquette ? etiquette.trim() : null,
          pointille: fleche.startsWith("-."),
        });
    } else declare(l);
  }
  return { noeuds: [...noeuds.values()], aretes, groupes };
}

function lireSequence(lignes) {
  const participants = [];
  const evenements = [];
  const vu = new Set();
  const ajoute = (id, alias) => {
    if (!vu.has(id)) {
      vu.add(id);
      participants.push({ id, nom: alias ?? id });
    }
  };
  for (const brut of lignes) {
    const l = brut.trim();
    if (!l || l.startsWith("%%")) continue;
    let m;
    if ((m = /^(participant|actor)\s+(\S+)(?:\s+as\s+(.+))?$/.exec(l))) {
      ajoute(m[2], m[3]?.trim());
    } else if (
      (m = /^Note\s+(over|left of|right of)\s+([^:]+):\s*(.+)$/i.exec(l))
    ) {
      evenements.push({
        genre: "note",
        cibles: m[2].split(",").map((s) => s.trim()),
        texte: m[3].trim(),
      });
    } else if ((m = /^(loop|alt|opt|par|critical)\s*(.*)$/i.exec(l))) {
      evenements.push({
        genre: "ouvre",
        cadre: m[1].toLowerCase(),
        texte: m[2].trim(),
      });
    } else if (/^else\b/i.test(l)) {
      evenements.push({
        genre: "sinon",
        texte: l.replace(/^else\s*/i, "").trim(),
      });
    } else if (/^end\b/i.test(l)) {
      evenements.push({ genre: "ferme" });
    } else if ((m = /^(\S+?)\s*(-?->>?|-->>|->)\s*([^:]+?):\s*(.+)$/.exec(l))) {
      ajoute(m[1]);
      ajoute(m[3].trim());
      evenements.push({
        genre: "message",
        de: m[1],
        vers: m[3].trim(),
        texte: m[4].trim(),
        pointille: m[2].startsWith("--"),
      });
    }
  }
  return { type: "sequence", participants, evenements };
}

/* ─────────────────────── 2. Placer un organigramme ─────────────────────── */

/**
 * Dispose un graphe orienté en COUCHES.
 *
 * L'algorithme est celui de Sugiyama, réduit à ce que des graphes de seize
 * nœuds demandent : (1) casser les arcs arrière pour obtenir un graphe sans
 * cycle, (2) donner à chaque nœud le rang de son plus long chemin depuis une
 * source, (3) ordonner chaque rang par le barycentre de ses voisins, en
 * alternant les passes descendantes et montantes. Trois passes suffisent à
 * cette taille ; au-delà, l'ordre ne bouge plus.
 *
 * @param {{noeuds: Array, aretes: Array}} g
 * @returns {Map<string, {rang: number, ordre: number}>}
 */
export function placerEnCouches({ noeuds, aretes }) {
  const ids = noeuds.map((n) => n.id);
  const sortants = new Map(ids.map((i) => [i, []]));
  const entrants = new Map(ids.map((i) => [i, []]));

  // (1) Les arcs arrière : détectés en profondeur, ils ne comptent pas pour le
  // rang — sinon un cycle rendrait le rang infini.
  const etat = new Map();
  const arriere = new Set();
  const brut = new Map(ids.map((i) => [i, []]));
  aretes.forEach((a, i) => {
    if (brut.has(a.de) && brut.has(a.vers)) brut.get(a.de).push([a.vers, i]);
  });
  const parcours = (n) => {
    etat.set(n, 1);
    for (const [m, i] of brut.get(n) ?? []) {
      if (etat.get(m) === 1) arriere.add(i);
      else if (!etat.has(m)) parcours(m);
    }
    etat.set(n, 2);
  };
  ids.forEach((n) => {
    if (!etat.has(n)) parcours(n);
  });

  aretes.forEach((a, i) => {
    if (arriere.has(i) || !sortants.has(a.de) || !entrants.has(a.vers)) return;
    sortants.get(a.de).push(a.vers);
    entrants.get(a.vers).push(a.de);
  });

  // (2) Rang = plus long chemin. Un nœud se pose sous TOUS ses prédécesseurs,
  // ce qui évite les arêtes qui remontent.
  const rang = new Map(ids.map((i) => [i, 0]));
  let bouge = true;
  let garde = 0;
  while (bouge && garde++ < ids.length + 2) {
    bouge = false;
    for (const id of ids)
      for (const suivant of sortants.get(id))
        if (rang.get(suivant) < rang.get(id) + 1) {
          rang.set(suivant, rang.get(id) + 1);
          bouge = true;
        }
  }

  // (3) Ordre dans le rang, par barycentre des voisins déjà placés.
  const couches = [];
  for (const id of ids) (couches[rang.get(id)] ??= []).push(id);
  const position = new Map();
  couches.forEach((c) => c.forEach((id, i) => position.set(id, i)));
  const barycentre = (id, voisins) => {
    const v = voisins
      .get(id)
      .map((x) => position.get(x))
      .filter((x) => x !== undefined);
    return v.length
      ? v.reduce((a, b) => a + b, 0) / v.length
      : position.get(id);
  };
  for (let passe = 0; passe < 3; passe += 1) {
    const sens = passe % 2 === 0 ? entrants : sortants;
    for (const c of couches) {
      if (!c) continue;
      c.sort((a, b) => barycentre(a, sens) - barycentre(b, sens));
      c.forEach((id, i) => position.set(id, i));
    }
  }
  return new Map(
    ids.map((id) => [id, { rang: rang.get(id), ordre: position.get(id) }]),
  );
}

/* ───────────────────── 3. Dessiner un organigramme ─────────────────────── */

const CAR = 7.05; // largeur moyenne d'un caractère à 13 px
const LIGNE = 16;

const taille = (n) => {
  const largeur = Math.max(...n.texte.map((t) => t.length)) * CAR + 30;
  const hauteur = n.texte.length * LIGNE + 20;
  return n.forme === "losange"
    ? [Math.ceil(largeur * 1.3), Math.ceil(hauteur * 1.5)]
    : [Math.ceil(largeur), Math.ceil(hauteur)];
};

/** Le SENS colore : un refus se voit, une réussite aussi. Jamais décoratif. */
const teinte = (n) => {
  const t = n.texte.join(" ").toLowerCase();
  if (/close \d|drop|refus|denied|rejet|401|403|erreur|échec/.test(t))
    return PALETTE[1];
  if (/welcome|ouverte|accept|succès|ok\b|passe|autoris/.test(t))
    return PALETTE[2];
  if (n.forme === "losange") return PALETTE[0];
  return null;
};

/**
 * Rend un organigramme depuis sa source Mermaid — en SVG direct.
 *
 * 🔴 **Pourquoi pas le type `graph` d'ECharts, qui sait pourtant tracer un
 * réseau.** Essayé, et regardé : il relie les CENTRES des nœuds (les traits
 * passent sous les boîtes au lieu de s'arrêter à leur bord) et fait pivoter
 * l'étiquette d'une arête le long du trait — « toutes les 30 s » s'est retrouvé
 * en diagonale par-dessus un nœud. Ces deux défauts sont structurels à un
 * moteur de graphes : il dessine des liens, pas un organigramme. Dessiner ici
 * donne les bords, les étiquettes droites et le coude orthogonal — sans
 * bibliothèque de plus, puisque le placement est déjà calculé.
 *
 * @param {{source: string|object, titre?: string, sousTitre?: string, theme?: "clair"|"sombre", desc?: string}} o
 * @returns {string} SVG.
 */
export function organigramme(o) {
  const { source, titre, sousTitre, theme = "clair", desc } = o;
  const modele = typeof source === "string" ? lireMermaid(source) : source;
  if (modele.type !== "flux")
    throw new Error("organigramme() attend un flowchart");
  const T = THEMES[theme];
  const pos = placerEnCouches(modele);
  const horizontal = /^(LR|RL)$/.test(modele.dir);

  const dim = new Map(modele.noeuds.map((n) => [n.id, taille(n)]));
  const rangs = [...new Set([...pos.values()].map((p) => p.rang))].sort(
    (a, b) => a - b,
  );
  const parRang = new Map(rangs.map((r) => [r, []]));
  for (const n of modele.noeuds) parRang.get(pos.get(n.id).rang).push(n);

  const ECART_RANG = horizontal ? 76 : 54;
  const ECART_ORDRE = 28;
  const MARGE = 18;
  const HAUT =
    (titre ? 24 : 0) + (sousTitre ? 18 : 0) + (titre || sousTitre ? 16 : 0);

  // Coordonnées du CENTRE de chaque nœud. L'axe « profondeur » suit les rangs,
  // l'axe « transversal » l'ordre dans le rang.
  const centre = new Map();
  let profondeur = MARGE;
  let transversalMax = 0;
  for (const r of rangs) {
    const groupe = parRang
      .get(r)
      .sort((a, b) => pos.get(a.id).ordre - pos.get(b.id).ordre);
    const epais = Math.max(
      ...groupe.map((n) => (horizontal ? dim.get(n.id)[0] : dim.get(n.id)[1])),
    );
    const total =
      groupe.reduce(
        (a, n) => a + (horizontal ? dim.get(n.id)[1] : dim.get(n.id)[0]),
        0,
      ) +
      (groupe.length - 1) * ECART_ORDRE;
    let curseur = 0;
    for (const n of groupe) {
      const [w, h] = dim.get(n.id);
      const long = horizontal ? h : w;
      const c = curseur + long / 2;
      centre.set(
        n.id,
        horizontal ? [profondeur + epais / 2, c] : [c, profondeur + epais / 2],
      );
      curseur += long + ECART_ORDRE;
    }
    transversalMax = Math.max(transversalMax, total);
    profondeur += epais + ECART_RANG;
  }
  // Chaque rang est CENTRÉ sur la largeur totale : un rang d'un seul nœud ne
  // doit pas être collé à gauche pendant qu'un autre en porte quatre.
  for (const r of rangs) {
    const groupe = parRang.get(r);
    const total =
      groupe.reduce(
        (a, n) => a + (horizontal ? dim.get(n.id)[1] : dim.get(n.id)[0]),
        0,
      ) +
      (groupe.length - 1) * ECART_ORDRE;
    const decalage = (transversalMax - total) / 2 + MARGE;
    for (const n of groupe) {
      const c = centre.get(n.id);
      if (horizontal) c[1] += decalage;
      else c[0] += decalage;
    }
  }

  const L = (horizontal ? profondeur : transversalMax + MARGE * 2) + MARGE;
  const H = (horizontal ? transversalMax + MARGE * 2 : profondeur) + HAUT;
  const decaleY = (id) => {
    const c = centre.get(id);
    return [c[0], c[1] + HAUT];
  };

  /** Le point de sortie ou d'entrée sur le BORD, pas au centre. */
  const bord = (id, versX, versY) => {
    const [cx, cy] = decaleY(id);
    const [w, h] = dim.get(id);
    const dx = versX - cx;
    const dy = versY - cy;
    if (Math.abs(dy) * w > Math.abs(dx) * h) {
      const y = cy + Math.sign(dy) * (h / 2);
      return [cx + (dx * (h / 2)) / Math.max(1, Math.abs(dy)), y];
    }
    const x = cx + Math.sign(dx) * (w / 2);
    return [x, cy + (dy * (w / 2)) / Math.max(1, Math.abs(dx))];
  };

  const out = [];
  out.push(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${Math.ceil(L)} ${Math.ceil(H)}" width="${Math.ceil(L)}" height="${Math.ceil(H)}" role="img" aria-label="${ech(titre ?? "organigramme")}"${desc ? ` aria-description="${ech(desc)}"` : ""} font-family="${POLICE}">`,
    `<title>${ech(titre ?? "organigramme")}</title>`,
    `<defs><marker id="fl-${theme}" viewBox="0 0 10 10" refX="8.5" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 1 L9 5 L0 9 z" fill="${T.muet}"/></marker></defs>`,
    `<rect width="100%" height="100%" fill="${T.fond}"/>`,
  );
  if (titre)
    out.push(
      `<text x="${MARGE}" y="20" font-size="14" font-weight="600" fill="${T.encre}">${ech(titre)}</text>`,
    );
  if (sousTitre)
    out.push(
      `<text x="${MARGE}" y="${titre ? 38 : 20}" font-size="12" fill="${T.muet}">${ech(sousTitre)}</text>`,
    );

  // Les arêtes d'abord : elles passent SOUS les boîtes.
  for (const a of modele.aretes) {
    if (!centre.has(a.de) || !centre.has(a.vers)) continue;
    const [x1, y1] = decaleY(a.de);
    const [x2, y2] = decaleY(a.vers);
    const [sx, sy] = bord(a.de, x2, y2);
    const [ex, ey] = bord(a.vers, x1, y1);
    // Coude orthogonal quand les deux nœuds ne sont pas alignés : un trait en
    // diagonale se lit mal dès qu'il en croise un autre.
    const aligne = Math.abs(sx - ex) < 6 || Math.abs(sy - ey) < 6;
    const d = aligne
      ? `M${sx.toFixed(1)} ${sy.toFixed(1)} L${ex.toFixed(1)} ${ey.toFixed(1)}`
      : horizontal
        ? `M${sx.toFixed(1)} ${sy.toFixed(1)} L${((sx + ex) / 2).toFixed(1)} ${sy.toFixed(1)} L${((sx + ex) / 2).toFixed(1)} ${ey.toFixed(1)} L${ex.toFixed(1)} ${ey.toFixed(1)}`
        : `M${sx.toFixed(1)} ${sy.toFixed(1)} L${sx.toFixed(1)} ${((sy + ey) / 2).toFixed(1)} L${ex.toFixed(1)} ${((sy + ey) / 2).toFixed(1)} L${ex.toFixed(1)} ${ey.toFixed(1)}`;
    out.push(
      `<path d="${d}" fill="none" stroke="${T.muet}" stroke-width="1.25" stroke-linejoin="round"${a.pointille ? ' stroke-dasharray="5 4"' : ""} marker-end="url(#fl-${theme})"/>`,
    );
    if (a.etiquette) {
      // Toujours HORIZONTALE, posée sur un fond opaque : une étiquette tournée
      // le long du trait devient illisible dès qu'elle croise une boîte.
      const mx = aligne ? (sx + ex) / 2 : horizontal ? (sx + ex) / 2 : sx;
      const my = aligne ? (sy + ey) / 2 : horizontal ? sy : (sy + ey) / 2;
      const w = a.etiquette.length * 6.1 + 8;
      out.push(
        `<rect x="${(mx - w / 2).toFixed(1)}" y="${(my - 8).toFixed(1)}" width="${w.toFixed(1)}" height="15" rx="3" fill="${T.fond}"/>`,
        `<text x="${mx.toFixed(1)}" y="${(my + 3.5).toFixed(1)}" text-anchor="middle" font-size="10.5" fill="${T.muet}">${ech(a.etiquette)}</text>`,
      );
    }
  }

  // Puis les nœuds.
  for (const n of modele.noeuds) {
    const [cx, cy] = decaleY(n.id);
    const [w, h] = dim.get(n.id);
    const x = cx - w / 2;
    const y = cy - h / 2;
    const couleur = teinte(n);
    const remplissage = couleur ? `${couleur}14` : T.fondDoux;
    const trait = couleur ?? T.trait;
    if (n.forme === "losange")
      out.push(
        `<path d="M${cx} ${y} L${x + w} ${cy} L${cx} ${y + h} L${x} ${cy} Z" fill="${remplissage}" stroke="${trait}" stroke-width="1.3"/>`,
      );
    else if (n.forme === "cylindre")
      out.push(
        `<path d="M${x} ${y + 8} a${w / 2} 8 0 0 1 ${w} 0 v${h - 16} a${w / 2} 8 0 0 1 ${-w} 0 Z" fill="${remplissage}" stroke="${trait}" stroke-width="1.3"/>`,
        `<path d="M${x} ${y + 8} a${w / 2} 8 0 0 0 ${w} 0" fill="none" stroke="${trait}" stroke-width="1.3"/>`,
      );
    else
      out.push(
        `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${n.forme === "arrondi" || n.forme === "stade" ? h / 2 : 8}" fill="${remplissage}" stroke="${trait}" stroke-width="1.3"/>`,
      );
    n.texte.forEach((ligne, i) => {
      const ty = cy - ((n.texte.length - 1) * LIGNE) / 2 + i * LIGNE + 4;
      out.push(
        `<text x="${cx}" y="${ty.toFixed(1)}" text-anchor="middle" font-size="12.5"${i === 0 && n.texte.length > 1 ? ' font-weight="600"' : ""} fill="${T.encre}">${ech(ligne)}</text>`,
      );
    });
  }

  out.push("</svg>");
  return out.join("\n");
}

/* ────────────────────── 4. Dessiner une séquence ───────────────────────── */

const ech = (s) =>
  String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

/**
 * Rend un diagramme de séquence — en SVG direct.
 *
 * Aucune bibliothèque : des participants en colonnes, des messages en lignes.
 * Le placement est arithmétique, et le tracé tient dans cette fonction ; passer
 * par un moteur de graphes ne rendrait pas le trait plus juste, seulement le
 * code plus indirect.
 *
 * @param {{source: string, titre?: string, sousTitre?: string, theme?: "clair"|"sombre", desc?: string}} o
 * @returns {string} SVG.
 */
export function sequence(o) {
  const { source, titre, sousTitre, theme = "clair", desc } = o;
  const modele = typeof source === "string" ? lireMermaid(source) : source;
  if (modele.type !== "sequence")
    throw new Error("sequence() attend un sequenceDiagram");
  const T = THEMES[theme];
  const P = modele.participants;

  const COL = Math.max(150, ...P.map((p) => p.nom.length * CAR + 40));
  const MARGE = 18;
  const HAUT = (titre ? 26 : 0) + (sousTitre ? 18 : 0) + 46;
  const PAS = 34;
  const L = MARGE * 2 + COL * P.length;

  const x = (id) => {
    const i = P.findIndex((p) => p.id === id);
    return MARGE + COL * (i < 0 ? 0 : i) + COL / 2;
  };

  const corps = [];
  let y = HAUT + 12;
  const cadres = [];
  for (const e of modele.evenements) {
    if (e.genre === "message") {
      const x1 = x(e.de);
      const x2 = x(e.vers);
      const memeCol = Math.abs(x1 - x2) < 1;
      const yl = y + 12;
      if (memeCol) {
        // Un message à soi-même : une boucle courte, pas une flèche invisible.
        corps.push(
          `<path d="M${x1} ${yl} h26 v16 h-26" fill="none" stroke="${T.muet}" stroke-width="1.2"${e.pointille ? ' stroke-dasharray="4 3"' : ""} marker-end="url(#fl)"/>`,
          `<text x="${x1 + 32}" y="${yl + 6}" font-size="11.5" fill="${T.encre}" font-family="${POLICE}">${ech(e.texte)}</text>`,
        );
        y += 30;
      } else {
        const sens = x2 > x1 ? -1 : 1;
        corps.push(
          `<line x1="${x1}" y1="${yl}" x2="${x2 + sens * 5}" y2="${yl}" stroke="${T.muet}" stroke-width="1.2"${e.pointille ? ' stroke-dasharray="4 3"' : ""} marker-end="url(#fl)"/>`,
          `<text x="${(x1 + x2) / 2}" y="${yl - 6}" text-anchor="middle" font-size="11.5" fill="${T.encre}" font-family="${POLICE}">${ech(e.texte)}</text>`,
        );
        y += PAS;
      }
    } else if (e.genre === "note") {
      const xs = e.cibles.map((c) => x(c));
      const gx = Math.min(...xs) - 60;
      const largeurNote = Math.max(...xs) - Math.min(...xs) + 120;
      corps.push(
        `<rect x="${gx}" y="${y + 2}" width="${largeurNote}" height="24" rx="4" fill="${T.fondDoux}" stroke="${T.trait}"/>`,
        `<text x="${gx + largeurNote / 2}" y="${y + 18}" text-anchor="middle" font-size="11" fill="${T.muet}" font-family="${POLICE}">${ech(e.texte)}</text>`,
      );
      y += 34;
    } else if (e.genre === "ouvre") {
      cadres.push({
        y0: y,
        texte: `${e.cadre}${e.texte ? ` — ${e.texte}` : ""}`,
      });
      y += 22;
    } else if (e.genre === "sinon") {
      corps.push(
        `<line class="cadre" x1="${MARGE + 6}" y1="${y}" x2="${L - MARGE - 6}" y2="${y}" stroke="${T.trait}" stroke-dasharray="4 3"/>`,
        `<text x="${MARGE + 12}" y="${y + 13}" font-size="10.5" fill="${T.muet}" font-family="${POLICE}">sinon ${ech(e.texte)}</text>`,
      );
      y += 22;
    } else if (e.genre === "ferme") {
      const c = cadres.pop();
      if (c)
        corps.unshift(
          `<rect x="${MARGE + 6}" y="${c.y0 - 4}" width="${L - MARGE * 2 - 12}" height="${y - c.y0 + 10}" rx="5" fill="none" stroke="${T.trait}"/>` +
            `<rect x="${MARGE + 6}" y="${c.y0 - 4}" width="${c.texte.length * 6 + 16}" height="17" rx="4" fill="${T.fondDoux}" stroke="${T.trait}"/>` +
            `<text x="${MARGE + 13}" y="${c.y0 + 8}" font-size="10.5" fill="${T.muet}" font-family="${POLICE}">${ech(c.texte)}</text>`,
        );
      y += 12;
    }
  }

  const H = y + 16;
  const entete = P.map((p, i) => {
    const cx = MARGE + COL * i + COL / 2;
    const w = p.nom.length * CAR + 26;
    return (
      `<line x1="${cx}" y1="${HAUT}" x2="${cx}" y2="${H - 8}" stroke="${T.trait}" stroke-dasharray="3 4"/>` +
      `<rect x="${cx - w / 2}" y="${HAUT - 30}" width="${w}" height="26" rx="6" fill="${T.fondDoux}" stroke="${T.trait}"/>` +
      `<text x="${cx}" y="${HAUT - 12}" text-anchor="middle" font-size="12" font-weight="600" fill="${T.encre}" font-family="${POLICE}">${ech(p.nom)}</text>`
    );
  }).join("");

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${L} ${H}" width="${L}" height="${H}" role="img" aria-label="${ech(titre ?? "diagramme de séquence")}"${desc ? ` aria-description="${ech(desc)}"` : ""}>`,
    `<title>${ech(titre ?? "diagramme de séquence")}</title>`,
    `<defs><marker id="fl" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 1 L9 5 L0 9 z" fill="${T.muet}"/></marker></defs>`,
    `<rect width="100%" height="100%" fill="${T.fond}"/>`,
    titre
      ? `<text x="${MARGE}" y="20" font-size="14" font-weight="600" fill="${T.encre}" font-family="${POLICE}">${ech(titre)}</text>`
      : "",
    sousTitre
      ? `<text x="${MARGE}" y="${titre ? 38 : 20}" font-size="12" fill="${T.muet}" font-family="${POLICE}">${ech(sousTitre)}</text>`
      : "",
    entete,
    corps.join("\n"),
    "</svg>",
  ].join("\n");
}

/* ─────────────────────────── 5. La porte unique ────────────────────────── */

/**
 * Rend un bloc Mermaid, quel que soit son type.
 *
 * Un type non couvert (état, entités) n'est pas une erreur : le bloc est rendu
 * tel quel, en source, plutôt que d'échouer ou — pire — de dessiner faux.
 *
 * @param {{source: string, titre?: string, sousTitre?: string, theme?: "clair"|"sombre", largeur?: number, desc?: string}} o
 * @returns {string} SVG, ou un bloc de source encadré.
 */
export function schema(o) {
  const modele = lireMermaid(o.source);
  if (modele.type === "flux") return organigramme({ ...o, source: modele });
  if (modele.type === "sequence") return sequence({ ...o, source: modele });
  const T = THEMES[o.theme ?? "clair"];
  return (
    `<pre style="border:1px solid ${T.trait};border-radius:8px;padding:12px;` +
    `overflow-x:auto;font-size:12px;color:${T.muet}">${ech(o.source)}</pre>`
  );
}
