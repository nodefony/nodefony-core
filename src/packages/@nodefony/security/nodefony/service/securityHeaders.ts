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

/**
 * En-têtes de sécurité **applicatifs** de Nodefony (couche `@nodefony/security`,
 * complémentaire du socle transport de `@nodefony/http`). Pré-calcule une fois au
 * boot la table d'en-têtes CONSTANTS (CSP statique, Referrer-Policy, isolation
 * cross-origin COOP/COEP/CORP, Origin-Agent-Cluster, Permissions-Policy) → zéro
 * alloc, zéro concat par requête (le firewall la pose telle quelle).
 *
 * **Étape A** : CSP posé tel quel (string config). Le **nonce par requête**
 * (`cspNonces`) relève de l'étape B (injection `'nonce-…'` dans le CSP + exposition
 * du nonce aux templates / Vite) — non géré ici pour ne pas poser un CSP mensonger.
 *
 * @see Fetch Metadata · W3C CSP Level 3 · WHATWG (COOP/COEP/CORP).
 */
export class SecurityHeaders {
  readonly #headers: Readonly<Record<string, string>>;

  constructor(o: ISecurityHeadersOptions) {
    const h: Record<string, string> = {};
    // CSP statique (le nonce dynamique = étape B). Vide → on n'impose rien.
    if (o.csp) h["Content-Security-Policy"] = o.csp;
    if (o.referrerPolicy) h["Referrer-Policy"] = o.referrerPolicy;
    // Isolation cross-origin (avancés, opt-in) — absents par défaut.
    if (o.coop) h["Cross-Origin-Opener-Policy"] = o.coop;
    if (o.coep) h["Cross-Origin-Embedder-Policy"] = o.coep;
    if (o.corp) h["Cross-Origin-Resource-Policy"] = o.corp;
    // Structured field boolean (RFC 8941) : présence = activé.
    if (o.originAgentCluster) h["Origin-Agent-Cluster"] = "?1";
    if (o.permissionsPolicy) h["Permissions-Policy"] = o.permissionsPolicy;
    this.#headers = Object.freeze(h);
  }

  /** Table d'en-têtes applicatifs CONSTANTS (figée), posée telle quelle par le firewall. */
  get headers(): Readonly<Record<string, string>> {
    return this.#headers;
  }
}

export default SecurityHeaders;
