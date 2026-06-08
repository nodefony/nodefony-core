import { Controller, controller, Get } from "@nodefony/framework";
import { Context } from "@nodefony/http";
import { ormRegistry } from "@nodefony/orm-core";

/**
 * Controller de **démonstration de la trace full-stack** du Log Backplane.
 *
 * Une requête sur `/nodefony/test/db/trace` émet plusieurs logs **corrélés par le
 * même `requestId`** (propagé par l'ALS `RequestContext` tout au long du pipeline) :
 *  1. les logs DEBUG du kernel (entrée de requête) ;
 *  2. les logs applicatifs de CE controller (`msgid: "DB-DEMO"`) ;
 *  3. les requêtes SQL réelles tracées par l'ORM (Drizzle `default`) ;
 *  4. la ligne récapitulative `req` de fin (désormais corrélée — fix teardown).
 *
 * → Dans l'onglet **Explorer** de la page Logs, coller ce `requestId` (ou cliquer
 * son badge) affiche TOUTE la chronologie de la requête, **appel base de données
 * inclus**. C'est la vitrine du différenciateur « suivre une requête de bout en bout ».
 */
@controller("/nodefony/test/db")
class DbController extends Controller {
  constructor(context: Context) {
    super("DbController", context);
  }

  /**
   * Exécute un comptage ORM réel (Drizzle `default`/User) en
   * loggant chaque étape → trace complète sous un seul `requestId`.
   */
  @Get("/trace")
  async trace() {
    const requestId = this.context?.requestId ?? "";
    this.log("Trace DB — début (comptage des entités)", "INFO", "DB-DEMO");

    // ── Drizzle (connecteur "default") : entité User ───────────────────────
    let users: number | null = null;
    try {
      const orm = ormRegistry.get("default");
      const repo = orm?.getRepository<unknown>("User");
      if (repo) {
        this.log(
          "SELECT count(*) FROM User (drizzle/default)",
          "DEBUG",
          "DB-DEMO",
        );
        users = await repo.count();
        this.log(`User : ${users} ligne(s)`, "INFO", "DB-DEMO");
      } else {
        this.log(
          "Repository User indisponible (orm default ?)",
          "WARNING",
          "DB-DEMO",
        );
      }
    } catch (e) {
      this.log(e as Error, "ERROR", "DB-DEMO", "comptage User échoué");
    }

    this.log("Trace DB — fin", "INFO", "DB-DEMO");
    return this.renderJson({ requestId, users });
  }
}

export default DbController;
