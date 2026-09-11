import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { printUsage, printUsageError, type IUsagePage } from "./usageReport";
import { writeAgentPointers } from "./scaffold/engine";
import { SysExit } from "./sysexits";
import { chargePrompts } from "./prompts";
import {
  ADMIN_SCOPE_READ,
  ADMIN_SCOPE_WRITE,
} from "../kernel/adminPlane/adminCaller";
import { findProjectRoot } from "./projectRoot";
import { defaultDevPorts } from "../service/dev/devProcess";
import {
  buildMcpUrl,
  planMcpConfig,
  renderMcpPlan,
  serveursDe,
  MCP_CONFIG_FILE,
  MCP_SERVER_KEY,
  MCP_TOKEN_ENV,
  type IMcpConfigDocument,
} from "./aiMcpReport";
import {
  AGENT_TARGETS,
  requestedAgents,
  agentsPresents,
  litVariable,
  planAgentDeclaration,
  agentRoot,
  renderPlanShell,
  type IAgentMcpFile,
  type IAgentTarget,
} from "./agentTargets";

/**
 * `nodefony ai:mcp` — déclare le serveur MCP de cette application à ton agent.
 *
 * ## Ce que cette commande fait, et ce qu'elle NE fait pas
 *
 * Elle **écrit un fichier de câblage** (`.mcp.json`) et rend la main. Elle ne
 * démarre aucun process : depuis la révision `2026-07-28` du transport, un
 * serveur MCP est un simple endpoint `POST` sans session — chez Nodefony,
 * c'est une **route de l'application** (`POST /nodefony/mcp`, module
 * `@nodefony/devkit`). Il n'y a donc rien à lancer en plus de l'application,
 * et rien à relancer quand le superviseur la recharge.
 *
 * ## Pourquoi standalone (aucun boot)
 *
 * Même raison que `card` et `ai:sync` : écrire un fichier de configuration ne
 * dépend d'aucun service, et la commande doit répondre dans un terminal qui n'a
 * pas posé `NODE_ENV` — le module qui sert la route est `policy: "dev"`, il
 * n'existerait pas ici.
 *
 * ## Le port n'est pas deviné
 *
 * Il est lu du fichier d'état que le runtime publie une fois ses serveurs en
 * écoute (`defaultDevPorts`), et retombe sur la convention `5151` seulement
 * quand rien n'a jamais tourné. C'est la même source que `nodefony status` :
 * deux lectures indépendantes finiraient par annoncer un port où personne
 * n'écoute.
 */

/** Chemin de la route MCP — dupliqué NULLE PART ailleurs dans le cœur. */
const MCP_PATH = "/nodefony/mcp";

/** La page d'aide — `nodefony ai:mcp --help`, et le rappel après un refus. */
const PAGE: IUsagePage = {
  command: "nodefony ai:mcp",
  tagline:
    "déclare le serveur MCP de cette application à ton agent, et si tu veux " +
    "chez les agents installés",
  synopsis: [
    "nodefony ai:mcp [--auth|--no-auth] [--url <origine>] [options]",
    "nodefony ai:mcp --agent <liste> [--remove] [--global] [options]",
  ],
  sections: [
    {
      title: "CE QU'ELLE ÉCRIT",
      paragraph:
        `Le fichier ${MCP_CONFIG_FILE} du projet, et — si --agent est donné — ` +
        "la déclaration chez les agents nommés, par LEUR propre outil en " +
        "ligne de commande. Elle ne DÉMARRE rien : le serveur MCP est une " +
        "route de l'application, pas un process.",
    },
    {
      title: "AGENTS RECONNUS",
      lines: [`${AGENT_TARGETS.map((c) => c.key).join(" · ")} · all · none`],
      paragraph:
        "« none » — ou aucune case cochée en mode interactif — ne touche à " +
        "aucun agent : coder seul est un choix, pas un oubli.",
    },
  ],
  options: [
    {
      term: "-a, --auth",
      text:
        `mode authentifié : l'en-tête porte \${${MCP_TOKEN_ENV}}, jamais le ` +
        "jeton lui-même. Sans option, le mode déjà en place est CONSERVÉ",
    },
    { term: "--no-auth", text: "retire l'en-tête d'autorisation" },
    {
      term: "--no-token",
      text: "câble la porte sans enchaîner sur l'émission du jeton",
    },
    {
      term: "-u, --url <origine>",
      text: "origine forcée (ex. https://localhost:5152)",
    },
    {
      term: "--agent <liste>",
      text: "déclare AUSSI la porte chez ces agents, via leur propre CLI",
    },
    {
      term: "--remove",
      text: "avec --agent : retire la déclaration au lieu de la poser",
    },
    {
      term: "--global",
      text:
        "avec --agent : déclare dans TON foyer au lieu du projet (une seule " +
        "application servie)",
    },
    { term: "-n, --dry-run", text: "le plan, sans rien écrire" },
    { term: "-j, --json", text: "le même plan, exploitable par un script" },
    {
      term: "--cwd <chemin>",
      text: "point de départ (la racine de l'app est résolue en remontant)",
    },
  ],
  examples: [
    { term: "nodefony ai:mcp", text: "déclare la porte dans le projet" },
    {
      term: "nodefony ai:mcp --auth",
      text: "en mode authentifié — le jeton s'obtient par `nodefony security:token --write`",
    },
    {
      term: "nodefony ai:mcp --agent all",
      text: "et chez tous les agents installés sur ce poste",
    },
  ],
  exitCodes: [{ term: "66", text: "aucune application ici (EX_NOINPUT)" }],
};

/** Ce que la ligne de commande demande. */
interface IAiMcpRequest {
  /** `true` si l'on veut seulement la page d'aide. */
  help: boolean;
  /** Origine forcée (`https://localhost:5152`), ou `null` pour la déduire. */
  url: string | null;
  /**
   * Mode authentifié. `null` = ne rien décider — on conserve ce que le fichier
   * porte déjà, pour qu'un rafraîchissement d'URL ne désarme pas la porte.
   */
  auth: boolean | null;
  /**
   * Agents à déclarer, tels que tapés. `undefined` = rien de demandé — en
   * terminal on PROPOSE, ailleurs on ne touche à la configuration de personne.
   */
  agent: string | undefined;
  /** Retirer la déclaration au lieu de la poser. */
  remove: boolean;
  /**
   * Déclarer dans le foyer de l'utilisateur au lieu du projet.
   *
   * Le défaut est le PROJET : l'URL d'une porte porte un port, et une
   * déclaration globale ne peut désigner qu'une application. Ce drapeau
   * existe pour qui veut délibérément une porte valable partout — un poste
   * qui n'ouvre jamais qu'un seul projet Nodefony, typiquement.
   */
  global: boolean;
  /**
   * Enchaîner sur l'émission du jeton (`security:token --write`) après le
   * câblage. `false` (`--no-token`) quand l'appelant SAIT que l'émission
   * échouerait : `create app` vient de constater que la base ne répond pas, et
   * `security:token` a besoin d'elle — la porte se câble, le jeton est nommé
   * comme geste suivant au lieu d'être tenté sur une base morte.
   */
  token: boolean;
  dryRun: boolean;
  json: boolean;
  cwd: string;
}

/**
 * Parse l'argv après le mot `ai:mcp`.
 *
 * @param argv - `process.argv` complet
 * @returns la demande, ou le motif du refus
 */
export function parseAiMcpArgv(
  argv: string[],
): IAiMcpRequest | { error: string } {
  const at = argv.indexOf("ai:mcp");
  const rest = at === -1 ? [] : argv.slice(at + 1);
  const req: IAiMcpRequest = {
    url: null,
    auth: null,
    agent: undefined,
    remove: false,
    global: false,
    token: true,
    dryRun: false,
    json: false,
    cwd: process.cwd(),
    help: false,
  };
  for (let i = 0; i < rest.length; i++) {
    const word = rest[i];
    if (word === "--help" || word === "-h") {
      // Une commande qui répond « argument inconnu : --help » apprend au
      // lecteur à ne plus croire le pied de l'aide, qui promet ce drapeau.
      req.help = true;
    } else if (word === "--auth" || word === "-a") {
      req.auth = true;
    } else if (word === "--no-auth") {
      // Le retrait est un geste qui se NOMME.
      req.auth = false;
    } else if (word === "--dry-run" || word === "-n") {
      req.dryRun = true;
    } else if (word === "--json" || word === "-j") {
      req.json = true;
    } else if (word === "--agent") {
      // Pas de forme courte : `-a` est déjà `--auth`, et deux options qui se
      // ressemblent sur une lettre finissent par se confondre le jour où l'une
      // écrit chez un tiers.
      req.agent = rest[++i] ?? "";
    } else if (word === "--no-token") {
      // Le débranchement se NOMME : on ne devine pas qu'une base est morte.
      req.token = false;
    } else if (word === "--global") {
      req.global = true;
    } else if (word === "--remove") {
      req.remove = true;
    } else if (word === "--url" || word === "-u") {
      req.url = rest[++i] ?? null;
    } else if (word === "--cwd") {
      req.cwd = path.resolve(rest[++i] ?? "");
    } else {
      return { error: `argument inconnu : ${word}` };
    }
  }
  return req;
}

/**
 * Déduit l'origine du serveur de développement.
 *
 * ⚠️ **Le port en clair est préféré au port TLS**, et ce n'est pas une
 * négligence : en développement le certificat est auto-signé, et un client MCP
 * qui le refuse ne dit pas pourquoi — il rend « serveur injoignable ». L'appel
 * est purement local ; `--url` reste là pour qui veut le TLS.
 *
 * @param cwd - racine du projet
 */
export function guessOrigin(cwd: string): string {
  const ports = defaultDevPorts(cwd);
  return `http://localhost:${ports[0] ?? 5151}`;
}

/**
 * Ce qu'on dit quand `security:token`, enchaîné, n'a pas rendu 0 — ou `null`
 * s'il a réussi.
 *
 * PURE : c'est la phrase que l'utilisateur lit à la place d'une stack trace.
 * L'enfant a déjà dit POURQUOI (base injoignable, service absent…) ; ici on
 * retient que le geste reste à faire, et lequel. Un `null` de statut est un
 * process tué par un signal : il n'a pas réussi non plus.
 *
 * @param status - code de sortie de `security:token`, `null` si tué.
 * @returns la note à afficher, ou `null` si le jeton est posé.
 */
export function chainedTokenNote(status: number | null): string | null {
  if (status === 0) return null;
  return (
    `jeton NON posé — security:token a rendu le code ${String(status)} ; ` +
    `à rejouer quand la cause est levée : nodefony security:token --write`
  );
}

/** Ce qu'il faut lancer pour obtenir le jeton, ou `null` s'il n'y a rien à faire. */
export interface IChainedToken {
  /** Arguments passés au binaire, après `node <bin>`. */
  argv: string[];
  /** Environnement du sous-process — hérité, `NODE_ENV` posé. */
  env: Record<string, string | undefined>;
  /** Répertoire de travail : la racine du PROJET, pas celui de l'appelant. */
  cwd: string;
}

/**
 * Décide s'il faut enchaîner sur `security:token`, et avec quoi.
 *
 * PURE — le `spawn` est de la plomberie, la DÉCISION est ce qui peut être faux.
 * Trois choses ne « suivent » pas toutes seules d'un process à l'autre, et
 * chacune a sa raison d'être ici :
 *
 *  - **l'environnement** : un sous-process ne reçoit que ce qu'on lui donne.
 *    `NODE_ENV=development` est POSÉ, parce que la porte MCP est servie par un
 *    module de développement — sans lui, l'émission échoue sur une audience que
 *    l'application ne sert pas, ce qui est exactement l'erreur qu'on veut
 *    éviter à l'utilisateur ;
 *  - **le répertoire** : le jeton s'écrit dans le `.env.local` du PROJET, pas
 *    dans celui d'où la commande a été tapée ;
 *  - **le terminal** : sans lui, l'enfant ne pourrait poser aucune question et
 *    échouerait en « aucun terminal pour le demander » — d'où le refus
 *    d'enchaîner hors TTY plutôt qu'un échec en cascade.
 *
 * @param demande - ce que la ligne de commande a demandé
 * @param contexte - racine du projet, présence d'un terminal, environnement
 * @returns le plan d'exécution, ou `null` si l'on n'enchaîne pas
 */
/**
 * Ce qu'on peut dire d'un jeton DÉJÀ posé, sans jamais le montrer.
 *
 * ⚠️ Le jeton part dans un en-tête STATIQUE que rien ne rafraîchit : quand il
 * expire, le symptôme est un `401` sur la porte MCP — un refus qui accuse la
 * configuration, l'audience ou le serveur, jamais l'échéance. Constater
 * l'échéance AVANT de proposer d'en émettre un nouveau transforme une enquête
 * en une ligne de texte.
 *
 * Lecture PURE de la charge utile (elle n'est pas chiffrée, seulement signée) :
 * on ne vérifie pas la signature ici — ce n'est pas une décision d'accès, c'est
 * un renseignement. La porte, elle, vérifie tout.
 */
export interface ITokenState {
  /** Secondes restantes ; négatif s'il est expiré, `null` si sans échéance. */
  remainingSeconds: number | null;
  /** Scopes que le jeton porte, tels qu'il les déclare. */
  scopes: string[];
  /**
   * Audience(s) déclarée(s) (`aud`, RFC 7519 §4.1.3), ou `null` s'il n'en
   * porte pas. Un jeton d'une autre porte n'est pas « valide » ici.
   */
  audience: string[] | null;
}

/**
 * Lit l'échéance et les scopes d'un JWT, sans le valider ni le divulguer.
 *
 * @param token - le jeton compact (`en-tête.charge.signature`).
 * @param nowSeconds - l'instant de référence, INJECTÉ pour que le banc
 *   n'ait pas à attendre le temps qui passe.
 * @returns l'état lisible, ou `null` si ce n'est pas un JWT exploitable.
 */
export function tokenState(
  token: string,
  nowSeconds: number,
): ITokenState | null {
  const parts = token.split(".");
  if (parts.length !== 3 || !parts[1]) return null;
  try {
    const charge = JSON.parse(
      Buffer.from(parts[1], "base64url").toString("utf8"),
    ) as { exp?: unknown; scope?: unknown; aud?: unknown };
    const scope = typeof charge.scope === "string" ? charge.scope : "";
    // `aud` est une chaîne ou un tableau ; absent, on ne conclut rien — c'est
    // la porte qui tranche, ceci n'est qu'un renseignement.
    const audience =
      typeof charge.aud === "string"
        ? [charge.aud]
        : Array.isArray(charge.aud)
          ? charge.aud.filter((a): a is string => typeof a === "string")
          : null;
    return {
      remainingSeconds:
        typeof charge.exp === "number" ? charge.exp - nowSeconds : null,
      scopes: scope.split(/\s+/u).filter((s) => s !== ""),
      audience,
    };
  } catch {
    // Un contenu illisible n'est pas une panne : c'est un jeton qu'on ne sait
    // pas décrire, et on se tait plutôt que d'affirmer quoi que ce soit.
    return null;
  }
}

/**
 * Phrase d'état d'un jeton, pour un humain devant une question.
 *
 * @param state - ce que {@link tokenState} a lu, ou `null` s'il n'y en a pas.
 * @returns la ligne à afficher.
 */
export function renderTokenState(
  state: ITokenState | null,
  expectedAudience?: string,
): string {
  if (state === null) return "aucun jeton lisible n'est posé chez tes agents";
  // 🔴 L'AUDIENCE avant l'échéance. Le jeton du foyer de l'utilisateur, émis
  // par une AUTRE application (autre port, donc autre porte), était annoncé
  // « valide encore 22 jours » : la porte d'ici le refuse (RFC 8707), et
  // l'écran disait l'inverse de la vérité.
  if (
    expectedAudience !== undefined &&
    state.audience !== null &&
    !state.audience.some((a) => sameAudience(a, expectedAudience))
  ) {
    return (
      `jeton émis pour une autre audience (${state.audience.join(", ")}) — ` +
      `la porte déclarée ici est ${expectedAudience} ; il y sera refusé`
    );
  }
  const scopes =
    state.scopes.length > 0 ? state.scopes.join(" ") : "aucun scope déclaré";
  if (state.remainingSeconds === null) return `jeton sans échéance (${scopes})`;
  if (state.remainingSeconds <= 0) {
    const since = Math.round(-state.remainingSeconds / 60);
    return `jeton EXPIRÉ depuis ${since} min (${scopes}) — c'est lui qui provoque les 401`;
  }
  const hours = state.remainingSeconds / 3600;
  const remainder =
    hours >= 48
      ? `${Math.round(hours / 24)} jours`
      : hours >= 2
        ? `${Math.round(hours)} heures`
        : `${Math.round(state.remainingSeconds / 60)} min`;
  return `jeton valide encore ${remainder} (${scopes})`;
}

/** Deux audiences sont les mêmes à une barre oblique finale près. */
function sameAudience(a: string, b: string): boolean {
  return trimTrailingSlashes(a) === trimTrailingSlashes(b);
}

/** Sans expression régulière : `/\/+$/` backtracke sur une suite de barres. */
function trimTrailingSlashes(s: string): string {
  let end = s.length;
  while (end > 0 && s.charCodeAt(end - 1) === 47) end -= 1;
  return s.slice(0, end);
}

/**
 * État du jeton posé chez CHAQUE agent détecté — l'échéance et la portée, pas
 * le secret.
 *
 * ⭐ Par agent, et non « le » jeton : rien ne garantit qu'ils portent le même.
 * Un agent servi il y a trois semaines a le sien, périmé, pendant qu'un autre
 * vient d'être rafraîchi — et c'est précisément l'écart qu'on ne voit jamais,
 * parce qu'il se manifeste par un `401` chez un seul outil.
 *
 * @param targets - agents détectés sur ce poste.
 * @param projectRoot - racine du projet, pour résoudre leurs fichiers.
 * @param nowSeconds - instant de référence, injecté pour le banc.
 * @returns pour chaque agent, sa phrase d'état.
 */
export function agentTokenStates(
  targets: readonly IAgentTarget[],
  projectRoot: string,
  nowSeconds: number,
  ctx: {
    /** Dossier de l'utilisateur, injecté pour le banc. */
    home?: string;
    /** Environnement (`CODEX_HOME`…), injecté pour le banc. */
    env?: Record<string, string | undefined>;
    /** Audience de la porte d'ICI : un jeton d'une autre porte n'est pas « valide ». */
    expectedAudience?: string;
  } = {},
): Map<string, string> {
  const states = new Map<string, string>();
  for (const target of targets) {
    // 🔴 Lire LÀ où `declareToAgents` ÉCRIT. Pour les agents à dossier maison
    // (Vibe, Codex), la déclaration dans le projet vit sous
    // `<projet>/<marqueur>` ; le foyer ne parle que s'il n'y a rien là. Lu en
    // premier, le foyer annonçait le jeton d'une autre application.
    const inProject = target.home
      ? path.join(projectRoot, target.marker, target.file)
      : null;
    const file =
      inProject !== null && existsSync(inProject)
        ? inProject
        : path.resolve(
            agentRoot(target, { projectRoot, home: ctx.home, env: ctx.env }),
            target.file,
          );
    let content = "";
    try {
      content = readFileSync(file, "utf8");
    } catch (e) {
      // ABSENT et ILLISIBLE ne se disent pas pareil, et le test préalable les
      // confondait : `existsSync` puis `readFileSync` laisse la fenêtre où le
      // fichier disparaît, et un refus de droits y prenait le visage d'un
      // agent sans jeton. Seul `ENOENT` vaut absence.
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") {
        // Un fichier illisible n'est pas une panne de cette commande : on se tait
        // sur cet agent plutôt que d'affirmer qu'il n'a pas de jeton.
        states.set(target.key, "état du jeton illisible");
        continue;
      }
    }
    const token = litVariable(target.forme, content, MCP_TOKEN_ENV);
    states.set(
      target.key,
      token === null
        ? "pas de jeton posé"
        : renderTokenState(tokenState(token, nowSeconds), ctx.expectedAudience),
    );
  }
  return states;
}

export function planTokenChaining(
  request: Pick<IAiMcpRequest, "auth" | "dryRun" | "json"> &
    Partial<Pick<IAiMcpRequest, "token">>,
  context: {
    projectRoot: string;
    isTTY: boolean;
    env?: Record<string, string | undefined>;
    /**
     * Durée de validité demandée, en minutes. Omise, l'émetteur applique son
     * défaut de configuration.
     *
     * ⭐ Elle existe ici parce que le jeton part dans un en-tête STATIQUE :
     * `.mcp.json` porte une valeur que personne ne rafraîchit. Le défaut de
     * l'émetteur (15 min) est taillé pour un client qui sait renouveler ; ici,
     * il condamne l'utilisateur à réémettre toutes les quinze minutes, en
     * lisant chaque fois un 401 qui accuse le jeton à tort.
     */
    ttlMinutes?: number;
    /**
     * Scopes demandés à l'émetteur. Omis, la commande d'émission applique son
     * défaut — la lecture seule.
     */
    scopes?: string;
  },
): IChainedToken | null {
  // Un jeton n'a de sens que si l'en-tête le RÉCLAME.
  if (request.auth !== true) return null;
  // Débranché par l'appelant, qui SAIT que l'émission échouerait.
  if (request.token === false) return null;
  // `--dry-run` ne doit rien produire ; `--json` part vers un script, qu'une
  // question romprait.
  if (request.dryRun || request.json) return null;
  if (!context.isTTY) return null;
  const argv = ["security:token", "--write"];
  if (context.ttlMinutes !== undefined) {
    argv.push("--ttl", String(context.ttlMinutes));
  }
  if (context.scopes !== undefined && context.scopes.trim() !== "") {
    argv.push("--scope", context.scopes);
  }
  return {
    argv,
    env: { ...(context.env ?? process.env), NODE_ENV: "development" },
    cwd: context.projectRoot,
  };
}

/** Ce qu'il est advenu de la déclaration chez un agent. */
export interface IDeclarationResult {
  /** L'agent visé. */
  target: IAgentTarget;
  /**
   * La déclaration a-t-elle été écrite DANS le projet ?
   *
   * Ne se déduit pas de `target.scope` — qui dit où l'agent lit ses VARIABLES,
   * pas où sa porte est déclarée. Pour Vibe et Codex, les deux diffèrent : le
   * jeton reste au foyer (un `.env` de projet se commite par accident), la
   * porte va dans le projet (son URL porte un port).
   */
  inProject?: boolean;
  /**
   * `declare`/`retire` : sa CLI a répondu OK, et le contrôle le CONFIRME quand
   * il est possible. `sans-effet` : elle a répondu OK, mais la porte est encore
   * là (ou toujours absente) — mesuré chez l'un d'eux, et invisible autrement.
   * `fichier-projet` : il lit déjà le `.mcp.json`, il n'y avait rien à lancer.
   * `fichier-agent` : il lit un fichier À LUI, dans SA grammaire — on vient de
   * l'écrire, et `command` porte son chemin. Distinct de `fichier-projet` parce
   * que le geste n'est pas le même : là on ne fait rien, ici on écrit.
   * `cli-absente` : l'outil n'est pas installé — la commande est rendue pour le
   * jour où il le sera. `echec` : sa CLI a refusé, et c'est ELLE qui dit pourquoi.
   */
  state:
    | "declare"
    | "retire"
    | "fichier-projet"
    | "fichier-agent"
    | "cli-absente"
    | "echec"
    | "sans-effet";
  /** La commande, telle qu'on peut la recopier. Vide pour `fichier-projet`. */
  command: string;
  /** Ce que la CLI a écrit quand elle a refusé. */
  detail?: string;
  /**
   * `true` quand une déclaration du même nom, visant une AUTRE porte, était
   * déjà là — donc qu'on vient de l'écraser.
   *
   * Le cas n'a rien de théorique : deux applications Nodefony sur le même poste
   * écoutent deux ports, et chez un agent de portée utilisateur elles se
   * disputent le même nom de serveur. Sans cette ligne, la seconde efface la
   * première en silence.
   */
  replacesOtherUrl?: boolean;
}

/**
 * Déclare (ou retire) la porte MCP chez chaque agent, **par SA propre CLI**.
 *
 * ⭐ La règle qui gouverne cette fonction : **on n'écrit pas le fichier de
 * configuration d'un outil tiers.** Son format lui appartient, il change avec
 * ses versions, et une écriture faite « à la main » se découvre le jour où
 * l'agent ne voit plus rien — sans rien dire. Sa CLI, elle, connaît son format
 * et le suit.
 *
 * La sortie des CLI est CAPTURÉE plutôt qu'héritée, et n'est montrée qu'en cas
 * d'échec : l'une d'elles écrit des avertissements d'interpréteur sur la sortie
 * d'erreur à chaque appel, et les laisser passer ferait lire un succès comme
 * une panne.
 *
 * @param targets - agents à servir
 * @param ctx - l'URL de la porte, et le sens du geste
 * @returns un verdict par agent — jamais une exception : un agent qui refuse
 *          n'empêche pas de servir les suivants
 */
/**
 * Écrit la porte dans le fichier PROPRE à un agent, dans SA grammaire.
 *
 * ⭐ **Pourquoi on écrit ce fichier-là, alors qu'on refuse d'écrire celui d'un
 * agent piloté par CLI.** La frontière du module est « l'agent possède le format
 * de sa déclaration » — et elle vaut tant que l'agent offre une commande pour
 * l'écrire. VS Code et Cursor n'en offrent aucune : leur configuration MCP de
 * projet est un fichier JSON documenté, versionné, que l'utilisateur édite à la
 * main. Ne rien faire l'obligerait à recopier une URL et une syntaxe de variable
 * qu'il n'a aucune raison de connaître — et c'est exactement ce que cette
 * commande existe pour éviter.
 *
 * Le document existant est PRÉSERVÉ, comme pour `.mcp.json` : un projet y déclare
 * ses autres serveurs, et une commande de câblage qui les emporterait serait une
 * commande qu'on n'ose plus lancer.
 *
 * @param target - l'agent visé
 * @param mcpFile - sa grammaire : où écrire, sous quelle racine, avec quelle
 *                  forme de variable
 * @param ctx - racine du projet, URL de la porte, sens du geste, mode d'autorisation
 * @returns le verdict — jamais d'exception : un agent qui refuse ne doit pas
 *          empêcher de servir les suivants
 */
function ecrireFichierAgent(
  target: IAgentTarget,
  mcpFile: IAgentMcpFile,
  ctx: {
    projectRoot: string;
    url: string;
    remove: boolean;
    auth?: boolean;
  },
): IDeclarationResult {
  // `path.join` sur un chemin écrit en `/` : il VOYAGE dans la table, on
  // l'OUVRE ici — axiome de portabilité.
  const cible = path.join(ctx.projectRoot, ...mcpFile.file.split("/"));
  const existant = readMcpConfig(cible);
  if (ctx.remove) {
    const serveurs = { ...serveursDe(existant, mcpFile.racine) };
    if (!existant || !(MCP_SERVER_KEY in serveurs)) {
      // Rien à retirer : le dire, plutôt qu'annoncer un retrait qui n'a rien
      // retiré — c'est le défaut mesuré chez un agent piloté par CLI.
      return { target, state: "sans-effet", command: mcpFile.file };
    }
    delete serveurs[MCP_SERVER_KEY];
    const document = { ...existant, [mcpFile.racine]: serveurs };
    try {
      writeFileSync(cible, `${JSON.stringify(document, null, 2)}\n`);
    } catch (error) {
      return {
        target,
        state: "echec",
        command: mcpFile.file,
        detail: (error as Error).message,
      };
    }
    return { target, state: "retire", command: mcpFile.file, inProject: true };
  }

  const plan = planMcpConfig(existant, ctx.url, {
    ...(ctx.auth === undefined ? {} : { auth: ctx.auth }),
    grammaire: mcpFile,
  });
  // Idempotence au sens FORT, comme `.mcp.json` : une porte déjà juste n'est pas
  // réécrite, l'horodatage ne bouge pas, et l'arbre reste propre — une commande
  // de synchronisation qui salit l'arbre est une commande qu'on hésite à lancer.
  if (plan.action !== "inchange") {
    try {
      mkdirSync(path.dirname(cible), { recursive: true });
      writeFileSync(cible, `${JSON.stringify(plan.document, null, 2)}\n`);
    } catch (error) {
      return {
        target,
        state: "echec",
        command: mcpFile.file,
        detail: (error as Error).message,
      };
    }
  }
  return {
    target,
    state: "fichier-agent",
    command: mcpFile.file,
    inProject: true,
  };
}

export async function declareToAgents(
  targets: readonly IAgentTarget[],
  ctx: {
    url: string;
    remove: boolean;
    projectRoot: string;
    /** Écrire dans le foyer de l'utilisateur au lieu du projet. */
    global?: boolean;
    /**
     * Mode d'autorisation retenu pour `.mcp.json`.
     *
     * Passé plutôt que recalculé : les fichiers d'agents doivent porter LA MÊME
     * décision que le fichier principal. Deux calculs auraient produit une porte
     * authentifiée chez l'un et anonyme chez l'autre, sans que rien ne le dise.
     */
    auth?: boolean;
  },
): Promise<IDeclarationResult[]> {
  const { spawnSync } = await import("node:child_process");
  // `mkdirSync` vient de l'import STATIQUE : `node:fs` est déjà chargé en tête
  // de ce fichier (`existsSync`, `writeFileSync`), un second import dynamique
  // n'économisait rien et masquait le nom du premier.
  const results: IDeclarationResult[] = [];
  for (const target of targets) {
    const plan = planAgentDeclaration(
      target,
      { url: ctx.url, tokenEnv: MCP_TOKEN_ENV },
      ctx.remove,
    );
    if (plan.channel === "fichier-agent") {
      results.push(
        ecrireFichierAgent(target, plan.mcpFile, {
          projectRoot: ctx.projectRoot,
          url: ctx.url,
          remove: ctx.remove,
          auth: ctx.auth,
        }),
      );
      continue;
    }
    if (plan.channel !== "cli") {
      results.push({ target: target, state: "fichier-projet", command: "" });
      continue;
    }
    const command = renderPlanShell(plan);
    // 🔴 L'URL de la porte porte un PORT, et deux applications Nodefony n'ont
    // pas le même. Une déclaration dans le foyer de l'utilisateur ne peut donc
    // en désigner qu'UNE — la dernière câblée efface la précédente sans un mot.
    // Ces CLI n'ont pas d'option de portée, mais elles obéissent toutes deux à
    // une variable qui déplace leur dossier (`VIBE_HOME`, `CODEX_HOME`) : on la
    // pointe sur `<projet>/<marker>`, et c'est LEUR binaire qui écrit LEUR
    // format, à l'endroit du projet. Écrire ce TOML nous-mêmes aurait été
    // reprendre à notre compte le format d'un tiers.
    // Vérifié au disque pour les deux, y compris la ligne d'authentification.
    const projectRoot = target.home
      ? path.join(ctx.projectRoot, target.marker)
      : undefined;
    const inProject = projectRoot !== undefined && !ctx.global;
    if (inProject && projectRoot) {
      // Codex REFUSE de démarrer si le dossier n'existe pas encore — constaté :
      // « CODEX_HOME points to "…", but that path does not exist ».
      //
      // 🔴 Et ce `mkdir` ne LÈVE pas : cette fonction promet un verdict par
      // agent, jamais une exception — un agent qui refuse ne doit pas empêcher
      // de servir les suivants. Une racine incréable n'est pas un cas à
      // traiter ici : si la CLI est absente, le `spawn` rendra `ENOENT` et le
      // dira ; si elle est là, c'est ELLE qui dira pourquoi elle n'a pas pu
      // écrire. La capacité se CONSTATE, elle ne se pré-vérifie pas.
      try {
        mkdirSync(projectRoot, { recursive: true });
      } catch {
        /* laissé au constat du spawn — voir ci-dessus */
      }
    }
    // Les TROIS appels le partagent : lu ailleurs qu'écrit, le constat
    // d'après-coup parlerait du foyer de l'utilisateur et vaudrait faux dans
    // les deux sens.
    const envAgent =
      inProject && projectRoot && target.home
        ? { ...process.env, [target.home]: projectRoot }
        : process.env;
    // Ce qui était déclaré AVANT — on ne peut le savoir qu'en regardant, et
    // seulement après coup ce serait trop tard : la CLI aura déjà écrasé.
    const argvListBefore = target.argvList?.();
    let replacesOtherUrl = false;
    if (argvListBefore && !ctx.remove) {
      const before = spawnSync(plan.bin, argvListBefore, {
        encoding: "utf8",
        shell: false,
        cwd: ctx.projectRoot,
        env: envAgent,
      });
      const vu = `${before.stdout ?? ""}${before.stderr ?? ""}`;
      replacesOtherUrl =
        !before.error &&
        before.status === 0 &&
        vu.includes(MCP_SERVER_KEY) &&
        !vu.includes(ctx.url);
    }
    const r = spawnSync(plan.bin, plan.argv, {
      encoding: "utf8",
      // `shell: false` (défaut) est ESSENTIEL : c'est ce qui fait arriver
      // `${NF_MCP_TOKEN}` littéral chez l'agent. Un shell le développerait, et
      // le jeton serait GRAVÉ dans un fichier de projet.
      shell: false,
      // 🔴 La racine du PROJET, jamais le dossier d'où l'on a tapé. Un agent en
      // portée projet écrit relativement à SON répertoire courant : lancée
      // depuis un sous-dossier, la commande créait un second `.gemini/` là où
      // personne ne le cherchera — et l'agent, à la racine, ne voyait rien.
      // Constaté au disque, jamais signalé par le code de sortie.
      cwd: ctx.projectRoot,
      env: envAgent,
    });
    // La CAPACITÉ se constate : on ne demande pas au `PATH` si l'outil existe,
    // on l'appelle. `ENOENT` est la réponse, et elle est sans ambiguïté.
    if (r.error && (r.error as NodeJS.ErrnoException).code === "ENOENT") {
      results.push({ target: target, state: "cli-absente", command: command });
      continue;
    }
    if (r.status !== 0) {
      results.push({
        target: target,
        state: "echec",
        command: command,
        // Borné : l'une de ces CLI crache une vingtaine de lignes de bruit
        // avant son vrai message.
        detail: `${r.stderr ?? ""}${r.stdout ?? ""}`
          .trim()
          .split("\n")
          .slice(-6)
          .join("\n"),
      });
      continue;
    }
    // 🔴 On ne se fie PAS au code de sortie : on regarde. Mesuré — une de ces
    // CLI sort en 0 en disant « not found » et laisse l'entrée en place. Le
    // constat se fait par SA propre commande de lecture, jamais en relisant son
    // fichier : son format lui appartient.
    const argvList = target.argvList?.();
    if (argvList) {
      const vue = spawnSync(plan.bin, argvList, {
        encoding: "utf8",
        shell: false,
        // Même racine que le geste : lue ailleurs, la liste parlerait d'un
        // autre projet et le constat serait faux dans les deux sens.
        cwd: ctx.projectRoot,
        env: envAgent,
      });
      const output = `${vue.stdout ?? ""}${vue.stderr ?? ""}`;
      // La lecture n'a pas pu se faire : on ne conclut RIEN de son silence —
      // une absence de trace n'est pas une preuve.
      const lisible = !vue.error && vue.status === 0;
      const present = output.includes(MCP_SERVER_KEY);
      if (lisible && present === ctx.remove) {
        results.push({
          target: target,
          state: "sans-effet",
          command: command,
          detail: output.trim().split("\n").slice(-4).join("\n"),
        });
        continue;
      }
    }
    results.push({
      target: target,
      inProject: inProject,
      state: ctx.remove ? "retire" : "declare",
      command: command,
      ...(replacesOtherUrl ? { replacesOtherUrl: true } : {}),
    });
  }
  return results;
}

/**
 * Les agents dont le compte rendu doit PARLER, quand `--agent` a été donné.
 *
 * PURE. `--agent none` veut dire « aucune CLI à lancer », pas « personne » :
 * l'agent servi par le fichier de projet (Claude Code lit le `.mcp.json` qu'on
 * vient d'écrire) est ajouté aux agents demandés — sinon l'écran disait
 * « tu codes seul » à qui venait précisément de le choisir. Sans doublon, et
 * les demandés d'abord : ce sont eux qu'une CLI va servir.
 *
 * @param requested - agents nommés par `--agent` (vide pour `none`).
 * @param detected - agents présents sur ce poste.
 * @returns les agents à passer au compte rendu.
 */
export function targetsToDeclare(
  requested: readonly IAgentTarget[],
  detected: readonly IAgentTarget[],
): IAgentTarget[] {
  const out = [...requested];
  for (const c of detected) {
    // 🔴 SEUL `fichier-projet` entre sans avoir été demandé, et la raison est
    // qu'il n'écrit RIEN : il est déjà servi, on ne fait que le NOMMER pour
    // qu'une liste où l'agent principal manque ne se lise pas « non géré ».
    //
    // `fichier-agent`, lui, ÉCRIT. L'ajouter ici sur la seule foi d'un `.vscode/`
    // présent — le dossier le plus banal qui soit — poserait un fichier chez un
    // outil que personne n'a nommé. Écrire dans la configuration d'un tiers est
    // un geste VOULU : il passe par `--agent`, ou par la case à cocher.
    if (c.declaration !== "fichier-projet") continue;
    if (out.some((r) => r.key === c.key)) continue;
    out.push(c);
  }
  return out;
}

/**
 * Rend le compte rendu des déclarations.
 *
 * PURE : c'est le texte que l'utilisateur lit, et il doit pouvoir être éprouvé
 * sans lancer la moindre CLI.
 *
 * @param results - un verdict par agent
 * @param remove - le sens du geste, pour accorder les phrases
 */
export function renderDeclarations(
  results: readonly IDeclarationResult[],
  remove: boolean,
): string {
  if (results.length === 0) {
    // 🔴 Le silence serait ambigu : « rien ne s'est passé » ou « ça a échoué » ?
    // Coder seul est un CHOIX, et il s'affiche comme tel.
    return (
      `\n  Aucun agent : tu codes seul, c'est un choix.\n` +
      `  Quand tu voudras : nodefony ai:mcp --agent all\n`
    );
  }
  let out = "\n";
  for (const r of results) {
    if (r.state === "fichier-projet") {
      // NOMMÉ, pas seulement « rien à faire » : dans une liste où l'agent
      // principal manque, on lit « non géré ».
      out +=
        `  • ${r.target.name} — servi par le ${MCP_CONFIG_FILE} de ce projet, ` +
        `${remove ? "retiré par --no-auth ou à la main" : "déjà à jour"} (rien à lancer).\n`;
    } else if (r.state === "fichier-agent") {
      // Le fichier est NOMMÉ : c'est celui que l'utilisateur ouvrira si la porte
      // ne répond pas, et il n'a aucune raison de deviner que VS Code lit
      // `.vscode/mcp.json` quand tout le reste du projet parle de `.mcp.json`.
      out +=
        `  • ${r.target.name} — ${remove ? "retiré de" : "écrit dans"} ` +
        `${r.command} (son propre format, dans ce projet).\n`;
      if (!remove && r.target.noteAfter) {
        out += `      ⚠️ ${r.target.noteAfter}\n`;
      }
    } else if (r.state === "declare") {
      // 🔴 La PORTÉE se dit. Deux de ces agents n'ont pas de notion de projet :
      // ⚠️ La portée se lit sur le GESTE, jamais sur `target.scope` — celui-ci
      // dit où l'agent tient ses VARIABLES, pas où sa porte est déclarée, et
      // les deux diffèrent pour Vibe et Codex. Une déclaration qui vaut pour
      // TOUS les projets et qu'on croit locale, c'est la deuxième application
      // Nodefony qui écrase la première sans un mot.
      //
      // ⚠️ Un état antérieur de ce commentaire affirmait qu'un
      // `.codex/config.toml` posé dans un projet « n'est PAS lu ». C'est FAUX,
      // et mesuré : le fichier déposé, `codex mcp list` montre le serveur. La
      // confiance du dépôt était la variable, pas la portée.
      const scope =
        r.inProject || r.target.scope === "projet"
          ? "dans ce projet"
          : "GLOBALE — elle vaut pour tous tes projets";
      out += `  ✓ ${r.target.name} — porte déclarée, ${scope}. RELANCE-le.\n`;
      if (r.state === "declare" && r.replacesOtherUrl) {
        out +=
          `    ⚠ elle a REMPLACÉ une déclaration « ${MCP_SERVER_KEY} » qui ` +
          `visait ailleurs — une autre application ?\n`;
      }
      if (r.target.noteAfter) out += `    ⓘ ${r.target.noteAfter}\n`;
    } else if (r.state === "retire") {
      out += `  ✓ ${r.target.name} — déclaration retirée.\n`;
    } else if (r.state === "sans-effet") {
      out +=
        `  ⚠ ${r.target.name} — sa CLI a répondu « ok », mais la porte est ` +
        `${remove ? "TOUJOURS déclarée" : "INTROUVABLE"} chez lui.\n` +
        `    Ce qu'elle liste :\n` +
        `${(r.detail ?? "")
          .split("\n")
          .map((l) => `      ${l}`)
          .join("\n")}\n` +
        `    La commande jouée : ${r.command}\n` +
        `    Son outil ne l'a pas honorée — reprends depuis SA configuration.\n`;
    } else if (r.state === "cli-absente") {
      out +=
        `  ⚠ ${r.target.name} — sa commande « ${r.target.bin} » est introuvable ici.\n` +
        `    Le jour où tu l'installes :\n      ${r.command}\n`;
    } else {
      out +=
        `  ⚠ ${r.target.name} — sa CLI a refusé :\n` +
        `${(r.detail ?? "")
          .split("\n")
          .map((l) => `      ${l}`)
          .join("\n")}\n` +
        `    La commande jouée était :\n      ${r.command}\n`;
    }
  }
  return out;
}

/** Lit le `.mcp.json` du projet, ou `null` s'il est absent ou illisible. */
export function readMcpConfig(file: string): IMcpConfigDocument | null {
  if (!existsSync(file)) return null;
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8")) as IMcpConfigDocument;
    return typeof parsed === "object" && parsed !== null ? parsed : null;
  } catch {
    // Un fichier corrompu ne se réécrit pas en silence : on le DIT à
    // l'appelant, qui décidera. (Ici : on repart d'un document vide, et le
    // rendu annonce « pose » — l'utilisateur voit qu'il perd son contenu.)
    return null;
  }
}

/**
 * Point d'entrée de la commande.
 *
 * @param argv - `process.argv` complet
 * @returns code de sortie sémantique (`OK`, `USAGE`, `NOINPUT` hors projet,
 *          `CANTCREAT` si l'écriture échoue)
 */
export async function runAiMcpCommand(argv: string[]): Promise<number> {
  const parsed = parseAiMcpArgv(argv);
  if ("error" in parsed) {
    return printUsageError(PAGE, parsed.error);
  }
  if (parsed.help) {
    return printUsage(PAGE);
  }

  const projectRoot = findProjectRoot(parsed.cwd);
  if (projectRoot === null) {
    process.stderr.write(
      `ai:mcp: aucun projet Nodefony ici (pas de nodefony.config.ts en remontant depuis ${parsed.cwd}).\n`,
    );
    return SysExit.NOINPUT;
  }

  // 🔴 Aucune option, et un terminal en face : on DEMANDE plutôt que d'agir.
  //
  // Le mode d'autorisation n'est pas anodin dans les deux sens — sans `--auth`,
  // l'entrée existante PERD son en-tête et la porte redevient anonyme. Quelqu'un
  // qui lance la commande depuis un menu, ou pour rafraîchir son URL, n'a pas
  // demandé ça. La question vit ICI, dans le chemin standalone, parce que c'est
  // lui qui répond à une invocation directe comme à un choix de menu.
  const nothingRequested =
    parsed.auth === null &&
    !parsed.dryRun &&
    !parsed.json &&
    parsed.url === null;
  if (nothingRequested && process.stdin.isTTY) {
    const alreadyAuth = Boolean(
      readMcpConfig(path.join(projectRoot, MCP_CONFIG_FILE))?.mcpServers?.[
        "nodefony"
      ]?.headers?.Authorization,
    );
    const { confirm } = await chargePrompts();
    parsed.auth = await confirm({
      message: `Mode authentifié ? (en-tête \${${MCP_TOKEN_ENV}}${alreadyAuth ? " — répondre non le RETIRE" : ""})`,
      default: alreadyAuth,
    });
  }

  const origin = parsed.url ?? guessOrigin(projectRoot);
  // 🔴 UNE seule URL, calculée UNE fois. Elle était recomposée à trois endroits,
  // et l'un d'eux avait gardé l'ORIGINE nue : `--dry-run` annonçait donc une
  // commande différente de celle qu'il aurait jouée — le pire défaut possible
  // pour l'option dont le seul rôle est de montrer ce qui va se passer.
  const mcpUrl = buildMcpUrl(origin, MCP_PATH);
  const file = path.join(projectRoot, MCP_CONFIG_FILE);
  const plan = planMcpConfig(
    readMcpConfig(file),
    mcpUrl,
    // `null` = aucune décision : le plan conserve alors ce que le fichier porte.
    parsed.auth === null ? {} : { auth: parsed.auth },
  );

  if (!parsed.dryRun && plan.action !== "inchange") {
    try {
      writeFileSync(file, `${JSON.stringify(plan.document, null, 2)}\n`);
    } catch (error) {
      process.stderr.write(
        `ai:mcp: écriture impossible (${(error as Error).message}).\n`,
      );
      return SysExit.CANTCREAT;
    }
  }

  // Qui déclare-t-on chez lui ? La réponse se décide AVANT le rendu JSON, pour
  // qu'un script obtienne le même verdict qu'un humain.
  const requests = requestedAgents(parsed.agent);
  if (requests instanceof Error) {
    process.stderr.write(`ai:mcp: ${requests.message}\n`);
    return SysExit.USAGE;
  }
  let targets: readonly IAgentTarget[] = requests ?? [];
  if (requests === undefined && !parsed.dryRun && !parsed.json) {
    // 🔴 Rien n'est coché par défaut, et ce n'est pas de la timidité : écrire
    // dans la configuration d'un autre outil est un geste qui doit être VOULU.
    // Un développeur peut parfaitement coder seul — ce n'est pas un oubli à
    // rattraper, c'est un choix qu'on lui laisse, et la question le dit.
    const detected = agentsPresents({
      projectRoot,
      exists: existsSync,
    });
    // Cochables = ceux qui ont un GESTE à faire : lancer leur CLI, ou recevoir
    // le fichier qu'ils lisent. Les seconds étaient absents de cette liste, donc
    // impossibles à choisir en dialogue — la case à cocher est le seul chemin
    // quand on ne connaît pas le nom de la clé `--agent`.
    const presents = detected.filter((c) => c.declaration !== "fichier-projet");
    // ⚠️ Un agent DÉTECTÉ mais absent de la liste doit être EXPLIQUÉ. Ceux qui
    // lisent le fichier de projet — Claude Code lit le `.mcp.json` qu'on vient
    // d'écrire — n'ont aucune commande à lancer : leur proposer une case à
    // cocher n'aurait aucun sens, et `claude mcp add` poserait même une SECONDE
    // déclaration dans le dossier de l'utilisateur, invisible du dépôt et
    // jamais rafraîchie. Mais les taire fait chercher, puis conclure qu'ils ne
    // sont pas gérés — vécu.
    const byFile = detected.filter((c) => c.declaration === "fichier-projet");
    if (detected.length > 0 && process.stdin.isTTY) {
      const { checkbox } = await chargePrompts();
      const chosen = (await checkbox({
        message: `Déclarer la porte chez quels agents ? ${"(espace pour cocher — ENTRÉE sans rien cocher : aucun, je code seul)"}`,
        choices: [
          // ⚠️ Les agents servis par le FICHIER de projet figurent dans la
          // liste, cochés et non décochables. Les taire était un contresens
          // d'ergonomie : une liste où l'agent principal MANQUE se lit
          // « non géré », alors qu'il est déjà servi — c'est même le seul qui
          // n'ait rien à attendre de cette question. Un choix inerte qui
          // s'EXPLIQUE vaut mieux qu'une absence qui s'interprète.
          ...byFile.map((c) => ({
            name: `${c.name} — servi par le ${path.basename(file)} de ce projet`,
            value: c.key,
            checked: true,
            disabled: "déjà à jour, rien à lancer",
          })),
          ...presents.map((c) => ({
            // Le libellé dit le GESTE réel. Écrit sur le seul `c.bin`, il
            // rendait « undefined mcp add » pour un agent sans CLI — une ligne
            // qui fait douter de tout le reste de la liste.
            name:
              c.declaration === "fichier-agent"
                ? `${c.name} — ${parsed.remove ? "retirer de" : "écrire"} ${c.mcpFile?.file}`
                : `${c.name} — ${c.bin} mcp ${parsed.remove ? "remove" : "add"}`,
            value: c.key,
            checked: false,
          })),
        ],
      })) as string[];
      // Un choix désactivé n'est jamais rendu par la question : le filtre porte
      // donc bien sur les seuls agents qui ont une CLI à lancer.
      targets = presents.filter((c) => chosen.includes(c.key));
    }
  }

  if (parsed.json) {
    process.stdout.write(
      `${JSON.stringify(
        {
          file,
          ...plan,
          dryRun: parsed.dryRun,
          agents: targets.map((c) => c.key),
        },
        null,
        2,
      )}\n`,
    );
    return SysExit.OK;
  }
  process.stdout.write(renderMcpPlan(plan, file, parsed.dryRun));

  // La porte chez chaque agent, par SA CLI. `--dry-run` ne lance rien : il
  // MONTRE, et une commande qui écrirait quand même dans la configuration d'un
  // outil tiers ferait mentir l'option qui sert précisément à ne rien risquer.
  if (parsed.dryRun) {
    if (targets.length > 0) {
      process.stdout.write(
        `\n  À lancer (non joué — --dry-run) :\n` +
          targets
            .map((c) => {
              const p = planAgentDeclaration(
                c,
                { url: mcpUrl, tokenEnv: MCP_TOKEN_ENV },
                parsed.remove,
              );
              if (p.channel === "cli") return `      ${renderPlanShell(p)}\n`;
              // Nommer SON fichier : annoncer `.mcp.json` à qui ne l'ouvre
              // jamais est le défaut que ce canal existe pour fermer.
              if (p.channel === "fichier-agent") {
                return `      (${c.name} : écriture de ${p.file})\n`;
              }
              return `      (${c.name} : rien — il lit ${MCP_CONFIG_FILE})\n`;
            })
            .join(""),
      );
    }
  } else if (requests !== undefined || targets.length > 0) {
    // Le compte rendu n'est écrit que si la question a été posée ou si des
    // agents ont été demandés : une invocation qui ne parlait pas d'agents ne
    // doit pas se mettre à en parler.
    //
    // 🔴 `--agent none` = « aucune CLI à lancer », pas « personne » : l'agent
    // servi par le fichier de projet entre dans le compte rendu.
    const declared =
      requests !== undefined
        ? targetsToDeclare(
            targets,
            agentsPresents({ projectRoot, exists: existsSync }),
          )
        : targets;
    process.stdout.write(
      renderDeclarations(
        await declareToAgents(declared, {
          url: mcpUrl,
          remove: parsed.remove,
          projectRoot,
          global: parsed.global,
          // LA décision du fichier principal, pas une seconde : une porte
          // authentifiée chez l'un et anonyme chez l'autre ne se verrait pas.
          ...(plan.auth === undefined ? {} : { auth: plan.auth }),
        }),
        parsed.remove,
      ),
    );
    // Le fichier d'instructions que cet agent lit d'office — posé ICI, au
    // moment où il entre dans le projet, et non à la création de l'application
    // « au cas où ». `create app` ne dépose que les pointeurs des agents
    // choisis ; celui-ci referme le seul trou que ce filtrage ouvrait.
    // Jamais lors d'un retrait : on ne pose pas un fichier en débranchant.
    if (!parsed.remove) {
      const poses = writeAgentPointers(
        projectRoot,
        targets.map((c) => c.key),
        path.basename(projectRoot),
      );
      if (poses.length > 0) {
        process.stdout.write(
          `\n  instructions : ${poses.join(", ")} — pointeur(s) vers AGENTS.md\n`,
        );
      }
    }
  }

  // Le geste SUIVANT, proposé plutôt que décrit.
  //
  // Câbler l'en-tête ne sert à rien tant que `NF_MCP_TOKEN` est vide, et la
  // commande qui émet ce jeton vit dans `@nodefony/security` — le cœur ne sait
  // pas signer. Il ne la réimplémente donc pas : il l'APPELLE, exactement comme
  // le menu appelle une commande de module. `NODE_ENV=development` est posé
  // parce que la porte MCP est servie par un module de développement : sans
  // lui, l'émission échoue sur une audience que l'application ne sert pas.
  const chainage = planTokenChaining(parsed, {
    projectRoot,
    isTTY: Boolean(process.stdin.isTTY),
  });
  if (chainage) {
    const { confirm, select } = await chargePrompts();
    // ⭐ CONSTATER avant de proposer. Le jeton part dans un en-tête statique
    // que rien ne rafraîchit : expiré, il produit un `401` qui accuse la
    // configuration, l'audience ou le serveur — jamais l'échéance. Une ligne
    // ici remplace une enquête. Et le défaut de la question suit le constat :
    // on ne pousse pas à réémettre un jeton qui a encore une semaine devant
    // lui, mais on le propose franchement s'il est mort.
    const detectedForToken = agentsPresents({
      projectRoot,
      exists: existsSync,
    });
    const states = agentTokenStates(
      detectedForToken,
      projectRoot,
      Math.floor(Date.now() / 1000),
      { expectedAudience: mcpUrl },
    );
    for (const target of detectedForToken) {
      process.stdout.write(`  ${target.name} : ${states.get(target.key)}\n`);
    }
    // « Périmé » vaut pour l'ENSEMBLE : si un seul agent porte un jeton mort,
    // proposer par défaut de réémettre est le bon service — c'est lui qui
    // rendra des 401 sans qu'on sache lequel.
    const perime =
      detectedForToken.length === 0 ||
      [...states.values()].some(
        (phrase) =>
          phrase.includes("EXPIRÉ") ||
          phrase.includes("pas de jeton") ||
          phrase.includes("autre audience"),
      );
    const now = await confirm({
      message: `${perime ? "Obtenir" : "Réémettre"} un jeton maintenant (${MCP_TOKEN_ENV}) ?`,
      default: perime,
    });
    const bin = process.argv[1];
    if (now && bin) {
      // ⭐ La DURÉE se demande, elle ne se subit pas. Le jeton part dans un
      // en-tête statique que rien ne rafraîchit : le défaut de l'émetteur
      // (15 min) oblige à tout recommencer au quart d'heure, et le refus qui
      // s'ensuit accuse le jeton alors qu'il a simplement vécu. Un choix fermé
      // plutôt qu'une saisie libre — on ne se trompe pas d'unité.
      const ttlMinutes = await select({
        message: "Durée de validité du jeton",
        default: 7 * 24 * 60,
        choices: [
          {
            name: "7 jours (recommandé pour un agent local)",
            value: 7 * 24 * 60,
          },
          { name: "30 jours (maximum)", value: 30 * 24 * 60 },
          { name: "12 heures", value: 12 * 60 },
          { name: "15 minutes (le défaut de la configuration)", value: 15 },
        ],
      });
      // ⭐ Le RÔLE du jeton se choisit, il ne se subit pas. Le défaut de la
      // commande d'émission est la lecture SEULE — le plus étroit se durcit
      // tout seul dans le bon sens — mais qui veut muter par la porte MCP
      // devait jusqu'ici connaître `--scope` et l'écrire à la main.
      const scopes = await select({
        message: "Ce que le jeton autorise",
        default: ADMIN_SCOPE_READ,
        choices: [
          {
            name: `Lecture seule (${ADMIN_SCOPE_READ}) — recommandé`,
            value: ADMIN_SCOPE_READ,
          },
          {
            name: `Lecture et mutations (${ADMIN_SCOPE_READ} ${ADMIN_SCOPE_WRITE})`,
            value: `${ADMIN_SCOPE_READ} ${ADMIN_SCOPE_WRITE}`,
          },
        ],
      });
      const withDuration = planTokenChaining(parsed, {
        projectRoot,
        isTTY: true,
        ttlMinutes,
        scopes,
      });
      const { spawnSync } = await import("node:child_process");
      // `stdio: "inherit"` — l'enfant hérite du TERMINAL, sans quoi il ne
      // pourrait poser aucune question (son `process.stdin.isTTY` serait faux).
      const r = spawnSync(
        process.execPath,
        [bin, ...(withDuration ?? chainage).argv],
        {
          stdio: "inherit",
          cwd: chainage.cwd,
          env: chainage.env,
        },
      );
      // 🔴 Le verdict de l'enfant se LIT. Ignoré, `security:token` mourait sur
      // une base injoignable en trois stacks, et cette commande rendait OK —
      // l'appelant (`create app`) concluait « jeton posé ».
      const note = chainedTokenNote(r.status);
      if (note !== null) {
        process.stdout.write(`\n  ⚠ ${note}\n`);
        return SysExit.UNAVAILABLE;
      }
    }
  }
  return SysExit.OK;
}
