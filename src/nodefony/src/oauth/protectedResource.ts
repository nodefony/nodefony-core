import { readBearerHeader } from "../runtime/bearer";

/**
 * Rôle **serveur de ressource** OAuth 2.1 — publier ce qu'on protège, et refuser
 * en disant où obtenir un jeton.
 *
 * ## Ce que ce fichier n'est pas
 *
 * Il n'est **pas** un serveur d'autorisation, et il n'y en a jamais eu besoin :
 * délivrer des jetons est un rôle distinct, que les spécifications placent
 * explicitement hors du serveur de ressource (« may be hosted with the resource
 * server **or a separate entity** »). Avoir écrit l'inverse a servi d'excuse à ne
 * rien faire pendant tout un cycle — le reste à faire était un ordre de grandeur
 * plus petit que ce qu'on s'était raconté.
 *
 * Il n'est pas non plus lié au **Model Context Protocol**, qui n'en est que le
 * premier consommateur. Rien ici ne connaît JSON-RPC, les outils ou le
 * catalogue : une ressource, une audience, un jeton, un refus. C'est ce qui
 * permettra à une porte agentique de production, ou à une API d'agents, de
 * réutiliser ces briques sans qu'un protocole de développement ne déteigne sur
 * elles.
 *
 * ## Plusieurs ressources dans une même application
 *
 * La RFC 9728 le prévoit par construction : le chemin de la ressource est
 * **inséré** dans l'URL bien connue (§3.1 — « Using path components enables
 * supporting multiple resources per host »). Une application peut donc protéger
 * `/nodefony/mcp` et, demain, une autre porte, chacune avec ses propres
 * serveurs d'autorisation, ses scopes et son audience — sans qu'aucune de ces
 * fonctions change.
 *
 * @see references/rfc/ietf/rfc9728.txt — métadonnées de la ressource protégée
 * @see references/rfc/ietf/rfc6750.txt — présentation du jeton, `WWW-Authenticate`
 * @see references/rfc/ietf/rfc8707.txt — l'audience, qui LIE un jeton à CE serveur
 */

/** Préfixe bien connu des métadonnées d'une ressource protégée (RFC 9728 §3). */
const WELL_KNOWN = "/.well-known/oauth-protected-resource";

/**
 * Métadonnées publiées d'une ressource protégée — RFC 9728 §2.
 *
 * Les noms de champs sont ceux du registre IANA, en `snake_case` : c'est un
 * document de protocole, pas un objet interne. Le renommer « pour la
 * cohérence » le rendrait illisible par tout client conforme.
 *
 * Seul `resource` est REQUIS par la RFC. `authorization_servers` y est optionnel
 * — mais un consommateur peut en faire une exigence (le Model Context Protocol
 * l'impose : « MUST include the `authorization_servers` field containing at
 * least one authorization server »), et c'est ce que
 * {@link buildProtectedResourceMetadata} applique : sans serveur d'autorisation,
 * le document ne mène nulle part, donc il ne se publie pas.
 */
export interface IProtectedResourceMetadata {
  /** URI canonique de la ressource — l'audience que les jetons doivent porter. */
  resource: string;
  /** Serveurs d'autorisation capables d'émettre un jeton pour elle. */
  authorization_servers: string[];
  /** Scopes que la ressource comprend — guide le client (RECOMMENDED). */
  scopes_supported?: string[];
  /**
   * Comment présenter le jeton. Toujours `["header"]` ici, et c'est normatif :
   * la spécification MCP interdit la chaîne de requête (« Access tokens MUST NOT
   * be included in the URI query string ») — une URL finit dans les journaux,
   * l'historique et le `Referer`.
   */
  bearer_methods_supported?: string[];
  /** Nom lisible, affiché par le client pendant le consentement. */
  resource_name?: string;
  /** Où un humain lit ce que fait cette ressource. */
  resource_documentation?: string;
}

/** De quoi composer le document — ce que l'application, seule, connaît. */
export interface IProtectedResourceInput {
  /**
   * URI canonique de la ressource, telle qu'un client l'atteint.
   *
   * 🔴 **Elle s'ÉCRIT, elle ne se dérive pas de l'en-tête `Host`.** Si l'URI
   * publiée et l'audience attendue venaient toutes deux de la requête, un `Host`
   * forgé obtiendrait un jeton d'audience arbitraire *et* passerait la
   * vérification : la liaison d'audience (RFC 8707), dont c'est l'unique raison
   * d'être, ne protégerait plus rien. Un déploiement derrière un relais doit de
   * toute façon déclarer son URL publique.
   */
  resource: string;
  /** Au moins un serveur d'autorisation — sinon le document ne mène nulle part. */
  authorizationServers: readonly string[];
  /** Scopes compris par la ressource (facultatif, mais recommandé). */
  scopesSupported?: readonly string[];
  /** Nom lisible par un humain. */
  resourceName?: string;
  /** URL d'une documentation destinée à un humain. */
  resourceDocumentation?: string;
}

/**
 * Normalise et contrôle une URI canonique de ressource (RFC 8707 §2).
 *
 * Trois refus, tous vécus comme des sources d'erreur silencieuse ailleurs :
 * l'absence de schéma (une audience relative ne se compare à rien), un fragment
 * (interdit — il ne voyage jamais jusqu'au serveur, donc deux URI distinctes
 * seraient reçues identiques), et un schéma non `http(s)`.
 *
 * La barre oblique terminale est retirée : les deux formes sont des URI
 * valides, mais l'audience se compare par **chaîne exacte** — publier une forme
 * et valider l'autre produit un refus que rien n'explique.
 *
 * @param raw - URI telle qu'écrite en configuration
 * @returns l'URI canonique, sans barre terminale
 * @throws Error si l'URI ne peut pas servir d'audience
 */
export function canonicalResourceUri(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(
      `URI de ressource invalide : « ${raw} » — une URI absolue est attendue ` +
        `(ex. « https://mon-app.example/nodefony/mcp »).`,
    );
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error(
      `URI de ressource invalide : schéma « ${url.protocol} » — http(s) attendu.`,
    );
  }
  if (url.hash) {
    throw new Error(
      `URI de ressource invalide : « ${raw} » porte un fragment, que la ` +
        `RFC 8707 §2 interdit (il n'atteint jamais le serveur).`,
    );
  }
  const composed = `${url.origin}${url.pathname}${url.search}`;
  return composed.endsWith("/") && url.pathname !== "/"
    ? composed.slice(0, -1)
    : composed.replace(/\/$/, "");
}

/**
 * Compose le CHEMIN où publier les métadonnées, à partir de l'URI de la
 * ressource (RFC 9728 §3.1).
 *
 * La règle est une insertion, pas une concaténation : le suffixe bien connu se
 * place **entre l'hôte et le chemin** de la ressource. Une application qui
 * publierait `…/nodefony/mcp/.well-known/…` servirait un document que personne
 * ne demande jamais.
 *
 * @param resource - URI canonique de la ressource (ou son seul chemin)
 * @returns le chemin absolu à servir en `GET`
 *
 * @example
 * ```ts
 * protectedResourceMetadataPath("https://app.example/nodefony/mcp");
 * // → "/.well-known/oauth-protected-resource/nodefony/mcp"
 * protectedResourceMetadataPath("https://app.example");
 * // → "/.well-known/oauth-protected-resource"
 * ```
 */
export function protectedResourceMetadataPath(resource: string): string {
  let path = resource;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(resource)) {
    const url = new URL(resource);
    path = `${url.pathname}${url.search}`;
  }
  // « any terminating slash following the host component MUST be removed »
  if (path === "/" || path === "") return WELL_KNOWN;
  const trimmed = path.endsWith("/") ? path.slice(0, -1) : path;
  return `${WELL_KNOWN}${trimmed.startsWith("/") ? "" : "/"}${trimmed}`;
}

/**
 * Compose l'URL ABSOLUE des métadonnées — celle qui part dans le défi.
 *
 * @param resource - URI canonique de la ressource
 * @returns l'URL complète du document de métadonnées
 */
export function protectedResourceMetadataUrl(resource: string): string {
  const canonical = canonicalResourceUri(resource);
  const { origin } = new URL(canonical);
  return `${origin}${protectedResourceMetadataPath(canonical)}`;
}

/**
 * Compose le document de métadonnées.
 *
 * @param input - ce que l'application déclare de sa ressource
 * @returns le document, prêt à sérialiser
 * @throws Error si aucun serveur d'autorisation n'est déclaré, ou si l'URI de
 *         ressource ne peut pas servir d'audience
 */
export function buildProtectedResourceMetadata(
  input: IProtectedResourceInput,
): IProtectedResourceMetadata {
  const servers = input.authorizationServers.filter(
    (s) => typeof s === "string" && s.length > 0,
  );
  if (servers.length === 0) {
    throw new Error(
      "métadonnées de ressource protégée : aucun serveur d'autorisation " +
        "déclaré. Un document sans `authorization_servers` ne mène nulle part — " +
        "le client apprendrait qu'un jeton est requis sans jamais pouvoir en " +
        "obtenir un.",
    );
  }
  const metadata: IProtectedResourceMetadata = {
    resource: canonicalResourceUri(input.resource),
    authorization_servers: [...servers],
    bearer_methods_supported: ["header"],
  };
  if (input.scopesSupported && input.scopesSupported.length > 0) {
    metadata.scopes_supported = [...input.scopesSupported];
  }
  if (input.resourceName) metadata.resource_name = input.resourceName;
  if (input.resourceDocumentation) {
    metadata.resource_documentation = input.resourceDocumentation;
  }
  return metadata;
}

/** Codes d'erreur d'un porteur — RFC 6750 §3.1. */
export const BearerError = {
  /**
   * Requête mal formée (schéma inconnu, jeton absent après `Bearer`).
   * La RFC veut **400**, pas 401 : rien n'a été présenté qu'on puisse juger.
   */
  INVALID_REQUEST: "invalid_request",
  /** Jeton expiré, révoqué, mal formé, ou d'une autre audience → **401**. */
  INVALID_TOKEN: "invalid_token",
  /** Identité prouvée, droits insuffisants → **403**. */
  INSUFFICIENT_SCOPE: "insufficient_scope",
} as const;

/** Un des codes de {@link BearerError}. */
export type BearerErrorCode = (typeof BearerError)[keyof typeof BearerError];

/** De quoi composer un défi `WWW-Authenticate`. */
export interface IBearerChallenge {
  /** URL du document de métadonnées — RFC 9728 §5.1. */
  resourceMetadataUrl: string;
  /** Scopes nécessaires à l'opération en cours. */
  scopes?: readonly string[];
  /** Code d'erreur, ABSENT quand la requête ne portait aucune information. */
  error?: BearerErrorCode;
  /** Explication lisible, jamais une cause fine (anti-oracle). */
  description?: string;
}

/**
 * Compose l'en-tête `WWW-Authenticate` d'un refus.
 *
 * ⭐ **C'est cet en-tête qui rend l'autorisation apprenable.** Sans lui, un
 * refus est un mur : le client ignore qu'un jeton existe, où le demander et pour
 * quels droits. Avec `resource_metadata`, il remonte seul jusqu'au serveur
 * d'autorisation — c'est le seul mécanisme normalisé pour cela.
 *
 * 🔴 **Le code d'erreur est OMIS quand la requête ne portait aucune information
 * d'authentification** — la RFC 6750 §3 le demande explicitement (« the resource
 * server SHOULD NOT include an error code or other error information »). Un
 * `invalid_token` sur une requête sans jeton ferait croire au client que son
 * jeton est mauvais, et le pousserait à le renouveler en boucle.
 *
 * @param challenge - de quoi composer le défi
 * @returns la valeur de l'en-tête `WWW-Authenticate`
 */
export function buildBearerChallenge(challenge: IBearerChallenge): string {
  // Ordre stable : ce qui identifie la ressource d'abord, la cause ensuite.
  const parts: string[] = [
    `resource_metadata="${challenge.resourceMetadataUrl}"`,
  ];
  if (challenge.scopes && challenge.scopes.length > 0) {
    parts.push(`scope="${challenge.scopes.join(" ")}"`);
  }
  if (challenge.error) parts.push(`error="${challenge.error}"`);
  if (challenge.description) {
    parts.push(
      `error_description="${sanitizeDescription(challenge.description)}"`,
    );
  }
  return `Bearer ${parts.join(", ")}`;
}

/**
 * Restreint une description à ce que la RFC 6750 §3 autorise.
 *
 * La grammaire y est explicite — `%x20-21 / %x23-5B / %x5D-7E` — soit l'ASCII
 * imprimable **sans** guillemet ni antislash. Ce n'est pas une coquetterie : un
 * en-tête HTTP n'est pas de l'UTF-8, et un simple accent y ressort en mojibake
 * chez le client (constaté : « jeton refusé » arrivait en « jeton refus? »).
 * Un antislash, lui, casserait carrément la grammaire de la chaîne citée.
 *
 * Le filtrage vit ICI, au point de composition, et non dans chaque message :
 * autrement le prochain texte accentué reproduirait le défaut, et personne ne
 * le verrait — un en-tête abîmé ne fait échouer aucun test qui ne le lit pas.
 *
 * @param raw - description telle qu'écrite par l'appelant
 * @returns la description réduite au jeu de caractères autorisé
 */
function sanitizeDescription(raw: string): string {
  let out = "";
  // Le guillemet devient une APOSTROPHE, pas une espace : `'` (0x27) est dans
  // la grammaire, et une citation reste lisible. Les autres caractères hors
  // grammaire, eux, n'ont pas d'équivalent évident.
  for (const char of raw.replace(/"/g, "'")) {
    const code = char.codePointAt(0) ?? 0;
    if (
      (code >= 0x20 && code <= 0x21) ||
      (code >= 0x23 && code <= 0x5b) ||
      (code >= 0x5d && code <= 0x7e)
    ) {
      out += char;
      continue;
    }
    // Les caractères hors grammaire deviennent une espace plutôt que de
    // disparaître : « en-tete mal forme » reste lisible, « entetemalforme »
    // beaucoup moins. Les espaces multiples sont resserrés ensuite.
    out += " ";
  }
  return out.replace(/ {2,}/g, " ").trim();
}

/**
 * Ce qu'une vérification de jeton RÉUSSIE établit.
 *
 * Il n'y a pas de drapeau `authenticated` : ce type n'existe que lorsqu'une
 * identité a été prouvée. Un booléen aurait permis de fabriquer un principal
 * « non authentifié » et de le passer plus loin — exactement l'erreur que le
 * type doit rendre impossible.
 */
export interface IAccessPrincipal {
  /**
   * Émetteur VÉRIFIÉ du jeton (`iss`), sous sa forme canonique.
   *
   * 🔴 **Un `sub` seul ne désigne personne.** OpenID Connect ne le garantit
   * unique et non réassigné QUE dans l'espace de son émetteur : l'identité est
   * la paire `(iss, sub)`. Transporter le sujet sans son émetteur revient à
   * verser des identifiants étrangers dans l'espace de noms local — et un
   * annuaire où l'utilisateur choisit son identifiant suffit alors à réclamer
   * `admin`.
   *
   * REQUIS, et non optionnel : un vérificateur incapable de dire d'où vient une
   * identité ne doit pas pouvoir en produire une. Le rendre facultatif
   * laisserait chaque appelant décider de s'en passer, ce qui est exactement la
   * façon dont ce trou est né.
   *
   * ⚠️ C'est l'émetteur de l'ALLOWLIST — celui contre lequel la signature a été
   * vérifiée — jamais la valeur brute lue dans le jeton.
   */
  issuer: string;
  /** Sujet du jeton (`sub`) — pour l'audit, et pour borner ce qu'on rend. */
  subject?: string;
  /** Scopes réellement accordés. */
  scopes: readonly string[];
  /**
   * Expiration du jeton (`exp`), en **secondes** epoch — RFC 7519 §4.1.4.
   *
   * Elle a déjà été vérifiée au moment de la validation ; si elle est ici, c'est
   * pour ce qui vient APRÈS. Une requête HTTP se termine avant que la question
   * se pose, mais une connexion durable — une socket ouverte au nom de ce jeton
   * — doit pouvoir mourir avec lui. Sans cette borne transportée jusqu'à
   * l'appelant, une identité vérifiée une fois vaut indéfiniment : le jeton
   * expire, la connexion reste.
   *
   * ⚠️ **Secondes**, comme le claim JWT dont elle vient — pas des millisecondes.
   */
  expiresAt?: number;
  /** Émission du jeton (`iat`), en **secondes** epoch — révocation en masse. */
  issuedAt?: number;
  /**
   * Identifiant unique du jeton (`jti`) — révocation CIBLÉE avant terme.
   *
   * Il vient d'un émetteur étranger : il ne désigne rien dans nos registres, et
   * ne sert qu'à interroger une liste de révocation qui, elle, peut le connaître.
   */
  tokenId?: string;
}

/**
 * Ce qui sait valider un jeton — implémenté ailleurs, jamais ici.
 *
 * Le cœur ne valide aucune signature : cela demande un fournisseur de clés, une
 * dépendance cryptographique et une politique, qui vivent dans le module de
 * sécurité. Le contrat est ici pour que la porte n'ait pas à connaître son
 * implémentation, et pour qu'une application puisse en fournir une autre.
 *
 * @param token - le jeton présenté, brut
 * @param audience - l'URI canonique de CETTE ressource ; l'implémentation
 *          **doit** refuser un jeton qui ne la porte pas (RFC 8707 §2) — c'est
 *          ce qui empêche un jeton émis pour un autre service d'être rejoué ici
 * @returns le principal établi, ou `null` — jamais une exception pour un refus
 */
export type IAccessTokenVerifier = (
  token: string,
  audience: string,
) => Promise<IAccessPrincipal | null>;

/**
 * Nom sous lequel un {@link IAccessTokenVerifier} se pose dans le conteneur.
 *
 * ⭐ **La constante vit ICI, avec le contrat, et pas ailleurs.** Le nom est le
 * point de rendez-vous entre deux paquets qui ne se connaissent pas : celui qui
 * POSE le vérificateur (la sécurité, qui porte la cryptographie) et ceux qui le
 * LISENT (toute porte protégée). Écrit en dur de chaque côté, il vaut jusqu'au
 * jour où l'un des deux le renomme — un littéral ne casse aucune compilation,
 * et la porte cherche alors un service que personne ne pose. Importé, un
 * renommage devient une erreur de type.
 *
 * Le nom est **générique** à dessein : le contrat prend l'audience en
 * paramètre, donc une seule implémentation sert autant de ressources protégées
 * que l'application en publie (RFC 9728 §3.1).
 */
export const ACCESS_TOKEN_VERIFIER = "accessTokenVerifier";

/** Politique appliquée à une requête vers une ressource protégée. */
export interface IProtectedResourcePolicy {
  /** URI canonique de la ressource — l'audience PUBLIÉE, et la première essayée. */
  resource: string;
  /**
   * Autres URI sous lesquelles CETTE MÊME ressource est joignable, et dont les
   * jetons sont acceptés.
   *
   * ⭐ Une ressource peut avoir plusieurs adresses sans cesser d'être une : la
   * même porte servie en clair sur un port et en TLS sur un autre est un cas
   * courant en développement, et un jeton émis pour l'une était refusé sur
   * l'autre — la liaison d'audience faisant, à juste titre, son travail. La
   * réponse n'est pas de relâcher la liaison, c'est de DIRE quelles adresses
   * désignent cette ressource.
   *
   * 🔴 Ces valeurs s'ÉCRIVENT, elles ne se dérivent jamais du `Host` de la
   * requête : dérivées, un `Host` forgé obtiendrait un jeton d'audience
   * arbitraire *et* passerait la vérification, ce qui viderait la liaison de sa
   * seule raison d'être. La liste reste FERMÉE.
   *
   * Le document RFC 9728 ne publie que {@link IProtectedResourcePolicy.resource}
   * — la RFC n'y admet qu'une valeur, et un client n'a besoin que d'une adresse
   * pour demander son jeton.
   */
  acceptedResources?: readonly string[];
  /** URL du document de métadonnées, citée dans chaque refus. */
  metadataUrl: string;
  /** Scopes annoncés au client quand on le refuse. */
  scopes?: readonly string[];
  /**
   * Servir une requête sans jeton comme anonyme, au lieu de la refuser.
   *
   * Défaut attendu : `false`. Ouvrir est un choix qui s'écrit, jamais un
   * comportement qu'on hérite.
   */
  allowAnonymous: boolean;
}

/** Verdict rendu à la porte — à elle de le traduire en réponse. */
export type ProtectedResourceOutcome =
  /** Aucun jeton, et la politique l'accepte. */
  | {
      outcome: "anonymous";
      /**
       * Un jeton a été présenté et REJETÉ, et la porte sert quand même
       * l'anonyme — pour le JOURNAL seul, jamais pour le client.
       *
       * Sans ce champ, un jeton expiré devenait indistinguable d'une requête
       * muette : l'agent perdait ses outils réservés sans que rien ne dise
       * pourquoi, et l'exploitant ne voyait aucune trace d'un porteur refusé.
       */
      rejected?: true;
    }
  /** Jeton validé. */
  | { outcome: "authenticated"; principal: IAccessPrincipal }
  /** Refus : statut et en-tête à poser tels quels. */
  | { outcome: "challenge"; status: 400 | 401; wwwAuthenticate: string }
  /**
   * La ressource se dit protégée, mais rien ne peut vérifier un jeton.
   * La porte DOIT alors refuser de servir — laisser passer reviendrait à
   * accepter n'importe quel porteur.
   *
   * Deux causes, que `why` distingue POUR LE JOURNAL seul : aucun vérificateur
   * n'est posé (faute de configuration), ou le vérificateur a ÉCHOUÉ — émetteur
   * injoignable, jeu de clés illisible. Le client, lui, reçoit le même refus
   * dans les deux cas : ce qui empêche de le servir ne le regarde pas.
   */
  | { outcome: "unverifiable"; why?: string };

/**
 * Décide du sort d'une requête d'après l'en-tête `Authorization`.
 *
 * **Fonction pure** (hors l'appel au vérificateur) : elle ne touche ni au
 * socket, ni au conteneur, ni à l'horloge — d'où le fait que chacun de ses
 * verdicts, statuts et en-têtes compris, s'éprouve sans démarrer de serveur.
 *
 * @param authorizationHeader - valeur brute de l'en-tête, ou rien
 * @param policy - ce que la ressource exige
 * @param verify - ce qui sait valider un jeton, s'il y a quelque chose
 * @returns le verdict à appliquer
 */
export async function authorizeProtectedResource(
  authorizationHeader: unknown,
  policy: IProtectedResourcePolicy,
  verify: IAccessTokenVerifier | undefined,
): Promise<ProtectedResourceOutcome> {
  const lu = readBearerHeader(authorizationHeader);

  // 🔴 « Rien présenté » couvre DEUX formes, et les séparer coûtait la
  // capacité entière : l'en-tête absent, et l'en-tête `Bearer` qui ne porte
  // aucun jeton. Le second est le cas COURANT d'un client dont la variable
  // d'environnement n'a pas été substituée (`Authorization: Bearer `) : il
  // recevait `400` là où le même client, muet, recevait les outils publics —
  // la porte punissait plus sévèrement celui qui n'a rien à dire que celui qui
  // se tait, et la tolérance anonyme devenait inatteignable par accident de
  // configuration. Aucun risque à les réunir : un en-tête vide ne prouve rien
  // de plus qu'une absence, donc il n'obtient rien de plus.
  if (lu.kind === "absent" || lu.kind === "empty") {
    if (policy.allowAnonymous) return { outcome: "anonymous" };
    return {
      outcome: "challenge",
      status: 401,
      // Aucun code d'erreur : la requête ne portait rien à juger (RFC 6750 §3).
      wwwAuthenticate: buildBearerChallenge({
        resourceMetadataUrl: policy.metadataUrl,
        scopes: policy.scopes,
      }),
    };
  }

  // Un AUTRE schéma, lui, reste une faute du client : il croit s'authentifier
  // et ne le fait pas. Le lui dire (`400`) vaut mieux que le servir en anonyme,
  // ce qui laisserait son erreur invisible jusqu'au premier outil retenu.
  if (lu.kind === "other") {
    return {
      outcome: "challenge",
      status: 400,
      wwwAuthenticate: buildBearerChallenge({
        resourceMetadataUrl: policy.metadataUrl,
        scopes: policy.scopes,
        error: BearerError.INVALID_REQUEST,
        // ASCII volontaire : la RFC 6750 §3 restreint ce champ, et le filtre de
        // `buildBearerChallenge` remplacerait tout accent par une espace.
        description: "malformed Authorization header, Bearer scheme expected",
      }),
    };
  }

  const token = lu.token;

  // Un porteur est présenté et rien ne sait le juger : refuser, toujours. Servir
  // en anonyme reviendrait à traiter un jeton comme s'il n'existait pas, et à
  // accepter en pratique n'importe lequel.
  if (!verify) return { outcome: "unverifiable" };

  // 🔴 Une PANNE de vérification n'est pas un jeton invalide, et ce n'est pas
  // non plus une erreur du client. Sans ce rattrapage, l'exception traversait la
  // porte et sortait en 500 avec sa trace d'appels — le porteur d'un jeton
  // PARFAITEMENT valide lisait une pile Node, et l'exploitant cherchait la faute
  // dans le jeton. Vécu : un émetteur injoignable parce que le certificat de
  // développement de l'application n'est pas dans le magasin d'autorités de
  // Node. Le verdict est `unverifiable` — la porte refuse de servir, et le dit.
  let principal: IAccessPrincipal | null = null;
  try {
    // L'audience publiée d'abord — c'est celle que suivra un client conforme.
    // Les autres adresses de la MÊME ressource ensuite, dans l'ordre écrit. La
    // boucle est bornée par la configuration, jamais par la requête.
    for (const audience of [
      policy.resource,
      ...(policy.acceptedResources ?? []),
    ]) {
      principal = await verify(token, audience);
      if (principal !== null) break;
    }
  } catch (error) {
    return { outcome: "unverifiable", why: (error as Error).message };
  }
  if (principal === null) {
    // 🔴 Une porte qui TOLÈRE l'anonyme ne peut pas punir un jeton rejeté plus
    // durement qu'une requête muette.
    //
    // Le paradoxe était complet : sans en-tête, le client recevait les outils
    // publics ; avec un jeton expiré — ou un gabarit `${…}` que son
    // environnement n'a pas substitué — il recevait `401` et PLUS RIEN. Un
    // client MCP marque alors le serveur « failed » pour toute la session,
    // donc un jeton périmé coûtait l'outillage entier, quand ne rien
    // présenter l'aurait conservé.
    //
    // Servir en anonyme n'accorde AUCUN privilège : un jeton rejeté obtient
    // exactement ce qu'obtient un inconnu, et les outils réservés restent
    // retenus — la liaison d'audience (RFC 8707) garde donc tout son mordant,
    // elle n'est simplement plus une porte qui claque. Le refus, lui, n'est
    // pas tu : il part au journal (`rejected`).
    //
    // `allowAnonymous` reste FAUX en production, où un jeton rejeté redevient
    // un `401` — c'est là que ce drapeau prend son sens.
    if (policy.allowAnonymous) return { outcome: "anonymous", rejected: true };
    return {
      outcome: "challenge",
      status: 401,
      wwwAuthenticate: buildBearerChallenge({
        resourceMetadataUrl: policy.metadataUrl,
        scopes: policy.scopes,
        error: BearerError.INVALID_TOKEN,
        // Message UNIFORME : la cause fine (expiré, audience, signature) part
        // dans le journal d'audit, jamais au client — sinon le refus devient un
        // oracle qui aide à fabriquer un jeton acceptable.
        description: "token rejected",
      }),
    };
  }
  return { outcome: "authenticated", principal };
}

/**
 * L'appelant présente-t-il TOUS les scopes exigés ?
 *
 * « Tous », et pas « au moins un » : un scope borne un pouvoir, et les cumuler
 * par disjonction reviendrait à accorder le plus large de la liste.
 *
 * @param granted - scopes accordés au porteur
 * @param required - scopes exigés par l'opération
 * @returns les scopes MANQUANTS — tableau vide si rien ne manque
 */
export function missingScopes(
  granted: readonly string[],
  required: readonly string[],
): string[] {
  if (required.length === 0) return [];
  return required.filter((s) => !granted.includes(s));
}
