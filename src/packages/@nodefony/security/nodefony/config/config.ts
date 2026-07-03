import { defineSecurityConfig } from "./defineSecurityConfig";

/**
 * ════════════════════════════════════════════════════════════════════════════
 *  @nodefony/security — DÉFAUTS DU MODULE (une seule source de vérité)
 * ════════════════════════════════════════════════════════════════════════════
 *
 * RÈGLE D'OR (ADR-0006) : les défauts vivent à UN seul endroit — le **schéma Zod
 * commenté** de `defineSecurityConfig.ts`. Ce fichier ne re-tape AUCUNE valeur :
 * il matérialise les défauts via `defineSecurityConfig()` (= parse d'un objet
 * vide → tous les `.default()` du schéma : Zero Trust, CORS strict, Studio OFF).
 *
 * (Historique : ce fichier dupliquait les valeurs du schéma → divergence vécue,
 *  ex. `timeCost` 3 (schéma) vs 2 (ici) vs 1 (commentaire). La duplication est
 *  supprimée — plus qu'une source possible.)
 *
 * OÙ LIRE les options, leurs défauts et leur doc :
 *   • `defineSecurityConfig.ts` — chaque champ porte `.describe()` (la référence) ;
 *   • `nodefony config:show` — la config résolue ;
 *   • Studio › onglet Configuration — formulaire auto-généré (`securityConfigJsonSchema()`).
 *
 * OÙ SURCHARGER (précédence croissante — cf ADR-0006) :
 *   • App (typé)         : `use("@nodefony/security", { … })` dans `nodefony.config.ts` ;
 *   • Par environnement  : la fonction `(ctx) => …` de `nodefony.config.ts` (`ctx.isProd`…) ;
 *   • Déploiement/Docker : `NF__SECURITY__<CHEMIN>=valeur` (override env générique) ;
 *   • Studio (à chaud)   : chaque section porte `enabled` → activable/désactivable.
 */
export default {
  // Tous les défauts proviennent du schéma Zod — JAMAIS re-tapés ici (ADR-0006 D1).
  ...defineSecurityConfig(),
};
