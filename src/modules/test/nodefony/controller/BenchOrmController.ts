import { Controller, controller, Get } from "@nodefony/framework";
import { Context } from "@nodefony/http";
import { ormRegistry } from "@nodefony/orm-core";
import type { IRepository } from "@nodefony/orm-core";
import { BENCH_ORM_CONNECTOR, BENCH_READ_USER } from "../entity/benchOrm";

/** Séquence process-local des écritures du banc (mono prod — pas de cluster). */
let writeSeq = 0;

/** Repository du banc (connector `default`) — throw si le décor n'est pas monté. */
function repo(name: string): IRepository<Record<string, unknown>> {
  const r = ormRegistry
    .get(BENCH_ORM_CONNECTOR)
    ?.getRepository<Record<string, unknown>>(name);
  if (!r) {
    throw new Error(`bench-orm : repository ${name} indisponible`);
  }
  return r;
}

/**
 * Banc du cycle ORM (opt-in `NF_BENCH_ORM=1`, monté par l'index du module) —
 * traverse la couche framework complète (repository orm-core → Drizzle →
 * better-sqlite3) sur le corpus Dolibarr seedé, JAMAIS le driver nu : c'est le
 * chemin framework qu'on profile.
 *
 * Routes toutes en GET : `wrk` sans script Lua — moins de pièces dans le
 * harnais de mesure. La route n'existe que le temps d'un banc.
 */
@controller("/nodefony/test/bench-orm")
class BenchOrmController extends Controller {
  constructor(context: Context) {
    super("BenchOrmController", context);
  }

  /** Lecture réaliste : 20 factures d'un user (`WHERE fk_user_author = ?`), rows entières. */
  @Get("/read")
  async read() {
    const rows = await repo("llx_facture").find(
      { fk_user_author: BENCH_READ_USER },
      { limit: 20 },
    );
    return this.renderJson({ n: rows.length, rows });
  }

  /**
   * Même lecture, réponse réduite au compte — la soustraction `/read` −
   * `/read-lean` isole le coût de sérialisation JSON des 20 rows.
   */
  @Get("/read-lean")
  async readLean() {
    const rows = await repo("llx_facture").find(
      { fk_user_author: BENCH_READ_USER },
      { limit: 20 },
    );
    return this.renderJson({ n: rows.length });
  }

  /** Écriture : INSERT d'une facture avec FK user + societe (ref `BENCH-<seq>`). */
  @Get("/write")
  async write() {
    const seq = ++writeSeq;
    const row = await repo("llx_facture").create({
      ref: `BENCH-${seq}`,
      fk_soc: (seq % 200) + 1,
      fk_user_author: (seq % 50) + 1,
      total_ht: 100,
      total_ttc: 120,
    });
    return this.renderJson({
      seq,
      rowid: (row as { rowid?: number }).rowid ?? null,
    });
  }

  /** Vide les écritures du banc (`BENCH-%`) — à appeler AVANT chaque run d'écriture. */
  @Get("/reset")
  async reset() {
    const deleted = await repo("llx_facture").delete({
      ref: { $like: "BENCH-%" },
    });
    writeSeq = 0;
    return this.renderJson({ deleted });
  }

  /** Comptes du décor — la preuve `cible valide` d'un banc AVANT de mesurer. */
  @Get("/status")
  async status() {
    const [users, societes, factures, writes] = await Promise.all([
      repo("llx_user").count(),
      repo("llx_societe").count(),
      repo("llx_facture").count(),
      repo("llx_facture").count({ ref: { $like: "BENCH-%" } }),
    ]);
    return this.renderJson({ users, societes, factures, writes });
  }
}

/**
 * Même lecture DERRIÈRE le firewall : le préfixe `/nodefony/test/secure` tombe
 * dans la zone `test-secure` (session BFF) → mesure le cycle utilisateur
 * COMPLET (reprise de session + requête entité) sur une seule route.
 */
@controller("/nodefony/test/secure/bench-orm")
class SecureBenchOrmController extends Controller {
  constructor(context: Context) {
    super("SecureBenchOrmController", context);
  }

  /** Cycle complet : session (firewall) + SELECT 20 factures du user du banc. */
  @Get("/read")
  async read() {
    const rows = await repo("llx_facture").find(
      { fk_user_author: BENCH_READ_USER },
      { limit: 20 },
    );
    return this.renderJson({ n: rows.length, rows });
  }
}

export { SecureBenchOrmController };
export default BenchOrmController;
