import { CsrfError } from "../errors/CsrfError";

/**
 * Méthodes HTTP « sûres » (RFC 9110 §9.2.1) — sans effet de bord par contrat,
 * donc hors du vecteur CSRF. Tout le reste (POST/PUT/PATCH/DELETE…) est traité
 * comme state-changing et passe la défense. Set figé au chargement du module.
 */
const SAFE_METHODS: ReadonlySet<string> = new Set([
  "GET",
  "HEAD",
  "OPTIONS",
  "TRACE",
]);

/** Sous-ensemble de la config `csrf` consommé par la défense (cf defineSecurityConfig). */
export interface ICsrfOptions {
  enabled: boolean;
  fetchMetadata: boolean;
  checkOrigin: boolean;
  strictSameSite: boolean;
}

/** En-têtes bruts d'une requête, extraits par le firewall (clés HTTP en lowercase). */
export interface ICsrfRequest {
  /** Méthode HTTP (`context.method`). */
  method: string | null | undefined;
  /** `Sec-Fetch-Site` — provenance tamponnée par le navigateur (défense primaire). */
  secFetchSite: string | undefined;
  /** `Origin` — origine du document initiateur (fallback). */
  origin: string | undefined;
  /** `Referer` — utilisé seulement si `Origin` est absent (fallback). */
  referer: string | undefined;
  /** Hôte cible (`context.domain` / en-tête `Host`) — pour le test same-host du fallback. */
  host: string | undefined;
}

/**
 * Défense CSRF par défaut de Nodefony — **Fetch Metadata d'abord** (modèle Go 1.25
 * `CrossOriginProtection` / OWASP 2025), repli `Origin`/`Referer` pour les vieux
 * navigateurs. Logique PURE et synchrone (aucun I/O, aucune alloc sur le hot-path
 * GET) → testable sans serveur, instanciée une seule fois au boot par le firewall.
 *
 * Chaîne de décision sur une requête state-changing :
 *
 * 1. **Origine de confiance** (alias multi-domaine `csrf.trustedOrigins` ∪ whitelist
 *    CORS) → laisser passer même en cross-site : un alias légitime de l'app, ou ce
 *    que CORS autorise déjà, n'est pas du CSRF (cohérence CSRF ↔ CORS).
 * 2. **Fetch Metadata** (`Sec-Fetch-Site`, infalsifiable) : `same-origin`/`none`
 *    → OK ; `same-site` → OK sauf `strictSameSite` ; `cross-site` → **403** ;
 *    valeur inconnue → on délègue au repli (forward-compat, W3C « SHOULD ignore »).
 * 3. **Repli `Origin`/`Referer`** : aucune des deux → client non-navigateur, hors
 *    vecteur CSRF → OK ; sinon same-host requis, mismatch → **403**.
 *
 * @see RFC 9110 §9.2.1 (méthodes sûres) · W3C Fetch Metadata · RFC 6265bis §8.8.1.
 */
export class Csrf {
  readonly #fetchMetadata: boolean;
  readonly #checkOrigin: boolean;
  readonly #strictSameSite: boolean;
  // Origines de confiance (alias multi-domaine ∪ CORS) — Set pour lookup O(1).
  readonly #allowedOrigins: ReadonlySet<string>;

  /**
   * `true` si la méthode mute l'état (hors {@link SAFE_METHODS}). Permet à
   * l'appelant (firewall) de court-circuiter le hot-path GET sans lire d'en-tête.
   */
  static isStateChanging(method: string | null | undefined): boolean {
    return !!method && !SAFE_METHODS.has(method.toUpperCase());
  }

  constructor(options: ICsrfOptions, allowedOrigins: readonly string[] = []) {
    this.#fetchMetadata = options.fetchMetadata;
    this.#checkOrigin = options.checkOrigin;
    this.#strictSameSite = options.strictSameSite;
    this.#allowedOrigins = new Set(allowedOrigins);
  }

  /**
   * Valide la provenance d'une requête. No-op (retour immédiat) sur une méthode
   * sûre — coût nul sur le GET dominant. Lève {@link CsrfError} (403) sinon.
   *
   * @throws CsrfError - mutation `cross-site` (Fetch Metadata) ou `Origin`/`Referer`
   *   étranger aux origines de l'app (repli).
   */
  enforce(req: ICsrfRequest): void {
    const method = req.method?.toUpperCase();
    // Hot-path : méthode absente ou sûre → rien à vérifier, zéro alloc.
    if (!method || SAFE_METHODS.has(method)) return;

    const source = req.origin ?? this.#originFromReferer(req.referer);

    // 1. Origine explicitement whitelistée (CORS) → légitime, pas du CSRF.
    if (source && this.#allowedOrigins.has(source)) return;

    // 2. Défense primaire : Fetch Metadata (le navigateur tamponne la provenance).
    const site = this.#fetchMetadata ? req.secFetchSite : undefined;
    if (site) {
      switch (site) {
        case "same-origin":
        case "none":
          return;
        case "same-site":
          if (!this.#strictSameSite) return;
          throw new CsrfError();
        case "cross-site":
          throw new CsrfError();
        // default : valeur inconnue → forward-compat, on délègue au repli.
      }
    }

    // 3. Repli Origin/Referer (vieux navigateur, ou Sec-Fetch-Site inconnu).
    if (this.#checkOrigin) {
      if (!source) return; // ni Fetch Metadata ni Origin/Referer → non-navigateur.
      if (req.host && this.#sameHost(source, req.host)) return;
      throw new CsrfError();
    }
  }

  /** Origine (`scheme://host[:port]`) extraite d'un `Referer`, ou `undefined` si illisible. */
  #originFromReferer(referer: string | undefined): string | undefined {
    if (!referer) return undefined;
    try {
      return new URL(referer).origin;
    } catch {
      return undefined;
    }
  }

  /** `true` si l'hôte de l'origine source est exactement l'hôte cible (repli OWASP). */
  #sameHost(source: string, host: string): boolean {
    try {
      return new URL(source).host === host;
    } catch {
      return false;
    }
  }
}

export default Csrf;
