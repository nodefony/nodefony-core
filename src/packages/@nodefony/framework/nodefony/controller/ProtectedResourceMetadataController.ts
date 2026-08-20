import type { Module } from "nodefony";
import type { IProtectedResourceInput } from "nodefony";
import {
  canonicalResourceUri,
  protectedResourceMetadataPath,
  buildProtectedResourceMetadata,
} from "nodefony";
import type { ContextType } from "@nodefony/http";
import Router from "../service/router";
import Controller from "../src/Controller";
import { askedAuthority, onDeclaredAuthority } from "./oauthAuthority";

/**
 * Vue MINIMALE du service qui sait ce que l'application PROTÈGE, côté
 * **publication**. Contrat structurel local : framework ne dépend JAMAIS de
 * `@nodefony/security` — couplage par nom de service (`firewall`), comme
 * `tokenService`/`authFlow`/`adminBroker`.
 *
 * Le partage des rôles est le même que pour l'émetteur : security DÉCIDE (quelles
 * zones déclarent une ressource, quels serveurs d'autorisation les servent) et
 * framework se contente d'ouvrir la porte.
 */
export interface IProtectedResourcePublisher {
  /**
   * Ressources protégées à publier — vide si l'application n'en protège aucune.
   *
   * Chaque entrée décrit une ressource telle qu'un client l'atteint, et les
   * serveurs d'autorisation capables d'émettre un jeton pour elle.
   */
  publishedProtectedResources(): readonly IProtectedResourceInput[];
}

// Montage one-shot par process (même sémantique que `mountIssuerMetadataRoutes`).
let mounted = false;

/**
 * Le document qui rend un refus APPRENABLE — RFC 9728.
 *
 * ## Le trou que ce controller ferme
 *
 * Un `401` d'une zone qui déclare sa ressource porte désormais un défi complet :
 *
 * ```
 * WWW-Authenticate: Bearer resource_metadata="https://app/.well-known/oauth-protected-resource/api"
 * ```
 *
 * Sans ce controller, cette URL rendait **404** : un pointeur syntaxiquement
 * conforme qui ne mène nulle part. Le client le lit, le suit, trouve une erreur,
 * et conclut qu'il n'y a pas d'autorisation ici — c'est-à-dire exactement
 * l'inverse de ce que le refus voulait lui apprendre. Seul `@nodefony/devkit`
 * publiait un document, et uniquement pour SA porte MCP.
 *
 * ## Une route par CHEMIN, un document par AUTORITÉ
 *
 * La RFC 9728 §3.1 **insère** le chemin de la ressource dans l'URL bien connue
 * (« Using path components enables supporting multiple resources per host ») :
 * deux ressources de chemins distincts ont donc deux URL distinctes, et l'on
 * monte une route par chemin. Deux ressources qui partagent le chemin mais pas
 * l'autorité (`https://a.example/api` et `https://b.example/api`) partagent en
 * revanche la même route : c'est alors l'autorité demandée qui départage, à la
 * requête.
 *
 * ## Ce qui retient la publication
 *
 * Rien n'est monté si le service `firewall` est absent, ou s'il ne déclare
 * aucune ressource : **`404`, zéro surface**. Un document creux apprendrait à un
 * client qu'il y a quelque chose à découvrir sans lui donner de quoi le faire —
 * et la spécification MCP l'interdit explicitement (« MUST include […] at least
 * one authorization server »).
 *
 * `bypassFirewall: true` : ce document est public par construction. Le placer
 * derrière l'authentification serait circulaire — il sert précisément à
 * expliquer comment s'authentifier à qui ne l'est pas encore. Il ne révèle rien
 * de secret : une URI publique, des émetteurs, des scopes.
 *
 * @see references/rfc/ietf/rfc9728.txt — métadonnées de la ressource protégée
 * @see references/rfc/ietf/rfc8707.txt — l'audience, qui LIE un jeton à CE service
 */
class ProtectedResourceMetadataController extends Controller {
  constructor(context: ContextType) {
    super("ProtectedResourceMetadataController", context);
  }

  /** Résout le publieur — absent = capacité éteinte. */
  #publisher(): IProtectedResourcePublisher | null {
    return this.get<IProtectedResourcePublisher>("firewall") ?? null;
  }

  /** Chemin bien connu demandé, tel que le Router l'a matché. */
  #askedPath(): string | null {
    const req = this.request as { pathname?: unknown; url?: unknown } | null;
    const p = req?.pathname;
    if (typeof p === "string") return p;
    const url = req?.url;
    if (url instanceof URL) return url.pathname;
    if (typeof url === "string") {
      try {
        return new URL(url, "http://localhost").pathname;
      } catch {
        return null;
      }
    }
    return null;
  }

  /**
   * `GET /.well-known/oauth-protected-resource/<chemin>` — RFC 9728 §3.
   *
   * 🔴 Le document n'est servi que sur l'autorité de SA ressource. Un client
   * conforme rejette un document dont la `resource` ne correspond pas à l'URI
   * qu'il interrogeait (§3.3) — et un client réel s'arrête là au lieu de
   * continuer sans authentification. C'est la faille déjà vécue sur le document
   * d'émetteur, transposée : la règle est partagée (`onDeclaredAuthority`).
   *
   * @returns le document JSON, ou `404` si aucune ressource déclarée ne
   *          correspond au chemin ET à l'autorité demandés
   */
  async metadata() {
    const declared = this.#publisher()?.publishedProtectedResources() ?? [];
    const path = this.#askedPath();
    const asked = askedAuthority(this.request?.headers);
    if (!path || declared.length === 0) {
      return this.renderJson({ error: "not_found" }, 404);
    }

    let match: IProtectedResourceInput | null = null;
    for (const entry of declared) {
      let canonical: string;
      try {
        canonical = canonicalResourceUri(entry.resource);
      } catch {
        // Ressource devenue impubliable depuis le montage : elle ne peut pas
        // répondre, mais elle ne doit pas empêcher les autres de le faire.
        continue;
      }
      if (protectedResourceMetadataPath(canonical) !== path) continue;
      if (!onDeclaredAuthority(asked, canonical)) continue;
      match = entry;
      break;
    }
    if (!match) {
      return this.renderJson({ error: "not_found" }, 404);
    }

    let document;
    try {
      document = buildProtectedResourceMetadata(match);
    } catch (error) {
      // La composition a été validée au montage ; arriver ici veut dire que la
      // configuration a changé depuis. Publier un document approximatif serait
      // pire que rien — un client le met en cache, et il porte l'identité de la
      // ressource.
      this.log(
        `métadonnées de ressource protégée impubliables : ${(error as Error).message}`,
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

/**
 * Chemins bien connus à monter pour un jeu de ressources déclarées.
 *
 * Fonction **pure**, exportée pour être éprouvée sans serveur : c'est elle qui
 * porte les deux décisions qui font la différence entre un document servi et un
 * `404` — la dérivation du chemin (insertion RFC 9728 §3.1, jamais une
 * concaténation) et la déduplication.
 *
 * Deux zones peuvent parfaitement déclarer la même ressource (typiquement une
 * zone HTTP et son pendant WebSocket) ; deux hôtes virtuels peuvent en déclarer
 * deux différentes sous le même chemin. Dans les deux cas il ne faut monter
 * qu'**une** route : `Router.createRoute` empile sans vérifier, et la seconde
 * ne serait jamais atteinte — une collision parfaitement silencieuse.
 *
 * @param resources - ressources déclarées par le publieur
 * @returns les chemins distincts à servir, dans l'ordre de déclaration
 */
export function protectedResourceRoutePaths(
  resources: readonly IProtectedResourceInput[],
): string[] {
  const paths: string[] = [];
  const seen = new Set<string>();
  for (const entry of resources) {
    let canonical: string;
    try {
      canonical = canonicalResourceUri(entry.resource);
    } catch {
      // Une URI qui ne peut pas servir d'audience ne peut pas non plus se
      // publier. Le refus est porté au boot par l'authenticator qui l'exige
      // (`ExternalJwtAuthenticator.validateArea`) ; ici on ne monte rien.
      continue;
    }
    const path = protectedResourceMetadataPath(canonical);
    if (seen.has(path)) continue;
    seen.add(path);
    paths.push(path);
  }
  return paths;
}

/**
 * Monte les documents de ressource protégée — appelé par le module framework à
 * `onKernelReady`, seulement si un publieur déclare au moins une ressource.
 *
 * @param frameworkModule - module porteur des routes
 * @param resources - ressources déclarées, qui DÉTERMINENT les chemins montés
 * @returns le nombre de routes montées
 */
export function mountProtectedResourceRoutes(
  frameworkModule: Module,
  resources: readonly IProtectedResourceInput[],
): number {
  if (mounted) return 0;
  const paths = protectedResourceRoutePaths(resources);
  if (paths.length === 0) return 0;
  let index = 0;
  for (const path of paths) {
    Router.createRoute(`security.resource.metadata.${index++}`, {
      path,
      constructor:
        ProtectedResourceMetadataController as unknown as Controller["constructor"],
      classMethod: "metadata",
      requirements: { methods: ["GET"] },
      bypassFirewall: true,
    });
  }
  if (
    !Object.prototype.hasOwnProperty.call(
      ProtectedResourceMetadataController.prototype,
      "module",
    )
  ) {
    Router.setController(
      ProtectedResourceMetadataController as unknown as Parameters<
        typeof Router.setController
      >[0],
      frameworkModule,
    );
  }
  mounted = true;
  return paths.length;
}

export default ProtectedResourceMetadataController;
