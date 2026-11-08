import { z } from "zod";
import { demoSecurity } from "./security";

/**
 * <%= it.pkgName %> — CONFIGURATION DE LA DÉMO (schéma Zod = source unique).
 *
 * Même règle que tout module : chaque `.default(...)` est la valeur d'usine,
 * l'application ne surcharge que ses écarts par `use("<%= it.pkgName %>", { … })`,
 * et le déploiement passe par un NOM COURT déclaré sur le champ
 * (`.meta({ env })`), que le Kernel applique et que `nodefony env` montre.
 *
 * `strictObject` : une clé inconnue arrête le démarrage en la nommant, au lieu
 * d'être retirée sans un mot.
 */
export const demoConfigSchema = z.strictObject({
  // #region partner-config
  /**
   * Secret du client machine `<%= it.appName %>-machine` du realm Keycloak —
   * celui qui obtient un jeton par `client_credentials` pour
   * `nodefony demo:partner:call --issuer keycloak`.
   *
   * `.meta()` EN DERNIER : chaque méthode zod clone, et une méthode posée
   * après perdrait la métadonnée.
   */
  machineSecret: z
    .string()
    .min(1)
    .optional()
    .describe(
      "Secret du client machine Keycloak de la démo (flux client_credentials de demo:partner:call)",
    )
    .meta({ env: "NF_KEYCLOAK_MACHINE_SECRET", secret: true }),
  // #endregion
});

/** Config telle que l'APP l'écrit dans `use()` — tous les champs optionnels. */
export type IDemoConfigInput = z.input<typeof demoConfigSchema>;

/** Config telle que le CODE la lit — défauts appliqués. */
export type IDemoConfig = z.output<typeof demoConfigSchema>;

/** Défauts matérialisés. */
const defaults: IDemoConfig = demoConfigSchema.parse({});

/**
 * Config passée au `super()` du module : les défauts, plus la zone que la
 * démo apporte à `@nodefony/security` (`./security.ts`). Le Kernel consomme
 * la clé `module-security` avant de valider la config de la démo, qui ne la
 * voit donc jamais.
 */
// #region demo-module-security
export default {
  ...defaults,
  // La zone de la démo rejoint le firewall de l'application.
  "module-security": demoSecurity,
};
// #endregion
