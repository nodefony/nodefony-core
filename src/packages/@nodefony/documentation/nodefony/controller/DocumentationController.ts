import {
  Controller,
  Get,
  Param,
  IsGranted,
  controller,
} from "@nodefony/framework";
import { Context } from "@nodefony/http";
import {
  DocNotFoundError,
  DocUnsafeSlugError,
} from "../src/errors/DocumentationError";
import type { IDocumentationService } from "../interfaces/IDocumentation";

/**
 * Data plane HTTP de la documentation Nodefony.
 *
 * Expose l'index transverse et le contenu des pages sous
 * `/nodefony/documentation/api/*` (convention figée : un module admin sert
 * toujours `/nodefony/<module>/api/*`, jamais une route mono-segment).
 *
 * **Mince par design** : toute la logique (scan, cache, allowlist, résolution
 * `{{ }}`) vit dans `DocumentationService` (singleton stateful). Le controller
 * est réinstancié par requête → il ne porte aucun état, il délègue.
 *
 * Sécurité (Zero Trust) : un slug invalide/inconnu renvoie un message
 * **générique** au client ; le détail (slug, raison) est loggé côté serveur.
 * La garde anti-traversée est dans le service ({@link isSafeSlug}).
 */
@controller("/nodefony")
class DocumentationController extends Controller {
  constructor(context: Context) {
    super("DocumentationController", context);
  }

  /** Résout le service de documentation depuis le container partagé. */
  #service(): IDocumentationService {
    const svc = this.get<IDocumentationService>("documentation");
    if (!svc) throw new Error("DocumentationService non enregistré");
    return svc;
  }

  // Doc TECHNIQUE du framework (RFC, archi, internals) → public développeurs /
  // exploitants / admin, PAS un utilisateur final. RBAC aligné sur la page Studio
  // « Documentation » (bundle devops) ; ROLE_NODEFONY_ADMIN couvre par hiérarchie.
  // (Était lisible par tout authentifié — endpoint monté hors broker, pré-P6.)
  /** Index transverse : sections → pages, taguées par audience. */
  @IsGranted(["ROLE_DEV", "ROLE_SUPERVISOR"])
  @Get("/documentation/api/tree")
  async tree() {
    try {
      return this.renderJson(await this.#service().getTree());
    } catch (e) {
      this.log(e as Error, "ERROR");
      return this.renderJson(
        { error: "Index de documentation indisponible." },
        500,
      );
    }
  }

  /** Contenu d'une page + variables `{{ }}` résolues côté serveur. */
  @IsGranted(["ROLE_DEV", "ROLE_SUPERVISOR"])
  @Get("/documentation/api/page/{slug}")
  async page(@Param("slug") slug: string) {
    try {
      return this.renderJson(await this.#service().getPage(slug));
    } catch (e) {
      // Cas attendus → 404 générique (détail loggé serveur, jamais au client).
      if (e instanceof DocNotFoundError || e instanceof DocUnsafeSlugError) {
        this.log(`${e.docCode}: ${e.message}`, "WARNING");
        return this.renderJson({ slug, error: "Document inconnu." }, 404);
      }
      this.log(e as Error, "ERROR");
      return this.renderJson(
        { slug, error: "Lecture de la page impossible." },
        500,
      );
    }
  }
}

export default DocumentationController;
