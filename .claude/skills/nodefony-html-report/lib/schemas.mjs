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
import { PALETTE, POLICE, THEMES, bars, lines } from "./echarts.mjs";

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

/**
 * Coupe un texte en lignes d'au plus `largeur` caractères, sur les espaces.
 *
 * Au-delà de `maxLignes`, la dernière est suffixée d'une ellipse : mieux vaut
 * une étiquette visiblement abrégée qu'un pavé qui recouvre ses voisines. Le
 * texte entier reste porté par un `<title>`.
 *
 * @param {string} texte - le libellé à couper.
 * @param {number} largeur - longueur visée d'une ligne, en caractères.
 * @param {number} maxLignes - nombre de lignes au-delà duquel on abrège.
 * @returns {string[]} les lignes.
 */
export function couper(texte, largeur = 22, maxLignes = 3) {
  const mots = texte.split(/\s+/).filter(Boolean);
  const lignes = [];
  let cur = "";
  for (const mot of mots) {
    if (!cur) cur = mot;
    else if (cur.length + 1 + mot.length <= largeur) cur += ` ${mot}`;
    else {
      lignes.push(cur);
      cur = mot;
    }
  }
  if (cur) lignes.push(cur);
  if (lignes.length <= maxLignes) return lignes.length ? lignes : [""];
  const gardees = lignes.slice(0, maxLignes);
  gardees[maxLignes - 1] = `${gardees[maxLignes - 1]}…`;
  return gardees;
}

/**
 * Entités HTML qu'une source Mermaid porte couramment.
 *
 * Un libellé qui contient un chevron DOIT l'écrire échappé — Mermaid lit ce qui
 * suit comme du HTML. `IRepository&lt;T&gt;` est donc la forme normale dans le
 * fichier, et la forme attendue à l'écran est `IRepository<T>`.
 */
const ENTITES = {
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
  "&nbsp;": " ",
  "&amp;": "&",
};

/**
 * Un libellé Mermaid, rendu en lignes de texte.
 *
 * Trois traitements, dans cet ORDRE — l'inverser casse tout :
 *
 *   1. `<br/>` devient un saut de ligne ;
 *   2. les balises de mise en forme de Mermaid (`<b>`, `<i>`…) sont retirées —
 *      un SVG rend du texte, et les laisser affichait `</b>` en clair au milieu
 *      d'un nœud ;
 *   3. les entités sont DÉCODÉES, en dernier, `&amp;` compris. Sans cette étape,
 *      l'échappement qui protège le SVG s'appliquait une seconde fois et
 *      `IRepository&lt;T&gt;` s'affichait tel quel, chevrons écrits en toutes
 *      lettres. Décoder `&amp;` en premier ressusciterait au contraire les
 *      autres entités : il passe donc en dernier, ce que fait une seule regex.
 */
const libelle = (t) =>
  t
    .trim()
    .replace(/^["']|["']$/g, "")
    .split(/<br\s*\/?>/i)
    .map((s) =>
      s
        .replace(/<\/?(?:b|i|em|strong|u|small|code)>/gi, "")
        .replace(/&(?:lt|gt|quot|#39|nbsp|amp);/g, (e) => ENTITES[e])
        .trim(),
    )
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
  // Les lignes `%%` sont des commentaires ou des directives mermaid
  // (`%%{init: …}%%`, qui règle par exemple la couleur des courbes dans la
  // console) : elles ne décrivent rien du schéma. Placée en tête, une directive
  // faisait prendre le bloc pour un type inconnu, rendu en source brute.
  const toutes = src.split("\n");
  const lignes = toutes.filter((l) => !l.trim().startsWith("%%"));
  const tete = (lignes[0] ?? "").trim();
  if (tete.startsWith("sequenceDiagram")) return lireSequence(lignes.slice(1));
  if (/^(flowchart|graph)\b/.test(tete)) {
    const dir = /(TD|TB|LR|RL|BT)/.exec(tete)?.[1] ?? "TD";
    return { type: "flux", dir, ...lireFlux(lignes.slice(1)) };
  }
  if (/^stateDiagram(-v2)?\b/.test(tete))
    return { type: "flux", dir: "TD", ...lireEtats(lignes.slice(1)) };
  if (/^xychart(-beta)?\b/.test(tete))
    // Le lecteur de courbes reçoit AUSSI les commentaires : `%% series:` y
    // nomme les séries.
    return {
      type: "xy",
      ...lireXy(toutes.slice(toutes.findIndex((l) => l.trim() === tete) + 1)),
      taille: tailleDirective(toutes),
    };
  return { type: "inconnu", src };
}

/**
 * La taille qu'une directive `%%{init: {"xyChart": {"width": …, "height": …}}}%%`
 * impose au graphique. Mermaid la lit dans la console ; le site la lit ici :
 * UNE déclaration règle les deux rendus, au lieu de deux figures de tailles
 * différentes pour la même page.
 */
function tailleDirective(lignes) {
  for (const l of lignes) {
    const m = /^%%\{\s*init:\s*(\{[\s\S]*\})\s*\}%%$/.exec(l.trim());
    if (!m) continue;
    try {
      const xy = JSON.parse(m[1])?.xyChart;
      if (xy && (Number.isFinite(xy.width) || Number.isFinite(xy.height)))
        return { largeur: xy.width ?? null, hauteur: xy.height ?? null };
    } catch {
      // Directive illisible : mermaid l'ignore, le site aussi.
    }
  }
  return null;
}

/** Une liste mermaid `[a, "b c", 3]` en éléments, guillemets retirés. */
const elementsListe = (corps) =>
  corps
    .split(",")
    .map((e) => e.trim().replace(/^"(.*)"$/, "$1"))
    .filter((e) => e !== "");

/**
 * Diagramme `xychart-beta` — des COURBES et des BARRES, lues comme le fait
 * mermaid 11 dans la console d'administration.
 *
 * C'est le type que le standard de rédaction prescrit pour « barres, lignes ».
 * Sans cette lecture, le site publié le rendait en source brute : la même
 * page montrait une courbe dans la console et un bloc de texte en ligne.
 * La grammaire couverte est celle de mermaid : `title`, `x-axis` (liste de
 * catégories ou intervalle `min --> max`), `y-axis` (libellé, intervalle),
 * puis une ou plusieurs séries `line [...]` / `bar [...]`.
 */
function lireXy(lignes) {
  const xy = {
    titre: "",
    axeX: { libelle: "", categories: null, min: null, max: null },
    axeY: { libelle: "", min: null, max: null },
    series: [],
    noms: [],
  };
  const axe = (reste, cible) => {
    const lib = /^"([^"]*)"\s*/.exec(reste);
    if (lib) {
      cible.libelle = lib[1];
      reste = reste.slice(lib[0].length);
    } else {
      const nu = /^([^\s[]+)\s*(?=\[|$|-?\d)/.exec(reste);
      if (nu && !/^-?\d/.test(nu[1])) {
        cible.libelle = nu[1];
        reste = reste.slice(nu[0].length);
      }
    }
    const liste = /^\[(.*)\]\s*$/.exec(reste.trim());
    if (liste && "categories" in cible)
      cible.categories = elementsListe(liste[1]);
    const intervalle = /(-?[\d.]+)\s*-->\s*(-?[\d.]+)/.exec(reste);
    if (intervalle) {
      cible.min = Number(intervalle[1]);
      cible.max = Number(intervalle[2]);
    }
  };
  for (const brute of lignes) {
    const l = brute.trim();
    // Mermaid 11 ne nomme pas les séries d'un xychart ; un commentaire
    // `%% series: a | b` les nomme pour la légende du site, sans gêner la console.
    const noms = /^%%\s*series:\s*(.*)$/.exec(l);
    if (noms) {
      xy.noms = noms[1]
        .split("|")
        .map((n) => n.trim())
        .filter(Boolean);
      continue;
    }
    if (!l || l.startsWith("%%")) continue;
    let m;
    if ((m = /^title\s+"?([^"]*)"?$/.exec(l))) xy.titre = m[1];
    else if ((m = /^x-axis\s*(.*)$/.exec(l))) axe(m[1], xy.axeX);
    else if ((m = /^y-axis\s*(.*)$/.exec(l))) axe(m[1], xy.axeY);
    else if ((m = /^(line|bar)\s*(?:"[^"]*"\s*)?\[(.*)\]$/.exec(l)))
      xy.series.push({ kind: m[1], valeurs: elementsListe(m[2]).map(Number) });
  }
  return xy;
}

/**
 * Rend un `xychart-beta` par le moteur de graphes (ECharts, côté serveur).
 *
 * Les catégories de l'axe X viennent de la liste ; à défaut (intervalle
 * numérique), elles se répartissent régulièrement sur l'intervalle. Les
 * courbes ne sont PAS lissées : une valeur mesurée par palier (une cadence,
 * un seuil) dessinée en courbe douce mentirait sur les instants de bascule.
 */
function graphiqueXy(xy, o) {
  const n = Math.max(0, ...xy.series.map((s) => s.valeurs.length));
  const cats =
    xy.axeX.categories ??
    Array.from({ length: n }, (_, i) =>
      xy.axeX.min !== null && xy.axeX.max !== null && n > 1
        ? String(
            Math.round(
              (xy.axeX.min + ((xy.axeX.max - xy.axeX.min) * i) / (n - 1)) * 100,
            ) / 100,
          )
        : String(i + 1),
    );
  const nom = (i) =>
    xy.noms[i] ??
    (xy.series.length > 1 ? `série ${i + 1}` : xy.titre || "série");
  const commun = {
    titre: o.titre ?? xy.titre,
    desc: o.desc ?? xy.titre,
    theme: o.theme ?? "clair",
    largeur: o.largeur ?? xy.taille?.largeur ?? 640,
    ...(xy.taille?.hauteur ? { hauteur: xy.taille.hauteur } : {}),
  };
  if (xy.series.length > 0 && xy.series.every((s) => s.kind === "bar"))
    return bars({
      ...commun,
      axeValeur: xy.axeY.libelle,
      series: xy.series.map((s, i) => ({
        nom: nom(i),
        data: s.valeurs.map((v, j) => [cats[j] ?? String(j + 1), v]),
      })),
    });
  return lines({
    ...commun,
    axeX: xy.axeX.libelle,
    axeY: xy.axeY.libelle,
    lisse: false,
    ...(xy.axeY.min !== null && xy.axeY.max !== null
      ? { bornesY: { min: xy.axeY.min, max: xy.axeY.max } }
      : {}),
    series: xy.series
      .filter((s) => s.kind === "line")
      .map((s, i) => ({
        nom: nom(i),
        points: s.valeurs.map((v, j) => [cats[j] ?? String(j + 1), v]),
      })),
  });
}

/**
 * Diagramme d'ÉTATS, lu comme un flux.
 *
 * Un diagramme d'états est un graphe orienté à transitions étiquetées — la même
 * chose qu'un organigramme, avec deux particularités de syntaxe : l'étiquette
 * suit un deux-points au lieu de vivre entre barres verticales, et `[*]` désigne
 * l'entrée ou la sortie. Sans cette lecture, ces schémas tombaient dans le cas
 * « type non couvert » et s'affichaient en source brute au milieu d'une page de
 * documentation — ce qui se lit comme une page cassée, à raison.
 *
 * Le point d'entrée et le point de sortie deviennent des nœuds en forme de stade
 * nommés « début » et « fin » : un lecteur ne connaît pas la convention `[*]`.
 * Chaque occurrence de `[*]` reçoit son propre nœud, sinon toutes les entrées
 * d'un diagramme convergeraient en un seul point qui n'existe pas.
 */
function lireEtats(lignes) {
  const noeuds = new Map();
  const aretes = [];
  const alias = new Map();
  let bornes = 0;

  const etat = (brut, sortie) => {
    const t = brut.trim();
    if (t === "[*]") {
      const id = `__b${bornes++}`;
      noeuds.set(id, {
        id,
        forme: "stade",
        texte: [sortie ? "fin" : "début"],
        groupe: null,
      });
      return id;
    }
    const id = t.replace(/^state\s+/, "").split(/\s+/)[0];
    if (!noeuds.has(id))
      noeuds.set(id, {
        id,
        forme: "arrondi",
        texte: libelle(alias.get(id) ?? id.replace(/_/g, " ")),
        groupe: null,
      });
    else if (alias.has(id)) noeuds.get(id).texte = libelle(alias.get(id));
    return id;
  };

  for (const brut of lignes) {
    const l = brut.trim();
    if (!l || l.startsWith("%%")) continue;
    if (/^(direction|note|end)\b/.test(l)) continue;
    // `state "libellé lisible" as identifiant`
    const a = /^state\s+"([^"]*)"\s+as\s+(\S+)/.exec(l);
    if (a) {
      alias.set(a[2], a[1]);
      continue;
    }
    const m = /^(.+?)\s*-->\s*([^:]+?)\s*(?::\s*(.*))?$/s.exec(l);
    if (!m) continue;
    const [, g, d, etiquette] = m;
    aretes.push({
      de: etat(g, false),
      vers: etat(d, true),
      etiquette: etiquette ? libelle(etiquette).join(" ") : "",
      style: "plein",
    });
  }
  return { noeuds: [...noeuds.values()], aretes, groupes: [] };
}

/**
 * Réécrit une étiquette de flèche EN LIGNE (`A -- texte --> B`,
 * `A -. texte .-> B`, guillemets facultatifs) dans la forme `A -->|texte| B`,
 * la seule que le lecteur analyse. Sans elle, ces flèches — valides en mermaid —
 * étaient jetées en silence, ou produisaient un nœud fantôme nommé d'après
 * l'étiquette. Une ligne sans étiquette en ligne est rendue telle quelle :
 * `A --> B` ne correspond pas (le `--` y est collé à `>`).
 */
export function enLigneVersBarres(ligne) {
  const m =
    /^(.+?)\s*(--|-\.)\s+(?![->.])(.+?)\s+(-->|---|\.->|\.-)\s*(.+)$/s.exec(
      ligne,
    );
  if (!m) return ligne;
  const [, g, ouvre, brut, ferme, d] = m;
  const etiquette = brut.trim().replace(/^"(.*)"$/s, "$1");
  const fleche =
    ouvre === "-."
      ? ferme === ".->"
        ? "-.->"
        : "-.-"
      : ferme === "---"
        ? "---"
        : "-->";
  return `${g} ${fleche}|${etiquette}| ${d}`;
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
        enLigneVersBarres(l),
      );
    if (m) {
      const [, g, fleche, etiquette, d] = m;
      const a = declare(g);
      const b = declare(d);
      if (a && b)
        aretes.push({
          de: a,
          vers: b,
          // Même traitement que les libellés de nœuds : une étiquette d'arête
          // porte les mêmes entités et les mêmes balises de mise en forme.
          etiquette: etiquette ? libelle(etiquette).join(" ") : null,
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
  let autonumber = false;
  const ajoute = (id, alias) => {
    if (!vu.has(id)) {
      vu.add(id);
      participants.push({ id, nom: alias ?? id });
    }
  };
  for (const brut of lignes) {
    const l = brut.trim();
    if (!l || l.startsWith("%%")) continue;
    if (/^autonumber\b/i.test(l)) {
      autonumber = true;
      continue;
    }
    let m;
    if ((m = /^(participant|actor)\s+(\S+)(?:\s+as\s+(.+))?$/.exec(l))) {
      ajoute(m[2], m[3]?.trim());
    } else if (
      (m = /^Note\s+(over|left of|right of)\s+([^:]+):\s*(.+)$/i.exec(l))
    ) {
      evenements.push({
        genre: "note",
        position: m[1].toLowerCase(),
        cibles: m[2].split(",").map((s) => s.trim()),
        texte: m[3].trim(),
      });
    } else if ((m = /^(loop|alt|opt|par|critical|rect)\b\s*(.*)$/i.exec(l))) {
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
      const vers = m[3].trim().replace(/^[+-]/, "");
      ajoute(m[1]);
      ajoute(vers);
      evenements.push({
        genre: "message",
        de: m[1],
        vers,
        texte: m[4].trim(),
        pointille: m[2].startsWith("--"),
      });
    }
  }
  return { type: "sequence", participants, evenements, autonumber };
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

/**
 * Identifiant de la pointe de flèche d'UN schéma, dans UN thème.
 *
 * Le site met dans la même page le rendu clair ET le rendu sombre de chaque
 * schéma, et en masque un. Deux `<marker id="fl">` identiques font pointer
 * `url(#fl)` vers le PREMIER du document — celui du rendu clair, masqué en
 * thème sombre : les flèches y perdaient leur pointe. L'identifiant dérive donc
 * de la source et du thème, ce qui le rend aussi stable d'un build à l'autre.
 */
const idPointe = (source, theme) => {
  const texte = typeof source === "string" ? source : JSON.stringify(source);
  let h = 2166136261;
  for (let i = 0; i < texte.length; i++) {
    h ^= texte.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return `fl-${theme}-${(h >>> 0).toString(36)}`;
};

const CAR = 7.05; // largeur moyenne d'un caractère à 13 px
const LIGNE = 16;
/** Écart entre deux pistes de coude dans un même intervalle entre rangs. */
const PISTE = 10;
/** Distance minimale entre un couloir de contournement et la boîte qu'il longe. */
const DEGAGEMENT = 14;

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
 * Le cartouche d'une étiquette d'arête : ses lignes et sa taille. Partagé par le
 * placement, qui lui réserve sa place, et par le dessin, qui le pose.
 */
const mesurerEtiquette = (texte) => {
  const lignes = couper(texte, 22, 3);
  return {
    lignes,
    w: Math.max(...lignes.map((l) => l.length)) * 6.1 + 10,
    h: lignes.length * 12 + 4,
  };
};

/** Retire d'une ligne brisée les points répétés et ceux qui ne coudent pas. */
const simplifier = (pts) => {
  const out = [];
  for (const p of pts) {
    const q = out.at(-1);
    if (q && Math.abs(q[0] - p[0]) < 0.5 && Math.abs(q[1] - p[1]) < 0.5)
      continue;
    const r = out.at(-2);
    if (
      q &&
      r &&
      ((Math.abs(r[0] - q[0]) < 0.5 && Math.abs(q[0] - p[0]) < 0.5) ||
        (Math.abs(r[1] - q[1]) < 0.5 && Math.abs(q[1] - p[1]) < 0.5))
    )
      out.pop();
    out.push(p);
  }
  return out;
};

/**
 * Place un organigramme : boîtes et tracé de chaque arête, en coordonnées SVG,
 * sans rien dessiner.
 *
 * Le sens de la source est respecté (`TD`/`TB`, `BT`, `LR`, `RL`) : GitHub le
 * suit, et un rendu qui l'inverse dit le contraire du même fichier.
 *
 * Le tracé est orthogonal et ne se superpose pas :
 *
 *   - une arête quitte sa source par la face qui REGARDE sa cible, et entre dans
 *     la cible par la face opposée — jamais par un côté, ce qui faisait courir un
 *     trait horizontal entre deux boîtes voisines ;
 *   - plusieurs arêtes d'une même face partent de PORTS répartis sur sa largeur,
 *     triés par la position de l'autre extrémité, au lieu de partir du même
 *     point et de se confondre ;
 *   - chaque coude suit sa propre PISTE dans l'intervalle entre deux rangs, et
 *     l'intervalle s'élargit au nombre de pistes qu'il porte ;
 *   - une arête qui saute un rang descend par un COULOIR libre, à l'écart des
 *     boîtes intermédiaires, au lieu de les traverser.
 *
 * @param {{dir: string, noeuds: Array, aretes: Array}} modele - un modèle `flux`.
 * @param {number} haut - place réservée au-dessus (titre, sous-titre).
 * @returns {{noeuds: {id: string, x: number, y: number, w: number, h: number}[], aretes: {de: string, vers: string, etiquette?: string, pointille?: boolean, points: number[][]}[], largeur: number, hauteur: number}}
 */
export function placerOrganigramme(modele, haut = 0) {
  const pos = placerEnCouches(modele);
  const horizontal = /^(LR|RL)$/.test(modele.dir);
  const inverse = /^(BT|RL)$/.test(modele.dir);
  const dim = new Map(modele.noeuds.map((n) => [n.id, taille(n)]));
  const formes = new Map(modele.noeuds.map((n) => [n.id, n.forme]));
  // Longueur d'une boîte le long de l'axe TRANSVERSAL (t) et de la PROFONDEUR (d).
  const lt = (id) => (horizontal ? dim.get(id)[1] : dim.get(id)[0]);
  const ld = (id) => (horizontal ? dim.get(id)[0] : dim.get(id)[1]);

  const rangs = [...new Set([...pos.values()].map((p) => p.rang))].sort(
    (a, b) => a - b,
  );
  const ri = new Map(rangs.map((r, i) => [r, i]));
  const rangDe = (id) => ri.get(pos.get(id).rang);
  const parRang = rangs.map(() => []);
  for (const n of modele.noeuds) parRang[rangDe(n.id)].push(n);
  for (const g of parRang)
    g.sort((a, b) => pos.get(a.id).ordre - pos.get(b.id).ordre);

  // Les arêtes tracées, et l'intervalle où chacune fait ses coudes. L'intervalle
  // `k` est celui qui suit le rang `k`.
  const aretes = modele.aretes
    .filter((a) => a.de !== a.vers && dim.has(a.de) && dim.has(a.vers))
    .map((a, i) => {
      const ra = rangDe(a.de);
      const rb = rangDe(a.vers);
      const sens = rb > ra ? 1 : rb < ra ? -1 : 0;
      return Object.assign({}, a, {
        i,
        ra,
        rb,
        // Même rang : on sort et on rentre par la face « après ».
        faceDe: sens === 0 ? 1 : sens,
        faceVers: sens === 0 ? 1 : -sens,
        cartouche: a.etiquette ? mesurerEtiquette(a.etiquette) : null,
        premier: sens >= 0 ? ra : ra - 1,
        dernier: sens > 0 ? rb - 1 : sens < 0 ? rb : ra,
      });
    });
  const pistes = rangs.map(() => []);
  for (const a of aretes) {
    pistes[a.premier].push(a);
    if (a.dernier !== a.premier) pistes[a.dernier].push(a);
  }

  const ECART_RANG = horizontal ? 76 : 54;
  const ECART_ORDRE = 28;
  const MARGE = 18;
  // Place qu'une arête prend dans un intervalle : une piste, ou — dans son
  // PREMIER intervalle, où se pose son étiquette — l'épaisseur de l'étiquette.
  // Sans cela, trois étiquettes d'un même intervalle s'empilaient sur 54 px.
  const place = (a, k) =>
    a.cartouche && k === a.premier
      ? (horizontal ? a.cartouche.w : a.cartouche.h) + 8
      : PISTE;
  const besoin = (k) => pistes[k].reduce((n, a) => n + place(a, k), 0);
  const ecart = (k) =>
    Math.max(
      k < rangs.length - 1 || pistes[k].length ? ECART_RANG : 0,
      pistes[k].length ? 16 + besoin(k) + PISTE : 0,
    );

  // Profondeur : rang après rang, chaque intervalle à la taille de ses pistes.
  const bande = [];
  let d = MARGE;
  for (let k = 0; k < rangs.length; k++) {
    const epais = Math.max(...parRang[k].map((n) => ld(n.id)));
    bande.push({ debut: d, fin: d + epais });
    d += epais + ecart(k);
  }
  const profondeur = d + MARGE;

  // Transversal : chaque rang centré sur le plus large.
  const total = (g) =>
    g.reduce((s, n) => s + lt(n.id), 0) + (g.length - 1) * ECART_ORDRE;
  const transversalMax = Math.max(...parRang.map(total));
  const centre = new Map();
  parRang.forEach((g, k) => {
    let t = (transversalMax - total(g)) / 2 + MARGE;
    for (const n of g) {
      centre.set(n.id, {
        t: t + lt(n.id) / 2,
        d: (bande[k].debut + bande[k].fin) / 2,
      });
      t += lt(n.id) + ECART_ORDRE;
    }
  });

  // Ports : les arêtes d'une même face, réparties sur sa largeur dans l'ordre
  // transversal de leur autre extrémité — c'est ce qui évite qu'elles se croisent
  // en sortant.
  const faces = new Map();
  const inscrire = (id, face, a, autre) => {
    const k = `${id}|${face}`;
    if (!faces.has(k)) faces.set(k, []);
    faces.get(k).push({ a, autre });
  };
  for (const a of aretes) {
    inscrire(a.de, a.faceDe, a, centre.get(a.vers).t);
    inscrire(a.vers, a.faceVers, a, centre.get(a.de).t);
  }
  const port = new Map();
  for (const [k, liste] of faces) {
    const id = k.slice(0, k.lastIndexOf("|"));
    liste.sort((x, y) => x.autre - y.autre);
    const c = centre.get(id).t;
    // Un losange n'a qu'un point sur chaque face : sa pointe.
    const pointe = formes.get(id) === "losange";
    const etendue = pointe
      ? 0
      : Math.min(lt(id) * 0.7, (liste.length - 1) * 22);
    liste.forEach(({ a }, i) => {
      const t =
        liste.length === 1 || pointe
          ? c
          : c - etendue / 2 + (etendue * i) / (liste.length - 1);
      port.set(`${a.i}|${id}`, t);
    });
  }
  // Une face qui ne porte qu'UNE arête n'a rien à partager : son port se cale
  // en face de l'autre extrémité, dans les limites de la boîte, et le trait
  // devient droit au lieu de faire un crochet de quelques pixels.
  for (const a of aretes) {
    for (const [id, face, autre] of [
      [a.de, a.faceDe, a.vers],
      [a.vers, a.faceVers, a.de],
    ]) {
      if (faces.get(`${id}|${face}`).length !== 1) continue;
      if (formes.get(id) === "losange") continue;
      const cible = port.get(`${a.i}|${autre}`);
      const c = centre.get(id).t;
      const m = lt(id) * 0.35;
      port.set(`${a.i}|${id}`, Math.min(c + m, Math.max(c - m, cible)));
    }
  }
  const portDe = (a) => port.get(`${a.i}|${a.de}`);
  const portVers = (a) => port.get(`${a.i}|${a.vers}`);

  const traverses = (a) => {
    const out = [];
    for (let k = Math.min(a.ra, a.rb) + 1; k < Math.max(a.ra, a.rb); k++)
      out.push(k);
    return out;
  };

  // Couloirs : une arête qui traverse des rangs passe à l'écart de leurs boîtes.
  // Choisis AVANT les pistes, sur toute la hauteur des rangs traversés : l'ordre
  // des pistes dépend des colonnes qu'occupent les couloirs.
  const couloirs = [];
  const libre = (t, rangsTraverses, d1, d2, interdits = []) =>
    interdits.every((x) => Math.abs(x - t) >= PISTE) &&
    rangsTraverses.every((k) =>
      parRang[k].every((n) => {
        const c = centre.get(n.id).t;
        return Math.abs(t - c) >= lt(n.id) / 2 + DEGAGEMENT - 0.5;
      }),
    ) &&
    couloirs.every(
      (c) =>
        Math.abs(c.t - t) >= PISTE || Math.max(c.d1, d1) >= Math.min(c.d2, d2),
    );
  const couloir = new Map();
  for (const a of aretes) {
    const tr = traverses(a);
    if (tr.length === 0) continue;
    const ts = portDe(a);
    const tv = portVers(a);
    const d1 = bande[Math.min(a.ra, a.rb)].fin;
    const d2 = bande[Math.max(a.ra, a.rb)].debut;
    const bornes = tr.flatMap((k) =>
      parRang[k].flatMap((n) => {
        const c = centre.get(n.id).t;
        const m = lt(n.id) / 2 + DEGAGEMENT;
        return [c - m, c + m];
      }),
    );
    // Le couloir descend aussi dans le premier et le dernier intervalle : il y
    // croiserait la colonne d'arrivée ou de départ d'une autre arête.
    const interdits = [...pistes[a.premier], ...pistes[a.dernier]].flatMap(
      (b) => (b === a ? [] : [portDe(b), portVers(b)]),
    );
    const cout = (t) => Math.abs(t - ts) + Math.abs(t - tv);
    let t = [tv, ts, (ts + tv) / 2, ...bornes]
      .filter((x) => libre(x, tr, d1, d2, interdits))
      .sort((x, y) => cout(x) - cout(y))[0];
    // Repli : s'écarter pas à pas hors de tout, sans jamais renoncer.
    for (let pas = 1; t === undefined; pas++)
      for (const x of [
        Math.min(...bornes) - pas * PISTE,
        Math.max(...bornes) + pas * PISTE,
      ])
        if (t === undefined && libre(x, tr, d1, d2, interdits)) t = x;
    couloirs.push({ t, d1, d2 });
    couloir.set(a.i, t);
  }

  // Les colonnes qu'une arête occupe dans l'intervalle k : côté du rang k
  // (« bas ») entre le bord et sa piste, côté du rang k + 1 (« haut ») entre sa
  // piste et le bord.
  const colonnes = (a, k) => {
    const ts = portDe(a);
    const tv = portVers(a);
    const c = couloir.get(a.i);
    if (a.ra === a.rb) return { bas: [ts, tv], haut: [] };
    if (a.rb > a.ra)
      return k === a.premier
        ? { bas: [ts], haut: [c ?? tv] }
        : { bas: [c], haut: [tv] };
    return k === a.premier
      ? { bas: [c ?? tv], haut: [ts] }
      : { bas: [tv], haut: [c] };
  };

  // Piste de chaque arête dans chacun de ses intervalles. L'ordre n'est pas
  // indifférent : si X occupe, côté bas, la colonne où Y occupe le côté haut,
  // la piste de X doit précéder celle de Y — sinon les deux traits courent l'un
  // contre l'autre sur la même colonne, et se lisent comme un seul. Tri
  // topologique sur cette contrainte, la position transversale départageant le
  // reste ; un cycle se résout dans l'ordre transversal.
  const piste = new Map();
  pistes.forEach((liste, k) => {
    const debut = bande[k].fin;
    const fin = k + 1 < bande.length ? bande[k + 1].debut : debut + ecart(k);
    const restantes = [...liste].sort(
      (x, y) =>
        Math.min(portDe(x), portVers(x)) - Math.min(portDe(y), portVers(y)),
    );
    const col = new Map(restantes.map((a) => [a.i, colonnes(a, k)]));
    const avant = (x, y) =>
      col
        .get(x.i)
        .bas.some((cx) =>
          col.get(y.i).haut.some((cy) => Math.abs(cx - cy) < PISTE),
        );
    const ordre = [];
    while (restantes.length) {
      const i = restantes.findIndex((y) =>
        restantes.every((x) => x === y || !avant(x, y)),
      );
      ordre.push(...restantes.splice(i < 0 ? 0 : i, 1));
    }
    let curseur = debut + (fin - debut - besoin(k)) / 2;
    for (const a of ordre) {
      piste.set(`${a.i}|${k}`, curseur + place(a, k) / 2);
      curseur += place(a, k);
    }
  });

  const placees = aretes.map((a) => {
    const s = centre.get(a.de);
    const v = centre.get(a.vers);
    const ts = portDe(a);
    const tv = portVers(a);
    const ds = s.d + (a.faceDe * ld(a.de)) / 2;
    const dv = v.d + (a.faceVers * ld(a.vers)) / 2;
    const p1 = piste.get(`${a.i}|${a.premier}`);
    const p2 = piste.get(`${a.i}|${a.dernier}`);
    const c = couloir.get(a.i);
    let pts;
    if (c === undefined)
      pts =
        Math.abs(ts - tv) < 0.5 && a.ra !== a.rb
          ? [
              [ts, ds],
              [tv, dv],
            ]
          : [
              [ts, ds],
              [ts, p1],
              [tv, p1],
              [tv, dv],
            ];
    else
      pts = [
        [ts, ds],
        [ts, p1],
        [c, p1],
        [c, p2],
        [tv, p2],
        [tv, dv],
      ];
    // L'étiquette se pose sur la piste du premier intervalle, là où sa place a
    // été réservée : au milieu du coude transversal, ou sur le trait droit.
    const fin1 = c ?? tv;
    const ancre = [Math.abs(ts - fin1) < 0.5 ? ts : (ts + fin1) / 2, p1];
    return { a, pts: simplifier(pts), ancre };
  });

  // Coordonnées logiques (t, d) → SVG. Un couloir peut sortir du cadre : on
  // élargit et on recale, plutôt que de couper un trait.
  let tMin = MARGE;
  let tMax = transversalMax + MARGE;
  for (const { pts } of placees)
    for (const [t] of pts) {
      tMin = Math.min(tMin, t - MARGE / 2);
      tMax = Math.max(tMax, t + MARGE / 2);
    }
  const recale = MARGE - tMin;
  const vers = (t, dd) => {
    const p = inverse ? profondeur - dd : dd;
    return horizontal ? [p, t + recale + haut] : [t + recale, p + haut];
  };
  const transversal = tMax - tMin + MARGE * 2;

  return {
    noeuds: modele.noeuds.map((n) => {
      const c = centre.get(n.id);
      const [x, y] = vers(c.t, c.d);
      const [w, h] = dim.get(n.id);
      return { id: n.id, x, y, w, h };
    }),
    aretes: placees.map(({ a, pts, ancre }) => ({
      de: a.de,
      vers: a.vers,
      etiquette: a.etiquette,
      pointille: a.pointille,
      points: pts.map(([t, dd]) => vers(t, dd)),
      ancre: vers(...ancre),
    })),
    largeur: horizontal ? profondeur : transversal,
    hauteur: (horizontal ? transversal : profondeur) + haut,
  };
}

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
 * bibliothèque de plus, puisque le placement est déjà calculé
 * (`placerOrganigramme`).
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
  const MARGE = 18;
  const HAUT =
    (titre ? 24 : 0) + (sousTitre ? 18 : 0) + (titre || sousTitre ? 16 : 0);
  const g = placerOrganigramme(modele, HAUT);
  const pointe = idPointe(source, theme);
  const L = Math.ceil(g.largeur);
  const H = Math.ceil(g.hauteur);

  const out = [];
  out.push(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${L} ${H}" width="${L}" height="${H}" role="img" aria-label="${ech(titre ?? "organigramme")}"${desc ? ` aria-description="${ech(desc)}"` : ""} font-family="${POLICE}">`,
    `<title>${ech(titre ?? "organigramme")}</title>`,
    `<defs><marker id="${pointe}" viewBox="0 0 10 10" refX="8.5" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 1 L9 5 L0 9 z" fill="${T.muet}"/></marker></defs>`,
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
  // Cartouches d'étiquettes déjà posés — sert à ne pas les empiler.
  const posees = [];
  for (const a of g.aretes) {
    const d = a.points
      .map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`)
      .join(" ");
    out.push(
      `<path d="${d}" fill="none" stroke="${T.muet}" stroke-width="1.25" stroke-linejoin="round"${a.pointille ? ' stroke-dasharray="5 4"' : ""} marker-end="url(#${pointe})"/>`,
    );
    if (a.etiquette) {
      // Toujours HORIZONTALE, posée sur un fond opaque : une étiquette tournée
      // le long du trait devient illisible dès qu'elle croise une boîte.
      //
      // Et sur PLUSIEURS LIGNES au-delà d'une vingtaine de caractères. Un
      // cartouche d'un seul tenant s'étale sur la largeur de deux colonnes et
      // passe SOUS celui de l'arête voisine : le texte n'est pas tronqué, il est
      // recouvert — ce qui se lit comme un schéma cassé, et l'était en pratique
      // sur les transitions d'un diagramme d'états. Le texte entier reste
      // accessible au survol.
      const { lignes, w, h } = mesurerEtiquette(a.etiquette);
      const [mx, my0] = a.ancre;
      // Deux arêtes issues d'un même nœud ont des milieux voisins, donc des
      // cartouches OPAQUES qui se recouvrent : le premier disparaît sous le
      // second et son texte semble tronqué. On les écarte de part et d'autre du
      // milieu jusqu'à ce qu'ils ne se croisent plus. La comparaison porte sur
      // les CENTRES — confronter un bord supérieur à une demi-hauteur ne
      // détecte rien, et laisse l'empilement intact.
      let my = my0;
      for (let essai = 1; essai <= 24; essai++) {
        const chevauche = posees.some(
          (r) =>
            Math.abs(r.x - mx) < (r.w + w) / 2 - 2 &&
            Math.abs(r.y - my) < (r.h + h) / 2 + 2,
        );
        if (!chevauche) break;
        my = my0 + Math.ceil(essai / 2) * (h + 5) * (essai % 2 === 1 ? -1 : 1);
      }
      posees.push({ x: mx, y: my, w, h });
      const y0 = my - h / 2;
      out.push(
        `<rect x="${(mx - w / 2).toFixed(1)}" y="${y0.toFixed(1)}" width="${w.toFixed(1)}" height="${h}" rx="3" fill="${T.fond}"><title>${ech(a.etiquette)}</title></rect>`,
        lignes
          .map(
            (l, k) =>
              `<text x="${mx.toFixed(1)}" y="${(y0 + 12 + k * 12).toFixed(1)}" text-anchor="middle" font-size="10.5" fill="${T.muet}">${ech(l)}</text>`,
          )
          .join(""),
      );
    }
  }

  // Puis les nœuds.
  const boite = new Map(g.noeuds.map((b) => [b.id, b]));
  for (const n of modele.noeuds) {
    const { x: cx, y: cy, w, h } = boite.get(n.id);
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

/** Largeur moyenne d'un caractère des libellés de message et de note (11,5 px). */
export const CAR_MESSAGE = 6.5;
/** Longueur, en caractères, au-delà de laquelle un libellé de message passe à la ligne. */
const COUPE_MESSAGE = 32;
const INTERLIGNE = 14;
/** Place qu'une pastille de numéro (`autonumber`) prend devant un libellé. */
const PASTILLE = 20;

/** Les lignes d'un libellé de message ou de note : `<br/>` respecté, puis coupé. */
const lignesDe = (texte) => {
  const morceaux = libelle(texte).flatMap((s) => couper(s, COUPE_MESSAGE, 6));
  return morceaux.length ? morceaux : [""];
};

/** Largeur estimée d'un bloc de lignes, en pixels. */
export const largeurLignes = (lignes) =>
  Math.max(...lignes.map((l) => l.length)) * CAR_MESSAGE;

/**
 * Place un diagramme de séquence : colonnes, messages, notes et cadres, en
 * coordonnées — sans rien dessiner.
 *
 * L'écart entre deux lignes de vie n'est pas fixe : il grandit jusqu'à contenir
 * le plus long libellé qui les relie, et un message à soi-même réserve sa place
 * à droite de sa colonne. Un écart constant faisait déborder les libellés sur les
 * colonnes voisines et chevaucher les boucles. Les bornes horizontales englobent
 * tout ce qui est posé — une note plus large que les colonnes n'est plus coupée.
 *
 * @param {{participants: {id: string, nom: string}[], evenements: object[], autonumber?: boolean}} modele
 * @param {number} haut - ordonnée des lignes de vie (sous les en-têtes).
 * @returns {{colonnes: number[], boites: number[], messages: object[], notes: object[], cadres: object[], x0: number, largeur: number, hauteur: number}}
 */
export function placerSequence(modele, haut) {
  const P = modele.participants;
  const n = P.length;
  const rang = (id) =>
    Math.max(
      0,
      P.findIndex((p) => p.id === id),
    );
  const boites = P.map((p) => p.nom.length * CAR + 26);
  const avance = modele.autonumber ? PASTILLE : 0;
  const evts = modele.evenements.map((e) =>
    e.genre === "message" || e.genre === "note"
      ? { ...e, lignes: lignesDe(e.texte) }
      : e,
  );

  const ecarts = Array.from({ length: Math.max(0, n - 1) }, (_, k) =>
    Math.max(150, (boites[k] + boites[k + 1]) / 2 + 30),
  );
  let droite = boites[n - 1] / 2;
  for (const e of evts) {
    if (e.genre !== "message") continue;
    const a = rang(e.de);
    const b = rang(e.vers);
    const w = largeurLignes(e.lignes) + avance;
    if (a === b) {
      const besoin = 34 + w + 14;
      if (a < n - 1) ecarts[a] = Math.max(ecarts[a], besoin);
      else droite = Math.max(droite, besoin);
      continue;
    }
    const lo = Math.min(a, b);
    const hi = Math.max(a, b);
    let portee = 0;
    for (let k = lo; k < hi; k++) portee += ecarts[k];
    const besoin = w + 36;
    if (portee < besoin)
      for (let k = lo; k < hi; k++) ecarts[k] += (besoin - portee) / (hi - lo);
  }
  const colonnes = [0];
  for (let k = 0; k < n - 1; k++) colonnes.push(colonnes[k] + ecarts[k]);
  const x = (id) => colonnes[rang(id)];

  let gauche = colonnes[0] - boites[0] / 2;
  let fin = colonnes[n - 1] + droite;
  const messages = [];
  const notes = [];
  const cadres = [];
  const ouverts = [];
  let y = haut + 12;
  let numero = 0;
  for (const e of evts) {
    if (e.genre === "message") {
      const x1 = x(e.de);
      const x2 = x(e.vers);
      const supl = (e.lignes.length - 1) * INTERLIGNE;
      const m = {
        x1,
        x2,
        texte: e.texte,
        lignes: e.lignes,
        pointille: e.pointille,
        numero: modele.autonumber ? ++numero : null,
        haut: y,
      };
      if (x1 === x2) {
        m.yl = y + 10;
        m.boucle = Math.max(16, supl + 10);
        y += m.boucle + 24;
      } else {
        m.yl = y + 14 + supl;
        y += 34 + supl;
      }
      m.bas = y;
      messages.push(m);
    } else if (e.genre === "note") {
      const xs = e.cibles.map(x);
      const w = largeurLignes(e.lignes) + 24;
      let gx;
      let nw;
      if (e.position === "left of") {
        nw = Math.max(w, 100);
        gx = Math.min(...xs) - 12 - nw;
      } else if (e.position === "right of") {
        nw = Math.max(w, 100);
        gx = Math.max(...xs) + 12;
      } else {
        const g = Math.min(...xs) - 50;
        const d = Math.max(...xs) + 50;
        nw = Math.max(w, d - g);
        gx = (g + d) / 2 - nw / 2;
      }
      const nh = 24 + (e.lignes.length - 1) * INTERLIGNE;
      notes.push({
        x: gx,
        y: y + 2,
        largeur: nw,
        hauteur: nh,
        texte: e.texte,
        lignes: e.lignes,
      });
      gauche = Math.min(gauche, gx);
      fin = Math.max(fin, gx + nw);
      y += nh + 10;
    } else if (e.genre === "ouvre") {
      ouverts.push({
        cadre: e.cadre,
        texte:
          e.cadre === "rect"
            ? ""
            : `${e.cadre}${e.texte ? ` — ${e.texte}` : ""}`,
        y0: y,
        profondeur: ouverts.length,
        sinons: [],
      });
      y += e.cadre === "rect" ? 8 : 22;
    } else if (e.genre === "sinon") {
      ouverts.at(-1)?.sinons.push({ y, texte: e.texte });
      y += 22;
    } else if (e.genre === "ferme") {
      const c = ouverts.pop();
      if (c) cadres.push({ ...c, y1: y + 6 });
      y += 12;
    }
  }
  const x0 = gauche - 8 - 18;
  return {
    colonnes,
    boites,
    messages,
    notes,
    cadres,
    x0,
    largeur: fin + 8 + 18 - x0,
    hauteur: y + 16,
  };
}

/**
 * Rend un diagramme de séquence — en SVG direct.
 *
 * Aucune bibliothèque : des participants en colonnes, des messages en lignes.
 * Le placement est arithmétique (`placerSequence`), le tracé tient dans cette
 * fonction ; passer par un moteur de graphes ne rendrait pas le trait plus
 * juste, seulement le code plus indirect.
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
  const HAUT = (titre ? 26 : 0) + (sousTitre ? 18 : 0) + 46;
  const g = placerSequence(modele, HAUT);
  const pointe = idPointe(source, theme);
  const { x0, largeur: L, hauteur: H } = g;
  const police = `font-family="${POLICE}"`;
  const texte = (lignes, tx, ty, attrs) =>
    `<text x="${tx}" y="${ty}" ${attrs} ${police}>${lignes
      .map(
        (l, i) =>
          `<tspan x="${tx}"${i ? ` dy="${INTERLIGNE}"` : ""}>${ech(l)}</tspan>`,
      )
      .join("")}</text>`;
  const pastille = (cx, cy, n) =>
    `<circle cx="${cx}" cy="${cy}" r="8" fill="${T.encre}"/>` +
    `<text x="${cx}" y="${cy + 3.5}" text-anchor="middle" font-size="9.5" font-weight="600" fill="${T.fond}" ${police}>${n}</text>`;

  const corps = [];
  const gx = x0 + 18;
  const gw = L - 36;
  for (const c of g.cadres) {
    const r = 5 + c.profondeur * 6;
    const fx = gx + c.profondeur * 6;
    const fw = gw - c.profondeur * 12;
    if (c.cadre === "rect") {
      corps.push(
        `<rect x="${fx}" y="${c.y0 - 4}" width="${fw}" height="${c.y1 - c.y0 + 4}" rx="${r}" fill="${T.fondDoux}" opacity="0.6"/>`,
      );
      continue;
    }
    corps.push(
      `<rect x="${fx}" y="${c.y0 - 4}" width="${fw}" height="${c.y1 - c.y0 + 4}" rx="5" fill="none" stroke="${T.trait}"/>` +
        `<rect x="${fx}" y="${c.y0 - 4}" width="${c.texte.length * 6 + 16}" height="17" rx="4" fill="${T.fondDoux}" stroke="${T.trait}"/>` +
        `<text x="${fx + 7}" y="${c.y0 + 8}" font-size="10.5" fill="${T.muet}" ${police}>${ech(c.texte)}</text>`,
    );
    for (const s of c.sinons)
      corps.push(
        `<line x1="${fx}" y1="${s.y}" x2="${fx + fw}" y2="${s.y}" stroke="${T.trait}" stroke-dasharray="4 3"/>`,
        `<text x="${fx + 6}" y="${s.y + 13}" font-size="10.5" fill="${T.muet}" ${police}>sinon ${ech(s.texte)}</text>`,
      );
  }

  for (const [i, cx] of g.colonnes.entries()) {
    const p = modele.participants[i];
    const w = g.boites[i];
    corps.unshift(
      `<line x1="${cx}" y1="${HAUT}" x2="${cx}" y2="${H - 8}" stroke="${T.trait}" stroke-dasharray="3 4"/>` +
        `<rect x="${cx - w / 2}" y="${HAUT - 30}" width="${w}" height="26" rx="6" fill="${T.fondDoux}" stroke="${T.trait}"/>` +
        `<text x="${cx}" y="${HAUT - 12}" text-anchor="middle" font-size="12" font-weight="600" fill="${T.encre}" ${police}>${ech(p.nom)}</text>`,
    );
  }

  for (const nt of g.notes)
    corps.push(
      `<rect x="${nt.x}" y="${nt.y}" width="${nt.largeur}" height="${nt.hauteur}" rx="4" fill="${T.fondDoux}" stroke="${T.trait}"/>`,
      texte(
        nt.lignes,
        nt.x + nt.largeur / 2,
        nt.y + 16,
        `text-anchor="middle" font-size="11" fill="${T.muet}"`,
      ),
    );

  for (const m of g.messages) {
    const trait = `stroke="${T.muet}" stroke-width="1.2"${m.pointille ? ' stroke-dasharray="4 3"' : ""} marker-end="url(#${pointe})"`;
    const decale = m.numero === null ? 0 : PASTILLE;
    if (m.x1 === m.x2) {
      corps.push(
        `<path d="M${m.x1} ${m.yl} h26 v${m.boucle} h-26" fill="none" ${trait}/>`,
        texte(
          m.lignes,
          m.x1 + 34 + decale,
          m.yl + 4,
          `font-size="11.5" fill="${T.encre}"`,
        ),
      );
      if (m.numero !== null)
        corps.push(pastille(m.x1 + 34 + 8, m.yl, m.numero));
      continue;
    }
    const sens = m.x2 > m.x1 ? -1 : 1;
    const mx = (m.x1 + m.x2) / 2 + decale / 2;
    const premiere = m.yl - 6 - (m.lignes.length - 1) * INTERLIGNE;
    corps.push(
      `<line x1="${m.x1}" y1="${m.yl}" x2="${m.x2 + sens * 5}" y2="${m.yl}" ${trait}/>`,
      texte(
        m.lignes,
        mx,
        premiere,
        `text-anchor="middle" font-size="11.5" fill="${T.encre}"`,
      ),
    );
    if (m.numero !== null) corps.push(pastille(m.x1, m.yl, m.numero));
  }

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${x0} 0 ${L} ${H}" width="${L}" height="${H}" role="img" aria-label="${ech(titre ?? "diagramme de séquence")}"${desc ? ` aria-description="${ech(desc)}"` : ""}>`,
    `<title>${ech(titre ?? "diagramme de séquence")}</title>`,
    `<defs><marker id="${pointe}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 1 L9 5 L0 9 z" fill="${T.muet}"/></marker></defs>`,
    `<rect x="${x0}" y="0" width="${L}" height="${H}" fill="${T.fond}"/>`,
    titre
      ? `<text x="${gx}" y="20" font-size="14" font-weight="600" fill="${T.encre}" ${police}>${ech(titre)}</text>`
      : "",
    sousTitre
      ? `<text x="${gx}" y="${titre ? 38 : 20}" font-size="12" fill="${T.muet}" ${police}>${ech(sousTitre)}</text>`
      : "",
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
  if (modele.type === "xy" && modele.series.length > 0)
    return graphiqueXy(modele, o);
  const T = THEMES[o.theme ?? "clair"];
  return (
    `<pre style="border:1px solid ${T.trait};border-radius:8px;padding:12px;` +
    `overflow-x:auto;font-size:12px;color:${T.muet}">${ech(o.source)}</pre>`
  );
}
