/**
 * Interfaces publiques du data plane de documentation.
 *
 * Contrat exposé par `/nodefony/documentation/api/*` et consommé par le front
 * Studio (et, demain, par un générateur de site statique ou le RAG P12). Le
 * module est **headless** : il produit ces shapes, il ne rend aucun HTML.
 */

/** Persona métier ciblée par une page (RBAC P6 — aujourd'hui filtre de vue). */
export type DocAudience = "developer" | "devops" | "supervisor" | "admin";

/** Statut de maturité d'une page (issu du frontmatter `status`). */
export type DocStatus =
  "stable" | "draft" | "temporary" | "experimental" | "deprecated";

/** Une persona décrite dans l'index (clé + libellé + description courte). */
export interface IDocAudienceInfo {
  key: DocAudience;
  label: string;
  desc: string;
}

/** Entrée d'une page dans l'arbre (métadonnées seules, sans le markdown). */
export interface IDocPageRef {
  /** Identifiant URL-safe unique (sert de clé d'allowlist anti-traversée). */
  slug: string;
  /** Titre lisible (frontmatter `title`, sinon dérivé du nom de fichier). */
  title: string;
  /**
   * Libellé COURT pour la navigation (frontmatter `navTitle`, repli sur
   * {@link title}). Le menu est une colonne étroite, le titre est écrit pour être
   * lu en tête d'article : sans ce champ, l'arbre affiche des phrases et la
   * recherche ne trouve pas le mot qu'on VOIT à l'écran.
   */
  navTitle: string;
  /** Personas autorisées (frontmatter `audience`). Vide = toutes. */
  audience: DocAudience[];
  /** Version de la page (frontmatter `version`, ou `"doc"`). */
  version?: string;
  /** Statut de maturité (frontmatter `status`). */
  status?: DocStatus;
  /** `true` si la page est annoncée mais pas encore rédigée. */
  wip?: boolean;
  /**
   * `true` si la page est le **hub** de sa section (`index.md`) : son point
   * d'entrée, à présenter en premier et non comme une page parmi les autres.
   */
  isHub?: boolean;
}

/** Une section de l'index transverse : un groupe ordonné de pages. */
export interface IDocSection {
  /** Identifiant stable de la section (URL-safe). */
  id: string;
  /** Libellé affiché. */
  label: string;
  /** Module propriétaire (`@nodefony/x`) si la section vient d'un module. */
  module?: string;
  /** Pages de la section. */
  pages: IDocPageRef[];
}

/** Index transverse complet renvoyé par `GET …/api/tree`. */
export interface IDocTree {
  /** Date ISO de génération de l'index (cache invalidé après TTL). */
  generatedAt: string;
  /** Personas connues (pour le sélecteur de vue / RBAC). */
  audiences: IDocAudienceInfo[];
  /** Sections de l'index. */
  sections: IDocSection[];
}

/** Contenu complet d'une page renvoyé par `GET …/api/page/{slug}`. */
export interface IDocPage {
  slug: string;
  title: string;
  version?: string;
  status?: DocStatus;
  /** Date de dernière modif (frontmatter `updated` ou dernier commit git). */
  updated?: string;
  /** Chemin source relatif au repo (pour traçabilité). */
  source?: string;
  /** URL « Modifier sur GitHub » assemblée serveur (jamais de chemin FS). */
  sourceUrl?: string;
  /** Markdown SANS le bloc frontmatter, variables `{{ }}` résolues. */
  markdown: string;
}

/**
 * Fournisseur d'une variable dynamique `{{ name }}` résolue côté serveur.
 *
 * Doit retourner une valeur **sûre** (publique, dérivée) : version, compteur,
 * nom de symbole — JAMAIS un secret ni un chemin FS absolu. Synchrone par
 * design (résolution dans le hot path froid de lecture d'une page).
 */
export type DocVarProvider = () => string;

/** Service public du module documentation (consommé par le controller). */
export interface IDocumentationService {
  /** Construit (ou sert depuis le cache) l'index transverse des docs. */
  getTree(): Promise<IDocTree>;
  /**
   * Charge une page par slug (validé contre l'allowlist du scan), résout son
   * frontmatter et ses variables `{{ }}`.
   *
   * @throws DocNotFoundError si le slug est inconnu
   * @throws DocUnsafeSlugError si le slug est rejeté par la garde de sécurité
   */
  getPage(slug: string): Promise<IDocPage>;

  /**
   * Cherche dans les titres ET le corps des pages, et rend des extraits situés.
   *
   * @param query - la saisie brute ; les termes d'un caractère sont ignorés.
   * @param limit - nombre maximal de pages rendues (défaut 20).
   */
  search(query: string, limit?: number): Promise<IDocSearchResult>;
  /** Enregistre un fournisseur de variable `{{ name }}` (résolution serveur). */
  registerVar(name: string, provider: DocVarProvider): void;
  /** Invalide le cache de l'index (force un rescan au prochain `getTree`). */
  invalidate(): void;
}

/** Un extrait de texte où les termes cherchés apparaissent. */
export interface IDocSearchExcerpt {
  /** Le titre de section (`##`) sous lequel l'extrait a été trouvé, s'il y en a un. */
  section?: string;
  /** Le texte de l'extrait, borné — les termes y sont encadrés par `\u0000`. */
  text: string;
}

/** Une page retenue par la recherche. */
export interface IDocSearchHit {
  slug: string;
  title: string;
  navTitle: string;
  /** Libellé de la section d'arbre qui porte la page (« Guides », « Cœur »…). */
  sectionLabel: string;
  /** Extraits, dans l'ordre du document — bornés. */
  excerpts: IDocSearchExcerpt[];
  /** Occurrences TOTALES dans la page ; les extraits, eux, sont bornés. */
  occurrences: number;
  /** Pertinence décroissante : un terme dans le titre pèse plus que dans le corps. */
  score: number;
}

/** Réponse de `/documentation/api/search`. */
export interface IDocSearchResult {
  /** La requête telle que reçue. */
  query: string;
  /** Les termes effectivement cherchés (pliés, vides retirés). */
  terms: string[];
  /** Pages lues pour répondre — dit ce que la recherche a réellement balayé. */
  scanned: number;
  /** Pages retenues AVANT bornage — un total de 40 avec 20 rendus se dit. */
  matched: number;
  hits: IDocSearchHit[];
}
