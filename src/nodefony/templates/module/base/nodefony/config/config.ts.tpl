import { z } from "zod";

/**
 * <%= it.pkgName %> — CONFIGURATION DU MODULE (schéma Zod = source unique).
 *
 * ⭐ TL;DR : CE SCHÉMA EST LA CONFIG. Chaque `.default(...)` est la valeur d'usine ;
 * changer un défaut du module = ÉDITER ICI (et nulle part ailleurs). L'app, elle,
 * ne surcharge que ses écarts, via `use("<%= it.pkgName %>", { … })`.
 *
 * RÈGLE D'OR (ADR-0006) : ce fichier porte le schéma commenté (type + validation +
 * défaut + doc) ET matérialise les défauts par `parse({})`. Le builder
 * (`define<%= it.pascal %>Config`) importe le schéma d'ici et ne retape aucune valeur —
 * un défaut écrit à deux endroits finit toujours par diverger.
 *
 * SURCHARGE (précédence croissante) :
 *   • défauts du schéma (ce fichier) ;
 *   • app : `use("<%= it.pkgName %>", { … })` dans `nodefony.config.ts` ;
 *   • déploiement : `NF__<%= it.upper %>__<CHEMIN>=valeur` (override env générique, `__` = niveau).
 *
 * Le schéma reste **PUR** : aucune lecture de `process.env`, aucun accès au kernel
 * (il est évalué à l'import — le kernel n'existe pas encore).
 *
 * Champ sensible (clé, mot de passe) → `.meta({ secret: true })` EN DERNIER de la
 * chaîne : chaque méthode zod clone, une `.default()` posée après `.meta()` perdrait
 * la métadonnée. Ces flags ressortent dans le JSON Schema lu par Studio.
 */
export const <%= it.camel %>ConfigSchema = z.object({
  /** Interrupteur du module — l'app peut le charger sans l'activer. */
  enabled: z
    .boolean()
    .default(true)
    .describe("Active les fonctionnalités du module <%= it.name %>"),

  /** Exemple : à remplacer par la vraie config du module. */
  greeting: z
    .string()
    .min(1)
    .default("Bonjour de <%= it.name %>")
    .describe("Message renvoyé par le service (exemple de champ configurable)"),
});

/** Config telle que l'APP l'écrit dans `use()` — tous les champs optionnels. */
export type <%= it.pascal %>ConfigInput = z.input<typeof <%= it.camel %>ConfigSchema>;

/** Config telle que le CODE la lit — défauts appliqués, rien d'optionnel. */
export type <%= it.pascal %>Config = z.output<typeof <%= it.camel %>ConfigSchema>;

/** Défauts matérialisés (passés au `super()` du Module). */
const defaults: <%= it.pascal %>Config = <%= it.camel %>ConfigSchema.parse({});

export default defaults;
