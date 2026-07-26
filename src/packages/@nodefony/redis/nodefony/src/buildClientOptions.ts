import type { RedisClientOptions } from "redis";
import type {
  IRedisConfig,
  IRedisConnectionConfig,
} from "../interfaces/IRedisConfig";

/**
 * Construit la fonction `reconnectStrategy` de redis v6 à partir de la politique
 * déclarative (`baseMs`/`maxMs`/`maxRetries`) — back-off linéaire borné.
 *
 * @returns une fonction `(retries) => délai ms | Error` consommée par le socket.
 */
function buildReconnectStrategy(
  policy: IRedisConfig["globalOptions"]["socket"]["reconnectStrategy"],
): (retries: number) => number | Error {
  const { baseMs, maxMs, maxRetries } = policy;
  return (retries: number): number | Error => {
    if (maxRetries > 0 && retries >= maxRetries) {
      return new Error(
        `[@nodefony/redis] reconnexion abandonnée après ${retries} tentatives`,
      );
    }
    return Math.min((retries + 1) * baseMs, maxMs);
  };
}

/**
 * Assemble les options `createClient` (redis v6) d'une connexion nommée à partir
 * de la config validée : `globalOptions` fusionné avec la surcharge de connexion.
 *
 * Précédence : `url` (si présent) > socket de connexion > `globalOptions.socket`.
 * Quand `url` est fourni, host/port/auth en sont extraits par redis lui-même —
 * on ne pose alors PAS de `socket.host/port` (ils seraient ignorés/conflictuels).
 *
 * redis v6 : RESP3 est le protocole par défaut (on l'assume — set/get/pub/sub
 * inchangés côté API) mais `maintNotifications` y bascule à `"auto"` (souscrit aux
 * push frames de maintenance Redis Enterprise + relâche les timeouts socket). On
 * cible Redis OSS → on force `"disabled"` pour un comportement déterministe et
 * zéro listener/frame superflu (règle perf-mémoire).
 *
 * @param config - config racine validée et gelée.
 * @param connection - définition de la connexion (name/database/socket override).
 * @returns options prêtes pour `createClient`.
 */
export function buildClientOptions(
  config: IRedisConfig,
  connection: IRedisConnectionConfig,
): RedisClientOptions {
  const global = config.globalOptions;
  const reconnectStrategy = buildReconnectStrategy(
    global.socket.reconnectStrategy,
  );

  const options: RedisClientOptions = {
    name: connection.name,
    database: connection.database,
    // redis v6 OSS : pas de notifications de maintenance Enterprise (déterministe).
    maintNotifications: "disabled",
  } as RedisClientOptions;

  if (global.username) {
    options.username = global.username;
  }
  if (global.password) {
    options.password = global.password;
  }

  if (config.url) {
    // URL prioritaire : host/port/auth/db extraits par redis. On ne pose pas de
    // socket.host/port (conflit). On garde quand même le reconnectStrategy.
    options.url = config.url;
    options.socket = { reconnectStrategy };
    return options;
  }

  const socket = { ...global.socket, ...connection.socket };
  options.socket = {
    host: socket.host,
    port: socket.port,
    family: socket.family,
    connectTimeout: socket.connectTimeout,
    tls: socket.tls === true ? true : undefined,
    reconnectStrategy,
  };
  return options;
}
