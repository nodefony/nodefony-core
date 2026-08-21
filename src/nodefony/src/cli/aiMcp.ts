import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { SysExit } from "./sysexits";
import { findProjectRoot } from "./projectRoot";
import { defaultDevPorts } from "../service/dev/devProcess";
import {
  buildMcpUrl,
  planMcpConfig,
  renderMcpPlan,
  MCP_CONFIG_FILE,
  MCP_TOKEN_ENV,
  type IMcpConfigDocument,
} from "./aiMcpReport";

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

const USAGE =
  `Usage : nodefony ai:mcp [--auth|--no-auth] [--url <origine>] [--dry-run] [--json] [--cwd <path>]\n` +
  `  Déclare le serveur MCP de cette application dans ${MCP_CONFIG_FILE}.\n` +
  `  --auth : mode authentifié — l'en-tête porte \${${MCP_TOKEN_ENV}} (jamais le jeton lui-même).\n` +
  `           sans option, le mode déjà en place est CONSERVÉ ; --no-auth le retire.\n` +
  `         le jeton s'obtient par : nodefony security:token --write\n`;

/** Ce que la ligne de commande demande. */
interface IAiMcpRequest {
  /** Origine forcée (`https://localhost:5152`), ou `null` pour la déduire. */
  url: string | null;
  /**
   * Mode authentifié. `null` = ne rien décider — on conserve ce que le fichier
   * porte déjà, pour qu'un rafraîchissement d'URL ne désarme pas la porte.
   */
  auth: boolean | null;
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
    dryRun: false,
    json: false,
    cwd: process.cwd(),
  };
  for (let i = 0; i < rest.length; i++) {
    const word = rest[i];
    if (word === "--auth" || word === "-a") {
      req.auth = true;
    } else if (word === "--no-auth") {
      // Le retrait est un geste qui se NOMME.
      req.auth = false;
    } else if (word === "--dry-run" || word === "-n") {
      req.dryRun = true;
    } else if (word === "--json" || word === "-j") {
      req.json = true;
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
export function planTokenChaining(
  demande: Pick<IAiMcpRequest, "auth" | "dryRun" | "json">,
  contexte: {
    projectRoot: string;
    isTTY: boolean;
    env?: Record<string, string | undefined>;
  },
): IChainedToken | null {
  // Un jeton n'a de sens que si l'en-tête le RÉCLAME.
  if (demande.auth !== true) return null;
  // `--dry-run` ne doit rien produire ; `--json` part vers un script, qu'une
  // question romprait.
  if (demande.dryRun || demande.json) return null;
  if (!contexte.isTTY) return null;
  return {
    argv: ["security:token", "--write"],
    env: { ...(contexte.env ?? process.env), NODE_ENV: "development" },
    cwd: contexte.projectRoot,
  };
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
    process.stderr.write(`ai:mcp: ${parsed.error}\n${USAGE}`);
    return SysExit.USAGE;
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
  const rienDemande =
    parsed.auth === null &&
    !parsed.dryRun &&
    !parsed.json &&
    parsed.url === null;
  if (rienDemande && process.stdin.isTTY) {
    const dejaAuth = Boolean(
      readMcpConfig(path.join(projectRoot, MCP_CONFIG_FILE))?.mcpServers?.[
        "nodefony"
      ]?.headers?.Authorization,
    );
    const { confirm } = await import("@inquirer/prompts");
    parsed.auth = await confirm({
      message: `Mode authentifié ? (en-tête \${${MCP_TOKEN_ENV}}${dejaAuth ? " — répondre non le RETIRE" : ""})`,
      default: dejaAuth,
    });
  }

  const origin = parsed.url ?? guessOrigin(projectRoot);
  const file = path.join(projectRoot, MCP_CONFIG_FILE);
  const plan = planMcpConfig(
    readMcpConfig(file),
    buildMcpUrl(origin, MCP_PATH),
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

  if (parsed.json) {
    process.stdout.write(
      `${JSON.stringify({ file, ...plan, dryRun: parsed.dryRun }, null, 2)}\n`,
    );
    return SysExit.OK;
  }
  process.stdout.write(renderMcpPlan(plan, file, parsed.dryRun));

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
    const { confirm } = await import("@inquirer/prompts");
    const maintenant = await confirm({
      message: `Obtenir un jeton maintenant (${MCP_TOKEN_ENV} dans .env.local) ?`,
      default: true,
    });
    const bin = process.argv[1];
    if (maintenant && bin) {
      const { spawnSync } = await import("node:child_process");
      // `stdio: "inherit"` — l'enfant hérite du TERMINAL, sans quoi il ne
      // pourrait poser aucune question (son `process.stdin.isTTY` serait faux).
      spawnSync(process.execPath, [bin, ...chainage.argv], {
        stdio: "inherit",
        cwd: chainage.cwd,
        env: chainage.env,
      });
    }
  }
  return SysExit.OK;
}
