import { createClient } from "redis";
import {
  REDIS_GATE,
  gateValue,
} from "../../../../../../../scripts/test/vitest/gates";

const PASSWORD = process.env.NF_REDIS_PASSWORD ?? "nodefony-dev";
const HOST = process.env.NF_REDIS_HOST ?? "localhost";
const PORT = Number.parseInt(process.env.NF_REDIS_PORT ?? "6379", 10);

/**
 * Client Redis de banc, sans reconnexion — l'URL vient de `REDIS_GATE`, la gate qui contrôle ces bancs (jamais un nom retapé) ; le triplet HOST/PORT/PASSWORD reste un repli.
 */
export function redisTestClient() {
  const url = gateValue(REDIS_GATE, "NF_REDIS_URL");
  const c = createClient(
    url
      ? { url, socket: { reconnectStrategy: false } }
      : {
          socket: { host: HOST, port: PORT, reconnectStrategy: false },
          password: PASSWORD,
        },
  );
  c.on("error", () => {});
  return c;
}

/** Client rendu par {@link redisTestClient}. */
export type RedisTestClient = ReturnType<typeof redisTestClient>;

/** Redis répond-il ? Un banc absent se saute — et `gateReporter` le dit. */
export async function redisReachable(): Promise<boolean> {
  const probe = redisTestClient();
  try {
    await probe.connect();
    await probe.ping();
    await probe.quit();
    return true;
  } catch {
    try {
      probe.destroy();
    } catch {
      /* déjà fermé */
    }
    return false;
  }
}
