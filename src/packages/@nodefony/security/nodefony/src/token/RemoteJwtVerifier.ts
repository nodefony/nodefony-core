import type * as Jose from "jose";
import {
  canonicalIssuer,
  extractScopes,
  issuerMetadataUrls,
  validateIssuerMetadata,
  type IAccessPrincipal,
} from "nodefony";

/**
 * Un émetteur en qui l'application accepte de faire confiance.
 *
 * Le fait qu'il n'y ait pas de valeur par défaut pour `issuer` est le cœur du
 * dispositif : **la liste des émetteurs est fermée et vient de la
 * configuration**, jamais d'un jeton. Le `iss` présenté ne sert qu'à choisir
 * DANS cette liste — il ne peut donc pas désigner un serveur que l'application
 * n'a pas nommé, et aucune requête sortante ne peut être provoquée par un
 * appelant anonyme vers une URL de son choix.
 */
export interface ITrustedIssuer {
  /** Identifiant canonique de l'émetteur (`iss` attendu dans les jetons). */
  issuer: string;
  /**
   * Jeu de clés, quand on ne veut pas de découverte.
   *
   * Utile pour un émetteur qui ne publie pas de métadonnées, et pour supprimer
   * une requête au démarrage à froid. Déclaré, il fait autorité : rien n'est
   * découvert.
   */
  jwksUri?: string;
  /**
   * Algorithmes de signature acceptés — **allowlist côté serveur**.
   *
   * RFC 8725 §3.1 : l'algorithme ne se déduit JAMAIS de l'en-tête du jeton.
   * Tous asymétriques, et c'est structurel : les clés viennent d'un jeu PUBLIC,
   * donc accepter un algorithme à secret partagé (`HS*`) laisserait un attaquant
   * signer avec la clé publique de l'émetteur, que tout le monde peut lire.
   */
  algorithms: readonly string[];
  /**
   * Valeur exigée de l'en-tête `typ` (RFC 9068 : `at+jwt`), ou rien.
   *
   * Non exigé par défaut : le parc réel est très inégal sur ce point, et un
   * défaut strict serait désactivé en bloc à la première intégration plutôt que
   * réglé finement. La séparation entre jetons est déjà assurée par l'audience,
   * qui, elle, n'est pas facultative.
   */
  typ?: string;
  /** Claims dont la PRÉSENCE est exigée, en plus de `iss`/`aud`/`sub`. */
  requiredClaims?: readonly string[];
}

/** Réglages du vérificateur — au-delà de la liste des émetteurs. */
export interface IRemoteJwtVerifierOptions {
  /** Les émetteurs de confiance. Vide = le vérificateur ne sert à rien. */
  issuers: readonly ITrustedIssuer[];
  /** Délai maximal d'une requête vers un émetteur (ms). */
  timeoutMs?: number;
  /** Fenêtre pendant laquelle on ne redemande PAS le jeu de clés (ms). */
  cooldownMs?: number;
  /** Âge maximal du jeu de clés en cache avant rafraîchissement (ms). */
  cacheMaxAgeMs?: number;
  /** Tolérance d'horloge sur `exp`/`nbf` (secondes). */
  clockToleranceS?: number;
  /**
   * Implémentation de `fetch` — le seul moyen d'éprouver ce code SANS réseau.
   *
   * C'est ce qui permet aux tests de jouer une rotation de clés, un émetteur
   * qui ment sur son identité ou un délai dépassé, de façon déterministe et
   * sans démarrer quoi que ce soit.
   */
  fetch?: typeof globalThis.fetch;
  /** Journal d'audit — reçoit la cause FINE, que le client ne voit jamais. */
  log?: (message: string) => void;
}

/** Ce qu'on garde par émetteur, une fois la découverte faite. */
interface IResolvedIssuer {
  trusted: ITrustedIssuer;
  getKey: Jose.JWTVerifyGetKey;
}

/**
 * Codes d'erreur `jose` qui désignent un **jeton fautif** — la liste est
 * BLANCHE, et c'est le point important.
 *
 * La distinction refus / panne n'est pas cosmétique : répondre « jeton refusé »
 * quand l'émetteur est injoignable envoie le client en chercher un autre — qui
 * échouera pareil — et noie la panne dans une statistique d'authentification.
 *
 * Le sens de la liste a été choisi en lisant la source de `jose`, pas de
 * mémoire : un JWKS qui répond `500`, ou dont le corps n'est pas du JSON, y
 * lève une erreur GÉNÉRIQUE (`ERR_JOSE_GENERIC`), et une panne réseau brute
 * remonte sans aucun code. Une liste noire des pannes aurait donc classé ces
 * trois cas — tous des pannes — en « jeton invalide », silencieusement. Ici,
 * ce qui n'est pas explicitement imputable au jeton devient une panne visible.
 */
const TOKEN_FAULT_CODES = new Set([
  "ERR_JWS_SIGNATURE_VERIFICATION_FAILED",
  "ERR_JWT_EXPIRED",
  "ERR_JWT_CLAIM_VALIDATION_FAILED",
  "ERR_JWT_INVALID",
  "ERR_JWS_INVALID",
  "ERR_JOSE_ALG_NOT_ALLOWED",
  // Aucune clé ne correspond au `kid` présenté, jeu de clés rechargé compris :
  // le jeton vient d'ailleurs, ou d'une clé retirée.
  "ERR_JWKS_NO_MATCHING_KEY",
]);

/**
 * Vérificateur de jetons d'accès émis par un **serveur d'autorisation tiers**.
 *
 * C'est la pièce qui manquait pour que le rôle *serveur de ressource* du cœur
 * (`nodefony/src/oauth/`) soit autre chose qu'un refus poli : il sait publier ce
 * qu'il protège et dire où prendre un jeton, mais rien, jusqu'ici, ne savait
 * LIRE ce jeton. `JwtAuthenticator` ne vérifie que les jetons émis par
 * Nodefony lui-même (jeu de clés local) ; ici, les clés appartiennent à
 * quelqu'un d'autre, arrivent par le réseau et tournent sans prévenir.
 *
 * ## Ce qui vaut garantie
 *
 * - **L'audience est obligatoire et vient de l'APPELANT** — jamais du jeton. Un
 *   jeton parfaitement valide, émis par un émetteur de confiance, pour un AUTRE
 *   service, est refusé (RFC 8707 §2). C'est la seule chose qui empêche le
 *   rejeu d'un jeton légitime d'une ressource vers une autre.
 * - **L'algorithme est imposé par la configuration** (RFC 8725 §3.1), jamais lu
 *   dans l'en-tête ; `alg: none` n'existe pas pour cette API.
 * - **Les clés viennent du `jwks_uri` de l'émetteur**, jamais d'un `jku` ou
 *   d'un `jwk` porté par le jeton (§3.5) — sans quoi un attaquant fournirait
 *   la clé qui valide sa propre signature.
 * - **La liste des émetteurs est fermée** : un `iss` inconnu est refusé avant
 *   toute requête sortante.
 *
 * ## Ce que cette classe ne fait pas
 *
 * Elle n'établit pas d'utilisateur applicatif : elle rend un sujet et des
 * scopes. Rattacher ce sujet à un compte local (approvisionnement à la volée,
 * comptes de service) est une décision d'application, pas de protocole — et
 * l'entremêler ici rendrait impossible d'accepter un appelant purement machine,
 * qui est précisément le cas d'usage.
 *
 * @see references/rfc/ietf/rfc8707.txt — l'audience, qui LIE un jeton à CE service
 */
export class RemoteJwtVerifier {
  readonly #issuers: Map<string, ITrustedIssuer>;
  readonly #resolved = new Map<string, Promise<IResolvedIssuer>>();
  readonly #options: IRemoteJwtVerifierOptions;
  #jose: typeof Jose | null = null;

  /**
   * @param options - émetteurs de confiance et réglages réseau
   * @throws Error si un émetteur est invalide, dupliqué, ou déclare un
   *         algorithme à secret partagé
   */
  constructor(options: IRemoteJwtVerifierOptions) {
    this.#options = options;
    this.#issuers = new Map();
    for (const trusted of options.issuers) {
      const issuer = canonicalIssuer(trusted.issuer);
      if (this.#issuers.has(issuer)) {
        throw new Error(
          `émetteur « ${issuer} » déclaré deux fois — deux politiques pour un ` +
            `même émetteur ne peuvent pas coexister : la seconde serait ignorée ` +
            `en silence.`,
        );
      }
      assertAsymmetric(issuer, trusted.algorithms);
      this.#issuers.set(issuer, { ...trusted, issuer });
    }
  }

  /** Nombre d'émetteurs de confiance — pour l'introspection et les journaux. */
  get size(): number {
    return this.#issuers.size;
  }

  /**
   * Vérifie un jeton porté, pour UNE ressource donnée.
   *
   * Conforme au contrat `IAccessTokenVerifier` du cœur : un refus est un `null`,
   * jamais une exception. Les exceptions sont réservées aux pannes — un
   * émetteur injoignable n'est pas un jeton invalide.
   *
   * @param token - le jeton brut, tel que présenté
   * @param audience - URI canonique de la ressource visée ; le jeton DOIT la
   *          porter dans `aud`
   * @returns le principal établi, ou `null` si le jeton est refusé
   * @throws Error si l'émetteur ne peut pas être joint ou publie un jeu de clés
   *         inutilisable — la porte doit alors refuser de servir, pas répondre
   *         « jeton invalide »
   */
  async verify(
    token: string,
    audience: string,
  ): Promise<IAccessPrincipal | null> {
    if (typeof token !== "string" || token.length === 0) return null;
    const jose = (this.#jose ??= (await import("jose")) as typeof Jose);

    // Lecture NON VÉRIFIÉE, et traitée comme telle : elle ne sert qu'à choisir
    // une entrée dans une liste fermée. Aucune valeur du jeton ne devient une
    // URL, un algorithme ou une clé.
    let claimedIssuer: string;
    try {
      const claims = jose.decodeJwt(token);
      if (typeof claims.iss !== "string") return null;
      claimedIssuer = canonicalIssuer(claims.iss);
    } catch {
      return null;
    }

    const trusted = this.#issuers.get(claimedIssuer);
    if (!trusted) {
      this.#audit(`jeton refusé : émetteur « ${claimedIssuer} » non déclaré.`);
      return null;
    }

    const { getKey } = await this.#resolve(trusted, jose);

    try {
      const { payload } = await jose.jwtVerify(token, getKey, {
        algorithms: [...trusted.algorithms],
        issuer: trusted.issuer,
        // Rend `aud` OBLIGATOIRE côté jose — omettre cette option accepterait
        // un jeton sans audience du tout.
        audience,
        clockTolerance: this.#options.clockToleranceS ?? 5,
        ...(trusted.typ ? { typ: trusted.typ } : {}),
        // Testé sur la LONGUEUR, pas sur la présence : passer un tableau vide
        // remplacerait les claims que jose exige d'office (`iss`, `aud`) par
        // rien du tout — la garde s'annulerait elle-même.
        ...(trusted.requiredClaims?.length
          ? { requiredClaims: [...trusted.requiredClaims] }
          : {}),
      });
      const subject = typeof payload.sub === "string" ? payload.sub : undefined;
      return { subject, scopes: extractScopes(payload) };
    } catch (error) {
      const code = (error as { code?: string }).code;
      if (!code || !TOKEN_FAULT_CODES.has(code)) {
        throw new Error(
          `vérification impossible : l'émetteur « ${trusted.issuer} » n'a pas ` +
            `fourni de jeu de clés utilisable (${code ?? (error as Error).message}).`,
          { cause: error },
        );
      }
      // Signature, expiration, audience, algorithme, clé inconnue : le jeton est
      // refusé. La cause fine part au journal, jamais au client — sinon le refus
      // devient un oracle qui aide à fabriquer un jeton acceptable.
      this.#audit(`jeton refusé (${trusted.issuer}) : ${code}`);
      return null;
    }
  }

  /**
   * Résout — une seule fois par émetteur — la fonction qui fournit les clés.
   *
   * La promesse elle-même est mémorisée, pas son résultat : deux jetons qui
   * arrivent ensemble à froid partagent la même découverte au lieu d'en lancer
   * deux. En cas d'échec, l'entrée est retirée pour qu'un appel ultérieur
   * réessaie — une panne passagère ne doit pas condamner l'émetteur pour la
   * durée de vie du processus.
   */
  #resolve(
    trusted: ITrustedIssuer,
    jose: typeof Jose,
  ): Promise<IResolvedIssuer> {
    const pending = this.#resolved.get(trusted.issuer);
    if (pending) return pending;
    const promise = this.#build(trusted, jose).catch((error: unknown) => {
      this.#resolved.delete(trusted.issuer);
      throw error;
    });
    this.#resolved.set(trusted.issuer, promise);
    return promise;
  }

  async #build(
    trusted: ITrustedIssuer,
    jose: typeof Jose,
  ): Promise<IResolvedIssuer> {
    const jwksUri = trusted.jwksUri ?? (await this.#discover(trusted.issuer));
    const options: Jose.RemoteJWKSetOptions = {
      timeoutDuration: this.#options.timeoutMs ?? 5_000,
      cooldownDuration: this.#options.cooldownMs ?? 30_000,
      cacheMaxAge: this.#options.cacheMaxAgeMs ?? 600_000,
    };
    const fetchImpl = this.#options.fetch;
    if (fetchImpl) {
      // Le symbole est la porte OFFICIELLE de jose pour cela ; le cast couvre
      // l'écart connu entre la signature `fetch` du runtime et celle que jose
      // décrit (documenté dans jose : « expect type-related issues »).
      options[jose.customFetch] =
        fetchImpl as unknown as Jose.FetchImplementation;
    }
    return {
      trusted,
      getKey: jose.createRemoteJWKSet(new URL(jwksUri), options),
    };
  }

  /**
   * Trouve le `jwks_uri` d'un émetteur en essayant les points bien connus,
   * dans l'ordre normatif, et en s'arrêtant au premier document VALIDE.
   *
   * Un document qui répond mais ne se réclame pas du bon émetteur n'est pas une
   * « meilleure réponse que rien » : il est écarté comme s'il n'avait pas
   * répondu, et la recherche continue.
   */
  async #discover(issuer: string): Promise<string> {
    const doFetch = this.#options.fetch ?? globalThis.fetch;
    const timeout = this.#options.timeoutMs ?? 5_000;
    const failures: string[] = [];
    for (const url of issuerMetadataUrls(issuer)) {
      try {
        const response = await doFetch(url, {
          signal: AbortSignal.timeout(timeout),
          redirect: "manual",
          headers: { accept: "application/json" },
        });
        if (!response.ok) {
          failures.push(`${url} → HTTP ${response.status}`);
          continue;
        }
        const metadata = validateIssuerMetadata(await response.json(), issuer);
        this.#audit(
          `émetteur « ${issuer} » découvert : clés sur ${metadata.jwksUri}.`,
        );
        return metadata.jwksUri;
      } catch (error) {
        failures.push(`${url} → ${(error as Error).message}`);
      }
    }
    throw new Error(
      `découverte impossible pour l'émetteur « ${issuer} » : aucun document de ` +
        `métadonnées valide. Essayé — ${failures.join(" ; ")}. Déclarer ` +
        `\`jwksUri\` évite toute découverte.`,
    );
  }

  #audit(message: string): void {
    this.#options.log?.(message);
  }
}

/**
 * Refuse un algorithme à secret partagé sur un jeu de clés PUBLIC.
 *
 * C'est la confusion d'algorithme la plus classique (RFC 8725 §2.1) : la clé
 * publique de l'émetteur est lisible par tout le monde ; acceptée comme secret
 * HMAC, elle laisse n'importe qui signer un jeton valide. La règle vaut au
 * démarrage, où elle empêche la configuration d'exister, plutôt qu'à la
 * vérification, où elle dépendrait d'un jeton pour se manifester.
 */
function assertAsymmetric(issuer: string, algorithms: readonly string[]): void {
  if (algorithms.length === 0) {
    throw new Error(
      `émetteur « ${issuer} » : aucun algorithme accepté — la liste est la ` +
        `garde principale (RFC 8725 §3.1), elle ne peut pas être vide.`,
    );
  }
  for (const alg of algorithms) {
    if (alg.startsWith("HS") || alg.toLowerCase() === "none") {
      throw new Error(
        `émetteur « ${issuer} » : algorithme « ${alg} » refusé. Les clés ` +
          `proviennent d'un jeu PUBLIC : un algorithme à secret partagé y ` +
          `transformerait la clé publique en secret de signature.`,
      );
    }
  }
}

export default RemoteJwtVerifier;
