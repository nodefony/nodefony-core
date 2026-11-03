import { validateHeaderValue } from "node:http";
import { BootConfigurationError } from "nodefony";
import { mergeCspFragments, type CspFragment } from "../src/csp";

/**
 * Sous-ensemble APPLICATIF de la config `headers` (cf defineSecurityConfig).
 *
 * `hsts` / `frameguard` / `noSniff` n'y figurent PAS volontairement : ces trois
 * en-têtes « transport » sont posés par `@nodefony/http` sur toute réponse
 * (`HttpKernel.transportHeaders`, figés au démarrage) pour couvrir AUSSI les fichiers statiques,
 * les erreurs précoces et un serveur sans module security (secure-by-default).
 * `@nodefony/security` ne les ré-émet pas → une seule source par en-tête.
 */
export interface ISecurityHeadersOptions {
  enabled: boolean;
  csp: string;
  cspNonces: boolean;
  referrerPolicy: string;
  coop?: string | undefined;
  coep?: string | undefined;
  corp?: string | undefined;
  originAgentCluster?: boolean | undefined;
  permissionsPolicy?: string | undefined;
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
  // Cas courant (#508) : UN seul `{{nonce}}` (CSP par défaut) → deux
  // segments, recomposés par `prefix + nonce + suffix` au lieu d'un `join`
  // (~85 ns de moins par requête). `null` quand le CSP porte 0 ou ≥ 2 placeholders.
  readonly #cspPrefix: string | null;
  readonly #cspSuffix: string;
  // CSP de base BRUT (avec `{{nonce}}` éventuel, non purgé) — conservé pour
  // `cspForExtra` (merge des directives `@Csp` d'une route). Vide si aucun CSP.
  readonly #cspRaw: string;
  // Même table SANS la CSP statique — lue seulement par une route `@Csp` sans
  // nonce, qui pose SA politique : la CSP n'est ainsi écrite qu'UNE fois par
  // réponse (un `setHeader` de CSP coûte ~0,7 µs, la valeur étant validée
  // caractère par caractère). Même référence que `#headers` s'il n'y a rien à ôter.
  readonly #headersWithoutCsp: Readonly<Record<string, string>>;
  // Politique `@Csp` déjà composée, par jeu de directives de route — null tant
  // qu'aucune route décorée n'a servi (cas courant : 0 allocation).
  #extraComposed: WeakMap<CspFragment, IComposedCsp> | null = null;

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
    // Structured field boolean (RFC 9651) : présence = activé.
    if (o.originAgentCluster) h["Origin-Agent-Cluster"] = "?1";
    if (o.permissionsPolicy) h["Permissions-Policy"] = o.permissionsPolicy;
    // Validés UNE fois ici : la réponse les pose ensuite sans les revalider
    // (`HttpResponse.setValidatedHeader`). Une valeur qu'un en-tête ne peut pas
    // porter arrête le démarrage au lieu de faire échouer chaque réponse.
    for (const name in h) assertHeaderValue(name, h[name] ?? "");
    if (cspParts) {
      assertHeaderValue("Content-Security-Policy", cspParts.join(NONCE_SAMPLE));
    }
    this.#headers = Object.freeze(h);
    if (h["Content-Security-Policy"] === undefined) {
      this.#headersWithoutCsp = this.#headers;
    } else {
      const { "Content-Security-Policy": _csp, ...rest } = h;
      this.#headersWithoutCsp = Object.freeze(rest);
    }
    this.#cspParts = cspParts ? Object.freeze(cspParts) : null;
    if (cspParts?.length === 2) {
      this.#cspPrefix = cspParts[0] ?? "";
      this.#cspSuffix = cspParts[1] ?? "";
    } else {
      this.#cspPrefix = null;
      this.#cspSuffix = "";
    }
    this.#cspRaw = o.csp;
  }

  /** Table d'en-têtes applicatifs CONSTANTS (figée), posée telle quelle par le firewall. */
  get headers(): Readonly<Record<string, string>> {
    return this.#headers;
  }

  /**
   * Table constante SANS la CSP statique — pour une réponse qui pose sa propre
   * politique (route `@Csp`), afin que la CSP ne soit écrite qu'une fois.
   */
  get headersWithoutCsp(): Readonly<Record<string, string>> {
    return this.#headersWithoutCsp;
  }

  /** `true` si le CSP est recomposé par requête avec un nonce (→ `cspFor`). */
  get hasNonce(): boolean {
    return this.#cspParts !== null;
  }

  /**
   * Recompose le CSP en injectant le `nonce` de la requête aux emplacements
   * `{{nonce}}` : une concaténation s'il n'y en a qu'un, un `join` sinon (segments
   * pré-split au boot). Le nonce est base64 (jamais
   * `'`/`;`/espace) → aucune évasion possible du token CSP.
   *
   * @param nonce - nonce base64 de la requête (`Context.cspNonce`).
   * @returns la valeur `Content-Security-Policy` à poser sur la réponse.
   */
  cspFor(nonce: string): string {
    if (this.#cspPrefix !== null) {
      return this.#cspPrefix + nonce + this.#cspSuffix;
    }
    return (this.#cspParts as readonly string[]).join(nonce);
  }

  /**
   * Recompose le CSP en fusionnant ADDITIVEMENT les directives `extra` d'une
   * route (`@Csp`) dans le CSP de base, PUIS en substituant le `nonce`. Le merge
   * (parse/serialize) n'est payé QUE sur les routes décorées `@Csp` (rares) — le
   * cas courant reste {@link cspFor} (1 `join`). Une directive déjà présente voit
   * ses sources complétées (jamais dupliquée — W3C CSP3 §3).
   *
   * @param nonce - nonce base64 de la requête (ignoré si le CSP n'a pas de nonce).
   * @param extra - directives additionnelles de la route (`directive → sources`).
   * @returns la valeur `Content-Security-Policy` à poser sur la réponse.
   */
  cspForExtra(nonce: string, extra: CspFragment): string {
    // Fusion (et validation) UNE fois par jeu de directives : la clé est l'objet
    // figé que le routeur calcule une fois par action. Par requête ne reste que
    // la recomposition du nonce, au même coût que `cspFor`.
    let composed = this.#extraComposed?.get(extra);
    if (composed === undefined) {
      const merged = mergeCspFragments(this.#cspRaw, [extra]);
      // Nonce actif (`#cspParts` non null) → découpe autour de `{{nonce}}` ; sinon
      // purge un résiduel `'nonce-{{nonce}}'` (placeholder non substitué = CSP cassé).
      composed =
        this.#cspParts !== null
          ? composeAroundNonce(merged.split(NONCE_PLACEHOLDER))
          : {
              head: merged.replace(/\s*'nonce-\{\{nonce\}\}'/g, ""),
              tail: null,
              parts: null,
            };
      (this.#extraComposed ??= new WeakMap()).set(extra, composed);
    }
    if (composed.tail !== null) return composed.head + nonce + composed.tail;
    return composed.parts !== null ? composed.parts.join(nonce) : composed.head;
  }
}

/**
 * Politique pré-découpée autour du nonce : `head + nonce + tail` quand elle porte
 * UN `{{nonce}}` (cas courant), `parts.join(nonce)` sinon, `head` seul sans nonce.
 */
/** Nonce témoin pour valider le gabarit : même alphabet que `nextCspNonce` (base64). */
const NONCE_SAMPLE = "AAAAAAAAAAAAAAAAAAAAAA==";

/**
 * Refuse au démarrage une valeur qu'un en-tête HTTP ne peut pas porter.
 *
 * @throws BootConfigurationError en nommant l'en-tête et la raison de Node.
 */
function assertHeaderValue(name: string, value: string): void {
  try {
    validateHeaderValue(name, value);
  } catch (error) {
    throw new BootConfigurationError(
      `[@nodefony/security] en-tête « ${name} » refusé : ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

interface IComposedCsp {
  readonly head: string;
  readonly tail: string | null;
  readonly parts: readonly string[] | null;
}

/** Range les segments d'une politique découpée autour de `{{nonce}}`. */
function composeAroundNonce(parts: string[]): IComposedCsp {
  if (parts.length === 2) {
    const [head = "", tail = ""] = parts;
    return { head, tail, parts: null };
  }
  if (parts.length === 1)
    return { head: parts[0] ?? "", tail: null, parts: null };
  return { head: "", tail: null, parts: Object.freeze(parts) };
}

export default SecurityHeaders;
