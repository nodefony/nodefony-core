import { validateHeaderValue } from "node:http";
import { BootConfigurationError } from "nodefony";
import {
  mergeCspFragments,
  parseCsp,
  UPGRADE_INSECURE_REQUESTS,
  withoutDirective,
  type CspFragment,
} from "../src/csp";

/**
 * Famille d'une réponse au regard de la politique de contenu (ADR-0024 §C11) :
 * `document` (HTML, XHTML, SVG — politique complète avec nonce et
 * `Permissions-Policy`), `script` (JavaScript — politique complète SANS nonce,
 * celle que prend un worker), `other` (tout le reste — politique courte figée).
 */
export type ResponseKind = "document" | "script" | "other";

/** Types qu'un navigateur rend comme un document, donc qui exécutent la politique. */
const DOCUMENT_TYPES: ReadonlySet<string> = new Set([
  "text/html",
  "application/xhtml+xml",
  "image/svg+xml",
]);

/** Essences d'un type MIME JavaScript (WHATWG MIME Sniffing § 4.6). */
const SCRIPT_TYPES: ReadonlySet<string> = new Set([
  "application/ecmascript",
  "application/javascript",
  "application/x-ecmascript",
  "application/x-javascript",
  "text/ecmascript",
  "text/javascript",
  "text/javascript1.0",
  "text/javascript1.1",
  "text/javascript1.2",
  "text/javascript1.3",
  "text/javascript1.4",
  "text/javascript1.5",
  "text/jscript",
  "text/livescript",
  "text/x-ecmascript",
  "text/x-javascript",
]);

/**
 * Range une réponse dans sa famille d'après son `Content-Type`.
 *
 * @param contentType - valeur de `Content-Type` (paramètres admis) ; `null` =
 *   réponse sans contenu ; `undefined` = type INCONNU de l'appelant, traité en
 *   document — la politique la plus complète, jamais une plus faible par défaut.
 * @returns la famille dont la réponse reçoit la politique.
 */
export function responseKindOf(
  contentType: string | null | undefined,
): ResponseKind {
  if (contentType === undefined) return "document";
  if (contentType === null) return "other";
  const semi = contentType.indexOf(";");
  const essence = (semi === -1 ? contentType : contentType.slice(0, semi))
    .trim()
    .toLowerCase();
  if (DOCUMENT_TYPES.has(essence)) return "document";
  if (SCRIPT_TYPES.has(essence)) return "script";
  return "other";
}

/** Politique des réponses qui ne sont ni document ni script (ADR-0024 §C11). */
const NARROW_CSP = "default-src 'none'";

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
 * Une politique prête à poser : table d'en-têtes figée et CSP pré-découpée
 * autour du nonce. Deux existent au plus — servie en TLS, servie en clair.
 */
interface ICspVariant {
  /** Table constante (CSP statique comprise si elle n'a pas de nonce). */
  readonly headers: Readonly<Record<string, string>>;
  /** Même table sans la CSP statique (route `@Csp` qui pose SA politique). */
  readonly headersWithoutCsp: Readonly<Record<string, string>>;
  /** Segments autour de `{{nonce}}` ; `null` = CSP statique (dans `headers`). */
  readonly parts: readonly string[] | null;
  /** Cas courant, UN seul `{{nonce}}` : `prefix + nonce + suffix`. */
  readonly prefix: string | null;
  readonly suffix: string;
  /** Politique BRUTE (avec `{{nonce}}`), base des fusions `@Csp`. */
  readonly raw: string;
}

/** Politique `@Csp` composée pour une route, dans ses deux variantes. */
interface IComposedExtra {
  readonly tls: IComposedCsp;
  readonly plain: IComposedCsp;
}

/**
 * En-têtes de sécurité **applicatifs** de Nodefony (couche `@nodefony/security`,
 * complémentaire du socle transport de `@nodefony/http`). Pré-calcule une fois au
 * boot la table d'en-têtes CONSTANTS (CSP statique, Referrer-Policy, isolation
 * cross-origin COOP/COEP/CORP, Origin-Agent-Cluster, Permissions-Policy) → zéro
 * alloc, zéro concat par requête (le firewall la pose telle quelle).
 *
 * Pour le CSP, deux régimes mutuellement exclusifs : **statique** (posé tel quel via
 * `headers`, 0 alloc/req) OU **nonce par requête** (`cspNonces` + placeholder
 * `{{nonce}}`) → segments pré-split au boot, recomposés par requête via
 * `cspFor(nonce)` (1 concaténation, aucun parse/regex dans le hot-path).
 *
 * **Deux variantes, composées au boot** (ADR-0024 §C6) : la politique telle
 * qu'écrite, servie en TLS, et la même SANS `upgrade-insecure-requests`, servie
 * en clair — sur une page `http`, la directive réécrirait les sous-ressources en
 * `https`, que le serveur ne sert pas. Sans la directive, les deux variantes sont
 * le MÊME objet : par requête, un booléen choisit, rien de plus.
 *
 * @see Fetch Metadata · W3C CSP Level 3 · WHATWG (COOP/COEP/CORP).
 */
export class SecurityHeaders {
  readonly #tls: ICspVariant;
  readonly #plain: ICspVariant;
  readonly #hasNonce: boolean;
  // Tables figées des familles `script` et `other` (ADR-0024 §C11) : aucune ne
  // porte de nonce, aucune n'est recomposée par réponse.
  readonly #scriptTls: Readonly<Record<string, string>>;
  readonly #scriptPlain: Readonly<Record<string, string>>;
  readonly #other: Readonly<Record<string, string>>;
  // Politique `@Csp` déjà composée, par jeu de directives de route — null tant
  // qu'aucune route décorée n'a servi (cas courant : 0 allocation).
  #extraComposed: WeakMap<CspFragment, IComposedExtra> | null = null;
  /** Prévenu (une fois par jeu de directives) quand un `@Csp` de route est ignoré. */
  readonly #onRejectedExtra: ((error: unknown) => void) | null;

  /**
   * @param o - options des en-têtes (config `security.headers`, CSP déjà fusionnée).
   * @param onRejectedExtra - appelé quand les directives `@Csp` d'une route sortent
   *   de la grammaire CSP3 : la route sert alors la politique de base.
   */
  constructor(
    o: ISecurityHeadersOptions,
    onRejectedExtra?: (error: unknown) => void,
  ) {
    this.#onRejectedExtra = onRejectedExtra ?? null;
    const common: Record<string, string> = {};
    if (o.referrerPolicy) common["Referrer-Policy"] = o.referrerPolicy;
    // Isolation cross-origin (avancés, opt-in) — absents par défaut.
    if (o.coop) common["Cross-Origin-Opener-Policy"] = o.coop;
    if (o.coep) common["Cross-Origin-Embedder-Policy"] = o.coep;
    if (o.corp) common["Cross-Origin-Resource-Policy"] = o.corp;
    // Structured field boolean (RFC 9651) : présence = activé.
    if (o.originAgentCluster) common["Origin-Agent-Cluster"] = "?1";
    if (o.permissionsPolicy) common["Permissions-Policy"] = o.permissionsPolicy;
    // Validés UNE fois ici : la réponse les pose ensuite sans les revalider
    // (`HttpResponse.setValidatedHeader`). Une valeur qu'un en-tête ne peut pas
    // porter arrête le démarrage au lieu de faire échouer chaque réponse.
    for (const name in common) assertHeaderValue(name, common[name] ?? "");
    const nonced =
      Boolean(o.csp) && o.cspNonces && o.csp.includes(NONCE_PLACEHOLDER);
    this.#hasNonce = nonced;
    this.#tls = buildVariant(o.csp, o.cspNonces, nonced, common);
    const plainCsp = withoutDirective(o.csp, UPGRADE_INSECURE_REQUESTS);
    this.#plain =
      plainCsp === o.csp
        ? this.#tls
        : buildVariant(plainCsp, o.cspNonces, nonced, common);
    // Chaque en-tête part là où le navigateur le LIT, nulle part ailleurs : une
    // ligne ignorée coûte quand même ses octets à chaque réponse.
    //  - Referrer-Policy : partout — une feuille de style, un worker émettent
    //    leurs requêtes sous la politique de LEUR réponse ;
    //  - CORP : partout — c'est l'en-tête des ressources incluses ;
    //  - COEP : document et script (un worker charge lui aussi des ressources) ;
    //  - COOP, Origin-Agent-Cluster, Permissions-Policy : document seulement.
    const other: Record<string, string> = {};
    if (o.referrerPolicy) other["Referrer-Policy"] = o.referrerPolicy;
    if (o.corp) other["Cross-Origin-Resource-Policy"] = o.corp;
    const script: Record<string, string> = { ...other };
    if (o.coep) script["Cross-Origin-Embedder-Policy"] = o.coep;
    // JavaScript : la politique complète, sans nonce — un worker prend celle de
    // son script, et un nonce n'y désigne aucune balise.
    const scriptCsp = purgeNoncePlaceholder(o.csp);
    this.#scriptTls = freezeTable(scriptCsp, script);
    const scriptPlainCsp = withoutDirective(
      scriptCsp,
      UPGRADE_INSECURE_REQUESTS,
    );
    this.#scriptPlain =
      scriptPlainCsp === scriptCsp
        ? this.#scriptTls
        : freezeTable(scriptPlainCsp, script);
    // Reste : rien à charger, rien à exécuter. L'encadrement suit la politique
    // complète (donc `http.securityHeaders.frameOptions`, ADR-0024 §C5) : un PDF
    // ou une image encadrés par l'application le restent.
    this.#other = freezeTable(narrowCspOf(o.csp), other);
  }

  /**
   * Table d'en-têtes figée d'une réponse qui n'est pas un document (ADR-0024
   * §C11) : JavaScript (politique complète sans nonce, Referrer-Policy, COEP,
   * CORP) ou reste (politique courte `default-src 'none'`, Referrer-Policy,
   * CORP). Ni l'une ni l'autre ne porte de nonce ; COOP, Origin-Agent-Cluster
   * et Permissions-Policy, lus sur un document seulement, n'y figurent pas.
   *
   * @param kind - famille de la réponse (cf {@link responseKindOf}).
   * @param tls - la page est servie en `https` (garde `upgrade-insecure-requests`).
   * @returns la table à poser telle quelle.
   */
  headersForResource(
    kind: Exclude<ResponseKind, "document">,
    tls: boolean,
  ): Readonly<Record<string, string>> {
    if (kind === "other") return this.#other;
    return tls ? this.#scriptTls : this.#scriptPlain;
  }

  /** Table d'en-têtes applicatifs CONSTANTS (figée) d'une réponse en clair. */
  get headers(): Readonly<Record<string, string>> {
    return this.#plain.headers;
  }

  /**
   * Table constante SANS la CSP statique d'une réponse en clair — pour une
   * réponse qui pose sa propre politique (route `@Csp`), afin que la CSP ne
   * soit écrite qu'une fois.
   */
  get headersWithoutCsp(): Readonly<Record<string, string>> {
    return this.#plain.headersWithoutCsp;
  }

  /**
   * Table d'en-têtes constants selon le transport de la réponse.
   *
   * @param tls - la page est servie en `https` (proxy de confiance compris).
   * @param withoutCsp - omettre la CSP statique (route `@Csp` qui pose la sienne).
   * @returns la table figée à poser telle quelle.
   */
  headersFor(
    tls: boolean,
    withoutCsp = false,
  ): Readonly<Record<string, string>> {
    const variant = tls ? this.#tls : this.#plain;
    return withoutCsp ? variant.headersWithoutCsp : variant.headers;
  }

  /** `true` si le CSP est recomposé par requête avec un nonce (→ `cspFor`). */
  get hasNonce(): boolean {
    return this.#hasNonce;
  }

  /**
   * Recompose le CSP en injectant le `nonce` de la requête aux emplacements
   * `{{nonce}}` : une concaténation s'il n'y en a qu'un, un `join` sinon (segments
   * pré-split au boot). Le nonce est base64 (jamais
   * `'`/`;`/espace) → aucune évasion possible du token CSP.
   *
   * @param nonce - nonce base64 de la requête (`Context.cspNonce`).
   * @param tls - la page est servie en `https` : la politique garde
   *   `upgrade-insecure-requests`. Défaut : en clair.
   * @returns la valeur `Content-Security-Policy` à poser sur la réponse.
   */
  cspFor(nonce: string, tls = false): string {
    const variant = tls ? this.#tls : this.#plain;
    if (variant.prefix !== null) {
      return variant.prefix + nonce + variant.suffix;
    }
    return (variant.parts as readonly string[]).join(nonce);
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
   * @param tls - la page est servie en `https`. Défaut : en clair.
   * @returns la valeur `Content-Security-Policy` à poser sur la réponse.
   */
  cspForExtra(nonce: string, extra: CspFragment, tls = false): string {
    // Fusion (et validation) UNE fois par jeu de directives : la clé est l'objet
    // figé que le routeur calcule une fois par action. Par requête ne reste que
    // la recomposition du nonce, au même coût que `cspFor`.
    let pair = this.#extraComposed?.get(extra);
    if (pair === undefined) {
      pair = this.#composeExtra(extra);
      (this.#extraComposed ??= new WeakMap()).set(extra, pair);
    }
    const composed = tls ? pair.tls : pair.plain;
    if (composed.tail !== null) return composed.head + nonce + composed.tail;
    return composed.parts !== null ? composed.parts.join(nonce) : composed.head;
  }

  /** Compose les deux variantes d'une politique `@Csp` (une fois par route). */
  #composeExtra(extra: CspFragment): IComposedExtra {
    let merged: string;
    try {
      merged = mergeCspFragments(this.#tls.raw, [extra]);
    } catch (error) {
      // Directives hors grammaire : la route sert la politique de BASE, plus
      // stricte — jamais une 500. Mis en cache comme une composition réussie,
      // donc la faute se dit UNE fois, pas à chaque requête.
      merged = this.#tls.raw;
      this.#onRejectedExtra?.(error);
    }
    const tls = this.#composeAround(merged);
    const plainCsp = withoutDirective(merged, UPGRADE_INSECURE_REQUESTS);
    return {
      tls,
      plain: plainCsp === merged ? tls : this.#composeAround(plainCsp),
    };
  }

  /**
   * Nonce actif → découpe autour de `{{nonce}}` ; sinon purge un résiduel
   * `'nonce-{{nonce}}'` (placeholder non substitué = CSP cassé).
   */
  #composeAround(csp: string): IComposedCsp {
    return this.#hasNonce
      ? composeAroundNonce(csp.split(NONCE_PLACEHOLDER))
      : { head: purgeNoncePlaceholder(csp), tail: null, parts: null };
  }
}

/**
 * Compose une variante : table d'en-têtes figée (CSP statique comprise si elle
 * n'a pas de nonce) et segments de la CSP autour du nonce.
 *
 * @throws BootConfigurationError si la CSP ne peut pas être portée par un en-tête.
 */
function buildVariant(
  csp: string,
  cspNonces: boolean,
  nonced: boolean,
  common: Readonly<Record<string, string>>,
): ICspVariant {
  let parts: string[] | null = null;
  let staticCsp = "";
  if (csp) {
    if (nonced) {
      // CSP nonce-aware : recomposé par requête (NON figé dans `headers`).
      parts = csp.split(NONCE_PLACEHOLDER);
      assertHeaderValue("Content-Security-Policy", parts.join(NONCE_SAMPLE));
    } else {
      // Statique : nonce désactivé OU aucun placeholder. Si désactivé, on purge
      // un token `'nonce-{{nonce}}'` résiduel → CSP propre sans nonce.
      staticCsp = cspNonces ? csp : purgeNoncePlaceholder(csp);
      if (staticCsp) {
        assertHeaderValue("Content-Security-Policy", staticCsp);
      }
    }
  }
  const headersWithoutCsp = Object.freeze({ ...common });
  const headers = staticCsp
    ? Object.freeze({ "Content-Security-Policy": staticCsp, ...common })
    : headersWithoutCsp;
  const two = parts?.length === 2;
  return {
    headers,
    headersWithoutCsp,
    parts: parts ? Object.freeze(parts) : null,
    prefix: two ? (parts?.[0] ?? "") : null,
    suffix: two ? (parts?.[1] ?? "") : "",
    raw: csp,
  };
}

/**
 * Table figée : la politique (validée) en tête, puis les en-têtes communs.
 *
 * @throws BootConfigurationError si la politique ne peut pas être portée par un en-tête.
 */
function freezeTable(
  csp: string,
  common: Readonly<Record<string, string>>,
): Readonly<Record<string, string>> {
  if (!csp) return Object.freeze({ ...common });
  assertHeaderValue("Content-Security-Policy", csp);
  return Object.freeze({ "Content-Security-Policy": csp, ...common });
}

/**
 * Politique courte d'une réponse qui n'est ni document ni script :
 * `default-src 'none'`, plus le `frame-ancestors` de la politique complète. Une
 * politique complète vide (CSP coupée par l'application) n'en donne aucune.
 */
function narrowCspOf(csp: string): string {
  if (!csp.trim()) return "";
  for (const [name, sources] of parseCsp(csp)) {
    if (name.toLowerCase() === "frame-ancestors") {
      // Liste vide = aucune origine (W3C CSP3 § source-list) : `'none'` explicite.
      const list = sources.length > 0 ? sources.join(" ") : "'none'";
      return `${NARROW_CSP}; frame-ancestors ${list}`;
    }
  }
  return NARROW_CSP;
}

/** Jeton CSP qui porte le marqueur, retiré tel quel d'une CSP sans nonce. */
const NONCE_TOKEN = `'nonce-${NONCE_PLACEHOLDER}'`;

/**
 * Retire chaque token `'nonce-{{nonce}}'` d'une CSP sans nonce, avec les blancs
 * qui le précèdent. Découpe + `trimEnd` plutôt qu'une regex `\s*…` : celle-ci
 * coûte O(n²) sur une longue suite de blancs (CodeQL `js/polynomial-redos`).
 */
function purgeNoncePlaceholder(csp: string): string {
  const parts = csp.split(NONCE_TOKEN);
  if (parts.length === 1) return csp;
  const last = parts.length - 1;
  let out = "";
  for (let i = 0; i < last; i++) out += (parts[i] ?? "").trimEnd();
  return out + (parts[last] ?? "");
}

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

/**
 * Politique pré-découpée autour du nonce : `head + nonce + tail` quand elle porte
 * UN `{{nonce}}` (cas courant), `parts.join(nonce)` sinon, `head` seul sans nonce.
 */
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
