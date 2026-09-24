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
 *   🔴 PAS sur une infra MongoDB : les stores y vivent sur `nodefony`
 *   (Mongoose), et un `default` ÉCRIT ici est pris pour une demande — Drizzle
 *   ouvrait alors un SQLite local où le schéma du framework se déclarait en
 *   double, sans que personne ne s'en serve. Non écrit, Drizzle le retire de
 *   lui-même (`defineDrizzleConfig`).
 * - `mediasoup` : la base EN MÉMOIRE du module de banc `@nodefony/mediasoup`,
 *   ouverte exactement quand le module est chargé (`ctx.devModules`, le verdict
 *   du gating `policy: "dev"`, dérogation comprise). `isProd` ignorait la
 *   dérogation : module chargé en production, connecteur absent, entités
 *   orphelines.
 *
 * `mediasoup` n'écrit aucun `ddl` : c'est un connecteur SECONDAIRE, les
 * migrations du dépôt (framework et application) appartiennent à `default`
 * seul. En développement son schéma est donc dérivé du code (`auto`), même
 * quand l'application versionne des migrations.
 */
export const drizzleConfig = (ctx: ConfigContext<typeof env>) =>
  ({
    connectors: {
      ...(ctx.infra.database?.family === "mongo" ? {} : { default: {} }),
      ...(ctx.devModules !== true
        ? {}
        : {
            mediasoup: {
              dialect: "sqlite",
              filename: ":memory:",
            },
          }),
    },
  }) satisfies IDrizzleConfigInput;
