import { inject } from "vitest";

/**
 * URI Mongo partagée (provisionnée 1× par `tests/globalSetup.ts`) scopée sur une
 * base `db` dédiée au fichier appelant → isolation des collections entre bancs
 * sur le serveur unique partagé. `null` si l'infra est indisponible (le banc
 * appelant fait alors `describe.skipIf(!uri)`).
 *
 * @param db - nom de base de données propre au fichier (ex. le nom de l'ORM).
 * @returns l'URI complète `mongodb://…/<db>?<query>`, ou `null` si pas de serveur.
 */
export function mongoTestUri(db: string): string | null {
  const base = inject("mongoUri");
  if (!base) return null;
  // Insère la base AVANT la query string (`?replicaSet=…`) — `getUri()` la rend
  // sans nom de base (`mongodb://host/?replicaSet=rs`).
  const qi = base.indexOf("?");
  const path = qi === -1 ? base : base.slice(0, qi);
  const query = qi === -1 ? "" : base.slice(qi);
  const withSlash = path.endsWith("/") ? path : `${path}/`;
  return `${withSlash}${db}${query}`;
}
