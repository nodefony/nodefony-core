import {
  registerTokenStore,
  getTokenStoreFactory,
  registerWebAuthnStore,
  getWebAuthnStoreFactory,
} from "@nodefony/security";
import type { Container } from "nodefony";
import type RedisService from "./service/redis";
import { RedisTokenStore } from "./src/RedisTokenStore";
import { RedisWebAuthnCredentialStore } from "./src/RedisWebAuthnCredentialStore";

/**
 * AUTO-ENREGISTREMENT des backends framework portés par Redis — « charger le
 * module = ses backends deviennent sélectionnables par simple nom » (convention-
 * frère : `registerDrizzleFrameworkStores` / `registerMongooseFrameworkStores`).
 *
 * Appelé par `Redis.onKernelRegister`. Pas d'entité (clés + TTL natifs, aucun
 * schéma à déclarer). Le client est résolu LAZY par le store (connexion `main`,
 * dégradation gracieuse pendant boot/shutdown — pattern `RedisSessionStorage`).
 *
 * Fabriques `get`-guarded : une fabrique déjà posée par l'app garde la main.
 * Session (`session.handler: "redis"`) et idempotence (`NF_IDEMPOTENCY_STORE=redis`,
 * builtin `@nodefony/framework`) restent enregistrées ailleurs — ici : tokens
 * (PAT + denylist JWT) et credentials WebAuthn.
 */

/** Résout le service redis du container — échec FRANC avec la cause exacte. */
function resolveRedisService(
  store: string,
  container?: Container,
): RedisService {
  const service = (container?.get?.("redis") ?? null) as RedisService | null;
  if (!service) {
    throw new Error(
      `${store} : service "redis" introuvable — le module @nodefony/redis est-il ` +
        `chargé (manifeste "modules") ?`,
    );
  }
  return service;
}

/**
 * Enregistre les fabriques de stores Redis dans les registres de
 * `@nodefony/security`. Idempotent (guards) — rejouable sans effet.
 */
export function registerRedisFrameworkStores(): void {
  // ── Tokens (PAT + denylist JWT) — TTL natif, gc() no-op ─────────────────────
  if (!getTokenStoreFactory("redis")) {
    registerTokenStore("redis", (ctx) => {
      const service = resolveRedisService(`tokenStore "redis"`, ctx?.container);
      const days = ctx?.config?.tokenStore?.retentionRevokedDays;
      return RedisTokenStore.from(
        service,
        undefined,
        typeof days === "number" ? days * 86_400_000 : undefined,
      );
    });
  }

  // ── Credentials WebAuthn (passkeys) ─────────────────────────────────────────
  if (!getWebAuthnStoreFactory("redis")) {
    registerWebAuthnStore("redis", (ctx) =>
      RedisWebAuthnCredentialStore.from(
        resolveRedisService(`passkeys.store "redis"`, ctx?.container),
      ),
    );
  }
}
