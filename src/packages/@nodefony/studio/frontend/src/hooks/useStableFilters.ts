import { useMemo } from "react";

/**
 * Filtres d'une liste serveur, rendus STABLES par leur valeur.
 *
 * Le parent recrée l'objet `filters` à chaque rendu ; un chargeur qui en
 * dépendait se rechargeait donc sans raison, et celui qui dépendait de sa
 * seule signature lisait un objet qui n'était PAS dans ses dépendances —
 * juste par chance du même contenu. Ici l'objet rendu est reconstruit DEPUIS
 * la signature : ce que le chargeur lit est exactement ce qui le relance.
 *
 * @param filters - les filtres courants (JSON pur : clés et valeurs texte).
 * @returns `signal`, la signature (repasse la grille en page 1 quand elle
 *   change), et `filters`, un objet dont l'identité ne change qu'avec elle.
 */
export function useStableFilters(filters: Record<string, string>): {
  signal: string;
  filters: Record<string, string>;
} {
  const signal = JSON.stringify(filters);
  const stable = useMemo(
    () => JSON.parse(signal) as Record<string, string>,
    [signal],
  );
  return { signal, filters: stable };
}
