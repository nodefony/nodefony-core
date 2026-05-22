import path from "path";
import { Nodefony, Kernel } from "nodefony";

/**
 * Surcharge app du module `@nodefony/sequelize`.
 *
 * Un seul endroit pour CHOISIR le moteur du connecteur `sequelize` : éditer
 * `dialect` (+ params de connexion). L'entité (`orm: "sequelize"`) ne connaît que
 * le NOM du connecteur — le driver vit ici. `describeConnection` n'expose JAMAIS
 * les credentials (dialectes serveur = `host:port/base`, password rédacté).
 */
const config = {
  connectors: {
    sequelize: {
      dialect: "sqlite",
      logging: false,
      storage: path.resolve(
        (Nodefony.getKernel() as Kernel).path,
        "nodefony",
        "databases",
        "nodefony-sequelize.db",
      ),
    },
    // Pour basculer en serveur, remplacer le bloc ci-dessus :
    // sequelize: {
    //   dialect: "mysql",      // ou "postgres"
    //   host: "localhost",
    //   port: 3306,            // 5432 pour postgres
    //   database: "nodefony",
    //   username: "root",
    //   password: "nodefony",  // rédacté dans le dashboard
    //   logging: false,
    // },
  },
};

export default config;
