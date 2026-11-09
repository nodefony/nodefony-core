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
 * Ce qui a été PUBLIÉ au montage — la même liste qui a décidé des chemins.
 *
 * Le controller la relit plutôt que de réinterroger les services à chaque
 * requête, pour deux raisons. La première est la justesse : les routes sont
 * montées une fois, à partir de cette liste ; servir un document composé
 * d'autre chose ferait répondre une ressource à un chemin dérivé d'une autre.
 * La seconde est le coût : balayer le conteneur sur le chemin de la requête
 * pour un document qui ne change qu'au redéploiement est exactement la dépense
 * que la règle de perf proscrit.
 */
let published: readonly IProtectedResourceInput[] = Object.freeze([]);

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

  /** Chemin bien connu demandé, tel que le Router l'a matché. */
  #askedPath(): string | null {
    const req: unknown = this.request;
    if (typeof req !== "object" || req === null) return null;
    const p = "pathname" in req ? req.pathname : undefined;
    if (typeof p === "string") return p;
    const url = "url" in req ? req.url : undefined;
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
    const declared = published;
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
        `métadonnées de ressource protégée impubliables : ${error instanceof Error ? error.message : String(error)}`,
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
 * Vue minimale du conteneur de services — assez pour balayer, pas plus.
 *
 * Le type complet vit dans `nodefony` mais l'importer ici lierait ce fichier au
 * cœur pour une seule opération de lecture.
 */
export interface IServiceScan {
  keys(): string[];
  get(name: string): unknown;
}

/**
 * Rassemble ce que TOUS les services du conteneur déclarent protéger.
 *
 * ⭐ **Pourquoi balayer plutôt que demander à un service nommé.** Les ressources
 * protégées d'une application n'ont pas une source unique : le pare-feu en
 * déclare (une zone qui exige un jeton tiers), et un module peut en déclarer une
 * de son propre chef — la porte MCP de `@nodefony/devkit` en est le premier cas.
 * Interroger le seul `firewall` aurait laissé chaque autre module monter SON
 * document, c'est-à-dire recopier cette règle autant de fois qu'il y a de
 * sources, avec la collision de chemin en prime : `Router.createRoute` empile
 * sans vérifier, et la seconde route ne serait jamais atteinte.
 *
 * Un **registre** aurait fait le même travail, au prix d'une dépendance d'ordre :
 * un module qui s'enregistre après le `onKernelReady` du framework ne serait
 * jamais publié, et rien ne le dirait. Le balayage n'a pas ce défaut — les
 * services sont tous en place bien avant, et la question se pose au moment où
 * l'on monte.
 *
 * Le contrat est **structurel** : porter la méthode suffit, aucun import, aucune
 * interface à implémenter formellement — le même couplage que `tokenService` ou
 * `adminBroker`.
 *
 * Deux sources peuvent déclarer la MÊME ressource — une zone du pare-feu et la
 * porte MCP qu'elle couvre, typiquement — : elles sont fusionnées
 * ({@link mergeProtectedResources}), jamais départagées par leur ordre.
 *
 * @param container - conteneur de services de l'application
 * @returns les ressources déclarées, une entrée par ressource, dans l'ordre des
 *          services
 */
export function collectProtectedResources(
  container: IServiceScan,
): readonly IProtectedResourceInput[] {
  const collected: IProtectedResourceInput[] = [];
  for (const name of container.keys()) {
    const service = container.get(name);
    if (
      typeof service !== "object" ||
      service === null ||
      !("publishedProtectedResources" in service) ||
      typeof service.publishedProtectedResources !== "function"
    ) {
      continue;
    }
    let declared: unknown;
    try {
      // `Reflect.apply` : la méthode n'est connue que comme `Function` — son
      // résultat entre en `unknown`, et se vérifie juste en dessous.
      declared = Reflect.apply(
        service.publishedProtectedResources,
        service,
        [],
      );
    } catch {
      // Un service qui ne sait pas répondre ne doit pas empêcher les autres de
      // publier — et surtout pas faire tomber le boot pour un document.
      continue;
    }
    if (!Array.isArray(declared)) continue;
    for (const entry of declared) {
      if (isProtectedResourceInput(entry)) collected.push(entry);
    }
  }
  return mergeProtectedResources(collected);
}

/** Une liste de chaînes, ou rien. */
function isStringList(value: unknown): value is readonly string[] {
  return (
    Array.isArray(value) &&
    value.every((item: unknown) => typeof item === "string")
  );
}

/**
 * Une déclaration a-t-elle la forme d'une ressource publiable ? Le contrat est
 * structurel ({@link IProtectedResourcePublisher}) : ce qu'un service rend se
 * VÉRIFIE, il ne se suppose pas.
 */
function isProtectedResourceInput(
  value: unknown,
): value is IProtectedResourceInput {
  if (typeof value !== "object" || value === null) return false;
  if (!("resource" in value) || typeof value.resource !== "string") {
    return false;
  }
  if (
    !("authorizationServers" in value) ||
    !isStringList(value.authorizationServers)
  ) {
    return false;
  }
  return (
    !("scopesSupported" in value) ||
    value.scopesSupported === undefined ||
    isStringList(value.scopesSupported)
  );
}

/** L'union de deux listes, dans l'ordre d'apparition. */
function union(
  first: readonly string[],
  second: readonly string[],
): readonly string[] {
  return [...new Set([...first, ...second])];
}

/**
 * Une ressource, UN document : fusionne les déclarations d'une même ressource
 * (même URI canonique) — l'union de leurs serveurs d'autorisation et de leurs
 * scopes ; le premier nom et la première documentation déclarés.
 *
 * Pourquoi fusionner plutôt que garder la première : une zone du pare-feu
 * publie sa ressource avec les émetteurs de confiance, et la porte MCP qu'elle
 * couvre publie la MÊME ressource avec les scopes de ses outils. Garder la
 * première jetait les scopes sans un mot — et un agent qui suit le document
 * demandait alors un jeton sans eux, qui n'ouvrait pas l'outil.
 *
 * @param entries - déclarations, dans l'ordre des services
 * @returns une entrée par ressource, à la place de la première déclaration
 */
export function mergeProtectedResources(
  entries: readonly IProtectedResourceInput[],
): IProtectedResourceInput[] {
  const merged: IProtectedResourceInput[] = [];
  const byResource = new Map<string, IProtectedResourceInput>();
  for (const entry of entries) {
    let key: string;
    try {
      key = canonicalResourceUri(entry.resource);
    } catch {
      // Impubliable : la route ne sera pas montée (`protectedResourceRoutePaths`).
      merged.push(entry);
      continue;
    }
    const seen = byResource.get(key);
    if (seen === undefined) {
      const first = { ...entry };
      byResource.set(key, first);
      merged.push(first);
      continue;
    }
    seen.authorizationServers = union(
      seen.authorizationServers,
      entry.authorizationServers,
    );
    if (entry.scopesSupported !== undefined) {
      seen.scopesSupported = union(
        seen.scopesSupported ?? [],
        entry.scopesSupported,
      );
    }
    if (seen.resourceName === undefined && entry.resourceName !== undefined) {
      seen.resourceName = entry.resourceName;
    }
    if (
      seen.resourceDocumentation === undefined &&
      entry.resourceDocumentation !== undefined
    ) {
      seen.resourceDocumentation = entry.resourceDocumentation;
    }
  }
  return merged;
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
  published = resources;
  let index = 0;
  for (const path of paths) {
    Router.createRoute(`security.resource.metadata.${index++}`, {
      path,
      constructor: ProtectedResourceMetadataController,
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
    Router.setController(ProtectedResourceMetadataController, frameworkModule);
  }
  mounted = true;
  return paths.length;
}

export default ProtectedResourceMetadataController;
