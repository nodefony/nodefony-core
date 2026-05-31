import type { ComponentType } from "react";
import { ActionsLiveGraph } from "./ActionsLiveGraph";
import { ArchitectureLiveGraph } from "./ArchitectureLiveGraph";
import { BackplaneLiveGraph } from "./BackplaneLiveGraph";
import { FanOutLiveGraph } from "./FanOutLiveGraph";
import { ProtocoleLiveGraph } from "./ProtocoleLiveGraph";
import { SondesLiveGraph } from "./SondesLiveGraph";

/* ════════════════════════════════════════════════════════════════════════
 * pages.ts — REGISTRY des sous-pages de la doc Socket.
 *
 * Source = `docs/realtime/socket/*.md` (racine du repo, hors Studio). Vite
 * glob les charge en **bloc** au boot (eager) → 1 seul appel `?raw` qui
 * absorbe toute la laideur de path relatif. Tu ajoutes un fichier dans
 * `docs/realtime/socket/` → il apparaît automatiquement dans la nav, à la
 * position dictée par son préfixe numérique (`01-…`, `02-…`).
 *
 * Le frontmatter est parsé côté front (mini-parseur 5 lignes — POC). Le
 * mapping `LIVE_GRAPHS` associe optionnellement un composant graphe live à
 * un slug (un slug sans entrée = pas de graphe sous le markdown).
 *
 * Phase C — Phase D rédigera 6 sous-pages de plus ; ce fichier ne bouge pas.
 * ════════════════════════════════════════════════════════════════════════ */

/**
 * Tous les `.md` du répertoire `docs/realtime/socket/`. Vite glob = ce
 * seul path relatif laid existe dans tout le repo ; toutes les pages
 * passent par lui. `eager: true` = chargés au boot (taille négligeable :
 * 7 fichiers × ~3-5 ko).
 */
// 8 `..` : `realtime/socket/` est 1 niveau plus profond que `routes/` (où 7
// `..` suffisaient). Vite glob exige un littéral statique → on assume cette
// laideur dans CE fichier UNIQUE (point fait avec [[feedback_studio_layout_rigor]]).
const RAW_MAP = import.meta.glob<string>(
  "../../../../../../../../docs/realtime/socket/*.md",
  { query: "?raw", import: "default", eager: true },
);

/**
 * Mapping `slug → composant graphe live`. Une page sans entrée ici ne
 * monte aucun graphe live (le markdown seul est rendu).
 */
const LIVE_GRAPHS: Record<
  string,
  ComponentType<{ live?: boolean; height?: number }> | undefined
> = {
  "vue-ensemble": ArchitectureLiveGraph,
  architecture: ArchitectureLiveGraph,
  "fan-out": FanOutLiveGraph,
  protocole: ProtocoleLiveGraph,
  sondes: SondesLiveGraph,
  backplane: BackplaneLiveGraph,
  actions: ActionsLiveGraph,
};

export interface SocketPage {
  /** Slug humain (sans préfixe numérique) — `vue-ensemble`, `architecture`, … */
  slug: string;
  /** Ordre dans la nav (préfixe numérique du fichier : `01-` → 1). */
  order: number;
  /** Titre affiché — frontmatter `title:` ou slug humanisé en fallback. */
  title: string;
  /** Frontmatter complet, brut (clé → valeur string). */
  meta: Record<string, string>;
  /** Markdown sans le bloc `---…---`. */
  body: string;
  /** Chemin source côté repo, pour le lien « Modifier sur GitHub ». */
  sourcePath: string;
  /** Composant graphe live à monter sous le markdown (optionnel). */
  LiveGraph?: ComponentType<{ live?: boolean; height?: number }>;
}

/** Parseur frontmatter ultra-simple (mono-ligne string). */
function parseFrontmatter(raw: string): {
  meta: Record<string, string>;
  body: string;
} {
  const m = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(raw);
  if (!m) return { meta: {}, body: raw };
  const meta: Record<string, string> = {};
  for (const line of m[1].split("\n")) {
    const kv = /^([a-zA-Z][\w-]*)\s*:\s*(.+?)\s*$/.exec(line);
    if (kv) meta[kv[1]] = kv[2].replace(/^["']|["']$/g, "");
  }
  return { meta, body: m[2] };
}

/** `01-vue-ensemble.md` → `{ slug: "vue-ensemble", order: 1 }`. */
function parseFilename(path: string): { slug: string; order: number } {
  const base = path.replace(/^.*\//, "").replace(/\.md$/, "");
  const m = /^(\d+)[-_](.+)$/.exec(base);
  if (!m) return { slug: base, order: 999 };
  return { slug: m[2], order: parseInt(m[1], 10) };
}

/** Slug humanisé en titre fallback (« vue-ensemble » → « Vue Ensemble »). */
function humanize(slug: string): string {
  return slug.replace(/[-_]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Liste triée des sous-pages — source unique du registry Vite glob. */
export const socketPages: SocketPage[] = Object.entries(RAW_MAP)
  .map(([path, raw]) => {
    const { slug, order } = parseFilename(path);
    const { meta, body } = parseFrontmatter(raw);
    // Le path absorbe les `../`. Pour `sourcePath`, on retire ces `../` initiaux
    // afin d'obtenir un chemin lisible depuis la racine repo.
    const sourcePath = path.replace(/^(\.\.\/)+/, "");
    return {
      slug,
      order,
      title: meta.title ?? humanize(slug),
      meta,
      body,
      sourcePath,
      LiveGraph: LIVE_GRAPHS[slug],
    };
  })
  .sort((a, b) => a.order - b.order);

/** Trouve une page par slug ; fallback = première page de la liste. */
export function findSocketPage(slug?: string | null): SocketPage {
  return socketPages.find((p) => p.slug === slug) ?? socketPages[0];
}

/**
 * Trouve le composant graphe live associé à un slug, en acceptant les DEUX
 * formats qui peuvent arriver :
 *  - format court : `vue-ensemble`, `fan-out`, `protocole`, …
 *    (slug du registry Vite, utile pour tests / appels directs).
 *  - format portail backend : `root~realtime~socket~04-fan-out`, …
 *    (slug produit par le module `@nodefony/documentation`,
 *    `DocumentationService.getTree()` scan FS — c'est ce que reçoit `Documentation.tsx`).
 *
 * Retourne `undefined` si rien ne matche (la page rendra alors juste le
 * markdown, pas de bloc « Schéma live » sous le contenu).
 */
export function findSocketLiveGraph(
  slug: string,
): ComponentType<{ live?: boolean; height?: number }> | undefined {
  if (LIVE_GRAPHS[slug]) return LIVE_GRAPHS[slug];
  // Format backend : "root~realtime~socket~04-fan-out" → "fan-out".
  // On retire les segments séparés par `~` et le préfixe numérique optionnel.
  const m = /(?:^|~)(?:\d+[-_])?([a-z][\w-]*)$/.exec(slug);
  if (m) return LIVE_GRAPHS[m[1]];
  return undefined;
}
