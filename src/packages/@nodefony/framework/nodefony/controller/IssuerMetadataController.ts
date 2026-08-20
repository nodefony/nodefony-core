import type { Module } from "nodefony";
import {
  JWKS_PATH,
  authorizationServerMetadataPath,
  buildAuthorizationServerMetadata,
} from "nodefony";
import type { ContextType } from "@nodefony/http";
import Router from "../service/router";
import Controller from "../src/Controller";
import { askedAuthority, onDeclaredAuthority } from "./oauthAuthority";

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
 * Le montage ne suffit pas : servir encore exige que la requête entre par
 * **l'autorité de l'émetteur** ({@link IssuerMetadataController.metadata}). Un
 * serveur écoute plusieurs adresses ; l'émetteur n'en désigne qu'une.
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
   * 🔴 Ces documents ne sont servis QUE sur l'autorité de l'émetteur.
   *
   * Un serveur écoute presque toujours plusieurs autorités — deux ports en
   * développement, plusieurs hôtes virtuels en production. Servir le document
   * sur toutes revient à répondre « le serveur d'autorisation, c'est ici » à un
   * client qui interroge une adresse dont l'émetteur ne se réclame pas : il
   * DOIT alors rejeter le document (RFC 8414 §3.3 exige l'égalité stricte de
   * `issuer`), et un client réel s'arrête là — il ne cherche pas ailleurs.
   * Vécu : un client MCP sondant `http://localhost:5151` recevait le document
   * de `https://localhost:5152` et déclarait la connexion en échec, alors que
   * `404` l'aurait simplement fait continuer sans authentification.
   *
   * La comparaison porte sur l'**autorité demandée** (hôte + port, tels que le
   * client les a écrits), jamais sur le schéma : derrière un relais qui termine
   * TLS, le processus voit `http` pour une requête que le client a faite en
   * `https`, et refuser là-dessus fermerait le document en production. Le port
   * par défaut est normalisé par `URL` — `app.example:443` et `app.example`
   * désignent le même serveur et doivent se valoir.
   *
   * @param issuer - émetteur canonique publié
   * @returns `true` si la requête entre par l'autorité de l'émetteur
   */
  #onIssuerAuthority(issuer: string): boolean {
    // La règle est partagée avec le rôle serveur de ressource (RFC 9728 §3.3) :
    // même raisonnement, même correctif le jour où il faudra en écrire un.
    return onDeclaredAuthority(askedAuthority(this.request?.headers), issuer);
  }

  /**
   * `GET /.well-known/oauth-authorization-server` — métadonnées d'émetteur.
   *
   * @returns le document RFC 8414, ou `404` si la publication a été coupée
   *          après le montage des routes
   */
  async metadata() {
    const issuer = this.#publisher()?.publishedIssuer() ?? null;
    if (!issuer || !this.#onIssuerAuthority(issuer)) {
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
    const issuer = publisher?.publishedIssuer() ?? null;
    if (!publisher || !issuer || !this.#onIssuerAuthority(issuer)) {
      // Même règle que les métadonnées : le `jwks_uri` publié désigne CETTE
      // autorité. Servir les clés ailleurs inviterait un client à les mettre en
      // cache sous une origine qui n'est pas celle de l'émetteur.
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
