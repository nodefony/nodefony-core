// `import type` du contrat (CORE) → effacé à la compilation : 0 dépendance
// runtime vers `@nodefony/framework` (où vivent le data plane admin + `@Idempotent`
// qui CONSOMMENT ce store). Le contrat vit au CORE exprès pour ça → mongoose
// (hors du graphe de framework) l'implémente sans cycle.
import type {
  IIdempotencyKeyEntry,
  IIdempotencyListQuery,
  IIdempotencyStore,
  IdempotencyOutcome,
  IdempotentResponse,
  IPage,
} from "nodefony";
import { assertPageQuery, escapeRegExp } from "nodefony";
import type { Connection, Model } from "mongoose";
import type { MongooseOrm } from "./orm-core/index";
import {
  IDEMPOTENCY_ENTITY_NAME,
  type IdempotencyKeyRow,
} from "../entity/idempotencyEntity";

/** Modèle Mongoose à document libre (boundary — comme `MongooseRepository`). */
type LooseModel = Model<Record<string, unknown>>;

/** Bail par défaut d'une entrée *in-flight* : 60 s (au-delà = exécution abandonnée). */
const DEFAULT_LEASE_MS = 60_000;

/** Rétention par défaut d'une réponse mémorisée : 10 min (rejeu plausible). */
const DEFAULT_TTL_MS = 600_000;

/** Code d'erreur MongoDB d'une violation de contrainte d'unicité. */
const DUPLICATE_KEY = 11_000;

/**
 * L'erreur est-elle une violation d'unicité MongoDB (`E11000`) ?
 *
 * C'est le **verdict de la réservation**, pas un incident : sur ce store, une
 * violation d'unicité signifie « la clé était vivante, quelqu'un d'autre la
 * détient ». Toute autre erreur (réseau, autorisation) doit remonter — la
 * confondre avec une contention ferait passer une panne pour une dédup.
 */
function isDuplicateKeyError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { code?: unknown }).code === DUPLICATE_KEY
  );
}

/**
 * Store d'idempotence **Mongoose** (NoSQL) — implémentation documentaire d'
 * {@link IIdempotencyStore} (contrat au CORE) pour dédoublonner les mutations
 * rejouées PARTAGÉ cross-pod, là où le store mémoire par défaut reste affine à
 * un pod. Pendant documentaire de `DrizzleIdempotencyStore`.
 *
 * **Pourquoi MongoDB plutôt que Redis** : un cluster qui possède déjà une base
 * Mongo mais pas de Redis obtient la dédup cross-pod sans nouvelle infra — le
 * même argument qui fonde la variante SQL.
 *
 * **Réservation atomique (`begin`)** — clé de voûte. Un `findOneAndUpdate`
 * filtré sur l'entrée MORTE, en `upsert`, est l'équivalent Mongo du `SET … NX
 * PX` Redis et du `INSERT … ON CONFLICT … WHERE expiré` SQL, en **une seule
 * instruction atomique** côté serveur :
 *  - clé absente → le filtre ne matche rien → l'`upsert` insère → `fresh` ;
 *  - clé présente mais **morte** (bail/rétention expirés) → le filtre matche →
 *    l'update la **vole** atomiquement → `fresh` ;
 *  - clé présente et **vivante** → le filtre ne matche pas → l'`upsert` tente
 *    d'insérer → violation d'unicité sur `_id` (`E11000`) → on lit l'état
 *    (`in-flight` / `replayed` / `mismatch`).
 *
 * C'est la **clé primaire** qui porte cette unicité, jamais un index secondaire :
 * Mongoose construit ses index en tâche de fond, donc la contrainte n'existerait
 * pas pendant la fenêtre de construction, et deux `begin` concurrents
 * renverraient tous deux `fresh` — exactement le double-effet que ce store
 * existe pour empêcher.
 *
 * Le store ne renvoie JAMAIS `fresh` sur le chemin de contention → anti
 * double-effet garanti (l'invariant capital d'un store d'idempotence).
 *
 * **Pas de TTL natif** (≠ Redis `PX`, et un index TTL Mongo ignorerait la
 * bascule bail → rétention) → un {@link MongooseIdempotencyStore.gc} applicatif
 * purge les entrées expirées, comme la variante SQL.
 *
 * **Empreinte préservée à la complétion** : `complete()` ne touche pas le champ
 * `fingerprint` → un rejeu de la clé avec un AUTRE payload après complétion est
 * toujours détecté (`mismatch` 422, draft §2.7).
 *
 * **Résolution LAZY + dégradation gracieuse** (calqué sur le frère SQL) : le
 * modèle est résolu à CHAQUE appel, jamais capturé à la construction — le
 * framework fabrique ce store à `onKernelBoot`, AVANT le connect de l'ORM
 * (`onBoot`), et l'ORM se déconnecte au shutdown avant le drain des serveurs. Si
 * l'ORM n'est pas connecté, `begin` renvoie `fresh` (la mutation s'exécute SANS
 * dédup) et `complete`/`abort`/`gc` sont des no-op — l'idempotence est
 * temporairement inactive plutôt que de crasher une mutation en vol.
 */
export class MongooseIdempotencyStore implements IIdempotencyStore {
  readonly #resolveModel: () => LooseModel | null;
  readonly #now: () => number;
  readonly #leaseMs: number;
  readonly #ttlMs: number;
  /** Compteur LOCAL best-effort des réservations faites par CE pod (cf {@link size}). */
  #pending = 0;

  /**
   * @param resolveModel - résolveur **lazy** du modèle Mongoose (`null` = ORM non
   *   connecté → dégradation gracieuse). Lazy car l'ordre de boot/shutdown n'est
   *   pas garanti à la construction.
   * @param now - horloge (epoch ms) injectable pour des tests déterministes.
   * @param leaseMs - bail d'une entrée *in-flight* (ms).
   * @param ttlMs - rétention d'une réponse mémorisée (ms).
   * @param connector - connecteur ORM qui porte la collection, publié au registre des stores.
   */
  constructor(
    resolveModel: () => LooseModel | null,
    now: () => number = Date.now,
    leaseMs: number = DEFAULT_LEASE_MS,
    ttlMs: number = DEFAULT_TTL_MS,
    connector?: string,
  ) {
    this.#connector = connector;
    this.#resolveModel = resolveModel;
    this.#now = now;
    this.#leaseMs = leaseMs;
    this.#ttlMs = ttlMs;
  }

  /** Connecteur ORM qui porte ce store — reçu du constructeur. */
  readonly #connector: string | undefined;

  /**
   * Connecteur ORM qui porte ce store, lu par `readStoreConnector` pour le
   * registre des stores : la console rattache la brique à SON connecteur au
   * lieu de le déduire. `undefined` pour un store construit sans ORM (bancs).
   */
  get connector(): string | undefined {
    return this.#connector;
  }

  /**
   * Construit le store depuis un {@link MongooseOrm}. Le modèle est résolu
   * **lazy** (gardé par `isConnected()` → `null` tant que l'ORM n'est pas/plus
   * connecté). L'entité (`registerIdempotencyEntities`) doit avoir été
   * enregistrée **avant** `orm.connect()` (le modèle est compilé au connect).
   *
   * @param orm - ORM Mongoose hébergeant la collection `idempotency_key`.
   * @param now - horloge injectable (tests).
   * @param leaseMs - bail *in-flight* (ms).
   * @param ttlMs - rétention d'une réponse mémorisée (ms).
   */
  static from(
    orm: MongooseOrm,
    now?: () => number,
    leaseMs?: number,
    ttlMs?: number,
  ): MongooseIdempotencyStore {
    return new MongooseIdempotencyStore(
      () => {
        if (!orm.isConnected()) {
          return null;
        }
        const connection = orm.getNativeConnection<Connection>();
        return connection.model<Record<string, unknown>>(
          IDEMPOTENCY_ENTITY_NAME,
        );
      },
      now,
      leaseMs,
      ttlMs,
      orm.name,
    );
  }

  /**
   * Approximation **per-pod, best-effort** : compteur local des réservations
   * faites par CE pod (incrémenté au `fresh`, décrémenté au `complete`/`abort`),
   * non décrémenté si le bail expire sans complétion, et désaligné cross-pod. La
   * vérité cluster passe par un `countDocuments`, jamais ce getter (sync). Borné à ≥ 0.
   */
  get size(): number {
    return this.#pending < 0 ? 0 : this.#pending;
  }

  async begin(key: string, fingerprint: string): Promise<IdempotencyOutcome> {
    const model = this.#resolveModel();
    if (!model) {
      // ORM non connecté (boot/shutdown) → fail-soft : exécuter sans dédup.
      return { state: "fresh" };
    }
    const now = this.#now();
    const leaseExpiresAt = now + this.#leaseMs;
    let reserved: boolean;
    try {
      // Réservation ATOMIQUE. Le filtre ne matche QUE l'entrée MORTE ; en
      // `upsert`, Mongo insère quand rien ne matche — et la contrainte d'unicité
      // de `_id` transforme la course en `E11000` pour le perdant. `_id` est
      // repris du filtre (égalité), `expiresAt: {$lt}` ne l'est pas.
      await model
        .findOneAndUpdate(
          { _id: key, expiresAt: { $lt: now } },
          {
            $set: {
              key,
              fingerprint,
              state: "if",
              response: null,
              expiresAt: leaseExpiresAt,
            },
          },
          { upsert: true, returnDocument: "after" },
        )
        .exec();
      reserved = true;
    } catch (error) {
      if (!isDuplicateKeyError(error)) {
        throw error; // panne réelle — ne JAMAIS la confondre avec une contention.
      }
      reserved = false;
    }
    if (reserved) {
      this.#pending++;
      return { state: "fresh" };
    }
    // Contention : la clé était VIVANTE à l'instant de l'upsert → lire son état.
    const existing = (await model
      .findById(key)
      .lean()
      .exec()) as IdempotencyKeyRow | null;
    if (existing === null) {
      // Course rare : la clé a expiré et été purgée entre l'upsert et la
      // lecture. Prudence anti double-effet : on ne renvoie JAMAIS `fresh` hors
      // réservation atomique → `in-flight` (le client rejouera, et le prochain
      // `begin` réservera proprement la clé désormais libre).
      return { state: "in-flight" };
    }
    // Même clé vivante : le payload DOIT être identique (draft §2.2/§2.7).
    if (existing.fingerprint !== fingerprint) {
      return { state: "mismatch" };
    }
    if (existing.state === "done" && existing.response !== null) {
      return { state: "replayed", response: existing.response };
    }
    return { state: "in-flight" };
  }

  async complete(key: string, response: IdempotentResponse): Promise<void> {
    const model = this.#resolveModel();
    if (!model) {
      return; // ORM non connecté → no-op (cf dégradation gracieuse).
    }
    // Mise à jour conditionnelle atomique : ne mémorise QUE sur une entrée
    // encore `in-flight` → jamais ressusciter une clé LIBÉRÉE (`abort`) ni
    // écraser une réponse déjà mémorisée. `fingerprint` non touché = empreinte
    // préservée (mismatch 422 d'un rejeu avec un autre payload après complétion).
    //
    // ⚠️ Ce que cette garde NE couvre pas, et qu'aucun backend ne couvre : une
    // clé dont le bail a expiré et qu'un AUTRE pod a volée est, elle aussi,
    // `in-flight` — un handler figé qui se réveille y écrira donc sa réponse.
    // `complete` ne reçoit aucun jeton de réservation, il n'a rien pour les
    // distinguer. Comportement IDENTIQUE en mémoire et en SQL : la parité prime,
    // car sinon un `@Idempotent` changerait de sémantique avec son backend.
    const result = await model
      .updateOne(
        { _id: key, state: "if" },
        {
          $set: {
            state: "done",
            response,
            expiresAt: this.#now() + this.#ttlMs,
          },
        },
      )
      .exec();
    if ((result.modifiedCount ?? 0) > 0) {
      this.#dec();
    }
  }

  async abort(key: string): Promise<void> {
    const model = this.#resolveModel();
    if (!model) {
      return; // ORM non connecté → no-op (cf dégradation gracieuse).
    }
    // Libère une clé in-flight dont l'exécution a échoué (rien n'est mémorisé →
    // l'appel pourra être réessayé). `state:"if"` garde la suppression sûre :
    // jamais d'effacement d'une réponse déjà mémorisée (`done`) par une autre
    // exécution.
    const result = await model.deleteOne({ _id: key, state: "if" }).exec();
    if ((result.deletedCount ?? 0) > 0) {
      this.#dec();
    }
  }

  /**
   * Purge les entrées mortes (`expiresAt <= now`) — supplée l'absence de TTL
   * exploitable ici (cf le schéma : l'échéance bascule du bail à la rétention).
   * À déclencher périodiquement (le framework arme un `GcScheduler` au boot
   * quand cette méthode existe).
   *
   * @param now - horloge de purge (défaut : horloge injectée).
   * @returns le nombre d'entrées supprimées.
   */
  async gc(now: number = this.#now()): Promise<number> {
    const model = this.#resolveModel();
    if (!model) {
      return 0; // ORM non connecté → rien à purger.
    }
    const result = await model.deleteMany({ expiresAt: { $lte: now } }).exec();
    return result.deletedCount ?? 0;
  }

  /**
   * {@inheritDoc IIdempotencyStore.listPage}
   *
   * Query native projetée : on ne lit QUE les champs exposés — la réponse
   * mémorisée (`response`) ne quitte jamais la base par ce chemin, quelle que
   * soit la taille de la page (anti-IDOR sur le cache).
   *
   * Les entrées expirées sont exclues (`expiresAt > now`) : le GC applicatif
   * passe plus tard, mais une clé échue n'est déjà plus opposable.
   *
   * ⚠️ **Le préfixe `q` est ÉCHAPPÉ**, donc littéral. Une chaîne saisie dans une
   * console n'est pas une expression régulière : laisser passer les
   * métacaractères ouvrirait un balayage de collection arbitraire — et pire, une
   * catastrophe de retour sur trace. L'écart avec le frère SQL (où `%` et `_`
   * restent des jokers) est assumé dans ce sens : ici le contrat — « `q` =
   * préfixe » — est tenu au pied de la lettre.
   */
  async listPage(
    query: IIdempotencyListQuery,
  ): Promise<IPage<IIdempotencyKeyEntry>> {
    assertPageQuery(query, "offset");
    const limit = Math.max(1, Math.floor(query.limit));
    const offset = Math.max(0, Math.floor(query.offset ?? 0));
    const model = this.#resolveModel();
    if (!model) {
      // ORM non connecté → page vide honnête (même dégradation que `gc`).
      return { items: [], total: 0, limit, offset, hasNext: false };
    }
    // Une clé échue n'est plus opposable → elle ne fait pas partie du parc
    // vivant, même si le GC applicatif n'est pas encore passé.
    const filter: Record<string, unknown> = {
      expiresAt: { $gt: this.#now() },
    };
    if (query.state !== undefined) {
      filter.state = query.state === "in-flight" ? "if" : "done";
    }
    if (query.q !== undefined && query.q.length > 0) {
      filter._id = { $regex: `^${escapeRegExp(query.q)}` };
    }
    // `limit + 1` → `hasNext` sans dépendre du total (mode tranche possible).
    const docs = (await model
      .find(filter, { _id: 1, state: 1, expiresAt: 1 })
      .sort({ expiresAt: 1, _id: 1 })
      .skip(offset)
      .limit(limit + 1)
      .lean()
      .exec()) as unknown as Array<{
      _id: string;
      state: string;
      expiresAt: number;
    }>;
    const hasNext = docs.length > limit;
    const page = hasNext ? docs.slice(0, limit) : docs;
    const total =
      query.withTotal === false
        ? undefined
        : await model.countDocuments(filter).exec();
    return {
      items: page.map((doc) => ({
        key: doc._id,
        state: doc.state === "if" ? ("in-flight" as const) : ("done" as const),
        expiresAtMs: doc.expiresAt,
        // `state === "done"` ⇒ une réponse est mémorisée. On ne la lit pas.
        hasResponse: doc.state !== "if",
      })),
      total,
      limit,
      offset,
      hasNext,
    };
  }

  /** Décrémente le compteur local borné à 0. */
  #dec(): void {
    if (this.#pending > 0) {
      this.#pending--;
    }
  }
}
