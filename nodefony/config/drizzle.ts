/**
 * ORM SQL — les connecteurs Drizzle de l'application, DÉCLARÉS.
 *
 * Fragment du manifeste : `nodefony.config.ts` l'importe et le passe à
 * `use("@nodefony/drizzle", …)`. Rien ne charge ce fichier tout seul.
 *
 * 🔴 Déclarer n'est pas une formalité : tout ce qui lit la configuration SANS
 * démarrer l'application — `nodefony create entity`, la page « Créer » de la
 * console, `orm:migrate`, `nodefony doctor` — ne connaît que ce qui est écrit
 * ici. Un connecteur ouvert dans le code d'un module leur restait invisible,
 * et le générateur écrivait sur un `default` deviné.
 *
 * Forme lue par le générateur : `nom: { … }` sans accolade imbriquée.
 *
 * @module
 */
import type { ConfigContext } from "nodefony";
import type { IDrizzleConfigInput } from "@nodefony/drizzle";
import type { env } from "../../env";

/**
 * La configuration de `@nodefony/drizzle` pour cette application.
 *
 * - `default` : la base applicative — fichier sqlite local, ou la base que
 *   déclare `NF_DATABASE_URL` (l'infrastructure gagne sur ce fragment).
 * - `mediasoup` : la base EN MÉMOIRE du module de banc `@nodefony/mediasoup`,
 *   hors production seulement — comme le module (`policy: "dev"`). Ouverte en
 *   production, elle servirait un module qui n'y est pas chargé.
 *
 * 🔴 `ddl: "auto"` n'est pas décoratif sur `mediasoup`. Cette application
 * versionne des migrations : sans mode écrit, TOUT connecteur bascule en
 * `migrate`, et la base du banc réclamait les migrations du framework et de
 * l'application — pas les siennes — sans jamais créer ses tables. La bascule
 * protège une base DURABLE de deux fabricants de schéma qui divergent ; une
 * base `:memory:` repart vide à chaque démarrage, ils ne s'y rencontrent pas.
 */
export const drizzleConfig = (ctx: ConfigContext<typeof env>) =>
  ({
    connectors: {
      default: {},
      ...(ctx.isProd
        ? {}
        : {
            mediasoup: {
              dialect: "sqlite",
              filename: ":memory:",
              ddl: "auto",
            },
          }),
    },
  }) satisfies IDrizzleConfigInput;
