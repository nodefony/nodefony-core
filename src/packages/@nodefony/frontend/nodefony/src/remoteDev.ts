/**
 * Dev déporté (P14.17) — calculs PURS d'origine publique du dev server Vite.
 *
 * Le problème résolu : `devHost` est une adresse d'ÉCOUTE ; l'origine que le
 * NAVIGATEUR utilise peut être toute autre chose — un forwarder TLS (Codespaces,
 * Gitpod), une passerelle de conteneur (`host.docker.internal`), un port remappé.
 * Ce module dissocie les deux : il produit l'origine publique (assets, `base`
 * Vite, WebSocket HMR) à partir d'un TEMPLATE (`{port}` substitué au port réel
 * du spawn) — explicite (`frontend.publicOrigin`) ou détecté depuis
 * l'environnement de la plateforme.
 *
 * Tout est pur et injectable (env en paramètre) : testable sans process, sans
 * réseau, sur les trois plateformes.
 *
 * Formats VÉRIFIÉS (docs officielles + source Vite 8) :
 *  - Codespaces : `https://${CODESPACE_NAME}-${port}.${GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN}`
 *    (TLS terminé par le forwarder → WS HMR en `wss` sur 443).
 *  - Gitpod classic : `https://${port}-<hôte de GITPOD_WORKSPACE_URL>`.
 *  - Vite `server.allowedHosts` : IP et `localhost`/`*.localhost` TOUJOURS
 *    acceptés ; un préfixe `.` = le domaine ET tous ses sous-domaines.
 *  - VS Code Remote / dev containers / WSL2 : forwarding sur `localhost` →
 *    les défauts locaux suffisent, aucune détection requise.
 */

/** Placeholder substitué par le port réel du spawn dans un template d'origine. */
export const PORT_PLACEHOLDER = "{port}";

/**
 * `127.0.0.0/8` avec des octets BORNÉS (0-255). Pas de quantificateur imbriqué
 * ni d'alternance qui se chevauche : linéaire sur toute entrée, y compris
 * forgée (le `Host` est une donnée cliente).
 */
const LOOPBACK_V4_RE =
  /^127\.(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)$/;

/**
 * Template d'origine publique : `scheme://hostTemplate[:portTemplate]`, sans
 * chemin. `{port}` peut apparaître dans l'hôte (Codespaces/Gitpod : port encodé
 * dans le sous-domaine) OU en position de port (`host:{port}`).
 * Regex plutôt que `new URL()` : le parseur WHATWG refuse `{`/`}` dans un hôte.
 */
const ORIGIN_TEMPLATE_RE = /^(https?):\/\/([^/:\s]+)(?::(\d+|\{port\}))?$/;

/** Résultat d'un template résolu contre un port réel. */
export interface IResolvedPublicOrigin {
  /** Origine que le navigateur utilise — verbatim dans les `<script>` et le `base` Vite. */
  readonly origin: string;
  /**
   * Config `server.hmr` cliente : le WS HMR doit suivre le MÊME chemin que les
   * assets. Port implicite → 443/80 selon le scheme (cas forwarder TLS).
   */
  readonly hmr: {
    readonly host: string;
    readonly clientPort: number;
    readonly protocol: "ws" | "wss";
  };
}

/** Environnement de dev déporté détecté depuis les variables de la plateforme. */
export interface IRemoteDevDetection {
  readonly provider: "codespaces" | "gitpod";
  /** Template d'origine publique du dev server Vite (`{port}` à substituer). */
  readonly originTemplate: string;
}

/**
 * Hôte utilisable par un NAVIGATEUR pour une adresse d'écoute donnée.
 * `0.0.0.0`/`::` sont des adresses d'ÉCOUTE (toutes interfaces), pas des
 * destinations : dérivées telles quelles dans une URL, elles donnent des
 * `<script src="http://0.0.0.0:5173/…">` que les navigateurs refusent — et
 * sous Windows, une CONNEXION vers `0.0.0.0` échoue aussi (health check).
 */
export function browserReachableHost(listenHost: string): string {
  return listenHost === "0.0.0.0" ||
    listenHost === "::" ||
    listenHost === "[::]" ||
    listenHost === ""
    ? "127.0.0.1"
    : listenHost;
}

/**
 * Le client est-il arrivé par la BOUCLE LOCALE de la machine qui sert ?
 *
 * Ce n'est pas une commodité : c'est un fait vérifiable qui prime sur toute
 * déduction faite au démarrage. Une plateforme de dev déporté se détecte par
 * une variable d'environnement — donc UNE FOIS, au lancement du serveur — alors
 * qu'un même serveur reçoit simultanément des clients arrivés par des chemins
 * différents : l'origine publique de la plateforme, et un tunnel local (VS Code
 * Desktop redirige les ports d'un Codespace sur `localhost`, c'est sa
 * configuration par défaut).
 *
 * Servir l'origine publique à un client venu du tunnel a un coût réel : cette
 * origine exige la session de la plateforme. Un navigateur humain la porte et
 * ne voit rien ; une intégration continue, une sonde ou un agent ne l'ont pas,
 * se font refuser, et obtiennent une page blanche que rien n'explique.
 *
 * La liste est FERMÉE, et c'est ce qui la rend sûre : le `Host` est une donnée
 * cliente, et seuls ces noms désignent la machine locale de façon non
 * ambiguë. `0.0.0.0`/`::` en sont exclus — ce sont des adresses d'écoute, pas
 * des destinations (cf `browserReachableHost`).
 *
 * @param hostname - nom d'hôte NU, sans port (`[::1]` pour l'IPv6 canonique).
 * @returns `true` si ce nom désigne la boucle locale.
 */
export function isLoopbackHostname(hostname: string): boolean {
  if (hostname === "localhost" || hostname === "::1" || hostname === "[::1]") {
    return true;
  }
  // Tout le /8 est de la boucle locale (RFC 1122 § 3.2.1.3), pas seulement
  // `127.0.0.1` : un forwarder peut très bien présenter `127.0.0.2`. Les
  // octets sont BORNÉS — `127.999.1.1` n'est pas une adresse, et un test
  // d'autorisation ne doit rien accepter qui n'en soit pas une.
  return LOOPBACK_V4_RE.test(hostname);
}

/** Un template d'origine est-il syntaxiquement valide ? (autorité unique) */
export function isValidOriginTemplate(template: string): boolean {
  return ORIGIN_TEMPLATE_RE.test(template);
}

/**
 * Origine RÉSOLUE (scheme + hôte + port), telle qu'elle sort du superviseur :
 * `https://127.0.0.1:5173`, `https://x.app.github.dev` (port implicite),
 * `http://[::1]:5173`. Pas de `{port}` ici — le template est déjà substitué.
 */
const RESOLVED_ORIGIN_RE = /^(https?:\/\/)(\[[^\]/]+\]|[^/:\s]+)(:\d+)?$/;

/**
 * Rejoue une origine résolue sur un AUTRE nom d'hôte, en conservant le scheme
 * et le port. Pure.
 *
 * C'est le cœur de la dérivation par requête : le scheme et le port sont ceux
 * du serveur Vite (il écoute où il écoute), seul le NOM change — celui par
 * lequel le client est arrivé. Une page servie sur `http://poste:5151` charge
 * donc `https://poste:5173` si Vite est en TLS : le scheme ne se déduit JAMAIS
 * de la page.
 *
 * `new URL()` est volontairement évité (une allocation par page rendue, pour
 * une chaîne dont nous produisons nous-mêmes la grammaire).
 *
 * @param origin - origine résolue (`scheme://hôte[:port]`).
 * @param hostname - nom d'hôte de remplacement, SANS port (`Context.domain`) ;
 *   une IPv6 est acceptée sous sa forme canonique entre crochets (`[::1]`).
 * @returns l'origine réécrite, ou `null` si l'un des deux est inexploitable
 *   (l'appelant garde alors l'origine d'origine — jamais d'URL bancale émise).
 */
export function originWithHostname(
  origin: string,
  hostname: string,
): string | null {
  const m = RESOLVED_ORIGIN_RE.exec(origin);
  if (!m) return null;
  // Le nom doit être un hôte NU : ni port, ni chemin, ni scheme, ni espace.
  // Un `Host:` forgé (`evil.com/x`, `a:1@b`) ne doit pas pouvoir fabriquer une
  // URL d'asset arbitraire — même si la barrière `trustedHosts` l'a laissé
  // passer (`trustedHosts: true` délègue au reverse-proxy).
  if (!/^(\[[^\]/]+\]|[A-Za-z0-9._-]+)$/.test(hostname)) return null;
  return `${m[1]}${hostname}${m[3] ?? ""}`;
}

/**
 * Résout un template d'origine contre le port RÉEL du spawn. Pure.
 *
 * @returns origine + config HMR cliente, ou `null` si le template est invalide
 *   (l'appelant retombe sur la dérivation locale en l'ANNONÇANT — jamais en
 *   silence).
 */
export function resolveOriginTemplate(
  template: string,
  port: number,
): IResolvedPublicOrigin | null {
  const m = ORIGIN_TEMPLATE_RE.exec(template);
  if (!m) return null;
  const [, scheme, hostTemplate, portTemplate] = m as unknown as [
    string,
    "http" | "https",
    string,
    string | undefined,
  ];
  const host = hostTemplate.replaceAll(PORT_PLACEHOLDER, String(port));
  const explicitPort = portTemplate
    ? parseInt(portTemplate.replaceAll(PORT_PLACEHOLDER, String(port)), 10)
    : undefined;
  const secure = scheme === "https";
  return {
    origin: `${scheme}://${host}${explicitPort !== undefined ? `:${explicitPort}` : ""}`,
    hmr: {
      host,
      clientPort: explicitPort ?? (secure ? 443 : 80),
      protocol: secure ? "wss" : "ws",
    },
  };
}

/**
 * Motif `server.allowedHosts` couvrant TOUTES les origines qu'un template peut
 * produire. `{port}` dans l'hôte → le sous-domaine varie avec le port : motif
 * `.suffixe` (wildcard Vite = domaine + sous-domaines). Hôte fixe → verbatim.
 *
 * @returns le motif, ou `null` si template invalide ou hôte non exprimable
 *   (un `{port}` dans le DERNIER label n'a pas de suffixe à wildcarder).
 */
export function allowedHostPatternForTemplate(template: string): string | null {
  const m = ORIGIN_TEMPLATE_RE.exec(template);
  if (!m) return null;
  const hostTemplate = m[2]!;
  if (!hostTemplate.includes(PORT_PLACEHOLDER)) return hostTemplate;
  const dot = hostTemplate.indexOf(".");
  if (dot === -1 || hostTemplate.slice(dot + 1).includes(PORT_PLACEHOLDER)) {
    return null;
  }
  return hostTemplate.slice(dot); // ".app.github.dev"
}

/**
 * Motif Vite `allowedHosts` équivalent d'un pattern `trustedHosts` http.
 * `*.suffixe` (wildcard un-label de la barrière Host) → `.suffixe` (wildcard
 * Vite). Un `*` ailleurs n'est pas exprimable chez Vite → `null` (l'hôte reste
 * couvert par la barrière Nodefony ; Vite le refusera — motif à écrire en
 * clair dans `trustedHosts` si le cas se présente).
 */
export function viteAllowedHostFromPattern(pattern: string): string | null {
  if (!pattern.includes("*")) return pattern;
  if (pattern.startsWith("*.") && !pattern.slice(2).includes("*")) {
    return pattern.slice(1); // "*.nodefony.com" → ".nodefony.com"
  }
  return null;
}

/**
 * Détecte un environnement de dev déporté depuis les variables de plateforme
 * (variables qu'on ne possède pas — elles se lisent, ne se renomment pas).
 * Ordre : Codespaces puis Gitpod (jamais les deux posées en pratique).
 * Env local/VS Code Remote/WSL2 → `null` (les défauts locaux suffisent).
 */
export function detectRemoteDev(
  env: Readonly<Record<string, string | undefined>>,
): IRemoteDevDetection | null {
  const csName = env.CODESPACE_NAME;
  const csDomain = env.GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN;
  if (csName && csDomain) {
    return {
      provider: "codespaces",
      originTemplate: `https://${csName}-${PORT_PLACEHOLDER}.${csDomain}`,
    };
  }
  const gpUrl = env.GITPOD_WORKSPACE_URL;
  if (gpUrl) {
    try {
      const host = new URL(gpUrl).hostname;
      return {
        provider: "gitpod",
        originTemplate: `https://${PORT_PLACEHOLDER}-${host}`,
      };
    } catch {
      return null; // URL de plateforme malformée → pas de détection
    }
  }
  return null;
}
