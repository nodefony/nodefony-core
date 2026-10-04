/**
 * Rapport de boot — **vérité unique** sur le résultat du démarrage du Kernel,
 * calculé une fois à `onPostReady` et consommé par N canaux (rendu écran dev via
 * `BootReporter`, log structuré prod, code de sortie pour l'orchestrateur/superviseur,
 * canal RPC dev, futur endpoint Studio `/nodefony/kernel/api/boot`).
 *
 * Objectif : **plus aucun boot qui meurt en silence**. Un profil serveur qui finit
 * sans aucun serveur en écoute est un échec VISIBLE (`healthy=false`), pas un
 * « arrêt propre (code 0) » trompeur.
 */

/**
 * Un module ignoré ou en échec **non fatal** pendant le boot (fail-soft). Agrégé
 * par le Kernel pour expliquer, en une ligne par module, pourquoi le boot est
 * dégradé — au lieu de N WARNING enterrés dans le JSONL.
 */
export interface IBootFailure {
  /** Nom du module/service en échec (tag `owner`, ou nom d'entrée du manifeste). */
  module: string;
  /** Message d'erreur condensé (1ʳᵉ ligne). */
  reason: string;
  /**
   * Étape du boot où l'échec s'est produit :
   * - `load` — `import()` du module (manifeste) a throw (ex. « Cannot find package »).
   * - `lifecycle` — un hook `onKernelRegister`/`Boot`/`Ready` a throw/timeout.
   * - `init` — l'`initialize()` d'un service/module a throw/timeout.
   */
  phase: "load" | "lifecycle" | "init";
  /** `true` si l'échec est un dépassement du timeout de boot. */
  timedOut?: boolean | undefined;
}

/**
 * Un module du manifeste **volontairement NON chargé** par le gating
 * `policy`/`when` de `config.modules`. Ce n'est PAS un échec (cf {@link IBootFailure})
 * — mais un gating silencieux se lit comme un module perdu : le bilan de boot
 * l'affiche AVEC sa raison pour que le dev sache pourquoi son module manque.
 */
export interface IBootModuleGated {
  /** Nom d'entrée du manifeste (`config.modules`). */
  module: string;
  /** Raison lisible du non-chargement (ex. `policy "dev" — runtime production`). */
  reason: string;
}

/** Un serveur réseau réellement en écoute à la fin du boot. */
export interface IBootServerInfo {
  /** Nom de service interne (`http` | `https` | `websocket` | `websocket-secure`). */
  type: string;
  /** Scheme d'URL court et conventionnel (`http` | `https` | `ws` | `wss`). */
  scheme: string;
  /** Port d'écoute effectif. */
  port: number;
  /** Adresse de bind (`127.0.0.1`, `0.0.0.0`…), si connue. */
  address?: string | undefined;
  /** URL complète d'accès (`scheme://host:port`) — cliquable au terminal. */
  url: string;
}

/**
 * Verdict agrégé du dernier boot. `healthy=false` ⇒ le boot est raté ou dégradé de
 * façon bloquante (typiquement : profil serveur attendu mais 0 serveur en écoute).
 */
export interface IBootReport {
  /** Durée approximative du boot (ms). */
  durationMs: number;
  /** Modules effectivement chargés et enregistrés. */
  modulesLoaded: string[];
  /**
   * Nombre d'entrées DÉCLARÉES au manifeste `config.modules`, avant tout gating.
   *
   * Distinct de `modulesLoaded` (ce qui a été chargé), de `modulesSkipped` (ce qui
   * a échoué) et de `modulesGated` (ce qui a été écarté à dessein) : c'est ce que
   * la configuration LUE demandait. Un manifeste à `0` alors que le profil attend
   * des serveurs est un état muet — aucune de ces trois listes ne le contient, et
   * rien n'a été tenté. Vécu : une application dont le manifeste résolu était vide
   * bootait avec son seul module local puis échouait sur « aucun serveur en
   * écoute », un diagnostic qui ne menait nulle part.
   */
  manifestEntries: number;
  /** Modules ignorés/échoués en fail-soft (avec la raison). */
  modulesSkipped: IBootFailure[];
  /** Modules volontairement non chargés (gating `policy`/`when`) — pas des échecs. */
  modulesGated: IBootModuleGated[];
  /**
   * Logs `WARNING` émis pendant le boot (comptés dans le ring buffer syslog ;
   * figés à `onPostReady`, comptage à la volée tant que le boot est en cours).
   */
  warnings: number;
  /** Logs `ERROR` et pire (`CRITIC`/`ALERT`/`EMERGENCY`) émis pendant le boot. */
  errors: number;
  /**
   * Les PREMIERS de ces messages, condensés — `null` quand il n'y en a aucun.
   *
   * `errors: 1` sans un mot était le cas le plus frustrant du bilan : le
   * lecteur savait qu'il s'était passé quelque chose, pas quoi. Alloué
   * seulement s'il y a matière.
   */
  criticals: string[] | null;
  /** `true` si le profil d'exécution attendait des serveurs réseau. */
  serversExpected: boolean;
  /** Serveurs réellement en écoute. */
  serversListening: IBootServerInfo[];
  /**
   * Verdict global : `false` si un profil serveur a fini sans aucun serveur en
   * écoute (garde-fou 0-serveur). Les modules ignorés seuls ne rendent PAS le boot
   * `unhealthy` (dégradé mais vivant) — seul le 0-serveur attendu est bloquant.
   */
  healthy: boolean;
  /**
   * Action corrective suggérée d'après les raisons d'échec (ex. « dist périmé ⇒
   * npm run clean && npm run build » quand un `import()` échoue). `undefined` si
   * aucune heuristique ne matche. Source unique partagée par le log et l'écran.
   */
  remediation?: string | undefined;
  /**
   * Adresses à OUVRIR (application, puis les liens déclarés par les modules) —
   * vide sans serveur web. Jamais un port interne.
   */
  open: IBootLink[];
  /**
   * Points d'attention, triés du plus urgent au détail — constatés par le
   * noyau ({@link collectBootNotices}) ou déclarés par les modules.
   */
  notices: IBootNotice[];
}

/**
 * Gravité d'un point d'attention du démarrage, de la plus urgente à la moins
 * urgente : `error` bloque (✗), `warning` est à corriger (⚠), `info` renseigne (ℹ).
 */
export type BootNoticeLevel = "error" | "warning" | "info";

/**
 * Un point d'attention du démarrage — CE QUI MANQUE OU S'EST DÉGRADÉ, dit par
 * le module qui le constate, avec le geste qui le corrige.
 *
 * Le `code` est un identifiant STABLE (`DB_SQLITE_FALLBACK`) : c'est lui qu'un
 * agent ou un script compare, jamais le message, qui peut être reformulé.
 */
export interface IBootNotice {
  /** Identifiant stable, en majuscules (`FIREWALL_PUBLIC_ROUTES`). */
  code: string;
  /** Gravité — décide du symbole et de l'ordre d'affichage. */
  level: BootNoticeLevel;
  /** Le constat, en une phrase. */
  message: string;
  /** Le geste qui corrige, prêt à coller (commande ou config) — absent s'il n'y en a pas. */
  fix?: string | undefined;
}

/**
 * Une adresse à OUVRIR — ce que le développeur tape dans son navigateur.
 *
 * Distincte des adresses d'écoute : un serveur lié à `0.0.0.0` écoute bien
 * là, mais `https://0.0.0.0:5152` n'est pas une adresse qu'on ouvre.
 */
export interface IBootLink {
  /** Clé stable en anglais (`app`, `studio`) — lue par la machine. */
  id: string;
  /** Libellé affiché (`Application`, `Studio`). */
  label: string;
  /** URL complète. */
  url: string;
}

/**
 * Déclaration d'un lien par un module : un CHEMIN, que le noyau résout contre
 * l'origine de l'application. Le module ne connaît ni le port ni l'hôte — et
 * ne doit pas les connaître : ils changent avec la configuration.
 */
export interface IBootLinkDeclaration {
  /** Clé stable en anglais. */
  id: string;
  /** Libellé affiché. */
  label: string;
  /** Chemin absolu sur l'application (`/nodefony`). */
  path: string;
}

/** Rang d'une gravité : l'ordre d'affichage, du plus urgent au détail. */
const NOTICE_RANK: Record<BootNoticeLevel, number> = {
  error: 0,
  warning: 1,
  info: 2,
};

/**
 * Trie les points d'attention du plus urgent au moins urgent, en gardant
 * l'ordre d'arrivée à gravité égale (tri stable).
 *
 * @param notices - les points, dans l'ordre où ils ont été déclarés.
 * @returns une NOUVELLE liste triée.
 */
export function sortBootNotices(
  notices: readonly IBootNotice[],
): IBootNotice[] {
  return [...notices].sort(
    (a, b) => NOTICE_RANK[a.level] - NOTICE_RANK[b.level],
  );
}

/**
 * L'hôte à OUVRIR pour une adresse d'écoute.
 *
 * Une adresse de bouclage (`127.0.0.1`, `::1`) ou une adresse joker
 * (`0.0.0.0`, `::`) se remplace par `localhost` : le développement est
 * standardisé sur ce nom, parce que les passkeys refusent une IP comme
 * domaine et qu'un cookie posé sous un nom ne part pas sous l'autre. Une
 * adresse précise (une interface du réseau local, un nom) est gardée telle
 * quelle — c'est elle qu'on a demandée.
 *
 * @param address - adresse de liaison du serveur, si connue.
 * @returns un hôte utilisable dans une URL (IPv6 entre crochets).
 */
export function openableHost(address: string | undefined): string {
  if (
    address === undefined ||
    address === "" ||
    address === "0.0.0.0" ||
    address === "::" ||
    address === "::1" ||
    address.startsWith("127.")
  ) {
    return "localhost";
  }
  return address.includes(":") ? `[${address}]` : address;
}

/**
 * Les adresses à ouvrir, d'après les serveurs en écoute et les liens déclarés.
 *
 * L'application s'ouvre sur son origine HTTPS (repli HTTP) — jamais sur un
 * port interne : un serveur de développement d'assets passe DERRIÈRE
 * l'application et ne figure dans aucune de ces listes.
 *
 * @param servers - serveurs réellement en écoute.
 * @param declared - liens déclarés par les modules (chemins).
 * @returns les liens résolus, l'application en tête ; vide sans serveur web.
 */
export function resolveBootLinks(
  servers: readonly IBootServerInfo[],
  declared: readonly IBootLinkDeclaration[],
): IBootLink[] {
  const web =
    servers.find((s) => s.scheme === "https") ??
    servers.find((s) => s.scheme === "http");
  if (!web) return [];
  const origin = `${web.scheme}://${openableHost(web.address)}:${web.port}`;
  const links: IBootLink[] = [
    { id: "app", label: "Application", url: `${origin}/` },
  ];
  for (const link of declared) {
    const path = link.path.startsWith("/") ? link.path : `/${link.path}`;
    links.push({ id: link.id, label: link.label, url: `${origin}${path}` });
  }
  return links;
}

/**
 * Les points d'attention que le NOYAU constate lui-même — modules en échec,
 * composants qui retiennent la mise en service — suivis de ceux que les
 * modules ont déclarés, le tout trié.
 *
 * Une seule liste, calculée en un seul endroit : l'écran, le rendu machine et
 * `var/last-boot.json` la lisent telle quelle. Trois listes divergeraient.
 *
 * @param failed - modules en échec fail-soft.
 * @param remediation - geste correctif suggéré par le bilan, s'il y en a un.
 * @param contributors - contributeurs de disponibilité — seuls les NON prêts
 *   parlent : le cas normal reste muet (un bandeau qui parle sur le cas normal
 *   s'apprend à être ignoré).
 * @param declared - points déclarés par les modules.
 * @returns la liste triée (vide quand tout va bien).
 */
export function collectBootNotices(
  failed: readonly IBootFailure[],
  remediation: string | undefined,
  contributors: ReadonlyArray<{
    readonly name: string;
    readonly ready: boolean;
    readonly reason?: string | undefined;
    readonly action?: string | undefined;
    readonly blocking?: boolean | undefined;
  }>,
  declared: readonly IBootNotice[],
): IBootNotice[] {
  const notices: IBootNotice[] = [];
  for (const f of failed) {
    notices.push({
      code: "MODULE_FAILED",
      level: "warning",
      message: `module ${f.module} en échec, l'application tourne sans lui — ${f.reason}`,
      fix: remediation,
    });
  }
  for (const c of contributors) {
    if (c.ready) continue;
    // `blocking` absent = cas courant « non prêt ⇒ retient » (ReadinessRegistry).
    const held = c.blocking !== false;
    notices.push({
      code: "NOT_READY",
      level: held ? "error" : "warning",
      message:
        `${c.name} pas prêt${c.reason ? ` — ${c.reason}` : ""}` +
        (held
          ? " · trafic retenu (/readyz 503)"
          : " · le trafic passe quand même"),
      fix: c.action,
    });
  }
  notices.push(...declared);
  return sortBootNotices(notices);
}
