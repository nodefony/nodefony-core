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
  `Usage : nodefony ai:mcp [--auth] [--url <origine>] [--dry-run] [--json] [--cwd <path>]\n` +
  `  Déclare le serveur MCP de cette application dans ${MCP_CONFIG_FILE}.\n` +
  `  --auth : mode authentifié — l'en-tête porte \${${MCP_TOKEN_ENV}} (jamais le jeton lui-même).\n`;

/** Ce que la ligne de commande demande. */
interface IAiMcpRequest {
  /** Origine forcée (`https://localhost:5152`), ou `null` pour la déduire. */
  url: string | null;
  /** Mode authentifié : pose l'en-tête `Authorization` sur l'entrée. */
  auth: boolean;
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
    auth: false,
    dryRun: false,
    json: false,
    cwd: process.cwd(),
  };
  for (let i = 0; i < rest.length; i++) {
    const word = rest[i];
    if (word === "--auth" || word === "-a") {
      req.auth = true;
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
export function runAiMcpCommand(argv: string[]): number {
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

  const origin = parsed.url ?? guessOrigin(projectRoot);
  const file = path.join(projectRoot, MCP_CONFIG_FILE);
  const plan = planMcpConfig(
    readMcpConfig(file),
    buildMcpUrl(origin, MCP_PATH),
    {
      auth: parsed.auth,
    },
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
  return SysExit.OK;
}
