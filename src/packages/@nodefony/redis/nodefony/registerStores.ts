import {
  registerTokenStore,
  getTokenStoreFactory,
  registerWebAuthnStore,
  getWebAuthnStoreFactory,
} from "@nodefony/security";
import {
  runNeedsExternalServices,
  durableStoreRemedy,
  type Container,
} from "nodefony";
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
 * Session (`session.store: "redis"`) et idempotence (`NF_IDEMPOTENCY_STORE=redis`,
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
  // 🔴 REFUSER, plutôt que dégrader. Le client est résolu LAZY par le store, ce
  // qui est juste pendant la FENÊTRE de boot ou d'arrêt : le `null` y est
  // transitoire. Quand le run ne déclare pas `externalServices`, il est
  // PERMANENT — et un store durable sans client est fail-OPEN silencieux
  // (`put()` rend la main sans écrire, `findById()` rend `null`), donc une
  // denylist qui ne lit rien accepte un jeton révoqué. Le profil du run est connu
  // dès le départ : ce refus ne dépend d'aucun ordre de boot, contrairement au
  // `null` du getter. Sans kernel, il n'y a pas de run à interroger — l'appel est
  // alors un ORDRE, et rien n'est gardé (même règle que `RedisService.init`).
  // [[feedback_prod_brick_not_in_dev_module]]
  // `service.module.kernel` : `Service.kernel` vaut `null` sur ce service (3ᵉ
  // argument du constructeur) — la garde s'écrirait sur un champ toujours vide.
  const kernel = service.module?.kernel ?? null;
  if (kernel && !runNeedsExternalServices(kernel)) {
    throw new Error(
      `${store} : demandé EXPLICITEMENT dans un run qui n'ouvre aucune connexion. ` +
        `Le store serait créé sans client Redis : ses écritures seraient perdues et ` +
        `ses lectures rendraient vide, SANS erreur. ${durableStoreRemedy(false)} ` +
        `Un store "auto" n'atteint jamais ce point — il bascule en mémoire, ` +
        `véridiquement et avec sa raison ; seule une demande EXPLICITE arrive ici.`,
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
