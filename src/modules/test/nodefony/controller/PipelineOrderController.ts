import { Controller, controller, Get } from "@nodefony/framework";
import type { ContextType } from "@nodefony/http";
import {
  readInitializeProbe,
  resetInitializeProbe,
} from "../secure/initializeProbe";

/**
 * Lecture PUBLIQUE du mouchard d'ordre du pipeline (`initializeProbe`).
 *
 * Le mouchard est posé par `SecureController.initialize()`, qui vit en **zone
 * protégée** : un banc anonyme ne peut donc pas le relire là où il est écrit.
 * Ces deux routes sont la fenêtre — volontairement hors zone, volontairement
 * sans effet de bord autre que la remise à zéro.
 *
 * Ce qu'elles permettent d'affirmer : après une requête rejetée par le firewall
 * (401) ou par une garde `@IsGranted` (403), le hook `initialize()` du
 * controller visé a-t-il tourné ? Autrement dit, du code utilisateur
 * s'exécute-t-il avant l'authentification ?
 */
@controller("/nodefony/test/pipeline-order")
class PipelineOrderController extends Controller {
  constructor(context: ContextType) {
    super("PipelineOrderController", context);
  }

  /** État du mouchard : combien de passages, et ce qu'ils voyaient. */
  @Get("/probe")
  probe() {
    return this.renderJson(readInitializeProbe());
  }

  /** Remise à zéro entre deux cas de banc. */
  @Get("/probe/reset")
  reset() {
    resetInitializeProbe();
    return this.renderJson(readInitializeProbe());
  }
}

export default PipelineOrderController;
