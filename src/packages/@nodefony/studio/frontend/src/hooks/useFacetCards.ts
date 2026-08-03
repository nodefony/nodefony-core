import { useCallback, useMemo } from "react";

import { isFacetActive, toggleFacet } from "../components/ui";
import type { AdminPageCapabilities } from "../stores/AdminStore";

/** Ce qu'il faut passer à une `<StatCard>` pour la rendre cliquable. */
export interface FacetCardProps {
  /** Applique/retire le filtre de la facette. Absent = carte non cliquable. */
  onClick?: () => void;
  /** La sélection décrite par la carte est-elle active ? */
  active?: boolean;
  /** Ce que le clic fera, en clair (lecteur d'écran + infobulle). */
  actionLabel?: string;
}

/**
 * Rend les cartes de tête d'un écran CLIQUABLES à partir des facettes que le
 * serveur publie.
 *
 * Le mapping « carte → filtre » n'est pas écrit ici : il vient de l'endpoint de
 * comptage (`IAdminPageCapabilities.facets`), donc **le clic pose exactement le
 * filtre qui a produit le nombre affiché**. Le redéclarer dans chaque écran
 * aurait divergé au premier changement de définition — « utilisable » vaut
 * « sans échéance OU échéance à venir », une règle du vocabulaire de la
 * ressource, pas de la vue.
 *
 * Une carte dont la facette n'est pas publiée reste un simple nombre : c'est le
 * cas de « Administrateurs » (le rôle est une valeur de configuration) et de
 * « Utilisateurs distincts » (une agrégation, pas un `COUNT` filtré). Mieux
 * vaut une carte inerte qu'un clic qui filtrerait autre chose que l'annoncé.
 *
 * @param caps - capacités de l'endpoint de COMPTAGE (`<ressource>/stats`).
 * @param filters - filtres actifs de la vue.
 * @param onFiltersChange - poseur de filtres de la vue (le même que la barre).
 * @returns `facetCard(nom, libellé)` → les props à étaler sur la `<StatCard>`.
 *
 * @example
 * ```tsx
 * const facetCard = useFacetCards(statsCaps, filters, setFilters);
 * <StatCard label="Actifs" {...facetCard("active", "les comptes actifs")}>
 *   {fmtFacet(counts.active)}
 * </StatCard>
 * ```
 */
export function useFacetCards(
  caps: AdminPageCapabilities | null,
  filters: Record<string, string>,
  onFiltersChange: (next: Record<string, string>) => void,
): (name: string, what: string) => FacetCardProps {
  const facets = useMemo(() => caps?.facets ?? {}, [caps?.facets]);

  return useCallback(
    (name: string, what: string): FacetCardProps => {
      const criteria = facets[name];
      // Facette non publiée (ou catalogue pas encore chargé) → carte inerte.
      if (!criteria) return {};
      const active = isFacetActive(filters, criteria);
      return {
        active,
        actionLabel: active
          ? `Retirer le filtre : ${what}`
          : `Filtrer sur ${what}`,
        onClick: () => onFiltersChange(toggleFacet(filters, criteria, facets)),
      };
    },
    [facets, filters, onFiltersChange],
  );
}
