import {
  Controller,
  controller,
  Get,
  Post,
  Body,
  Idempotent,
} from "@nodefony/framework";
import type { ContextType } from "@nodefony/http";

/**
 * Banc de DÉMO de l'idempotence userland (`@Idempotent`, P6.8) — prouve
 * l'anti double-effet bout-en-bout en HTTP RÉEL, y compris **cross-pod** quand le
 * store distribué Redis est branché (`NF_IDEMPOTENCY_STORE=redis`).
 *
 * Sous la zone firewall `test-secure` (`Authorization: Basic` — RFC 7617,
 * stateless → cluster-safe : chaque worker seede ses users au boot) : l'identité
 * de l'appelant authentifié scope le cache (anti-IDOR). La route `bump`
 * **incrémente un compteur de process** et renvoie `{ count, pid }` :
 *  - 1ʳᵉ requête (clé fraîche) → exécute → `count` incrémenté, `pid` du worker.
 *  - rejeu MÊME clé → **réponse mémorisée** (`count`/`pid` STABLES, action NON
 *    ré-exécutée) ; en cluster Redis, un AUTRE worker renvoie le `pid` du PREMIER
 *    (preuve que le second a rejoué au lieu d'exécuter) — `memory` per-pod en
 *    serait incapable.
 *  - clé absente → **400** (strict) ; même clé + payload différent → **422**.
 *
 * Le compteur est volontairement un état de PROCESS (module-level) : c'est
 * justement ce qui rend la dédup observable (un rejoué ne le bouge pas).
 */

/** Compteur d'EXÉCUTIONS réelles de `bump` sur CE process (jamais bougé par un rejeu). */
let executions = 0;

@controller("/nodefony/test/secure/idempotent")
class IdempotentDemoController extends Controller {
  constructor(context: ContextType) {
    super("IdempotentDemoController", context);
  }

  /**
   * Mutation idempotente de démo : incrémente le compteur d'exécutions du
   * process et renvoie l'état observable. `@Idempotent()` (strict) → une mutation
   * sans `Idempotency-Key` est rejetée (400) ; un rejeu de la même clé renvoie la
   * réponse mémorisée sans ré-exécuter (count/pid figés).
   */
  @Post("/bump")
  @Idempotent()
  bump(@Body() body: { label?: string }) {
    executions += 1;
    return {
      count: executions,
      pid: process.pid,
      label: body?.label ?? null,
    };
  }

  /** Lecture (non mutante) du compteur d'exécutions du process — diagnostic. */
  @Get("/count")
  count() {
    return { count: executions, pid: process.pid };
  }
}

export default IdempotentDemoController;
