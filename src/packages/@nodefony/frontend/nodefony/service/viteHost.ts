/**
 * L'HÔTE Vite d'une famille (ADR-0030 §D1) : un process Node, lancé par `fork`
 * par un teneur `HostHolder`, qui pilote Vite par son API JavaScript —
 * `createServer`, `listen`, `close` — et en rapporte l'état par le canal
 * `nf-held`. Il remplace le process de la ligne de commande de Vite : aucune
 * sortie n'est plus lue pour deviner « prêt » ou « port occupé ».
 *
 * 🔴 MODULE FEUILLE. Il est lancé tel quel (dist, ou source `.ts` sous les tests)
 * à chaque démarrage et à chaque relance d'un service : il n'importe que des
 * modules `node:`, `nodefony/held` (le protocole seul, ~1 ms — le paquet
 * `nodefony` entier en coûte ~330) et `vite`. Aucun import relatif : Node ne
 * résout pas un spécificateur sans extension dans une source `.ts` lancée
 * directement. L'adaptateur côté serveur importe ce fichier pour ses fonctions
 * pures — la garde en pied de fichier n'y sert donc aucun service.
 */
import { createServer as createNetServer } from "node:net";
import {
  serveHeldServiceIfMain,
  type HeldJsonObject,
  type IHeldServiceImpl,
  type ProcessOutputStream,
} from "nodefony/held";
import type {
  InlineConfig,
  LogErrorOptions,
  Logger,
  LogOptions,
  ViteDevServer,
} from "vite";

/** Ce que l'hôte reçoit de son teneur (`IHeldStart.spec`), une fois lu. */
export interface IViteHostSpec {
  /** Famille d'isolation (`default`, `angular`) — préfixe des journaux. */
  readonly family: string;
  /** Chemin ABSOLU de `vite.config.generated.mjs`. */
  readonly configFile: string;
  /** Adresse d'écoute (`devHost`). */
  readonly host: string;
  /** Premier port essayé. */
  readonly port: number;
  /** Replis sur le port suivant quand le port est pris. */
  readonly portRetryAttempts: number;
  /** Mode Vite (`kernel.environment`), `null` → celui de la config. */
  readonly mode: string | null;
  /**
   * Titre du process (`nodefony-vite[react+studio]`), composé par l'adaptateur
   * sur `DEV_VITE_PREFIX` du cœur — seule source du préfixe que `nodefony
   * status` et `nodefony stop` reconnaissent en tête de ligne `ps`.
   */
  readonly title: string;
}

/** La donnée que l'hôte prêt rapporte (`IHeldReport.data`). */
export interface IViteHostReady {
  /** Le port où Vite écoute VRAIMENT, lu sur la socket. */
  readonly port: number;
  /** Replis de port effectués avant d'écouter. */
  readonly portRetries: number;
}

/** Un nom de famille sûr dans un préfixe de journal et un titre de process. */
const FAMILY_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

/** Un titre de process : imprimable, borné — il s'affiche dans `ps`. */
const TITLE_RE = /^[\x21-\x7e]{1,200}$/;

/** Plafond des replis de port — au-delà, ce n'est plus un repli mais un balayage. */
const MAX_PORT_RETRIES = 100;

/** Champ texte non vide d'une spécification. */
function readString(spec: HeldJsonObject, key: string): string {
  const value = spec[key];
  if (typeof value !== "string" || value === "") {
    throw new Error(`spécification de l'hôte Vite : « ${key} » invalide`);
  }
  return value;
}

/** Champ entier borné d'une spécification. */
function readInt(
  spec: HeldJsonObject,
  key: string,
  min: number,
  max: number,
): number {
  const value = spec[key];
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < min ||
    value > max
  ) {
    throw new Error(
      `spécification de l'hôte Vite : « ${key} » hors de [${min}, ${max}]`,
    );
  }
  return value;
}

/**
 * Lit et valide la spécification reçue : elle traverse un canal, elle ne se
 * croit pas sur parole.
 *
 * @param spec - l'objet JSON reçu du teneur.
 * @returns la spécification typée.
 * @throws si un champ manque ou sort de ses bornes — la raison part au teneur.
 */
export function readViteHostSpec(spec: HeldJsonObject): IViteHostSpec {
  const family = readString(spec, "family");
  if (!FAMILY_RE.test(family)) {
    throw new Error(
      `spécification de l'hôte Vite : famille « ${family} » invalide`,
    );
  }
  const mode = spec.mode;
  if (mode !== null && (typeof mode !== "string" || mode === "")) {
    throw new Error("spécification de l'hôte Vite : « mode » invalide");
  }
  const title = readString(spec, "title");
  if (!TITLE_RE.test(title)) {
    throw new Error("spécification de l'hôte Vite : « title » invalide");
  }
  return {
    family,
    configFile: readString(spec, "configFile"),
    host: readString(spec, "host"),
    port: readInt(spec, "port", 1, 65_535),
    portRetryAttempts: readInt(spec, "portRetryAttempts", 0, MAX_PORT_RETRIES),
    mode,
    title,
  };
}

/** Niveau d'une ligne de journal de l'hôte. */
export type ViteHostLogLevel = "info" | "warn" | "error";

/** Marque de niveau, posée après le préfixe de famille (`info` n'en a pas). */
const LEVEL_MARK: Readonly<Record<ViteHostLogLevel, string>> = {
  info: "",
  warn: "WARN ",
  error: "ERROR ",
};

/**
 * Met un message de Vite en lignes de journal : chaque ligne porte le préfixe
 * `[vite:<famille>] ` et la marque de niveau — si bien qu'une ligne se lit
 * seule, même quand un lecteur reçoit le message en plusieurs morceaux.
 *
 * SEULE écriture du format ; {@link parseViteHostLine} est sa SEULE lecture.
 *
 * @param family - famille de l'hôte.
 * @param level - niveau du message.
 * @param message - texte de Vite, éventuellement sur plusieurs lignes.
 * @returns les lignes, fin `\n` comprise ; `""` si le message est vide.
 */
export function formatViteHostLog(
  family: string,
  level: ViteHostLogLevel,
  message: string,
): string {
  const head = `[vite:${family}] ${LEVEL_MARK[level]}`;
  let out = "";
  for (const raw of message.split("\n")) {
    const line = raw.endsWith("\r") ? raw.slice(0, -1) : raw;
    if (line.trim() !== "") out += `${head}${line}\n`;
  }
  return out;
}

/** Une ligne de journal relue : son niveau et son texte, préfixe ôté. */
export interface IViteHostLine {
  readonly level: ViteHostLogLevel;
  readonly text: string;
}

/**
 * Relit une ligne écrite par {@link formatViteHostLog}.
 *
 * @param line - une ligne, sans sa fin `\n`.
 * @returns son niveau et son texte, ou `null` si elle ne vient pas du logger de
 *   l'hôte (un greffon qui écrit lui-même sur la console) — le lecteur tranche
 *   alors sur le flux d'origine.
 */
export function parseViteHostLine(line: string): IViteHostLine | null {
  if (!line.startsWith("[vite:")) return null;
  const end = line.indexOf("] ", 6);
  if (end === -1) return null;
  const rest = line.slice(end + 2);
  if (rest.startsWith(LEVEL_MARK.error))
    return { level: "error", text: rest.slice(LEVEL_MARK.error.length) };
  if (rest.startsWith(LEVEL_MARK.warn))
    return { level: "warn", text: rest.slice(LEVEL_MARK.warn.length) };
  return { level: "info", text: rest };
}

/**
 * Le `Logger` que l'hôte donne à Vite (`customLogger`). Même sémantique que
 * `createLogger` de Vite (`warnOnce`, `hasWarned`, `hasErrorLogged`), mais
 * `info` part sur la sortie standard, `warn` et `error` sur l'erreur, chacun
 * marqué de son niveau — là où celui de Vite mêle les deux derniers.
 * `clearScreen` est INERTE : l'écran appartient au superviseur (ADR-0030 §D6).
 *
 * @param family - famille de l'hôte, préfixe de chaque ligne.
 * @param write - où écrire ; le process par défaut.
 * @returns le logger.
 */
export function createViteHostLogger(
  family: string,
  write: (stream: ProcessOutputStream, text: string) => void,
): Logger {
  const loggedErrors = new WeakSet<object>();
  const warned = new Set<string>();
  const emit = (
    level: ViteHostLogLevel,
    message: string,
    options: LogOptions | undefined,
  ): void => {
    // Comme Vite : l'environnement (`(client)`, `(ssr)`) ne précède que les
    // messages horodatés.
    const env =
      options?.timestamp === true && options.environment
        ? `${options.environment} `
        : "";
    const text = formatViteHostLog(family, level, env + message);
    if (text !== "") write(level === "info" ? "out" : "err", text);
  };
  const logger: Logger = {
    hasWarned: false,
    info(message: string, options?: LogOptions): void {
      emit("info", message, options);
    },
    warn(message: string, options?: LogOptions): void {
      logger.hasWarned = true;
      emit("warn", message, options);
    },
    warnOnce(message: string, options?: LogOptions): void {
      if (warned.has(message)) return;
      warned.add(message);
      logger.hasWarned = true;
      emit("warn", message, options);
    },
    error(message: string, options?: LogErrorOptions): void {
      logger.hasWarned = true;
      if (options?.error) loggedErrors.add(options.error);
      emit("error", message, options);
    },
    clearScreen(): void {},
    hasErrorLogged(error: object): boolean {
      return loggedErrors.has(error);
    },
  };
  return logger;
}

/** Verdict d'une sonde de port. */
export type PortProbe = "free" | "taken";

/**
 * Le port est-il libre sur cette adresse ? Le CONSTATE en s'y liant, puis se
 * retire. Pris = `EADDRINUSE`, ou `EACCES` : sous Windows, un port tenu en
 * exclusivité ou réservé par le système (Hyper-V, WinNAT) refuse le `listen`
 * en `EACCES`, jamais en `EADDRINUSE` (vu sur la forge).
 *
 * Pourquoi sonder nous-mêmes : avec `strictPort`, Vite rejette un port pris
 * par `new Error("Port N is already in use")` — un texte, sans code. Le
 * reconnaître reviendrait à lire un libellé qu'une version peut changer.
 *
 * @param host - adresse d'écoute.
 * @param port - port à constater.
 * @returns `free` ou `taken`.
 * @throws toute autre erreur de `listen` (adresse inconnue…) : un autre port ne
 *   la réparerait pas.
 */
export function probePort(host: string, port: number): Promise<PortProbe> {
  return new Promise<PortProbe>((resolve, reject) => {
    const server = createNetServer();
    server.unref();
    server.once("error", (error: NodeJS.ErrnoException) => {
      if (error.code === "EADDRINUSE" || error.code === "EACCES") {
        resolve("taken");
      } else {
        reject(error);
      }
    });
    server.listen({ host, port, exclusive: true }, () => {
      server.close(() => resolve("free"));
    });
  });
}

/**
 * Ce que l'hôte touche d'un `ViteDevServer` — et rien d'autre. Le serveur réel
 * le satisfait structurellement ; un double de test aussi, sans transtypage.
 */
export interface IViteHostServer {
  listen(port?: number): Promise<unknown>;
  close(): Promise<void>;
  readonly httpServer: Pick<
    NonNullable<ViteDevServer["httpServer"]>,
    "address"
  > | null;
}

/** Ce dont l'hôte a besoin du monde — injectable pour l'éprouver sans Vite. */
export interface IViteHostDeps {
  /** Charge `createServer` de Vite. */
  readonly loadVite: () => Promise<{
    createServer(config: InlineConfig): Promise<IViteHostServer>;
  }>;
  readonly probePort: (host: string, port: number) => Promise<PortProbe>;
  readonly write: (stream: ProcessOutputStream, text: string) => void;
  readonly setTitle: (title: string) => void;
}

/** Les dépendances réelles : la Vite résolue depuis ce paquet, le process. */
const DEFAULT_DEPS: IViteHostDeps = {
  loadVite: () => import("vite"),
  probePort,
  write: (stream, text) => {
    (stream === "out" ? process.stdout : process.stderr).write(text);
  },
  setTitle: (title) => {
    process.title = title;
  },
};

/**
 * La config que l'hôte IMPOSE par-dessus le fichier généré — `InlineConfig`
 * prime sur le fichier (fusion de Vite). Ce sont les remparts de l'ADR-0030
 * §D6 qui passent par la config :
 * - `clearScreen: false` — Vite n'efface jamais un écran qui n'est pas à lui ;
 * - `server.forwardConsole: false` — sinon son défaut CHANGE sous un agent IA
 *   (`std-env`) et la console du navigateur se déverse dans le terminal ;
 * - `strictPort: true` — le port se choisit ICI, sondé, jamais au hasard d'un
 *   balayage de Vite qui empiéterait sur le bloc d'une autre famille.
 *
 * @param spec - la spécification lue.
 * @param port - le port retenu.
 * @param logger - le logger de l'hôte.
 * @returns la config passée à `createServer`.
 */
export function viteHostInlineConfig(
  spec: IViteHostSpec,
  port: number,
  logger: Logger,
): InlineConfig {
  return {
    configFile: spec.configFile,
    ...(spec.mode === null ? {} : { mode: spec.mode }),
    clearScreen: false,
    customLogger: logger,
    server: {
      host: spec.host,
      port,
      strictPort: true,
      forwardConsole: false,
    },
  };
}

/**
 * Le service que l'hôte sert : démarre Vite sur le premier port libre de son
 * bloc, rapporte le port lu sur la socket ; l'arrête par `close()`.
 *
 * Le port se sonde AVANT `createServer` — le coût de Vite (config, greffons)
 * n'est payé qu'une fois. Si un autre process prend le port entre la sonde et
 * l'écoute, le `listen` échoue : une nouvelle sonde le constate, et l'écoute
 * repart sur le port suivant avec le MÊME serveur.
 *
 * @param deps - le monde ; réel par défaut.
 * @returns l'implémentation servie par `serveHeldService`.
 */
export function createViteHostService(
  deps: IViteHostDeps = DEFAULT_DEPS,
): IHeldServiceImpl {
  let server: IViteHostServer | null = null;
  return {
    async start(raw: HeldJsonObject): Promise<HeldJsonObject> {
      const spec = readViteHostSpec(raw);
      // D'abord : la fenêtre où `nodefony status` ne reconnaît pas l'hôte
      // reste celle du démarrage de Node, jamais celle du chargement de Vite.
      deps.setTitle(spec.title);
      const last = spec.port + spec.portRetryAttempts;
      if (last > 65_535) {
        throw new Error(
          `hôte Vite « ${spec.family} » : bloc de ports ${spec.port}-${last} hors bornes`,
        );
      }
      let port = spec.port;
      while ((await deps.probePort(spec.host, port)) === "taken") {
        if (port === last) {
          throw new Error(
            `hôte Vite « ${spec.family} » : ports ${spec.port} à ${last} tous occupés`,
          );
        }
        port++;
      }
      const viteApi = await deps.loadVite();
      const logger = createViteHostLogger(spec.family, deps.write);
      const vite = await viteApi.createServer(
        viteHostInlineConfig(spec, port, logger),
      );
      server = vite;
      for (;;) {
        try {
          await vite.listen(port);
          break;
        } catch (error) {
          const raced =
            port < last &&
            (await deps.probePort(spec.host, port).catch(() => "free")) ===
              "taken";
          if (!raced) {
            server = null;
            await vite.close().catch(() => undefined);
            throw error;
          }
          port++;
        }
      }
      // Le port de la SOCKET, pas celui qu'on a demandé : c'est lui qui sert.
      const address = vite.httpServer?.address();
      const ready = {
        port:
          typeof address === "object" && address !== null ? address.port : port,
        portRetries: port - spec.port,
      } satisfies IViteHostReady;
      return ready;
    },
    async stop(): Promise<void> {
      const vite = server;
      server = null;
      if (vite !== null) await vite.close();
    },
  };
}

// Lancé par un teneur comme point d'entrée : servir. Importé par l'adaptateur
// pour ses fonctions pures : rien. (`SIGINT` et titre : `serveHeldService`.)
serveHeldServiceIfMain(import.meta, createViteHostService);
