/**
 * Sentinelle de la convention `NodefonyModuleConfig` — le registre augmentable
 * qui donne un TYPE à la config d'un module dans `use()`.
 *
 * Ce que ça protège : sans augmentation du registre, `use("@nodefony/redis", …)`
 * retombe sur `Record<string, unknown>`. Tout est alors accepté à la compilation,
 * et une clé mal orthographiée est **retirée par Zod au boot, en silence** — la
 * config semble prise en compte, elle ne l'est pas. Le CLAUDE.md racine impose
 * cette augmentation à tout module exposant une config ; elle n'était appliquée
 * nulle part avant d'être reprise module par module.
 *
 * `redis` sert de sentinelle pour la convention entière : c'est le module à
 * config autonome le plus simple. Les autres modules augmentés (`http`,
 * `framework`, `security`, `realtime`, `drizzle`, `mongoose`, `frontend`,
 * `documentation`) sont couverts par le typecheck du dépôt.
 *
 * Couvert par `npm run typecheck` (`tsgo -p tsconfig.tests.json`).
 */

import { describe, it } from "vitest";
import { use } from "nodefony";
// L'import de l'index du module est CE QUI CHARGE l'augmentation `declare
// module "nodefony"`. Sans lui, le registre reste vide et les `@ts-expect-error`
// ci-dessous ne trouveraient rien à signaler — le test se croirait vert.
import "../../../index";

function _typeOnly(): void {
  // ── Nominal : une clé du schéma est acceptée et typée ────────────────────
  use("@nodefony/redis", { enabled: false });

  // ── Le cœur : une clé INCONNUE est une erreur de COMPILATION ────────────
  // C'est exactement le cas qui partait au silence : Zod la retire au boot, et
  // rien n'avertit que la configuration écrite n'a servi à rien.
  // @ts-expect-error clé inexistante dans IRedisConfigInput
  use("@nodefony/redis", { enabledd: false });

  // ── Le TYPE d'une clé connue est vérifié, pas seulement son nom ─────────
  // @ts-expect-error `enabled` est un booléen, pas une chaîne
  use("@nodefony/redis", { enabled: "oui" });

  // ── Un module SANS augmentation reste permissif (non régressif) ─────────
  // La convention est incitative : un module tiers qui ne l'applique pas doit
  // continuer de fonctionner, sans complétion — jamais bloqué.
  use("@acme/module-tiers", { nimporte: "quoi" });
}

void _typeOnly;

describe("registre NodefonyModuleConfig — config de module typée dans use()", () => {
  it("refuse une clé inconnue à la compilation plutôt qu'au silence (compile-only)", () => {
    // La preuve est faite par `tsgo -p tsconfig.tests.json` : un
    // `@ts-expect-error` sans erreur réelle FAIT ÉCHOUER le typecheck (TS2578).
  });
});
