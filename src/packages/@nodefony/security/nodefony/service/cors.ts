/**
 * Sous-ensemble de la config `cors` consommé par la politique (cf defineSecurityConfig).
 */
export interface ICorsOptions {
  enabled: boolean;
  origins: readonly string[];
  credentials: boolean;
  methods: readonly string[];
  allowedHeaders: readonly string[];
  exposedHeaders: readonly string[];
  maxAgeS: number;
}

/** En-têtes de réponse CORS à poser (nom canonique → valeur). */
export type CorsHeaders = Record<string, string>;

/**
 * Politique CORS de Nodefony — Same-Origin Policy assouplie côté serveur
 * (Fetch Standard / W3C CORS protocol). Logique PURE et synchrone : décide les
 * en-têtes `Access-Control-*` à poser pour une origine donnée. Instanciée une
 * fois au boot par le firewall, testable sans serveur.
 *
 * Invariants de sécurité (OWASP) :
 * - **Jamais `*` + credentials** : interdit au boot (refine Zod). Ici, `*` n'est
 *   émis QUE si `credentials=false` ; avec credentials, l'origine est reflétée.
 * - **Reflet d'origine ⇒ `Vary: Origin`** : signalé via {@link reflectsOrigin}
 *   pour que l'appelant pose l'en-tête `Vary` (correction de cache).
 * - **Origine non whitelistée ⇒ aucun en-tête** : la réponse n'est pas partageable
 *   (le navigateur bloque), zéro information divulguée.
 *
 * @see Fetch Standard (CORS protocol) · OWASP CORS.
 */
export class Cors {
  readonly #origins: ReadonlySet<string>;
  readonly #wildcard: boolean;
  readonly #credentials: boolean;
  readonly #methods: string;
  readonly #allowedHeaders: string;
  readonly #exposedHeaders: string;
  readonly #maxAge: string;

  constructor(options: ICorsOptions) {
    this.#origins = new Set(options.origins);
    this.#wildcard = options.origins.includes("*");
    this.#credentials = options.credentials;
    this.#methods = options.methods.join(", ");
    this.#allowedHeaders = options.allowedHeaders.join(", ");
    this.#exposedHeaders = options.exposedHeaders.join(", ");
    this.#maxAge = String(options.maxAgeS);
  }

  /**
   * Valeur de `Access-Control-Allow-Origin` pour cette origine, ou `null` si
   * l'origine n'est pas autorisée. `*` seulement en l'absence de credentials
   * (sinon l'origine est reflétée — `*` + credentials est refusé par le navigateur).
   */
  #allowOrigin(origin: string): string | null {
    if (this.#wildcard) return this.#credentials ? origin : "*";
    return this.#origins.has(origin) ? origin : null;
  }

  /** `true` si la valeur Allow-Origin reflète l'origine (⇒ l'appelant doit poser `Vary: Origin`). */
  reflectsOrigin(allowOrigin: string): boolean {
    return allowOrigin !== "*";
  }

  /**
   * En-têtes d'une réponse au **preflight** `OPTIONS` (méthodes/headers autorisés
   * + cache + credentials), ou `null` si l'origine n'est pas autorisée (réponse
   * 204 nue → le navigateur bloque).
   */
  preflightHeaders(origin: string): CorsHeaders | null {
    const allow = this.#allowOrigin(origin);
    if (allow === null) return null;
    const h: CorsHeaders = {
      "Access-Control-Allow-Origin": allow,
      "Access-Control-Allow-Methods": this.#methods,
      "Access-Control-Allow-Headers": this.#allowedHeaders,
      "Access-Control-Max-Age": this.#maxAge,
    };
    if (this.reflectsOrigin(allow)) h["Vary"] = "Origin";
    if (this.#credentials) h["Access-Control-Allow-Credentials"] = "true";
    return h;
  }

  /**
   * En-têtes d'une réponse à une **requête réelle** cross-origin (Allow-Origin +
   * credentials + headers exposés au JS), ou `null` si l'origine n'est pas autorisée.
   */
  actualHeaders(origin: string): CorsHeaders | null {
    const allow = this.#allowOrigin(origin);
    if (allow === null) return null;
    const h: CorsHeaders = { "Access-Control-Allow-Origin": allow };
    if (this.reflectsOrigin(allow)) h["Vary"] = "Origin";
    if (this.#credentials) h["Access-Control-Allow-Credentials"] = "true";
    if (this.#exposedHeaders)
      h["Access-Control-Expose-Headers"] = this.#exposedHeaders;
    return h;
  }
}

export default Cors;
