<% if (it.mongo) { %>/**
 * ORM MongoDB — les connecteurs Mongoose de l'application, DÉCLARÉS.
 *
 * Fragment du manifeste : `nodefony.config.ts` l'importe et le passe à
 * `use("@nodefony/mongoose", …)`. Rien ne charge ce fichier tout seul.
 *
 * 🔴 Déclarer n'est pas une formalité : tout ce qui lit la configuration SANS
 * démarrer l'application — `nodefony doctor`, les outils d'un agent — ne
 * connaît que les connecteurs écrits ici.
 *
 * @module
 */
import type { IMongooseConfigInput } from "@nodefony/mongoose";

/**
 * La configuration de `@nodefony/mongoose` pour cette application.
 *
 * `nodefony` : la base de l'application. Son adresse vient de
 * `NF_DATABASE_URL` (`mongodb://…`), que le module applique à ce connecteur.
 */
export const mongooseConfig = () =>
  ({
    connectors: {
      nodefony: {},
    },
  }) satisfies IMongooseConfigInput;
<% } %>