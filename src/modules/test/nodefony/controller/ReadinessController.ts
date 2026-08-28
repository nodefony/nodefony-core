import { Controller, route, controller } from "@nodefony/framework";
import { Context } from "@nodefony/http";
import type { Kernel } from "nodefony";

/**
 * Décor du banc de DISPONIBILITÉ (S5-R) — la télécommande du registre porté par
 * le Kernel (`setReadiness` / `clearReadiness`).
 *
 * Pourquoi une route : le banc d'intégration parle à un serveur RÉEL, dans un
 * autre processus. Sans point d'entrée, il ne pourrait qu'observer `/readyz`
 * répondre 200 — c'est-à-dire ne rien prouver du tout. Ici il inscrit un
 * contributeur factice, constate la bascule à 503, le libère, et constate le
 * retour à 200 : la garde est vue MORDRE dans les deux sens.
 *
 * Ce module n'existe que dans le dépôt du framework (décor de banc) : il n'est
 * pas publié, et aucune application n'expose ces routes.
 */
@controller("/nodefony/test/readiness")
class ReadinessController extends Controller {
  constructor(context: Context) {
    super("ReadinessController", context);
  }

  /** Le Kernel qui porte le registre — non nul dès qu'une requête est servie. */
  private get target(): Kernel {
    return this.kernel as Kernel;
  }

  /**
   * Pose le verdict d'un contributeur factice.
   *
   * @param name - nom du contributeur
   * @param state - `ready` libère, toute autre valeur retient
   */
  @route("test-readiness-set", {
    path: "/set/{name}/{state}",
    requirements: { methods: "GET" },
  })
  setReadiness(name: string, state: string) {
    const ready = state === "ready";
    this.target.setReadiness(
      name,
      ready,
      ready ? undefined : `banc d'intégration : ${name} retenu`,
    );
    return this.renderJson({
      name,
      ready,
      blocked: this.target.readinessBlocked,
    });
  }

  /**
   * Retire un contributeur factice.
   *
   * @param name - nom du contributeur
   */
  @route("test-readiness-clear", {
    path: "/clear/{name}",
    requirements: { methods: "GET" },
  })
  clearReadiness(name: string) {
    this.target.clearReadiness(name);
    return this.renderJson({
      name,
      cleared: true,
      blocked: this.target.readinessBlocked,
    });
  }

  /** État complet du registre — ce que la sonde, elle, ne lit jamais. */
  @route("test-readiness-report", {
    path: "/report",
    requirements: { methods: "GET" },
  })
  report() {
    return this.renderJson({
      blocked: this.target.readinessBlocked,
      contributors: this.target.readinessReport(),
    });
  }
}

export default ReadinessController;
