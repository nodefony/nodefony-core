import inspector from "node:inspector";

/** Inspecteur demandé par `--inspect` / `--inspect-brk` sur la commande de développement. */
export interface IDevInspectRequest {
  /** Interface d'écoute — `127.0.0.1` par défaut, comme Node. */
  readonly host: string;
  /** Port d'écoute — `9229` par défaut ; `0` laisse le système choisir. */
  readonly port: number;
  /** `true` pour `--inspect-brk` : le serveur attend le débogueur AVANT de charger l'application. */
  readonly wait: boolean;
}

const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PORT = 9229;
const INSPECT_ARG = /^--inspect(-brk)?(?:=(.*))?$/u;

/**
 * Lit `--inspect[-brk][=[hôte:]port]` dans les arguments de la commande — et non dans
 * ceux de `node`.
 *
 * Pourquoi une option de NODEFONY : un `--inspect` posé pour `node` (ou dans
 * `NODE_OPTIONS`) est pris par le PREMIER process node de la chaîne — `npx`, `npm run`,
 * puis le superviseur —, jamais par le serveur qui exécute le code de l'application.
 * Lue ici, elle est relayée telle quelle au serveur, qui ouvre lui-même son inspecteur.
 * Fonction PURE (l'argv est passé) : elle s'éprouve sans process.
 *
 * @param args - `process.argv` ou son équivalent de test.
 * @returns la demande, ou `null` si aucune option d'inspection n'est présente.
 * @throws Si la valeur n'est ni un port, ni `hôte:port`.
 */
export function parseInspectArgs(
  args: readonly string[],
): IDevInspectRequest | null {
  for (let i = 0; i < args.length; i++) {
    const arg = args[i] ?? "";
    const m = INSPECT_ARG.exec(arg);
    if (!m) continue;
    const wait = m[1] === "-brk";
    let value = m[2];
    // Forme à ESPACE — celle que l'aide annonce (`--inspect [host:port]`) : la
    // valeur suit, sauf si c'est une autre option. Sans ceci elle était JETÉE en
    // silence et le débogueur s'ouvrait ailleurs que demandé.
    const next = args[i + 1];
    if (value === undefined && next !== undefined && !next.startsWith("-")) {
      value = next;
    }
    if (value === undefined || value === "") {
      return { host: DEFAULT_HOST, port: DEFAULT_PORT, wait };
    }
    const sep = value.lastIndexOf(":");
    const host = sep === -1 ? DEFAULT_HOST : value.slice(0, sep);
    const portText = sep === -1 ? value : value.slice(sep + 1);
    const port = Number(portText);
    if (
      host === "" ||
      !/^\d+$/u.test(portText) ||
      !Number.isInteger(port) ||
      port > 65535
    ) {
      throw new Error(
        `${arg} : valeur invalide — attendu --inspect, --inspect=<port> ou --inspect=<hôte>:<port>`,
      );
    }
    return { host, port, wait };
  }
  return null;
}

/**
 * Dit si une interface d'écoute reste sur la boucle locale.
 *
 * 🔴 Un inspecteur joignable depuis le réseau EXÉCUTE le code de quiconque s'y
 * connecte (le protocole permet `Runtime.evaluate`) : hors boucle locale, il
 * faut le dire à voix haute. Pur : l'appelant décide quoi afficher.
 *
 * @param host - hôte demandé (`127.0.0.1`, `::1`, `0.0.0.0`…).
 * @returns `true` si seule la machine locale peut joindre l'inspecteur.
 */
export function isLoopbackHost(host: string): boolean {
  const h = host.replace(/^\[(.*)\]$/u, "$1").toLowerCase();
  return h === "localhost" || h === "::1" || /^127\.\d+\.\d+\.\d+$/u.test(h);
}

/**
 * Ouvre l'inspecteur DANS le process serveur, avant le chargement de l'application.
 *
 * Appelée par l'enfant supervisé (donc rouverte à chaque redémarrage, sur le même
 * port) et par `--no-watch`. Un inspecteur déjà ouvert (`node --inspect` direct sur le
 * serveur) est conservé tel quel. La capacité se CONSTATE : un runtime qui n'implémente
 * pas `inspector.open` rend `{ supported: false }` au lieu de lever.
 *
 * @param req - demande lue par {@link parseInspectArgs}.
 * @returns l'URL WebSocket du débogueur, ou la raison de l'échec.
 */
export function openDevInspector(
  req: IDevInspectRequest,
): { supported: true; url: string } | { supported: false; reason: string } {
  try {
    let url = inspector.url();
    if (url === undefined) {
      inspector.open(req.port, req.host, req.wait);
      url = inspector.url();
    }
    if (url === undefined) {
      return { supported: false, reason: "inspecteur non ouvert" };
    }
    return { supported: true, url };
  } catch (e) {
    return {
      supported: false,
      reason: e instanceof Error ? e.message : String(e),
    };
  }
}
