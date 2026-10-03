/**
 * Index Redis des sessions — compter sans balayer.
 *
 * Les sessions vivent sous `<préfixe>:<id>` avec un TTL natif : Redis les efface
 * seul, sans passer par notre code. Les compter exigeait donc un `SCAN` de tout
 * le keyspace, et le store renvoyait « inconnu » — la console affichait « — »,
 * et l'on parcourait une liste sans savoir combien elle comptait.
 *
 * L'index tient, pour chaque session, sa date d'EXPIRATION comme score :
 *
 * | Clé                         | Type | Contenu                                         |
 * | --------------------------- | ---- | ----------------------------------------------- |
 * | `<base>:all`                | ZSET | toutes les sessions → expiration (ms)           |
 * | `<base>:auth`               | ZSET | les sessions authentifiées                      |
 * | `<base>:u:<utilisateur>`    | ZSET | les sessions d'un utilisateur                   |
 * | `<base>:users`              | ZSET | utilisateur → expiration la plus tardive        |
 * | `<base>:owner`              | HASH | session → utilisateur (`""` = anonyme)          |
 * | `<base>:built`              | STR  | l'index couvre les sessions antérieures          |
 *
 * 🔴 **Une expiration n'a pas besoin d'être vue pour être comptée juste** : une
 * entrée dont le score est passé est simplement hors de `ZCOUNT (maintenant
 * +inf`. La purge ({@link SessionIndex.prune}) ne sert qu'à borner la mémoire.
 *
 * `<base>` = `<préfixe>~{idx}` : hors du motif `<préfixe>:*` que balaie le
 * listing (un `GET` sur un ZSET rendrait `WRONGTYPE`), sous la même cloison
 * d'application, et une seule étiquette de hachage — toutes les clés de l'index
 * dans le même slot si le déploiement passe un jour en Redis Cluster.
 *
 * Chaque mutation est UN script Lua (atomique, un aller-retour), lancé en même
 * temps que la commande de session : le chemin d'une requête ne paie pas un
 * aller-retour de plus.
 */

/** Ce que l'index demande au client : charger et exécuter un script. */
export interface IScriptClient {
  scriptLoad(script: string): Promise<string>;
  evalSha(
    sha: string,
    options: { keys: string[]; arguments: string[] },
  ): Promise<unknown>;
}

/** Une session vue par l'index : à qui elle est, et quand elle expire. */
export interface IIndexedSession {
  id: string;
  /** Propriétaire ; `""` pour une session anonyme. */
  user: string;
  /** Expiration, en millisecondes depuis l'époque. */
  expiresAt: number;
}

/** Ce que l'on compte — le même périmètre que le filtre de liste. */
export type IndexCount = "all" | "auth" | "users" | { user: string };

/** Taille d'un lot de purge : borne le temps d'un script, qui bloque Redis. */
export const PRUNE_BATCH = 500;

/**
 * Inscrit (ou réinscrit) une session. Gère le CHANGEMENT de propriétaire : la
 * session quitte l'index de l'ancien, dont l'expiration la plus tardive est
 * recalculée — sinon un utilisateur déconnecté resterait compté.
 */
const ADD = `
local b, id, user, exp = ARGV[1], ARGV[2], ARGV[3], ARGV[4]
local owner = b .. ':owner'
local old = redis.call('HGET', owner, id)
if old and old ~= user and old ~= '' then
  local uk = b .. ':u:' .. old
  redis.call('ZREM', uk, id)
  local top = redis.call('ZRANGE', uk, -1, -1, 'WITHSCORES')
  if #top == 0 then redis.call('ZREM', b .. ':users', old)
  else redis.call('ZADD', b .. ':users', top[2], old) end
end
redis.call('HSET', owner, id, user)
redis.call('ZADD', b .. ':all', exp, id)
if user ~= '' then
  redis.call('ZADD', b .. ':auth', exp, id)
  redis.call('ZADD', b .. ':u:' .. user, exp, id)
  redis.call('ZADD', b .. ':users', 'GT', exp, user)
else
  redis.call('ZREM', b .. ':auth', id)
end
return 1
`;

/** Prolonge une session DÉJÀ indexée ; rend 0 si elle ne l'est pas. */
const TOUCH = `
local b, id, exp = ARGV[1], ARGV[2], ARGV[3]
local user = redis.call('HGET', b .. ':owner', id)
if not user then return 0 end
redis.call('ZADD', b .. ':all', 'XX', exp, id)
if user ~= '' then
  redis.call('ZADD', b .. ':auth', 'XX', exp, id)
  redis.call('ZADD', b .. ':u:' .. user, 'XX', exp, id)
  redis.call('ZADD', b .. ':users', 'GT', exp, user)
end
return 1
`;

/** Retire une session détruite (révocation, déconnexion). */
const DROP = `
local b, id = ARGV[1], ARGV[2]
local owner = b .. ':owner'
local user = redis.call('HGET', owner, id)
redis.call('HDEL', owner, id)
redis.call('ZREM', b .. ':all', id)
redis.call('ZREM', b .. ':auth', id)
if user and user ~= '' then
  local uk = b .. ':u:' .. user
  redis.call('ZREM', uk, id)
  local top = redis.call('ZRANGE', uk, -1, -1, 'WITHSCORES')
  if #top == 0 then redis.call('ZREM', b .. ':users', user)
  else redis.call('ZADD', b .. ':users', top[2], user) end
end
return 1
`;

/**
 * Purge UN lot d'entrées expirées. Les utilisateurs n'ont pas besoin de
 * recalcul : le score d'un utilisateur est son expiration la plus TARDIVE, donc
 * il n'expire qu'avec sa dernière session.
 */
const PRUNE = `
local b, now, batch = ARGV[1], ARGV[2], tonumber(ARGV[3])
local ids = redis.call('ZRANGEBYSCORE', b .. ':all', '-inf', now, 'LIMIT', 0, batch)
for _, id in ipairs(ids) do
  local user = redis.call('HGET', b .. ':owner', id)
  redis.call('HDEL', b .. ':owner', id)
  if user and user ~= '' then redis.call('ZREM', b .. ':u:' .. user, id) end
end
if #ids > 0 then
  redis.call('ZREM', b .. ':all', unpack(ids))
  redis.call('ZREM', b .. ':auth', unpack(ids))
end
redis.call('ZREMRANGEBYSCORE', b .. ':users', '-inf', now)
return #ids
`;

/** Compte ce qui expire APRÈS `now` — l'expiré n'est jamais compté. */
const COUNT = `
local key, now = ARGV[1], ARGV[2]
return redis.call('ZCOUNT', key, '(' .. now, '+inf')
`;

/**
 * Index des sessions d'UN store (une cloison d'application).
 *
 * Il ne lève jamais vers le chemin d'une requête : un échec d'indexation est
 * rendu à l'appelant, qui le journalise et INVALIDE l'index ({@link invalidate})
 * — le prochain comptage le reconstruit plutôt que de rendre un chiffre faux.
 */
export class SessionIndex {
  /** Base des clés : `<préfixe>~{idx}`. */
  readonly base: string;
  readonly #shas = new Map<string, string>();

  constructor(prefix: string) {
    this.base = `${prefix}~{idx}`;
  }

  /** Clé du marqueur « l'index couvre les sessions antérieures ». */
  get builtKey(): string {
    return `${this.base}:built`;
  }

  /** Clé du verrou de reconstruction (un seul pod reconstruit). */
  get lockKey(): string {
    return `${this.base}:building`;
  }

  /** Inscrit ou réinscrit une session. */
  async add(client: IScriptClient, s: IIndexedSession): Promise<void> {
    await this.#run(client, "add", ADD, [
      this.base,
      s.id,
      s.user,
      String(s.expiresAt),
    ]);
  }

  /**
   * Prolonge une session indexée.
   *
   * @returns `false` si la session n'est pas dans l'index (antérieure à lui, ou
   *   écrite par une version qui ne l'alimentait pas) : à l'appelant de l'y
   *   inscrire, lui seul sait lire son propriétaire.
   */
  async touch(
    client: IScriptClient,
    id: string,
    expiresAt: number,
  ): Promise<boolean> {
    const res = await this.#run(client, "touch", TOUCH, [
      this.base,
      id,
      String(expiresAt),
    ]);
    return res === 1;
  }

  /** Retire une session détruite. */
  async drop(client: IScriptClient, id: string): Promise<void> {
    await this.#run(client, "drop", DROP, [this.base, id]);
  }

  /** Purge les entrées expirées, par lots — borne la mémoire de l'index. */
  async prune(client: IScriptClient, now: number): Promise<number> {
    let total = 0;
    for (;;) {
      const n = Number(
        await this.#run(client, "prune", PRUNE, [
          this.base,
          String(now),
          String(PRUNE_BATCH),
        ]),
      );
      total += n;
      if (n < PRUNE_BATCH) return total;
    }
  }

  /** Compte les entrées vivantes d'un ensemble de l'index. */
  async count(
    client: IScriptClient,
    what: IndexCount,
    now: number,
  ): Promise<number> {
    const key =
      typeof what === "object"
        ? `${this.base}:u:${what.user}`
        : `${this.base}:${what}`;
    return Number(await this.#run(client, "count", COUNT, [key, String(now)]));
  }

  /**
   * Exécute un script par son empreinte, et le recharge si Redis l'a oublié
   * (redémarrage, `SCRIPT FLUSH`) — UNE fois : un second `NOSCRIPT` n'est pas
   * un oubli, c'est une panne, et il remonte.
   */
  async #run(
    client: IScriptClient,
    name: string,
    script: string,
    args: string[],
  ): Promise<unknown> {
    for (let attempt = 0; ; attempt += 1) {
      let sha = this.#shas.get(name);
      if (sha === undefined) {
        sha = await client.scriptLoad(script);
        this.#shas.set(name, sha);
      }
      try {
        return await client.evalSha(sha, { keys: [], arguments: args });
      } catch (e) {
        if (attempt === 0 && String(e).includes("NOSCRIPT")) {
          this.#shas.delete(name);
          continue;
        }
        throw e;
      }
    }
  }
}

/** Le client sait-il exécuter des scripts ? (un double de test, non.) */
export function supportsScripts(client: unknown): client is IScriptClient {
  return (
    typeof client === "object" &&
    client !== null &&
    "scriptLoad" in client &&
    typeof client.scriptLoad === "function" &&
    "evalSha" in client &&
    typeof client.evalSha === "function"
  );
}
