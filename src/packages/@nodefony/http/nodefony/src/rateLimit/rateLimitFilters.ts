import type { IFilterSpec } from "nodefony";

/**
 * **Le vocabulaire de filtre du registre de rate-limit**, en noms PUBLICS —
 * celui que la console écrit dans l'URL (`?limited=true`).
 *
 * `limited` répond à la seule question qu'on pose à ce registre en exploitation :
 * « qui est au plafond en ce moment ? ». Il est booléen STRICT — `?limited=1`
 * est refusé plutôt que lu comme `false`, ce que faisait la comparaison
 * `limitedRaw === "true"` : sur un tableau de bord d'incident, une liste vide
 * obtenue par erreur de syntaxe se lit « aucun client bloqué ».
 *
 * `q` n'y figure pas : c'est une clé du contrat de page, lue par
 * `parsePageQuery`. Le data plane la recopiait à la main — deuxième lecteur du
 * même paramètre, exactement le motif que ce chantier supprime.
 */
export const RATE_LIMIT_FILTERS = {
  /** `true` = seulement les clés au plafond, `false` = seulement les autres. */
  limited: "boolean",
} as const satisfies IFilterSpec;
