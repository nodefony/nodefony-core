import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
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
  MCP_CONFIG_FILE,
  MCP_SERVER_KEY,
  MCP_TOKEN_ENV,
  type IMcpConfigDocument,
} from "./aiMcpReport";
import {
  AGENT_TARGETS,
  agentsDemandes,
  agentsPresents,
  litVariable,
  planAgentDeclaration,
  racineAgent,
  renderPlanShell,
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

const USAGE =
  `Usage : nodefony ai:mcp [--auth|--no-auth] [--agent <liste>] [--remove]\n` +
  `                        [--url <origine>] [--dry-run] [--json] [--cwd <path>]\n` +
  `  Déclare le serveur MCP de cette application dans ${MCP_CONFIG_FILE}.\n` +
  `  --auth : mode authentifié — l'en-tête porte \${${MCP_TOKEN_ENV}} (jamais le jeton lui-même).\n` +
  `           sans option, le mode déjà en place est CONSERVÉ ; --no-auth le retire.\n` +
  `         le jeton s'obtient par : nodefony security:token --write\n` +
  `  --agent : déclare AUSSI la porte chez ces agents, via LEUR CLI —\n` +
  `            ${AGENT_TARGETS.map((c) => c.cle).join(", ")}, all, none.\n` +
  `            « none » (ou aucune case cochée en interactif) ne touche à aucun agent :\n` +
  `            coder seul est un choix, pas un oubli.\n` +
  `  --remove : retire la déclaration au lieu de la poser (avec --agent).\n`;

/** Ce que la ligne de commande demande. */
interface IAiMcpRequest {
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
    } else if (word === "--agent") {
      // Pas de forme courte : `-a` est déjà `--auth`, et deux options qui se
      // ressemblent sur une lettre finissent par se confondre le jour où l'une
      // écrit chez un tiers.
      req.agent = rest[++i] ?? "";
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
export interface IEtatJeton {
  /** Secondes restantes ; négatif s'il est expiré, `null` si sans échéance. */
  restantSecondes: number | null;
  /** Scopes que le jeton porte, tels qu'il les déclare. */
  scopes: string[];
}

/**
 * Lit l'échéance et les scopes d'un JWT, sans le valider ni le divulguer.
 *
 * @param jeton - le jeton compact (`en-tête.charge.signature`).
 * @param maintenantSecondes - l'instant de référence, INJECTÉ pour que le banc
 *   n'ait pas à attendre le temps qui passe.
 * @returns l'état lisible, ou `null` si ce n'est pas un JWT exploitable.
 */
export function etatDuJeton(
  jeton: string,
  maintenantSecondes: number,
): IEtatJeton | null {
  const parts = jeton.split(".");
  if (parts.length !== 3 || !parts[1]) return null;
  try {
    const charge = JSON.parse(
      Buffer.from(parts[1], "base64url").toString("utf8"),
    ) as { exp?: unknown; scope?: unknown };
    const scope = typeof charge.scope === "string" ? charge.scope : "";
    return {
      restantSecondes:
        typeof charge.exp === "number" ? charge.exp - maintenantSecondes : null,
      scopes: scope.split(/\s+/u).filter((s) => s !== ""),
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
 * @param etat - ce que {@link etatDuJeton} a lu, ou `null` s'il n'y en a pas.
 * @returns la ligne à afficher.
 */
export function renderEtatJeton(etat: IEtatJeton | null): string {
  if (etat === null) return "aucun jeton lisible n'est posé chez tes agents";
  const scopes =
    etat.scopes.length > 0 ? etat.scopes.join(" ") : "aucun scope déclaré";
  if (etat.restantSecondes === null) return `jeton sans échéance (${scopes})`;
  if (etat.restantSecondes <= 0) {
    const depuis = Math.round(-etat.restantSecondes / 60);
    return `jeton EXPIRÉ depuis ${depuis} min (${scopes}) — c'est lui qui provoque les 401`;
  }
  const heures = etat.restantSecondes / 3600;
  const reste =
    heures >= 48
      ? `${Math.round(heures / 24)} jours`
      : heures >= 2
        ? `${Math.round(heures)} heures`
        : `${Math.round(etat.restantSecondes / 60)} min`;
  return `jeton valide encore ${reste} (${scopes})`;
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
 * @param cibles - agents détectés sur ce poste.
 * @param projectRoot - racine du projet, pour résoudre leurs fichiers.
 * @param maintenantSecondes - instant de référence, injecté pour le banc.
 * @returns pour chaque agent, sa phrase d'état.
 */
export function etatJetonsAgents(
  cibles: readonly IAgentTarget[],
  projectRoot: string,
  maintenantSecondes: number,
): Map<string, string> {
  const etats = new Map<string, string>();
  for (const cible of cibles) {
    const fichier = path.resolve(
      racineAgent(cible, { projectRoot }),
      cible.fichier,
    );
    let contenu = "";
    try {
      contenu = existsSync(fichier) ? readFileSync(fichier, "utf8") : "";
    } catch {
      // Un fichier illisible n'est pas une panne de cette commande : on se tait
      // sur cet agent plutôt que d'affirmer qu'il n'a pas de jeton.
      etats.set(cible.cle, "état du jeton illisible");
      continue;
    }
    const jeton = litVariable(cible.forme, contenu, MCP_TOKEN_ENV);
    etats.set(
      cible.cle,
      jeton === null
        ? "pas de jeton posé"
        : renderEtatJeton(etatDuJeton(jeton, maintenantSecondes)),
    );
  }
  return etats;
}

export function planTokenChaining(
  demande: Pick<IAiMcpRequest, "auth" | "dryRun" | "json">,
  contexte: {
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
  if (demande.auth !== true) return null;
  // `--dry-run` ne doit rien produire ; `--json` part vers un script, qu'une
  // question romprait.
  if (demande.dryRun || demande.json) return null;
  if (!contexte.isTTY) return null;
  const argv = ["security:token", "--write"];
  if (contexte.ttlMinutes !== undefined) {
    argv.push("--ttl", String(contexte.ttlMinutes));
  }
  if (contexte.scopes !== undefined && contexte.scopes.trim() !== "") {
    argv.push("--scope", contexte.scopes);
  }
  return {
    argv,
    env: { ...(contexte.env ?? process.env), NODE_ENV: "development" },
    cwd: contexte.projectRoot,
  };
}

/** Ce qu'il est advenu de la déclaration chez un agent. */
export interface IResultatDeclaration {
  /** L'agent visé. */
  cible: IAgentTarget;
  /**
   * `declare`/`retire` : sa CLI a répondu OK, et le contrôle le CONFIRME quand
   * il est possible. `sans-effet` : elle a répondu OK, mais la porte est encore
   * là (ou toujours absente) — mesuré chez l'un d'eux, et invisible autrement.
   * `fichier-projet` : il lit déjà le `.mcp.json`, il n'y avait rien à lancer.
   * `cli-absente` : l'outil n'est pas installé — la commande est rendue pour le
   * jour où il le sera. `echec` : sa CLI a refusé, et c'est ELLE qui dit pourquoi.
   */
  etat:
    | "declare"
    | "retire"
    | "fichier-projet"
    | "cli-absente"
    | "echec"
    | "sans-effet";
  /** La commande, telle qu'on peut la recopier. Vide pour `fichier-projet`. */
  commande: string;
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
  remplaceAutreUrl?: boolean;
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
 * @param cibles - agents à servir
 * @param ctx - l'URL de la porte, et le sens du geste
 * @returns un verdict par agent — jamais une exception : un agent qui refuse
 *          n'empêche pas de servir les suivants
 */
export async function declarerChezAgents(
  cibles: readonly IAgentTarget[],
  ctx: { url: string; retirer: boolean; projectRoot: string },
): Promise<IResultatDeclaration[]> {
  const { spawnSync } = await import("node:child_process");
  const resultats: IResultatDeclaration[] = [];
  for (const cible of cibles) {
    const plan = planAgentDeclaration(
      cible,
      { url: ctx.url, tokenEnv: MCP_TOKEN_ENV },
      ctx.retirer,
    );
    if (plan.voie !== "cli") {
      resultats.push({ cible, etat: "fichier-projet", commande: "" });
      continue;
    }
    const commande = renderPlanShell(plan);
    // Ce qui était déclaré AVANT — on ne peut le savoir qu'en regardant, et
    // seulement après coup ce serait trop tard : la CLI aura déjà écrasé.
    const argvListeAvant = cible.argvListe?.();
    let remplaceAutreUrl = false;
    if (argvListeAvant && !ctx.retirer) {
      const avant = spawnSync(plan.bin, argvListeAvant, {
        encoding: "utf8",
        shell: false,
        cwd: ctx.projectRoot,
      });
      const vu = `${avant.stdout ?? ""}${avant.stderr ?? ""}`;
      remplaceAutreUrl =
        !avant.error &&
        avant.status === 0 &&
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
    });
    // La CAPACITÉ se constate : on ne demande pas au `PATH` si l'outil existe,
    // on l'appelle. `ENOENT` est la réponse, et elle est sans ambiguïté.
    if (r.error && (r.error as NodeJS.ErrnoException).code === "ENOENT") {
      resultats.push({ cible, etat: "cli-absente", commande });
      continue;
    }
    if (r.status !== 0) {
      resultats.push({
        cible,
        etat: "echec",
        commande,
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
    const argvListe = cible.argvListe?.();
    if (argvListe) {
      const vue = spawnSync(plan.bin, argvListe, {
        encoding: "utf8",
        shell: false,
        // Même racine que le geste : lue ailleurs, la liste parlerait d'un
        // autre projet et le constat serait faux dans les deux sens.
        cwd: ctx.projectRoot,
      });
      const sortie = `${vue.stdout ?? ""}${vue.stderr ?? ""}`;
      // La lecture n'a pas pu se faire : on ne conclut RIEN de son silence —
      // une absence de trace n'est pas une preuve.
      const lisible = !vue.error && vue.status === 0;
      const present = sortie.includes(MCP_SERVER_KEY);
      if (lisible && present === ctx.retirer) {
        resultats.push({
          cible,
          etat: "sans-effet",
          commande,
          detail: sortie.trim().split("\n").slice(-4).join("\n"),
        });
        continue;
      }
    }
    resultats.push({
      cible,
      etat: ctx.retirer ? "retire" : "declare",
      commande,
      ...(remplaceAutreUrl ? { remplaceAutreUrl: true } : {}),
    });
  }
  return resultats;
}

/**
 * Rend le compte rendu des déclarations.
 *
 * PURE : c'est le texte que l'utilisateur lit, et il doit pouvoir être éprouvé
 * sans lancer la moindre CLI.
 *
 * @param resultats - un verdict par agent
 * @param retirer - le sens du geste, pour accorder les phrases
 */
export function renderDeclarations(
  resultats: readonly IResultatDeclaration[],
  retirer: boolean,
): string {
  if (resultats.length === 0) {
    // 🔴 Le silence serait ambigu : « rien ne s'est passé » ou « ça a échoué » ?
    // Coder seul est un CHOIX, et il s'affiche comme tel.
    return (
      `\n  Aucun agent : tu codes seul, c'est un choix.\n` +
      `  Quand tu voudras : nodefony ai:mcp --agent all\n`
    );
  }
  let out = "\n";
  for (const r of resultats) {
    if (r.etat === "fichier-projet") {
      out +=
        `  • ${r.cible.nom} — rien à faire : il lit ${MCP_CONFIG_FILE}, ` +
        `${retirer ? "retiré par --no-auth ou à la main" : "déjà à jour"}.\n`;
    } else if (r.etat === "declare") {
      // 🔴 La PORTÉE se dit. Deux de ces agents n'ont pas de notion de projet :
      // leur CLI n'écrit que dans le dossier de l'utilisateur (constaté — un
      // `.codex/config.toml` posé dans un projet n'est PAS lu ; seul
      // `CODEX_HOME` le déplace, et il faudrait l'exporter à chaque
      // lancement). Une déclaration qui vaut pour TOUS les projets et qu'on
      // croit locale, c'est la deuxième application Nodefony qui écrase la
      // première sans un mot.
      const portee =
        r.cible.portee === "projet"
          ? "dans ce projet"
          : "GLOBALE — elle vaut pour tous tes projets";
      out += `  ✓ ${r.cible.nom} — porte déclarée, ${portee}. RELANCE-le.\n`;
      if (r.etat === "declare" && r.remplaceAutreUrl) {
        out +=
          `    ⚠ elle a REMPLACÉ une déclaration « ${MCP_SERVER_KEY} » qui ` +
          `visait ailleurs — une autre application ?\n`;
      }
      if (r.cible.noteApres) out += `    ⓘ ${r.cible.noteApres}\n`;
    } else if (r.etat === "retire") {
      out += `  ✓ ${r.cible.nom} — déclaration retirée.\n`;
    } else if (r.etat === "sans-effet") {
      out +=
        `  ⚠ ${r.cible.nom} — sa CLI a répondu « ok », mais la porte est ` +
        `${retirer ? "TOUJOURS déclarée" : "INTROUVABLE"} chez lui.\n` +
        `    Ce qu'elle liste :\n` +
        `${(r.detail ?? "")
          .split("\n")
          .map((l) => `      ${l}`)
          .join("\n")}\n` +
        `    La commande jouée : ${r.commande}\n` +
        `    Son outil ne l'a pas honorée — reprends depuis SA configuration.\n`;
    } else if (r.etat === "cli-absente") {
      out +=
        `  ⚠ ${r.cible.nom} — sa commande « ${r.cible.bin} » est introuvable ici.\n` +
        `    Le jour où tu l'installes :\n      ${r.commande}\n`;
    } else {
      out +=
        `  ⚠ ${r.cible.nom} — sa CLI a refusé :\n` +
        `${(r.detail ?? "")
          .split("\n")
          .map((l) => `      ${l}`)
          .join("\n")}\n` +
        `    La commande jouée était :\n      ${r.commande}\n`;
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
    const { confirm } = await chargePrompts();
    parsed.auth = await confirm({
      message: `Mode authentifié ? (en-tête \${${MCP_TOKEN_ENV}}${dejaAuth ? " — répondre non le RETIRE" : ""})`,
      default: dejaAuth,
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
  const demandes = agentsDemandes(parsed.agent);
  if (demandes instanceof Error) {
    process.stderr.write(`ai:mcp: ${demandes.message}\n`);
    return SysExit.USAGE;
  }
  let cibles: readonly IAgentTarget[] = demandes ?? [];
  if (demandes === undefined && !parsed.dryRun && !parsed.json) {
    // 🔴 Rien n'est coché par défaut, et ce n'est pas de la timidité : écrire
    // dans la configuration d'un autre outil est un geste qui doit être VOULU.
    // Un développeur peut parfaitement coder seul — ce n'est pas un oubli à
    // rattraper, c'est un choix qu'on lui laisse, et la question le dit.
    const detectes = agentsPresents({
      projectRoot,
      existe: existsSync,
    });
    const presents = detectes.filter((c) => c.declaration === "cli");
    // ⚠️ Un agent DÉTECTÉ mais absent de la liste doit être EXPLIQUÉ. Ceux qui
    // lisent le fichier de projet — Claude Code lit le `.mcp.json` qu'on vient
    // d'écrire — n'ont aucune commande à lancer : leur proposer une case à
    // cocher n'aurait aucun sens, et `claude mcp add` poserait même une SECONDE
    // déclaration dans le dossier de l'utilisateur, invisible du dépôt et
    // jamais rafraîchie. Mais les taire fait chercher, puis conclure qu'ils ne
    // sont pas gérés — vécu.
    const parFichier = detectes.filter(
      (c) => c.declaration === "fichier-projet",
    );
    if (detectes.length > 0 && process.stdin.isTTY) {
      const { checkbox } = await chargePrompts();
      const choisis = (await checkbox({
        message: `Déclarer la porte chez quels agents ? ${"(espace pour cocher — ENTRÉE sans rien cocher : aucun, je code seul)"}`,
        choices: [
          // ⚠️ Les agents servis par le FICHIER de projet figurent dans la
          // liste, cochés et non décochables. Les taire était un contresens
          // d'ergonomie : une liste où l'agent principal MANQUE se lit
          // « non géré », alors qu'il est déjà servi — c'est même le seul qui
          // n'ait rien à attendre de cette question. Un choix inerte qui
          // s'EXPLIQUE vaut mieux qu'une absence qui s'interprète.
          ...parFichier.map((c) => ({
            name: `${c.nom} — servi par le ${path.basename(file)} de ce projet`,
            value: c.cle,
            checked: true,
            disabled: "déjà à jour, rien à lancer",
          })),
          ...presents.map((c) => ({
            name: `${c.nom} — ${c.bin} mcp ${parsed.remove ? "remove" : "add"}`,
            value: c.cle,
            checked: false,
          })),
        ],
      })) as string[];
      // Un choix désactivé n'est jamais rendu par la question : le filtre porte
      // donc bien sur les seuls agents qui ont une CLI à lancer.
      cibles = presents.filter((c) => choisis.includes(c.cle));
    }
  }

  if (parsed.json) {
    process.stdout.write(
      `${JSON.stringify(
        {
          file,
          ...plan,
          dryRun: parsed.dryRun,
          agents: cibles.map((c) => c.cle),
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
    if (cibles.length > 0) {
      process.stdout.write(
        `\n  À lancer (non joué — --dry-run) :\n` +
          cibles
            .map((c) => {
              const p = planAgentDeclaration(
                c,
                { url: mcpUrl, tokenEnv: MCP_TOKEN_ENV },
                parsed.remove,
              );
              return p.voie === "cli"
                ? `      ${renderPlanShell(p)}\n`
                : `      (${c.nom} : rien — il lit ${MCP_CONFIG_FILE})\n`;
            })
            .join(""),
      );
    }
  } else if (demandes !== undefined || cibles.length > 0) {
    // Le compte rendu n'est écrit que si la question a été posée ou si des
    // agents ont été demandés : une invocation qui ne parlait pas d'agents ne
    // doit pas se mettre à en parler.
    process.stdout.write(
      renderDeclarations(
        await declarerChezAgents(cibles, {
          url: mcpUrl,
          retirer: parsed.remove,
          projectRoot,
        }),
        parsed.remove,
      ),
    );
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
    const detectesPourJeton = agentsPresents({
      projectRoot,
      existe: existsSync,
    });
    const etats = etatJetonsAgents(
      detectesPourJeton,
      projectRoot,
      Math.floor(Date.now() / 1000),
    );
    for (const cible of detectesPourJeton) {
      process.stdout.write(`  ${cible.nom} : ${etats.get(cible.cle)}\n`);
    }
    // « Périmé » vaut pour l'ENSEMBLE : si un seul agent porte un jeton mort,
    // proposer par défaut de réémettre est le bon service — c'est lui qui
    // rendra des 401 sans qu'on sache lequel.
    const perime =
      detectesPourJeton.length === 0 ||
      [...etats.values()].some(
        (phrase) =>
          phrase.includes("EXPIRÉ") || phrase.includes("pas de jeton"),
      );
    const maintenant = await confirm({
      message: `${perime ? "Obtenir" : "Réémettre"} un jeton maintenant (${MCP_TOKEN_ENV}) ?`,
      default: perime,
    });
    const bin = process.argv[1];
    if (maintenant && bin) {
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
      const avecDuree = planTokenChaining(parsed, {
        projectRoot,
        isTTY: true,
        ttlMinutes,
        scopes,
      });
      const { spawnSync } = await import("node:child_process");
      // `stdio: "inherit"` — l'enfant hérite du TERMINAL, sans quoi il ne
      // pourrait poser aucune question (son `process.stdin.isTTY` serait faux).
      spawnSync(process.execPath, [bin, ...(avecDuree ?? chainage).argv], {
        stdio: "inherit",
        cwd: chainage.cwd,
        env: chainage.env,
      });
    }
  }
  return SysExit.OK;
}
