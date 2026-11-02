import type { IRedisBackplaneTransport } from "../../src/backplane/RedisBackplane";
import { REDIS_RT_CHANNEL } from "../../src/backplane/RedisBackplane";

/**
 * Bus pub/sub Redis **en mémoire** — simule N pods abonnés au même canal SANS
 * Redis. Chaque `transport()` représente un pod : `publish` diffuse à TOUS les
 * abonnés du canal (y compris l'émetteur, comme Redis), prouvant le fan-out
 * cross-pod ET l'anti-echo (l'émetteur se filtre par originId).
 */
export class FakeRedisBus {
  readonly #subs = new Map<string, Set<(m: string) => void>>();
  /** Enveloppes JSON publiées (introspection des tests). */
  readonly published: { channel: string; message: string | Uint8Array }[] = [];

  transport(): IRedisBackplaneTransport {
    const bus = this;
    let mine: ((m: string) => void) | null = null;
    return {
      publish(channel, message): void {
        bus.published.push({ channel, message });
        // Bus texte seul : le sujet binaire a sa doublure (`RedisBackplaneBytes.test.ts`).
        if (typeof message === "string")
          bus.#subs.get(channel)?.forEach((l) => l(message));
      },
      subscribe(channel, onMessage): void {
        mine = onMessage;
        let set = bus.#subs.get(channel);
        if (!set) {
          set = new Set();
          bus.#subs.set(channel, set);
        }
        set.add(onMessage);
      },
      unsubscribe(channel): void {
        if (mine) bus.#subs.get(channel)?.delete(mine);
        mine = null;
      },
    };
  }

  /** Nb d'abonnés sur le canal (vérifie l'idempotence du start / le stop). */
  subscriberCount(channel: string = REDIS_RT_CHANNEL): number {
    return bus_size(this.#subs.get(channel));
  }
}
function bus_size(s: Set<unknown> | undefined): number {
  return s ? s.size : 0;
}
