import { z } from "zod";

/**
 * @nodefony/ai — CONFIGURATION DU MODULE (schéma Zod = source unique).
 *
 * ⭐ TL;DR : CE SCHÉMA EST LA CONFIG. Chaque `.default(...)` est la valeur d'usine ;
 * changer un défaut du module = ÉDITER ICI (et nulle part ailleurs). L'app, elle,
 * ne surcharge que ses écarts, via `use("@nodefony/ai", { … })`.
 *
 * RÈGLE D'OR (ADR-0006) : ce fichier porte le schéma commenté (type + validation +
 * défaut + doc) ET matérialise les défauts par `parse({})`. Le builder
 * (`defineAiConfig`) importe le schéma d'ici et ne retape aucune valeur —
 * un défaut écrit à deux endroits finit toujours par diverger.
 *
 * SURCHARGE (précédence croissante) :
 *   • défauts du schéma (ce fichier) ;
 *   • app : `use("@nodefony/ai", { … })` dans `nodefony.config.ts` ;
 *   • déploiement : un NOM COURT, si le champ en déclare un — `.meta({ env: "NF_AI_HOTE" })`
 *     sur le champ suffit : le Kernel l'applique, `nodefony env` et `.env.example`
 *     le montrent. C'est le contrat de PRODUCTION (nom stable, documenté) ;
 *   • banc, dépannage : `NF__AI__<CHEMIN>=valeur` (override générique, `__` = niveau).
 *
 * Le schéma reste **PUR** : aucune lecture de `process.env`, aucun accès au kernel
 * (il est évalué à l'import — le kernel n'existe pas encore).
 *
 * Champ sensible (clé, mot de passe) → `.meta({ secret: true })` EN DERNIER de la
 * chaîne : chaque méthode zod clone, une `.default()` posée après `.meta()` perdrait
 * la métadonnée. Ces flags ressortent dans le JSON Schema lu par Studio.
 */
/**
 * ⚠️ `strictObject`, et non `object` : une clé INCONNUE doit être REFUSÉE, pas
 * retirée en silence. C'est le défaut par défaut de Zod, et il coûte cher —
 * `use("@nodefony/ai", { gretting: "…" })` produisait une application qui
 * démarre en IGNORANT ce que l'utilisateur a écrit, sans un mot. Le typage du
 * registre `NodefonyModuleConfig` attrape la faute de frappe à la COMPILATION ;
 * ceci l'attrape au DÉMARRAGE, pour tout ce qui contourne le compilateur — une
 * config chargée d'un fichier, un `as never`, un override d'environnement.
 */
export const aiConfigSchema = z.strictObject({
  /** Interrupteur du module — l'app peut le charger sans l'activer. */
  enabled: z
    .boolean()
    .default(true)
    .describe("Active les fonctionnalités du module ai"),

  /** Exemple : à remplacer par la vraie config du module. */
  greeting: z
    .string()
    .min(1)
    .default("Bonjour de ai")
    .describe("Message renvoyé par le service (exemple de champ configurable)"),
});

/** Config telle que l'APP l'écrit dans `use()` — tous les champs optionnels. */
export type IAiConfigInput = z.input<typeof aiConfigSchema>;

/** Config telle que le CODE la lit — défauts appliqués, rien d'optionnel. */
export type IAiConfig = z.output<typeof aiConfigSchema>;

/** Défauts matérialisés (passés au `super()` du Module). */
const defaults: IAiConfig = aiConfigSchema.parse({});

export default defaults;
