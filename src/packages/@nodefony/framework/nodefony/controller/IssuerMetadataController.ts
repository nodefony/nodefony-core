import type { Module } from "nodefony";
import {
  JWKS_PATH,
  authorizationServerMetadataPath,
  buildAuthorizationServerMetadata,
} from "nodefony";
import type { ContextType } from "@nodefony/http";
import Router from "../service/router";
import Controller from "../src/Controller";

/**
 * Vue MINIMALE du service d'émission de jetons, côté **publication**
 * (`tokenService`, posé au container par `@nodefony/security`). Contrat
 * structurel local : framework ne dépend JAMAIS de security — couplage par nom
 * de service, comme `authFlow`/`adminBroker`.
 *
 * Les deux méthodes disent l'essentiel du partage des rôles : security DÉCIDE
 * (peut-on se déclarer émetteur ?) et FOURNIT la matière (les clés publiques) ;
 * framework se contente d'ouvrir la porte.
 */
export interface IIssuerPublisher {
  /** Émetteur canonique publiable, ou `null` si rien ne doit l'être. */
  publishedIssuer(): string | null;
  /** Jeu de clés PUBLIQUES de signature (jamais de clé privée). */
  getPublicJWKS(): Promise<unknown>;
}

// Montage one-shot par process (même sémantique que `mountTokenAuthRoutes`).
let mounted = false;

/**
 * Les deux documents qui rendent une application Nodefony **découvrable** comme
 * émetteur de jetons — RFC 8414 :
 *
 *  - `GET /.well-known/oauth-authorization-server` — métadonnées d'émetteur
 *    (`issuer`, `jwks_uri`) ; c'est le seul document qu'un tiers sait trouver,
 *    puisqu'il ne le lit pas mais le CONSTRUIT depuis l'identifiant d'émetteur
 *    par insertion de chemin (§3.1).
 *  - `GET /.well-known/jwks.json` — le jeu de clés publiques lui-même.
 *
 * ## Pourquoi ces routes existent
 *
 * Sans elles, `getPublicJWKS()` n'a qu'un usage interne : Nodefony vérifie ses
 * propres jetons en mémoire. Un tiers — une autre application Nodefony, un
 * agent, un service — ne peut donc PAS valider une signature émise ici, même en
 * connaissant l'URL des clés : il n'y en a pas. C'est le symétrique exact du
 * rôle serveur de ressource : là, on refusait en disant où aller ; ici, on
 * permet à quelqu'un d'autre de vérifier ce qu'on a signé.
 *
 * ## Ce qui les monte, et ce qui les retient
 *
 * Montées par le module framework UNIQUEMENT si `tokenService.publishedIssuer()`
 * rend une valeur — c'est-à-dire si le JWT est actif, `security.jwt.jwks` vrai,
 * et l'émetteur écrit sous forme d'URL https. Sinon les routes **n'existent
 * pas** (`404`, zéro surface) : un document creux apprendrait à un client qu'il
 * y a quelque chose à découvrir sans lui donner de quoi le faire.
 *
 * `bypassFirewall: true` : ces documents sont publics par construction. Un JWKS
 * derrière une authentification serait un non-sens — il sert précisément à
 * vérifier les jetons de ceux qui ne sont pas encore authentifiés. Ils ne
 * révèlent rien de secret : des clés PUBLIQUES et un identifiant, jamais `d`.
 *
 * @remarks Le chemin des métadonnées est **dérivé** de l'émetteur
 * (`authorizationServerMetadataPath`) et non écrit en dur : un émetteur porteur
 * d'un chemin se publie SOUS ce chemin (RFC 8414 §3.1), et c'est la même
 * fonction qui sert au lecteur, dans `@nodefony/security`.
 */
class IssuerMetadataController extends Controller {
  constructor(context: ContextType) {
    super("IssuerMetadataController", context);
  }

  /** Résout le service d'émission — absent = capacité éteinte. */
  #publisher(): IIssuerPublisher | null {
    return this.get<IIssuerPublisher>("tokenService") ?? null;
  }

  /**
   * `GET /.well-known/oauth-authorization-server` — métadonnées d'émetteur.
   *
   * @returns le document RFC 8414, ou `404` si la publication a été coupée
   *          après le montage des routes
   */
  async metadata() {
    const issuer = this.#publisher()?.publishedIssuer() ?? null;
    if (!issuer) {
      return this.renderJson({ error: "not_found" }, 404);
    }
    let document;
    try {
      document = buildAuthorizationServerMetadata({ issuer });
    } catch (error) {
      // L'émetteur a été validé au boot ; arriver ici veut dire qu'il a changé
      // depuis. Publier un document approximatif serait pire que rien — un
      // client le met en cache, et il porte l'identité de l'application.
      this.log(
        `métadonnées d'émetteur impubliables : ${(error as Error).message}`,
        "CRITIC",
      );
      return this.renderJson({ error: "server_error" }, 500);
    }
    return this.renderJson(document, 200, {
      // Ce document ne change qu'à un redéploiement (même raison qu'en
      // RFC 9728 §7.10) : sans directive, un client conforme le redemande à
      // chaque connexion.
      "Cache-Control": "public, max-age=3600",
    });
  }

  /**
   * `GET /.well-known/jwks.json` — clés publiques de signature.
   *
   * @returns le JWK Set (paramètres publics seuls)
   */
  async jwks() {
    const publisher = this.#publisher();
    if (!publisher?.publishedIssuer()) {
      return this.renderJson({ error: "not_found" }, 404);
    }
    let keys: unknown;
    try {
      keys = await publisher.getPublicJWKS();
    } catch (error) {
      this.log(`JWKS illisible : ${(error as Error).message}`, "CRITIC");
      return this.renderJson({ error: "server_error" }, 500);
    }
    return this.renderJson(keys, 200, {
      // Plus court que les métadonnées : une rotation de clé doit se propager
      // en minutes, pas en heures — un client qui garde un JWKS périmé rejette
      // des jetons parfaitement valides.
      "Cache-Control": "public, max-age=300",
    });
  }
}

/**
 * Monte les deux documents d'émetteur — appelé par le module framework à
 * `onKernelReady`, seulement si `tokenService.publishedIssuer()` répond.
 *
 * @param frameworkModule - module porteur des routes
 * @param issuer - émetteur canonique, qui DÉTERMINE le chemin des métadonnées
 */
export function mountIssuerMetadataRoutes(
  frameworkModule: Module,
  issuer: string,
): void {
  if (mounted) return;
  const routes: Array<[string, string, string]> = [
    [
      "security.issuer.metadata",
      authorizationServerMetadataPath(issuer),
      "metadata",
    ],
    ["security.issuer.jwks", JWKS_PATH, "jwks"],
  ];
  for (const [name, path, classMethod] of routes) {
    Router.createRoute(name, {
      path,
      constructor:
        IssuerMetadataController as unknown as Controller["constructor"],
      classMethod,
      requirements: { methods: ["GET"] },
      bypassFirewall: true,
    });
  }
  if (
    !Object.prototype.hasOwnProperty.call(
      IssuerMetadataController.prototype,
      "module",
    )
  ) {
    Router.setController(
      IssuerMetadataController as unknown as Parameters<
        typeof Router.setController
      >[0],
      frameworkModule,
    );
  }
  mounted = true;
}

export default IssuerMetadataController;
