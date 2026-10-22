/**
 * Gardes du transport MCP — ce qui protège une porte locale SANS authentification.
 *
 * Ces deux contrôles ne sont pas un pis-aller : ce sont exactement les
 * exigences que la spec pose au transport lui-même, indépendamment de toute
 * autorisation (`transports/streamable-http` §Security & Endpoint) —
 * « Servers **MUST** validate the `Origin` header on all incoming connections
 * to prevent DNS rebinding attacks » et « When running locally, servers
 * **SHOULD** bind only to localhost ».
 *
 * Fonctions **pures** : elles reçoivent ce qu'elles jugent, elles ne le lisent
 * nulle part. C'est ce qui les rend éprouvables sans serveur ni requête réelle
 * — et ce qui permet de vérifier le refus, qui est le comportement qui compte.
 */

/** Verdict d'une garde : passer, ou refuser en disant pourquoi. */
export type GuardVerdict = { allowed: true } | { allowed: false; why: string };

/** Ce que la garde a besoin de savoir d'une requête. */
export interface IGuardInput {
  /** En-tête `Origin`, `undefined` s'il est absent. */
  origin?: string | undefined;
  /** Adresse distante de la connexion (`socket.remoteAddress`). */
  remoteAddress?: string | undefined;
  /**
   * La requête porte un en-tête de relais (`Forwarded`, `X-Forwarded-For`,
   * `X-Real-IP`, `Via`) : elle a traversé un proxy, quelle que soit
   * l'adresse de la connexion.
   */
  relayed?: boolean | undefined;
}

/** Réglages qui gouvernent les gardes (viennent de la config du module). */
export interface IGuardPolicy {
  /** Origines de navigateur admises ; vide = aucune. */
  allowedOrigins: readonly string[];
  /** Accepter une adresse distante non locale. */
  allowRemote: boolean;
}

/**
 * Une adresse est-elle celle de la machine locale ?
 *
 * Couvre les trois formes que Node rend selon la pile réseau : IPv4
 * (`127.x.x.x`), IPv6 (`::1`), et l'IPv4 encapsulée en IPv6
 * (`::ffff:127.0.0.1`) — la plus fréquente sur un serveur à double pile, et
 * celle qu'une comparaison naïve à `"127.0.0.1"` rate.
 *
 * @param address - `socket.remoteAddress`, éventuellement absent
 * @returns `true` si l'appel vient de cette machine
 */
/**
 * Les en-têtes qu'un relais pose — leur présence suffit à dire que la requête
 * n'est pas arrivée directement, quelle que soit l'adresse de la connexion.
 */
export const RELAY_HEADERS = [
  "forwarded",
  "x-forwarded-for",
  "x-real-ip",
  "via",
] as const;

/**
 * La requête a-t-elle traversé un relais (proxy inverse, répartiteur) ?
 *
 * Un relais posé sur la MÊME machine fait arriver un client distant depuis la
 * boucle locale : l'adresse de la connexion ne prouve alors plus rien. Toute
 * porte qui exige la localité refuse donc aussi l'appel relayé — la porte MCP
 * comme la porte de session par ticket, une seule règle.
 *
 * @param headers - en-têtes reçus (`request.headers` de Node)
 * @returns `true` si un en-tête de relais non vide est présent
 */
export function isRelayedRequest(
  headers: Readonly<Record<string, string | string[] | undefined>>,
): boolean {
  return RELAY_HEADERS.some((name) => {
    const value = headers[name];
    const first = Array.isArray(value) ? value[0] : value;
    return first !== undefined && first !== "";
  });
}

export function isLocalAddress(address?: string): boolean {
  if (!address) {
    // Pas d'adresse = pas de preuve de localité. Le doute ne vaut pas un OUI.
    return false;
  }
  const bare = address.startsWith("::ffff:") ? address.slice(7) : address;
  if (bare === "::1" || bare === "localhost") {
    return true;
  }
  return /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(bare);
}

/**
 * Décide si un appel MCP peut être servi.
 *
 * ⭐ **La règle sur `Origin` est contre-intuitive, et c'est elle qui protège.**
 * Un client MCP légitime est un *process* (Cursor, Claude Code, un agent tiers)
 * : il n'envoie **aucun** `Origin`, cet en-tête étant posé par les navigateurs.
 * Une page web malveillante, elle, en pose **toujours** un lorsqu'elle vise
 * `https://localhost:5152`. Donc : *absent* → on passe ; *présent et hors
 * allowlist* → `403`. C'est ce qui referme le DNS rebinding, le seul vecteur
 * réel contre un serveur MCP local.
 *
 * L'ordre des contrôles est délibéré : la localité d'abord, parce qu'un appel
 * distant ne doit même pas apprendre quelles origines sont admises.
 *
 * @param input - ce que la requête présente
 * @param policy - les réglages du module
 * @returns le verdict, avec le motif quand il refuse
 */
export function checkMcpAccess(
  input: IGuardInput,
  policy: IGuardPolicy,
): GuardVerdict {
  if (!policy.allowRemote && !isLocalAddress(input.remoteAddress)) {
    return {
      allowed: false,
      why: `adresse non locale (${input.remoteAddress ?? "inconnue"}) — voir l'option \`allowRemote\` du serveur MCP`,
    };
  }
  // 🔴 Un relais sur la MÊME machine (le frontal que génère `proxy:generate`)
  // se connecte depuis le loopback : sans `trustProxy`, l'adresse vue est la
  // sienne, et une porte locale servait alors Internet sans jeton. La localité
  // ne se prouve pas à travers un relais — un appel qui en porte la trace est
  // refusé, même si l'adresse résolue est locale.
  if (!policy.allowRemote && input.relayed === true) {
    return {
      allowed: false,
      why: "appel relayé (en-tête Forwarded, X-Forwarded-For, X-Real-IP ou Via) sur une porte locale — la localité ne se prouve pas à travers un relais ; voir l'option `allowRemote` du serveur MCP",
    };
  }

  if (input.origin !== undefined && input.origin !== "") {
    if (!policy.allowedOrigins.includes(input.origin)) {
      return {
        allowed: false,
        why: `origine « ${input.origin} » non admise — voir l'option \`allowedOrigins\` du serveur MCP`,
      };
    }
  }

  return { allowed: true };
}
