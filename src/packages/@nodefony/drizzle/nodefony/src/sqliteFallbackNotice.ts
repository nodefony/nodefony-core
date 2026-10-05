import type { IBootNotice } from "nodefony";

/**
 * Le point d'attention « base en repli SQLite » du bilan de démarrage.
 *
 * Un repli qui ne se dit pas est indiscernable d'une configuration qui a
 * pris : on croirait parler à la base qu'on a en tête. Le journal l'écrit
 * déjà ; le bilan le remonte EN HAUT, avec le geste qui le lève.
 *
 * @param connector - nom du connecteur replié (`default`).
 * @param location - fichier de la base, RELATIF au projet (ou `:memory:`).
 * @returns le point à déclarer.
 */
export function sqliteFallbackNotice(
  connector: string,
  location: string,
): IBootNotice {
  return {
    code: "DB_SQLITE_FALLBACK",
    level: "warning",
    message:
      `Base « ${connector} » en repli SQLite (${location}) — ` +
      "NF_DATABASE_URL absente, aucun `dialect` écrit",
    fix: "NF_DATABASE_URL=postgres://… dans .env",
  };
}
