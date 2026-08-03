import type { IPageQuery } from "nodefony";

/**
 * **Le vocabulaire de tri des utilisateurs** — source unique, en noms publics.
 *
 * Il existe parce que cette liste était écrite DEUX fois, et qu'elle avait déjà
 * divergé : l'adapter SQL autorisait `id`, l'adapter Mongo non. Un `?order=id`
 * triait donc en base SQL et se faisait ignorer en base Mongo, sans erreur ni
 * trace — le genre d'écart qui ne se voit qu'en production, sur l'installation
 * d'un tiers.
 *
 * Chaque store la consomme au lieu de la recopier ; ceux qui **concatènent** le
 * nom dans une requête (SQL) continuent de filtrer avec, en défense en
 * profondeur — mais ils filtrent alors sur la même liste que tout le monde.
 */
export const USER_SORTABLE_FIELDS = [
  "identifier",
  "enabled",
  "createdAt",
  "updatedAt",
  "id",
] as const;

/**
 * Sous-ensemble réellement triable par l'annuaire **en mémoire**.
 *
 * `BaseUser` ne porte ni `createdAt` ni `updatedAt` — ce sont des colonnes des
 * schémas persistants, pas des attributs du modèle. Déclarer le vocabulaire
 * complet ici reviendrait à annoncer un tri que le store ne peut pas rendre :
 * la page sortirait dans un ordre arbitraire, sans erreur, et personne ne le
 * verrait. La capacité réduite est donc ANNONCÉE, pas simulée — même doctrine
 * que le store de sessions Redis, qui ne déclare aucun tri du tout.
 *
 * Ce que cela donne à l'usage : `?order=createdAt` trie sur une base SQL ou
 * Mongo, et rend **400** sur le backend mémoire. Un refus explicite vaut mieux
 * qu'un ordre inventé.
 */
export const USER_SORTABLE_FIELDS_IN_MEMORY = [
  "identifier",
  "enabled",
  "id",
] as const;

/**
 * Socle garanti par **tous** les backends d'utilisateurs. C'est ce sur quoi une
 * interface peut compter sans savoir quelle base est branchée.
 */
export const USER_SORTABLE_FIELDS_COMMON = USER_SORTABLE_FIELDS_IN_MEMORY;

/**
 * Ordre appliqué quand le client n'en demande aucun : par identifiant croissant
 * — le seul champ toujours présent et unique, donc le seul qui rende une
 * pagination offset déterministe sans départage supplémentaire.
 */
export const USER_DEFAULT_ORDER: NonNullable<IPageQuery["order"]> = [
  ["identifier", "ASC"],
];
