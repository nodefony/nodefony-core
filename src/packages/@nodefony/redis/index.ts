/**
 * @nodefony/redis — Accès Redis générique pour Nodefony.
 *
 * Module d'infrastructure : gère N connexions Redis nommées (lib `redis` v6) à
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
} from "./nodefony/config/defineModuleConfig";
import { registerRedisFrameworkStores } from "./nodefony/registerStores";
import type {
  IRedisConfig,
  IRedisConfigInput,
} from "./nodefony/interfaces/IRedisConfig";

@services([RedisService])
class Redis extends Module<IRedisConfig> {
  /** Module optionnel : un échec de son boot ne tue jamais le process (résilience Ph.3). */
  static override critical = false;

  constructor(kernel: Kernel) {
    super("redis", kernel, import.meta.url, defaultConfig);
  }

  /** JSON Schema de la config redis → data plane admin (config riche Studio). */
  override configSchema(): unknown {
    return redisConfigJsonSchema();
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
    // Config validée exposée via this.options → `this.config` (accès uniforme
    // typé). Le RedisService la lit sur son module (`this.module.config`).
    this.options = validated;

    // AUTO-REGISTER des fabriques de stores Redis (tokens/webauthn) dans les
    // registres security — zéro câblage app ; guards = l'app garde la main.
    // Session et idempotence redis sont enregistrées ailleurs (registre IoC de
    // SessionsService / builtin @nodefony/framework).
    registerRedisFrameworkStores();
    return this;
  }
}

export default Redis;
export { RedisService, redis };
// Stockage de session Redis (consommé par @nodefony/http via le registre IoC).
// L'export charge le fichier → son `registerStorage("redis", …)` s'exécute.
export { default as RedisSessionStorage } from "./nodefony/src/SessionStorage";
export { defineRedisConfig, redisConfigJsonSchema };
export { redisConfigSchema, type RedisConfig } from "./nodefony/config/config";
export type {
  IRedisConfig,
  IRedisConfigInput,
  IRedisConnectionConfig,
} from "./nodefony/interfaces/IRedisConfig";

// ─── Store de jetons Redis (contrat ITokenStore de @nodefony/security, J4b) ───
// AUTO-REGISTER (onKernelRegister) : sélectionnable via `tokenStore.store: "redis"`,
// zéro câblage app. TTL natif → gc() no-op.
export { RedisTokenStore } from "./nodefony/src/RedisTokenStore";
export type { RedisClientLike } from "./nodefony/src/RedisTokenStore";

// ─── Store de credentials WebAuthn Redis (IWebAuthnCredentialStore, J9) ───────
// AUTO-REGISTER (onKernelRegister) : sélectionnable via `passkeys.store: "redis"`.
// Pas de TTL → pas de gc.
export { RedisWebAuthnCredentialStore } from "./nodefony/src/RedisWebAuthnCredentialStore";

// ─── Auto-register des fabriques framework (appelé par onKernelRegister) ─────
export { registerRedisFrameworkStores } from "./nodefony/registerStores";
