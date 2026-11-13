import path from "node:path";
import { z } from "zod";
import { resolveInfra, sqliteFilenameFromUrl } from "nodefony";
import { demoSecurity } from "./security";
import { PAYLOAD_LIMIT } from "../../frontend/src/binary/binaryDemo";

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
// #region binary-config
/**
 * Temps réel binaire : deux réglages que la démo pose sur d'AUTRES modules,
 * pour toute l'application.
 */
const binaryOverrides = {
  // Le serveur sait parler CBOR. Le codec se NÉGOCIE par connexion : une page
  // qui ne l'offre pas (le chat) reste en texte, et reçoit ses octets sous
  // `{"$bytes":"…"}`, relus en `Uint8Array`.
  "module-realtime": { codec: "cbor" },
  // Un message ENTRANT plafonne à 1 Mio par défaut (fermeture 1009 au-delà) :
  // relevé à 2 Mio, sur les deux serveurs WebSocket (ws et wss).
  "module-http": {
    websocket: { maxPayload: PAYLOAD_LIMIT },
    websocketSecure: { maxPayload: PAYLOAD_LIMIT },
  },
};
// #endregion

// #region demo-module-security
export default {
  ...defaults,
  // La zone de la démo rejoint le firewall de l'application.
  "module-security": demoSecurity,
  ...binaryOverrides,
};
// #endregion

// #region demo-connector
/** Le connecteur des salons du chat : une base SQLite à la démo, jamais celle de l'application. */
export const DEMO_CONNECTOR = "demo";

/**
 * Le connecteur `demo` que la démo ajoute à `@nodefony/drizzle` : une base
 * SQLite à elle, quelle que soit celle de l'application. Un ORM porte
 * plusieurs connecteurs, et deux ORM cohabitent : une application MongoDB
 * charge Drizzle pour la seule démo, sans connecteur `default` (Drizzle ne
 * le crée pas quand la base déclarée est d'une autre famille).
 *
 * Où vit le fichier : à côté de la base de l'application quand elle est en
 * SQLite — sous `var/databases/` en développement, à côté de la base jetable
 * d'un test. Sinon `var/databases/nodefony-demo.db`, et en mémoire sous
 * `NODE_ENV=test` : un test ne touche jamais la base du poste. `ddl: "auto"`
 * est ÉCRIT : un module de développement n'a pas de migration, son schéma se
 * dérive au démarrage (doc `@nodefony/drizzle/docs/migrations.md`).
 *
 * @param env - l'environnement du processus (`process.env`)
 * @returns la clé `module-drizzle` à fusionner dans la config du module
 */
export function demoDrizzleOverride(
  env: NodeJS.ProcessEnv,
): Record<string, unknown> {
  const database = resolveInfra(env).database;
  const appFile =
    database?.dialect === "sqlite" ? sqliteFilenameFromUrl(database.url) : null;
  const filename =
    appFile === ":memory:" || (appFile === null && env.NODE_ENV === "test")
      ? { filename: ":memory:" }
      : appFile === null
        ? {}
        : { filename: path.join(path.dirname(appFile), "nodefony-demo.db") };
  return {
    "module-drizzle": {
      connectors: {
        [DEMO_CONNECTOR]: { dialect: "sqlite", ddl: "auto", ...filename },
      },
    },
  };
}
// #endregion
