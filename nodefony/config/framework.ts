/**
 * Routeur et contrôleurs — idempotence des mutations.
 *
 * Fragment du manifeste de l'application : `nodefony.config.ts` l'importe et
 * passe le résultat à `use("@nodefony/framework", …)`. Rien ne charge ce fichier
 * tout seul — c'est l'import du manifeste qui le monte, et lui seul.
 *
 * 🔴 `satisfies` n'est PAS décoratif. Écrit dans le manifeste, ce littéral
 * était vérifié au point d'appel : une clé inconnue y était refusée. Rendu par
 * une fonction, il ne l'est plus — la clé compile, puis Zod la retire EN
 * SILENCE au boot, et le module démarre sur son défaut. `satisfies` rétablit
 * ce contrôle, et `nodefony doctor` refuse un fragment qui s'en passe.
 *
 * @module
 */
import type { ConfigContext } from "nodefony";
import type { IFrameworkConfigInput } from "@nodefony/framework";
import type { env } from "../../env";

/**
 * La configuration de `@nodefony/framework` pour cette application.
 *
 * Idempotence des mutations : `auto` (défaut) suit l'infra déclarée —
 * `NF_REDIS_URL` → redis, sinon `NF_DATABASE_URL` → drizzle ; SANS infra
 * réseau, un backend local persistant chargé (drizzle sqlite, puis mongoose)
 * passe AVANT le repli `memory`. `NF_STORE` force tout cela d'un cran
 * au-dessus. `memory` (par pod) | `redis` | `drizzle` (distribués cross-pod).
 * Opt-in explicite : `NF_IDEMPOTENCY_STORE`. Le framework résout le nom au
 * boot (fail-loud si non enregistré). Cf `@Idempotent` (P6.8).
 */
export const frameworkConfig = (ctx: ConfigContext<typeof env>) =>
  ({
    idempotency: { store: ctx.env.NF_IDEMPOTENCY_STORE },
  }) satisfies IFrameworkConfigInput;
