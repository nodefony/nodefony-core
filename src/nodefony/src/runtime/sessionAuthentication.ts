/**
 * Quand et comment une session a été ouverte (ADR-0015, décision 7) — le
 * CONTRAT des métadonnées de session, partagé par qui les écrit
 * (`@nodefony/security`, à chaque ouverture) et qui les lit (garde
 * d'authentification récente, console des sessions). Au cœur parce que ces
 * paquets ne s'importent pas entre eux. Fichier sans import : isomorphe.
 */

/** Clé de métadonnée : heure de l'authentification (millisecondes epoch). */
export const SESSION_AUTH_AT_KEY = "authAt";

/** Clé de métadonnée : méthodes d'authentification utilisées (RFC 8176). */
export const SESSION_AMR_KEY = "amr";

/** Comment une session a été authentifiée. */
export interface ISessionAuthentication {
  /** Heure de l'authentification, en millisecondes epoch. */
  readonly at: number;
  /** Méthodes utilisées (RFC 8176) ; vide quand un fournisseur a authentifié. */
  readonly amr: readonly string[];
}

/** Vue minimale d'une session : ses métadonnées. */
interface IMetaBagReader {
  getMetaBag(key: string): unknown;
}

/**
 * Lit quand et comment une session a été ouverte.
 *
 * @param session - la session (ou `null`)
 * @returns l'authentification, ou `null` si la session n'en porte pas — une
 *   session ouverte avant que ces clés existent, ou des métadonnées altérées
 */
export function readSessionAuthentication(
  session: IMetaBagReader | null | undefined,
): ISessionAuthentication | null {
  if (!session) return null;
  const at = session.getMetaBag(SESSION_AUTH_AT_KEY);
  const amr = session.getMetaBag(SESSION_AMR_KEY);
  if (typeof at !== "number" || !Number.isFinite(at)) return null;
  if (!Array.isArray(amr)) return null;
  const methods: string[] = [];
  for (const m of amr) {
    if (typeof m !== "string") return null;
    methods.push(m);
  }
  return { at, amr: methods };
}
