import { Body, Controller, controller, Get, Post } from "@nodefony/framework";
import { Context } from "@nodefony/http";
import { ormRegistry } from "@nodefony/orm-core";
import type { IRepository } from "@nodefony/orm-core";
import { BENCH_ORM_CONNECTOR, BENCH_READ_USER } from "../entity/benchOrm";

/** Séquence process-local des écritures du banc (mono prod — pas de cluster). */
let writeSeq = 0;

/** Repository du banc (connector `default`) — throw si le décor n'est pas monté. */
function repo(name: string): IRepository<Record<string, unknown>> {
  // `get()` lève lui-même, en nommant le connecteur absent.
  return ormRegistry
    .get(BENCH_ORM_CONNECTOR)
    .getRepository<Record<string, unknown>>(name);
}

/**
 * Valide le corps de `/read-write-valid` — mêmes règles et mêmes messages que
 * `class-validator` chez le camp NestJS du banc (#507).
 *
 * @param body - corps JSON reçu
 * @returns la liste des violations, vide si le corps est valide
 */
function validateInvoice(body: unknown): string[] {
  const errors: string[] = [];
  const b = (typeof body === "object" && body !== null ? body : {}) as Record<
    string,
    unknown
  >;
  const ht = b["total_ht"];
  const ttc = b["total_ttc"];
  const ref = b["ref"];
  const htOk = typeof ht === "number" && Number.isFinite(ht);
  if (!htOk) {
    errors.push(
      "total_ht must be a number conforming to the specified constraints",
    );
  }
  if (!(typeof ht === "number" && ht >= 0)) {
    errors.push("total_ht must not be less than 0");
  }
  if (!(typeof ttc === "number" && Number.isFinite(ttc))) {
    errors.push(
      "total_ttc must be a number conforming to the specified constraints",
    );
  }
  if (!(typeof ttc === "number" && htOk && ttc >= ht)) {
    errors.push("total_ttc must be greater than or equal to total_ht");
  }
  if (ref !== undefined && ref !== null) {
    if (typeof ref !== "string") errors.push("ref must be a string");
    if (!(typeof ref === "string" && ref.length <= 30)) {
      errors.push("ref must be shorter than or equal to 30 characters");
    }
  }
  return errors;
}

/**
 * Banc du cycle ORM (opt-in `NF_BENCH_ORM=1`, monté par l'index du module) —
 * traverse la couche framework complète (repository orm-core → Drizzle →
 * better-sqlite3) sur le corpus Dolibarr seedé, JAMAIS le driver nu : c'est le
 * chemin framework qu'on profile.
 *
 * Routes en GET (`wrk` sans script Lua — moins de pièces dans le harnais),
 * sauf `/read-write-body`, dont le corps EST l'objet de la mesure. La route
 * n'existe que le temps d'un banc.
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

  /**
   * Le cas APPLICATIF : une lecture **et** une écriture dans la même requête.
   *
   * Pourquoi cette route existe à côté de `/read` et `/write`. Prises isolément,
   * ces deux-là mesurent chacune un mécanisme ; aucune ne ressemble à ce que fait
   * un logiciel réel, qui lit un état puis l'écrit. C'est pourtant sur CE profil
   * que la part du framework dans le budget d'une requête devient lisible : sur
   * une route triviale, le framework est 100 % du coût ; dès qu'une base entre
   * dans la boucle, il en devient une fraction, et c'est la fraction qui informe
   * un lecteur qui choisit une pile.
   *
   * 🔴 L'écriture est un `UPDATE` de la ligne LUE, jamais un `INSERT`, et c'est
   * une contrainte de PROTOCOLE avant d'être un choix de réalisme. À quelques
   * milliers de requêtes par seconde, un insert ferait grossir la table d'un
   * ordre de grandeur pendant la mesure elle-même : les derniers runs d'une série
   * ne mesureraient plus la même base que les premiers, et deux séries ne se
   * compareraient plus. Le cas « création » reste couvert par `/write`, qui a son
   * `/reset`.
   *
   * L'écriture dépend de la lecture — on met à jour la ligne qu'on vient de lire.
   * Sans ce lien, un moteur pourrait paralléliser les deux et l'on ne mesurerait
   * plus une séquence applicative mais deux requêtes concurrentes.
   */
  @Get("/read-write")
  async readWrite() {
    const rows = await repo("llx_facture").find(
      { fk_user_author: BENCH_READ_USER },
      { limit: 20 },
    );
    const seq = ++writeSeq;
    const target = rows[0] as { rowid?: number } | undefined;
    const maj = target?.rowid
      ? await repo("llx_facture").updateOne(
          { rowid: target.rowid },
          { total_ht: 100 + (seq % 100), total_ttc: 120 + (seq % 100) },
        )
      : null;
    return this.renderJson({
      lus: rows.length,
      seq,
      maj: maj ? 1 : 0,
    });
  }

  /**
   * Le cas APPLICATIF avec un CORPS : `/read-write`, mais les valeurs écrites
   * arrivent dans un JSON posté (`{ total_ht, total_ttc }`).
   *
   * Pourquoi une route à part plutôt que la même en POST : un GET ne traverse
   * jamais la lecture du corps, étape asynchrone par nature (le flux de la
   * requête), qui est aussi celle où le pipeline retrouve ses Promises. C'est ce
   * chemin — le plus fréquent d'une application qui écrit — que cette route
   * mesure. Même lecture, même `UPDATE` de la ligne lue que `/read-write` ; seule
   * l'origine des valeurs change. Miroir exact : `express-fair-sqlite`.
   */
  @Post("/read-write-body")
  async readWriteBody(
    @Body() body?: { total_ht?: number; total_ttc?: number },
  ) {
    const rows = await repo("llx_facture").find(
      { fk_user_author: BENCH_READ_USER },
      { limit: 20 },
    );
    const seq = ++writeSeq;
    const target = rows[0] as { rowid?: number } | undefined;
    const maj = target?.rowid
      ? await repo("llx_facture").updateOne(
          { rowid: target.rowid },
          {
            total_ht: (body?.total_ht ?? 100) + (seq % 100),
            total_ttc: (body?.total_ttc ?? 120) + (seq % 100),
          },
        )
      : null;
    return this.renderJson({
      lus: rows.length,
      seq,
      maj: maj ? 1 : 0,
    });
  }

  /**
   * Le POST RÉALISTE : `/read-write-body`, mais le corps est VALIDÉ, et un corps
   * invalide rend **422** sans toucher à la base (#507).
   *
   * Règles, identiques dans les trois camps du banc (`express-fair-sqlite`,
   * `nest-fair-sqlite` par `ValidationPipe`) : `total_ht` nombre ≥ 0, `total_ttc`
   * nombre ≥ `total_ht`, `ref` facultatif, chaîne de 30 caractères au plus. Le
   * corps d'erreur prend la forme que rend NestJS (`statusCode`, `error`,
   * `message[]`) : trois formes différentes feraient sérialiser des volumes
   * différents, et l'écart mesuré serait celui du format.
   *
   * La validation est écrite à la main : Nodefony n'a pas de validation
   * déclarative du corps, et c'est ce qu'un utilisateur écrirait aujourd'hui.
   */
  @Post("/read-write-valid")
  async readWriteValid(@Body() body?: unknown) {
    const errors = validateInvoice(body);
    if (errors.length > 0) {
      return this.renderJson(
        {
          statusCode: 422,
          error: "Unprocessable Entity",
          message: errors,
        },
        422,
      );
    }
    const valid = body as { total_ht: number; total_ttc: number };
    const rows = await repo("llx_facture").find(
      { fk_user_author: BENCH_READ_USER },
      { limit: 20 },
    );
    const seq = ++writeSeq;
    const target = rows[0] as { rowid?: number } | undefined;
    const maj = target?.rowid
      ? await repo("llx_facture").updateOne(
          { rowid: target.rowid },
          {
            total_ht: valid.total_ht + (seq % 100),
            total_ttc: valid.total_ttc + (seq % 100),
          },
        )
      : null;
    return this.renderJson({
      lus: rows.length,
      seq,
      maj: maj ? 1 : 0,
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
    const [users, companies, invoices, writes] = await Promise.all([
      repo("llx_user").count(),
      repo("llx_societe").count(),
      repo("llx_facture").count(),
      repo("llx_facture").count({ ref: { $like: "BENCH-%" } }),
    ]);
    return this.renderJson({ users, companies, invoices, writes });
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
