import { randomUUID } from "node:crypto";
import { Controller, controller, Get, Param, Post } from "@nodefony/framework";
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
  async traceQueries() {
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

  // ── Sonde de PERSISTANCE (banc e2e système) ───────────────────────────────
  //
  // Ce que ces trois routes existent pour prouver, et que rien d'autre ne
  // prouvait : qu'une donnée ÉCRITE par une requête HTTP, à travers le pipeline
  // entier et le repository ORM, SURVIT à l'arrêt et au redémarrage du process.
  // Les suites ORM éprouvent un connecteur isolé ; le banc e2e éprouve un
  // serveur sans base. Aucun des deux ne franchit la frontière du cycle de vie
  // du pod — c'est le « ORM Docker persistant » que le tableau de migration
  // déclare manquant.
  //
  // Ce qu'elles NE prouvent PAS : la justesse du mapping ORM (442 tests s'en
  // chargent) ni les performances. Elles prouvent un chemin, pas une couche.
  //
  // L'entité employée est `User` — déjà déclarée, sa table déjà créée au
  // `connect()`. Une entité de sonde dédiée aurait exigé d'ouvrir le `colKit`
  // de `@nodefony/drizzle` à la surface publique : trop cher pour un banc.

  /** Préfixe des identifiants de sonde — le nettoyage s'y accroche. */
  static readonly PROBE_PREFIX = "nf-persist-probe:";

  /**
   * Écrit une ligne portant `key`, à travers le repository ORM réel.
   *
   * @param key - clé de la sonde, fournie par le banc (unique par passe).
   * @returns `{ written: true, id }` — l'id sert d'empreinte : le banc vérifie
   *   après redémarrage que c'est bien la MÊME ligne qui revient, et non une
   *   ligne recréée par un décor complaisant.
   */
  @Post("/persist/{key}")
  async persistWrite(@Param("key") key: string) {
    const repo = ormRegistry
      .get("default")
      ?.getRepository<{ id: string }>("User");
    if (!repo) {
      return this.renderJson(
        { written: false, reason: "orm-indisponible" },
        503,
      );
    }
    const id = randomUUID();
    await repo.create({
      id,
      identifier: `${DbController.PROBE_PREFIX}${key}`,
      password: null,
      roles: [],
      enabled: false,
      locked: false,
    } as Partial<{ id: string }>);
    this.log(`Sonde de persistance écrite — ${key} (${id})`, "INFO", "DB-DEMO");
    return this.renderJson({ written: true, id });
  }

  /**
   * Relit la ligne portant `key`. Appelée par le banc APRÈS redémarrage.
   *
   * @param key - la même clé qu'à l'écriture.
   * @returns `{ found, id }` — `found: false` est une réponse VALIDE (200) :
   *   c'est le banc qui décide si l'absence est un échec, pas le serveur.
   */
  @Get("/persist/{key}")
  async persistRead(@Param("key") key: string) {
    const repo = ormRegistry
      .get("default")
      ?.getRepository<{ id: string }>("User");
    if (!repo) {
      return this.renderJson({ found: false, reason: "orm-indisponible" }, 503);
    }
    const rows = await repo.find({
      identifier: `${DbController.PROBE_PREFIX}${key}`,
    } as never);
    const first = rows[0] as { id?: string } | undefined;
    return this.renderJson({ found: rows.length > 0, id: first?.id ?? null });
  }

  /**
   * Ouvre une transaction, écrit, puis ÉCHOUE volontairement.
   *
   * Le banc vérifie ensuite par {@link persistRead} que rien n'a été laissé :
   * une transaction qui ne défait pas son travail est une corruption silencieuse,
   * et c'est le seul défaut de cette famille qu'un test unitaire sur connecteur
   * isolé ne voit pas passer la frontière HTTP.
   *
   * @param key - clé de la sonde, qui ne doit JAMAIS apparaître en base.
   * @returns toujours `{ rolledBack: true }` — l'échec est le comportement attendu.
   */
  @Post("/persist/{key}/rollback")
  async persistRollback(@Param("key") key: string) {
    const orm = ormRegistry.get("default");
    if (!orm) {
      return this.renderJson(
        { rolledBack: false, reason: "orm-indisponible" },
        503,
      );
    }
    try {
      await orm.transaction(async (tx) => {
        const repo = orm
          .getRepository<{ id: string }>("User")
          .withTransaction(tx);
        await repo.create({
          id: randomUUID(),
          identifier: `${DbController.PROBE_PREFIX}${key}`,
          password: null,
          roles: [],
          enabled: false,
          locked: false,
        } as Partial<{ id: string }>);
        throw new Error("échec volontaire — la transaction doit être annulée");
      });
      // Atteint seulement si la transaction n'a PAS propagé l'erreur : c'est un
      // défaut du contrat, pas un succès.
      return this.renderJson(
        { rolledBack: false, reason: "erreur-avalee" },
        500,
      );
    } catch {
      this.log(`Sonde de rollback jouée — ${key}`, "INFO", "DB-DEMO");
      return this.renderJson({ rolledBack: true });
    }
  }
}

export default DbController;
