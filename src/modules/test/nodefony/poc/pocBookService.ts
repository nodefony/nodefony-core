/**
 * POC « API souveraine » — Phase 1 — ÉCHAFAUDAGE JETABLE.
 *
 * La « logique métier » écrite **une seule fois** : un service trivial en mémoire.
 * Le but du POC n'est PAS le CRUD ici, mais de prouver qu'une action qui appelle
 * cette logique est joignable par plusieurs transports (REST + WebSocket) **sans
 * être réécrite**. À supprimer après la revue (Phase 6) si la thèse est validée.
 *
 * Pas de Service DI ni d'ORM volontairement (Phase 1 = minimal) : un objet
 * module-level suffit à prouver la convergence de ROUTAGE. Le vrai
 * `AbstractCrudService` arrive en Phase 2.
 */
export interface PocBook {
  id: string;
  title: string;
  authorId: string;
}

const BOOKS: readonly PocBook[] = [
  { id: "b1", title: "Dune", authorId: "42" },
  { id: "b2", title: "Hyperion", authorId: "42" },
  { id: "b3", title: "Neuromancer", authorId: "7" },
];

/** Logique métier unique — aucune notion de transport ici. */
export const pocBookService = {
  byAuthor(authorId: string): PocBook[] {
    return BOOKS.filter((b) => b.authorId === authorId);
  },
};

/**
 * Forme `IResourceService<PocBook>` (V4.2) — prouve que le contrat STRUCTUREL
 * du `ResourceController` accepte un simple objet en mémoire (pas d'ORM, pas
 * de `Service` DI). Read-only volontaire : pas de `create`/`updateOne`/`delete`
 * → les helpers d'écriture du `ResourceController` répondent 501.
 */
export const pocBookResourceService = {
  find(criteria?: Record<string, unknown>): PocBook[] {
    if (criteria?.authorId !== undefined) {
      return BOOKS.filter((b) => b.authorId === String(criteria.authorId));
    }
    return [...BOOKS];
  },
  findById(id: string): PocBook | null {
    return BOOKS.find((b) => b.id === id) ?? null;
  },
};
