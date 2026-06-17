/**
 * Sous-ensemble APPLICATIF de la config `headers` (cf defineSecurityConfig).
 *
 * `hsts` / `frameguard` / `noSniff` n'y figurent PAS volontairement : ces trois
 * en-têtes « transport » sont posés par `@nodefony/http` à l'entrée brute
 * (`onHttpRequest`, AVANT le pipeline) pour couvrir AUSSI les fichiers statiques,
 * les erreurs précoces et un serveur sans module security (secure-by-default).
 * `@nodefony/security` ne les ré-émet pas → une seule source par en-tête.
 */
export interface ISecurityHeadersOptions {
  enabled: boolean;
  csp: string;
  cspNonces: boolean;
  referrerPolicy: string;
  coop?: string;
  coep?: string;
  corp?: string;
  originAgentCluster?: boolean;
  permissionsPolicy?: string;
}

/** Marqueur substitué par le nonce CSP de la requête (cf `Context.cspNonce`). */
const NONCE_PLACEHOLDER = "{{nonce}}";

/**
 * En-têtes de sécurité **applicatifs** de Nodefony (couche `@nodefony/security`,
 * complémentaire du socle transport de `@nodefony/http`). Pré-calcule une fois au
 * boot la table d'en-têtes CONSTANTS (CSP statique, Referrer-Policy, isolation
 * cross-origin COOP/COEP/CORP, Origin-Agent-Cluster, Permissions-Policy) → zéro
 * alloc, zéro concat par requête (le firewall la pose telle quelle).
 *
 * **Étape A+B** : en-têtes constants pré-calculés au boot (Referrer/COOP/…). Pour le
 * CSP, deux régimes mutuellement exclusifs : **statique** (posé tel quel via `headers`,
 * 0 alloc/req) OU **nonce par requête** (`cspNonces` + placeholder `{{nonce}}` dans le
 * CSP) → segments pré-split au boot, recomposés par requête via `cspFor(nonce)` (1
 * `join`, aucun parse/regex dans le hot-path). Le nonce lui-même vit sur `Context`.
 *
 * @see Fetch Metadata · W3C CSP Level 3 · WHATWG (COOP/COEP/CORP).
 */
export class SecurityHeaders {
  readonly #headers: Readonly<Record<string, string>>;
  // CSP dynamique (nonce/req) : segments pré-split autour de `{{nonce}}`, joints par
  // requête avec le nonce réel. `null` = CSP statique (dans `#headers`) → 0 alloc/req.
  readonly #cspParts: readonly string[] | null;

  constructor(o: ISecurityHeadersOptions) {
    const h: Record<string, string> = {};
    let cspParts: readonly string[] | null = null;
    if (o.csp) {
      if (o.cspNonces && o.csp.includes(NONCE_PLACEHOLDER)) {
        // CSP nonce-aware : recomposé par requête (NON figé dans `#headers`).
        // Pré-split au boot → 1 seul `join` par requête (pas de parse hot-path).
        cspParts = o.csp.split(NONCE_PLACEHOLDER);
      } else {
        // Statique : nonce désactivé OU aucun placeholder. Si désactivé, on purge
        // un token `'nonce-{{nonce}}'` résiduel (placeholder non substitué = CSP
        // cassé) → CSP propre sans nonce.
        const csp = o.cspNonces
          ? o.csp
          : o.csp.replace(/\s*'nonce-\{\{nonce\}\}'/g, "");
        if (csp) h["Content-Security-Policy"] = csp;
      }
    }
    if (o.referrerPolicy) h["Referrer-Policy"] = o.referrerPolicy;
    // Isolation cross-origin (avancés, opt-in) — absents par défaut.
    if (o.coop) h["Cross-Origin-Opener-Policy"] = o.coop;
    if (o.coep) h["Cross-Origin-Embedder-Policy"] = o.coep;
    if (o.corp) h["Cross-Origin-Resource-Policy"] = o.corp;
    // Structured field boolean (RFC 8941) : présence = activé.
    if (o.originAgentCluster) h["Origin-Agent-Cluster"] = "?1";
    if (o.permissionsPolicy) h["Permissions-Policy"] = o.permissionsPolicy;
    this.#headers = Object.freeze(h);
    this.#cspParts = cspParts ? Object.freeze(cspParts) : null;
  }

  /** Table d'en-têtes applicatifs CONSTANTS (figée), posée telle quelle par le firewall. */
  get headers(): Readonly<Record<string, string>> {
    return this.#headers;
  }

  /** `true` si le CSP est recomposé par requête avec un nonce (→ `cspFor`). */
  get hasNonce(): boolean {
    return this.#cspParts !== null;
  }

  /**
   * Recompose le CSP en injectant le `nonce` de la requête aux emplacements
   * `{{nonce}}`. 1 `join` (segments pré-split au boot). Le nonce est base64 (jamais
   * `'`/`;`/espace) → aucune évasion possible du token CSP.
   *
   * @param nonce - nonce base64 de la requête (`Context.cspNonce`).
   * @returns la valeur `Content-Security-Policy` à poser sur la réponse.
   */
  cspFor(nonce: string): string {
    return (this.#cspParts as readonly string[]).join(nonce);
  }
}

export default SecurityHeaders;
