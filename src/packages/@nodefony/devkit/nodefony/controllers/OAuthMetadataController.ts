import { route, controller, Controller } from "@nodefony/framework";
import type { ContextType } from "@nodefony/http";
import {
  MCP_ENDPOINT_PATH,
  protectedResourceMetadataPath,
  buildProtectedResourceMetadata,
} from "nodefony";
import type { IDevkitService } from "../interfaces/IDevkitService";

/**
 * Chemin bien connu où se publient les métadonnées de la porte MCP.
 *
 * **Dérivé, jamais recopié** : il se compose du chemin de l'endpoint par la
 * règle d'insertion de la RFC 9728 §3.1. Le littéral qu'on serait tenté
 * d'écrire ici deviendrait faux le jour où la porte déménage — et l'erreur
 * serait parfaitement silencieuse : un client sonde ce chemin, reçoit `404`,
 * et conclut que l'application n'a pas d'autorisation.
 */
const METADATA_PATH = protectedResourceMetadataPath(MCP_ENDPOINT_PATH);

/**
 * Métadonnées OAuth 2.1 de la porte MCP — **le seul moyen normalisé** pour
 * qu'un agent apprenne où obtenir un jeton.
 *
 * ## Pourquoi un controller séparé
 *
 * Trois raisons, et aucune n'est esthétique. Le chemin vit **hors** du préfixe
 * `/nodefony` (la RFC impose `/.well-known/…` juste après l'hôte). Le document
 * est **public par conception** — un client doit pouvoir le lire avant d'avoir
 * le moindre jeton, donc il ne porte ni garde d'origine ni exigence de
 * localité, contrairement à la porte elle-même. Et il répond en `GET`, quand la
 * porte n'accepte que `POST`.
 *
 * ## Ce que publier coûte, et ce que ne rien publier coûte
 *
 * Le document ne révèle rien de sensible : l'émetteur des jetons, les scopes
 * compris, un nom. En revanche, ne PAS le publier a un coût mesuré — un client
 * qui ne le trouve pas suppose que le serveur d'autorisation est le serveur
 * lui-même, et part sonder des chemins qui n'existent pas. C'est exactement ce
 * qui a produit le bruit OAuth observé sur cette porte.
 *
 * 🔴 **Rôle éteint = `404`, jamais un document vide.** Un document sans serveur
 * d'autorisation apprendrait au client qu'un jeton est nécessaire sans jamais
 * lui dire où le demander : la spécification MCP l'interdit d'ailleurs
 * explicitement (« MUST include […] at least one authorization server »).
 */
@controller("")
class OAuthMetadataController extends Controller {
  constructor(context: ContextType) {
    super("devkit-oauth-metadata", context);
  }

  /** Résout le service du module depuis le conteneur partagé. */
  #service(): IDevkitService {
    const svc = this.get<IDevkitService>("devkit");
    if (!svc) {
      throw new Error("DevkitService non enregistré");
    }
    return svc;
  }

  /**
   * `GET /.well-known/oauth-protected-resource/nodefony/mcp` — RFC 9728 §3.
   *
   * @returns le document JSON, ou `404` si cette porte n'est pas protégée
   */
  @route("devkit-mcp-protected-resource", {
    path: METADATA_PATH,
    method: "GET",
  })
  async metadata() {
    const settings = this.#service().mcpSettings();
    const authz = settings.authorization;

    // Porte coupée, ou rôle serveur de ressource éteint : il n'y a rien à
    // publier. `404` est la réponse que la RFC attend d'une ressource sans
    // métadonnées — et c'est elle qui laisse le client conclure « pas
    // d'autorisation ici » au lieu de chercher un serveur d'autorisation.
    if (!settings.enabled || authz.authorizationServers.length === 0) {
      return this.renderJson({ error: "not_found" }, 404);
    }

    let document;
    try {
      document = buildProtectedResourceMetadata({
        resource: authz.resource,
        authorizationServers: authz.authorizationServers,
        scopesSupported: authz.scopesSupported,
        resourceName: authz.resourceName,
        resourceDocumentation: authz.resourceDocumentation,
      });
    } catch (error) {
      // Le schéma valide déjà la forme au boot ; si l'on arrive ici, la
      // configuration a été altérée après coup. Publier un document approximatif
      // serait pire que ne rien publier — un client le mettrait en cache.
      this.log(
        `MCP — métadonnées impubliables : ${(error as Error).message}`,
        "CRITIC",
      );
      return this.renderJson({ error: "server_error" }, 500);
    }

    return this.renderJson(document, 200, {
      // RFC 9728 §7.10 : ce document ne change qu'à un redéploiement. Sans
      // directive, un client conforme le redemande à chaque connexion.
      "Cache-Control": "public, max-age=3600",
    });
  }
}

export default OAuthMetadataController;
