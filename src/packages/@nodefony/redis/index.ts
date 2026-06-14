/**
 * @nodefony/redis — Accès Redis générique pour Nodefony.
 *
 * Module d'infrastructure : gère N connexions Redis nommées (lib `redis` v5) à
 * partir d'une config validée par Zod. Il N'IMPOSE aucun usage — il expose le
 * client Redis brut par connexion (`RedisService.getClient(name)`), donc on
 * l'utilise pour TOUT : cache clé-valeur, sessions, files (streams/lists),
 * compteurs, verrous, pub/sub… Les couches qui le consomment (P13.5
 * `RedisBackplane` realtime, P5.12 `RedisSessionStorage`) sont AILLEURS — ce
 * module reste un fournisseur d'accès neutre.
 *
 * Trois connexions par défaut (`main`/`publish`/`subscribe`) : un client Redis
 * abonné (SUBSCRIBE) ne peut plus émettre de commandes normales → le pub/sub
 * impose des clients dédiés. `main` sert les commandes clé-valeur / storage.
 *
 * Voir aussi : CLAUDE.md (décisions figées), MEMORY.md (internals IA),
 * README.md (usage humain), docs/ (doc vulgarisée surfacée dans Studio).
 */
import { Kernel, Module, services } from "nodefony";
import * as redis from "redis";
import RedisService from "./nodefony/service/redis";
import defaultConfig from "./nodefony/config/config";
import {
  defineRedisConfig,
  redisConfigJsonSchema,
} from "./nodefony/config/defineRedisConfig";
import type {
  IRedisConfig,
  IRedisConfigInput,
} from "./nodefony/interfaces/IRedisConfig";

@services([RedisService])
class Redis extends Module {
  /** Module optionnel : un échec de son boot ne tue jamais le process (résilience Ph.3). */
  static override critical = false;

  constructor(kernel: Kernel) {
    super("redis", kernel, import.meta.url, defaultConfig);
  }

  /**
   * Valide la config (défauts + `module.options` + surcharge env) au boot via
   * `defineRedisConfig`, et l'expose au container sous `redisConfig` pour que le
   * `RedisService` la consomme sans redupliquer la validation. Plante propre
   * avec messages clairs si la config est invalide (cf convention Zod figée
   * 2026-05-28).
   */
  override async onKernelRegister(): Promise<this> {
    let validated: IRedisConfig;
    try {
      // `this.options` est FLAT : le Kernel deep-merge la config de `use("@nodefony/redis", …)`
      // directement dans les options du module (Kernel.ts) — PAS sous une clé `.redis`. Lire
      // `this.options.redis` ignorait silencieusement toute config app (cf audit config ORM 2026-06).
      validated = defineRedisConfig((this.options as IRedisConfigInput) ?? {});
    } catch (e) {
      const issues =
        e instanceof Error && "issues" in e && Array.isArray(e.issues)
          ? (e.issues as Array<{ path: (string | number)[]; message: string }>)
              .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
              .join(" · ")
          : (e as Error).message;
      throw new Error(`[@nodefony/redis] Invalid config: ${issues}`);
    }
    this.set("redisConfig", validated);
    return this;
  }
}

export default Redis;
export { RedisService, redis };
// Stockage de session Redis (consommé par @nodefony/http via le registre IoC).
// L'export charge le fichier → son `registerStorage("redis", …)` s'exécute.
export { default as RedisSessionStorage } from "./nodefony/src/SessionStorage";
export { defineRedisConfig, redisConfigJsonSchema };
export { redisConfigSchema, type RedisConfig } from "./nodefony/config/schema";
export type {
  IRedisConfig,
  IRedisConfigInput,
  IRedisConnectionConfig,
} from "./nodefony/interfaces/IRedisConfig";

// ─── Store de jetons Redis (contrat ITokenStore de @nodefony/security, J4b) ───
// Approche B : `@nodefony/security` en `import type` (0 dép runtime). PAS d'auto-
// register — l'app câble `registerTokenStore("redis", ({container}) =>
// RedisTokenStore.from(container.get("redis")))`. TTL natif → gc() no-op.
export { RedisTokenStore } from "./nodefony/src/RedisTokenStore";
export type { RedisClientLike } from "./nodefony/src/RedisTokenStore";
