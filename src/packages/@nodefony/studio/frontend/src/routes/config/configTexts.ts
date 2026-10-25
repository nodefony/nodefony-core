/**
 * Textes « pour les nuls » de la page Configuration — PUR (0 JSX).
 *
 * Rassemblés ici pour qu'une seule relecture suffise à les garder justes : la
 * page, ses onglets et l'aide de chaque réglage parlent la même langue. Les
 * nombres ne sont JAMAIS écrits ici : ils viennent des données, à l'affichage.
 */
import type { ConfigSource } from "../../components/ui";

/** Une phrase en tête de page ; le reste vit dans sa bulle ⓘ ({@link PAGE_INTRO}). */
export const PAGE_LEAD =
  "Chaque réglage a une valeur d'usine. nodefony.config.ts ou une variable d'environnement peuvent la changer — cherche-le, ou regarde le coup d'œil.";

/** Intro complète de la page (bulle ⓘ). */
export const PAGE_INTRO =
  "La configuration, c'est le tableau de bord de ton application : chaque réglage a une valeur d'usine (le défaut). " +
  "Tu peux la changer dans le fichier nodefony.config.ts, ou sans toucher au code par une variable d'environnement — c'est elle qui a le dernier mot. " +
  "Ici, tu vois pour chaque réglage la valeur qui s'applique vraiment, et qui l'a posée.";

/** Invite du champ de recherche. */
export const SEARCH_PLACEHOLDER =
  "Chercher un réglage : port, session, redis, durée, NF_…";

/** Intro de chaque onglet. */
export const TAB_INTRO = {
  modules:
    "Chaque module (serveur HTTP, sécurité, base de données…) a ses propres réglages, comme chaque appareil a son mode d'emploi. " +
    "Une boîte par module : combien de réglages tu as changés, et un clic pour tout voir.",
  core:
    "Le noyau, c'est le châssis : le domaine et les ports d'écoute, les journaux, la liste ordonnée des modules chargés. " +
    "Ces réglages s'écrivent à la racine de nodefony.config.ts, directement dans defineConfig({ … }).",
  overrides:
    "Ce qui diffère de la valeur d'usine. C'est l'identité de ce déploiement : si l'application se comporte autrement que prévu, " +
    "c'est presque toujours une ligne de cette liste. La colonne « Surchargé par » dit qui a changé la valeur.",
} as const;

/** D'où vient la valeur effective, dit simplement. */
export const SOURCE_TEXT: Record<ConfigSource, string> = {
  default: "la valeur d'usine — personne ne l'a changée",
  module: "posée par le module lui-même",
  app: "posée dans nodefony.config.ts",
  env: "posée par une variable d'environnement, qui l'emporte sur le fichier",
  runtime: "modifiée à chaud depuis cette console (perdue au redémarrage)",
};

const IDENT = /^[A-Za-z_$][\w$]*$/;

/**
 * Littéral d'objet imbriqué qui pose un réglage, à coller dans la config.
 *
 * @param key - chemin pointé (`jwt.accessTtlS`).
 * @returns `{ jwt: { accessTtlS: … } }` (clé citée si ce n'est pas un identifiant).
 * @example nestedLiteral("connectors.my-db.url") // { connectors: { "my-db": { url: … } } }
 */
export function nestedLiteral(key: string): string {
  return key
    .split(".")
    .reduceRight<string>(
      (inner, seg) =>
        `{ ${IDENT.test(seg) ? seg : JSON.stringify(seg)}: ${inner} }`,
      "…",
    );
}

/**
 * Ligne de code qui pose un réglage dans `nodefony.config.ts`.
 *
 * @param moduleName - nom du paquet du module (`@nodefony/security`).
 * @param key - chemin pointé du réglage.
 * @param isApp - réglage du noyau (racine de `defineConfig`) plutôt que d'un module.
 * @returns l'extrait à recopier.
 */
export function configSnippet(
  moduleName: string,
  key: string,
  isApp: boolean,
): string {
  const lit = nestedLiteral(key);
  return isApp ? `defineConfig(${lit})` : `use("${moduleName}", ${lit})`;
}
