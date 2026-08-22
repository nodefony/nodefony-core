import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { homedir } from "node:os";
import {
  OptionsCommandInterface,
  CliKernel,
  Command,
  MCP_ENDPOINT_PATH,
} from "nodefony";
import type { UserService } from "@nodefony/user";
import type TokenService from "../service/tokenService";

const options: OptionsCommandInterface = {
  showBanner: false,
  // Services prêts, AUCUN serveur en écoute : cette commande SIGNE un jeton,
  // elle n'en demande pas un à une porte HTTP. C'est ce qui la rend utilisable
  // sans que l'application tourne — et sans mot de passe.
  kernelEvent: "onReady",
  // Le journal de cycle de vie n'est pas la sortie : ici la sortie est un jeton
  // qu'on copie ou qu'on exporte.
  quietBoot: true,
};

/** Variable d'environnement que le câblage `.mcp.json` développe. */
const MCP_TOKEN_ENV = "NF_MCP_TOKEN";

/**
 * Un agent de développement, et l'endroit où il lit ses variables.
 *
 * ⭐ **Cette table existe parce qu'aucun agent ne lit `.env.local`.** Ce fichier
 * est celui de l'APPLICATION ; le client MCP, lui, résout ses variables dans son
 * propre environnement ou dans SA configuration — et quand il n'y trouve rien,
 * il envoie l'en-tête non substitué et reçoit un 401 qui accuse le jeton. Une
 * heure de diagnostic pour une chaîne cohérente en apparence.
 *
 * Ajouter un agent = ajouter une ligne. Ce qui n'y est PAS reste dit en clair
 * plutôt que deviné : poser un secret dans un fichier dont on n'a pas vérifié le
 * comportement serait un pari, et c'est le porteur qui le paierait.
 */
interface IAgentTarget {
  /** Clé courte — ce que `--agent` accepte, et ce qu'une question propose. */
  cle: string;
  /** Nom affiché. */
  nom: string;
  /**
   * Où vit sa configuration : dans le PROJET, ou dans le dossier de
   * l'utilisateur. La distinction commande la garde appliquée — un fichier de
   * projet peut se retrouver commité, celui de l'utilisateur non.
   */
  portee: "projet" | "utilisateur";
  /** Ce dont la présence prouve que l'agent est utilisé — résolu selon `portee`. */
  marqueur: string;
  /** Fichier à écrire — relatif au projet, ou au dossier de l'agent. */
  fichier: string;
  /** Grammaire du fichier. */
  forme: "json-env" | "dotenv";
  /**
   * Variable qui déplace le dossier de l'agent (portée utilisateur seulement).
   * Vibe la documente et son source la lit : `VIBE_HOME`.
   */
  home?: string;
}

/**
 * Agents dont l'emplacement de secret a été CONSTATÉ — au comportement ou au
 * source, jamais sur la foi d'une page de blog.
 *
 * Deux stratégies, et elles ne se ressemblent pas :
 *  - **Claude Code** prend la VALEUR : la clé `env` de `settings.local.json`
 *    alimente l'expansion `${VAR}` de `.mcp.json` (constaté — `claude mcp list`
 *    passe de l'en-tête non substitué à « ✔ Connected ») ;
 *  - **Vibe** prend le NOM d'une variable (`--api-key-env`) et la résout dans
 *    son environnement — mais il PEUPLE cet environnement au démarrage depuis
 *    `$VIBE_HOME/.env` (`load_dotenv_values`, `vibe/cli/cli.py`), une valeur du
 *    shell l'emportant sur le fichier. Écrire là revient donc bien à câbler ;
 *  - **Gemini CLI** de même, depuis un fichier qu'il CHERCHE en remontant
 *    l'arborescence (`findEnvFile`) : `<projet>/.gemini/.env` d'abord — quand
 *    l'espace est de confiance — puis `<projet>/.env`, puis les parents, puis
 *    `~/.gemini/.env`. Le PREMIER trouvé gagne, et lui seul est chargé : viser
 *    `.gemini/.env` évite qu'il lise à la place le `.env` de l'application.
 *
 *  - **Codex** de même, depuis `$CODEX_HOME/.env` (défaut `~/.codex/.env`), et
 *    de là SEULEMENT : le `.env` du projet n'est pas lu.
 *
 * ⚠️ Ce dernier point a d'abord été conclu à l'envers, en cherchant une chaîne
 * dans un binaire compilé et en prenant son absence pour une preuve. Une
 * ABSENCE de trace n'en est pas une : c'est l'expérience qui a tranché — une
 * sonde (`codex doctor` signale une variable de serveur MCP manquante) montrée
 * discriminante d'abord, témoin à 1 et variable exportée à 0, puis passée sur
 * chaque emplacement candidat.
 */
const AGENT_TARGETS: readonly IAgentTarget[] = [
  {
    cle: "claude",
    nom: "Claude Code",
    portee: "projet",
    marqueur: ".claude",
    fichier: ".claude/settings.local.json",
    forme: "json-env",
  },
  {
    cle: "gemini",
    nom: "Gemini CLI",
    portee: "projet",
    marqueur: ".gemini",
    fichier: ".gemini/.env",
    forme: "dotenv",
  },
  {
    cle: "vibe",
    nom: "Vibe (Mistral)",
    portee: "utilisateur",
    marqueur: ".vibe",
    fichier: ".env",
    forme: "dotenv",
    home: "VIBE_HOME",
  },
  {
    cle: "codex",
    nom: "Codex",
    portee: "utilisateur",
    marqueur: ".codex",
    fichier: ".env",
    forme: "dotenv",
    home: "CODEX_HOME",
  },
];

/**
 * Pose une variable dans le contenu d'un fichier de configuration d'agent.
 *
 * Fonction PURE — elle prend le contenu et rend le contenu. C'est ce qui permet
 * d'éprouver chaque grammaire sans écrire sur le disque de qui que ce soit, et
 * de garantir qu'un fichier existant n'est pas ÉCRASÉ mais complété : ces
 * fichiers portent les réglages de quelqu'un d'autre.
 *
 * @param forme - grammaire du fichier
 * @param actuel - contenu actuel, ou chaîne vide s'il n'existe pas
 * @param cle - nom de la variable
 * @param valeur - sa valeur
 * @returns le nouveau contenu, ou une `Error` si le fichier est illisible
 */
export function poseVariable(
  forme: IAgentTarget["forme"],
  actuel: string,
  cle: string,
  valeur: string,
): string | Error {
  if (forme === "dotenv") {
    const ligne = `${cle}=${valeur}`;
    const motif = new RegExp(`^\\s*${cle}\\s*=.*$`, "m");
    if (motif.test(actuel)) return actuel.replace(motif, ligne);
    return actuel.length === 0
      ? `${ligne}\n`
      : `${actuel.replace(/\n*$/u, "")}\n${ligne}\n`;
  }
  let doc: Record<string, unknown>;
  try {
    doc =
      actuel.trim() === ""
        ? {}
        : (JSON.parse(actuel) as Record<string, unknown>);
  } catch {
    // Un fichier corrompu ne se réécrit pas en silence : il porte les réglages
    // de quelqu'un, et les remplacer par les nôtres serait pire que ne rien faire.
    return new Error("le fichier existe mais n'est pas du JSON valide");
  }
  const env = (doc.env ?? {}) as Record<string, unknown>;
  env[cle] = valeur;
  doc.env = env;
  return `${JSON.stringify(doc, null, 2)}\n`;
}

/**
 * Ce fichier porte-t-il DÉJÀ cette variable ?
 *
 * ⭐ C'est ce qui rend la rotation simple : l'état de câblage n'a pas à être
 * mémorisé quelque part, il EST dans les fichiers des agents. Un agent qui
 * porte la clé a été câblé un jour — le relancer doit la METTRE À JOUR, sans
 * reposer la question. Un fichier d'état parallèle, lui, mentirait dès que
 * quelqu'un modifierait sa configuration à la main.
 *
 * @param forme - grammaire du fichier
 * @param contenu - son contenu, ou chaîne vide s'il n'existe pas
 * @param cle - nom de la variable
 */
export function porteDejaLaCle(
  forme: IAgentTarget["forme"],
  contenu: string,
  cle: string,
): boolean {
  if (contenu.trim() === "") return false;
  if (forme === "dotenv") {
    return new RegExp(`^\\s*${cle}\\s*=`, "m").test(contenu);
  }
  try {
    const doc = JSON.parse(contenu) as { env?: Record<string, unknown> };
    return typeof doc.env?.[cle] === "string" && doc.env[cle] !== "";
  } catch {
    return false;
  }
}

/**
 * Traduit `--agent` en cibles, ou rend l'erreur à afficher.
 *
 * Trois formes : rien (les cibles détectées, décidé plus loin), `none` (aucune
 * écriture), ou une liste de clés. Une clé inconnue est REFUSÉE en nommant
 * celles qui existent — ignorée en silence, elle ferait croire à un agent servi
 * qui ne l'est pas, et c'est exactement ce genre de silence qui a déjà coûté une
 * heure de diagnostic ici.
 *
 * @param raw - la valeur telle que tapée, ou rien
 * @returns les cibles demandées, `undefined` si rien n'est demandé, une `Error` sinon
 */
export function agentsDemandes(
  raw: string | undefined,
): readonly IAgentTarget[] | undefined | Error {
  if (raw === undefined) return undefined;
  const cles = raw
    .split(/[\s,]+/u)
    .map((c) => c.trim().toLowerCase())
    .filter(Boolean);
  if (cles.length === 1 && cles[0] === "none") return [];
  if (cles.length === 1 && cles[0] === "all") return AGENT_TARGETS;
  const connues = AGENT_TARGETS.map((c) => c.cle);
  const inconnues = cles.filter((c) => !connues.includes(c));
  if (inconnues.length > 0) {
    return new Error(
      `--agent : « ${inconnues.join(", ")} » inconnu — attendus : ` +
        `${connues.join(", ")}, all, none`,
    );
  }
  return AGENT_TARGETS.filter((c) => cles.includes(c.cle));
}

/** Plafond d'une durée demandée en ligne de commande : 30 jours. */
const TTL_MAX_MINUTES = 30 * 24 * 60;

/**
 * Traduit `--ttl` en secondes, ou rend l'erreur à afficher.
 *
 * Exportée pour être ÉPROUVÉE : c'est une fonction pure dont chaque verdict est
 * binaire, et dont l'échec — une durée acceptée alors qu'elle est aberrante —
 * ne se verrait qu'au moment où un jeton refuse de mourir.
 *
 * @param raw - la valeur telle que tapée, ou rien
 * @returns les secondes, `undefined` si rien n'est demandé, une `Error` sinon
 */
export function ttlSeconds(
  raw: string | undefined,
): number | undefined | Error {
  if (raw === undefined) return undefined;
  const minutes = Number.parseInt(raw, 10);
  if (!Number.isFinite(minutes) || minutes <= 0) {
    return new Error(
      `--ttl attend un nombre de MINUTES supérieur à zéro (reçu « ${raw} »)`,
    );
  }
  if (minutes > TTL_MAX_MINUTES) {
    return new Error(
      `--ttl est borné à ${TTL_MAX_MINUTES} minutes (30 jours) — un jeton posé ` +
        `dans un fichier est une clé, et une clé se remplace`,
    );
  }
  return minutes * 60;
}

const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const DIM = "\x1b[2m";
const BOLD = "\x1b[1m";
const RESET = "\x1b[0m";

/**
 * `nodefony security:token` — émet un jeton d'accès pour une porte de cette
 * application (la porte MCP par défaut).
 *
 * **Pourquoi une commande, et pas un `curl`.** Le jeton s'obtenait par un appel
 * au grant : trouver l'URL, composer un JSON, y mettre un mot de passe en clair
 * dans l'historique du shell, et surtout AVOIR un serveur en marche. Personne ne
 * fait ça deux fois. Ici l'application SIGNE elle-même — elle possède la clé —
 * donc : pas de serveur, pas de mot de passe, pas de réseau.
 *
 * **L'audience est celle de la porte, et ce n'est pas un détail** (RFC 8707) :
 * un jeton d'audience différente est refusé, à juste titre — c'est toute la
 * raison d'être de la liaison d'audience. La commande la vise d'elle-même,
 * `--resource` ne sert qu'à en viser une autre.
 *
 * Suit `security:secrets` : `--write` pose la valeur là où l'AGENT la lit
 * (gitignoré), jamais dans le `.env` commité, et ne remplace jamais une valeur
 * existante — une rotation est un geste explicite.
 */
class SecurityToken extends Command {
  constructor(cli: CliKernel) {
    super(
      "security:token",
      `Émet un jeton d'accès pour la porte MCP (--write : le pose chez tes agents)`,
      cli,
      options,
    );
    this.addArgument(
      "[identifier]",
      "compte porteur du jeton (défaut : admin)",
    );
    this.addOption(
      "-s, --scope <scopes>",
      "scopes demandés, séparés par des espaces (défaut : aucun)",
    );
    this.addOption(
      "-r, --resource <uri>",
      "audience visée (défaut : la porte MCP de cette application)",
    );
    this.addOption(
      "-a, --agent <noms>",
      "agents à servir, séparés par des virgules (défaut : ceux détectés ; « none » pour aucun)",
    );
    this.addOption(
      "-t, --ttl <duree>",
      "durée de validité, en minutes (défaut : celle de la config, 15 min)",
    );
    this.addOption(
      "-w, --write",
      `pose ${MCP_TOKEN_ENV} dans la configuration des agents présents`,
    );
    this.addOption("-j, --json", "sortie JSON (scripts/CI)");
  }

  /** Racine du projet (le kernel la connaît ; repli sur le cwd). */
  #root(): string {
    return this.kernel?.path ?? process.cwd();
  }

  /** Ce fichier est-il couvert par un `.gitignore` ? */
  #gitIgnored(file: string): boolean {
    try {
      return (
        spawnSync("git", ["check-ignore", "-q", file], {
          cwd: this.#root(),
          stdio: "ignore",
        }).status === 0
      );
    } catch {
      return false;
    }
  }

  /** Ce fichier est-il SUIVI par git ? Un secret n'entre pas dans un suivi. */
  #tracked(file: string): boolean {
    try {
      return (
        spawnSync("git", ["ls-files", "--error-unmatch", file], {
          cwd: this.#root(),
          stdio: "ignore",
        }).status === 0
      );
    } catch {
      return false;
    }
  }

  /** Racine où vit la configuration d'une cible (projet, ou dossier maison). */
  #racineDe(cible: IAgentTarget): string {
    return cible.portee === "projet"
      ? this.#root()
      : path.resolve(
          (cible.home ? process.env[cible.home] : undefined) ??
            path.join(homedir(), cible.marqueur),
        );
  }

  /** Contenu du fichier d'une cible, "" s'il n'existe pas. */
  #contenuDe(cible: IAgentTarget): string {
    try {
      const abs = path.resolve(this.#racineDe(cible), cible.fichier);
      return existsSync(abs) ? readFileSync(abs, "utf8") : "";
    } catch {
      return "";
    }
  }

  /**
   * Agents dont la présence est CONSTATÉE — on ne crée pas la configuration
   * d'un outil que personne n'utilise ici.
   */
  #agentsPresents(): IAgentTarget[] {
    return AGENT_TARGETS.filter((cible) => {
      const racine = this.#racineDe(cible);
      return cible.portee === "projet"
        ? existsSync(path.resolve(racine, cible.marqueur))
        : existsSync(racine);
    });
  }

  /**
   * Pose le jeton dans la configuration des agents PRÉSENTS dans ce projet.
   *
   * Un agent n'est servi que si son marqueur existe : on ne crée pas la
   * configuration d'un outil que personne n'utilise ici. Et jamais dans un
   * fichier SUIVI par git — un jeton commité est un jeton publié, et c'est la
   * seule faute de cette commande qui serait irrattrapable.
   *
   * @param jeton - le jeton à poser
   * @param w - la sortie où rendre compte
   * @param cibles - agents à servir (déjà filtrés par le choix de l'appelant)
   * @returns le nombre d'agents effectivement servis
   */
  #poseChezAgents(
    jeton: string,
    w: (t: string) => void,
    cibles: readonly IAgentTarget[],
  ): number {
    let servis = 0;
    for (const cible of cibles) {
      const racine = this.#racineDe(cible);
      // La garde git ne vaut que pour le projet : le dossier de l'utilisateur
      // n'est pas versionné, et `git ls-files` y répondrait sur un autre dépôt.
      if (cible.portee === "projet" && this.#tracked(cible.fichier)) {
        w(
          `${YELLOW}⚠ ${cible.fichier} est SUIVI par git — rien n'est écrit.${RESET}\n` +
            `${DIM}  Un jeton commité est un jeton publié.${RESET}\n\n`,
        );
        continue;
      }
      const abs = path.resolve(racine, cible.fichier);
      const pose = poseVariable(
        cible.forme,
        existsSync(abs) ? readFileSync(abs, "utf8") : "",
        MCP_TOKEN_ENV,
        jeton,
      );
      if (pose instanceof Error) {
        w(
          `${YELLOW}⚠ ${cible.fichier} : ${pose.message} — rien n'est écrit.${RESET}\n\n`,
        );
        continue;
      }
      try {
        mkdirSync(path.dirname(abs), { recursive: true });
        writeFileSync(abs, pose, "utf8");
      } catch (error) {
        w(
          `${YELLOW}⚠ ${cible.fichier} : écriture impossible — ${(error as Error).message}${RESET}\n\n`,
        );
        continue;
      }
      w(
        `${GREEN}✓ ${MCP_TOKEN_ENV} posé pour ${cible.nom}${RESET} ` +
          // Le chemin AFFICHÉ est celui qu'on a réellement écrit : rendre
          // « .env » pour un fichier qui vit dans le dossier de l'utilisateur
          // le ferait confondre avec celui du projet, et chercher au mauvais
          // endroit le jour où quelque chose cloche.
          `${DIM}(${cible.portee === "projet" ? cible.fichier : abs})${RESET}\n` +
          `${DIM}  RELANCE-le : il lit sa configuration au démarrage.${RESET}\n`,
      );
      // Le fichier n'est pas suivi AUJOURD'HUI — mais rien n'empêche un
      // `git add -A` de l'emporter demain. Un jeton commité est un jeton
      // publié : la seule faute de cette commande qui serait irrattrapable.
      if (cible.portee === "projet" && !this.#gitIgnored(cible.fichier)) {
        w(
          `${YELLOW}  ⚠ ${cible.fichier} n'est PAS couvert par .gitignore — ` +
            `un « git add -A » l'emporterait.${RESET}\n`,
        );
      }
      w("\n");
      servis += 1;
    }
    return servis;
  }

  /**
   * Audience par défaut : la porte MCP de CETTE application.
   *
   * Lue de la configuration quand elle y est écrite — c'est elle qui fait foi,
   * et elle doit l'être : dérivée d'un en-tête `Host`, un `Host` forgé
   * obtiendrait un jeton d'audience arbitraire. À défaut, on compose l'adresse
   * locale, qui est celle du développement.
   */
  #defaultResource(): string {
    // La configuration du module qui SERT la porte fait foi quand elle est
    // écrite — et elle doit l'être : dérivée d'un en-tête `Host`, un `Host`
    // forgé obtiendrait un jeton d'audience arbitraire.
    const modules = this.kernel?.modules as
      Record<string, { options?: Record<string, unknown> }> | undefined;
    const devkit = modules?.devkit?.options as
      { mcp?: { authorization?: { resource?: string } } } | undefined;
    const declaree = devkit?.mcp?.authorization?.resource;
    if (typeof declaree === "string" && declaree.length > 0) return declaree;
    const port = process.env.NF_PORT ?? "5151";
    return `http://localhost:${port}${MCP_ENDPOINT_PATH}`;
  }

  /**
   * `true` si l'application signe avec une clé ÉPHÉMÈRE (ni `keySetJson` ni
   * `dir` déclarés dans `security.jwt.keystore`).
   *
   * 🔴 C'est le piège que cette commande doit annoncer : le jeton produit est
   * parfaitement valide et n'est vérifiable par PERSONNE d'autre que le process
   * qui vient de le signer — celui-ci. Le serveur en marche a généré la sienne
   * au démarrage, et refusera ce jeton en « autorisation requise ». Mesuré :
   * deux `kid` distincts pour la même application, et un troisième après un
   * redémarrage.
   */
  #cleEphemere(): boolean {
    const modules = this.kernel?.modules as
      Record<string, { options?: Record<string, unknown> }> | undefined;
    const jwt = (
      modules?.security?.options as
        | { jwt?: { keystore?: { keySetJson?: string; dir?: string } } }
        | undefined
    )?.jwt;
    const ks = jwt?.keystore;
    return !ks?.keySetJson && !ks?.dir;
  }

  override async generate(
    identifierArg: string | undefined,
    opts: {
      scope?: string;
      ttl?: string;
      agent?: string;
      resource?: string;
      write?: boolean;
      json?: boolean;
    },
  ): Promise<this> {
    const tokens = this.kernel?.container?.get("tokenService") as
      TokenService | undefined;
    const users = this.kernel?.container?.get("users") as
      UserService | undefined;
    if (!tokens || !users) {
      this.log(
        `service « ${!tokens ? "tokenService" : "users"} » absent — cette ` +
          `application ne provisionne pas d'émetteur de jetons.`,
        "ERROR",
      );
      process.exitCode = 1;
      return this;
    }

    // En terminal et sans argument : on PROPOSE les comptes qui existent.
    // Taper un identifiant de mémoire est la meilleure façon de se tromper —
    // et l'erreur ne se voit qu'après le boot complet.
    let identifier = identifierArg?.trim() ?? "";
    if (!identifier && process.stdin.isTTY) {
      const page = await users.listPage({ limit: 25 });
      if (page.items.length > 0) {
        await this.loadPrompts();
        identifier = (await this.prompts.select({
          message: "Compte porteur du jeton :",
          choices: page.items.map((u) => ({
            name: `${u.identifier}${(u.roles ?? []).length ? ` ${DIM}(${(u.roles ?? []).join(", ")})${RESET}` : ""}`,
            value: u.identifier,
          })),
        })) as string;
      }
    }
    if (!identifier) identifier = "admin";
    const user = await users.findByIdentifier(identifier);
    if (!user) {
      this.log(
        `compte « ${identifier} » introuvable — crée-le : ` +
          `nodefony security:user:add ${identifier}`,
        "ERROR",
      );
      process.exitCode = 1;
      return this;
    }

    const resource = opts.resource ?? this.#defaultResource();
    const scopes = (opts.scope ?? "").split(/\s+/u).filter(Boolean);
    // Une durée EXPLICITE, bornée. Le défaut de configuration (15 min) est
    // taillé pour un jeton d'API qu'un client rafraîchit ; l'en-tête statique
    // d'un agent, lui, n'est renouvelé par personne — le porteur revient toutes
    // les quinze minutes constater un 401 qui n'accuse pas la bonne chose. La
    // borne haute existe pour que « pratique » ne devienne pas « éternel » : un
    // jeton posé dans un fichier est une clé, et une clé se remplace.
    const ttlS = ttlSeconds(opts.ttl);
    if (ttlS instanceof Error) {
      this.log(ttlS.message, "ERROR");
      process.exitCode = 1;
      return this;
    }
    let emis;
    try {
      emis = await tokens.issueTokens(user, scopes, resource, ttlS);
    } catch (e) {
      // `invalid_target` en clair. L'émetteur refuse une audience qu'il ne sert
      // pas, et il a RAISON de ne rien dire de plus (énumérer les audiences
      // acceptées donnerait la carte des ressources protégées à qui possède un
      // simple identifiant). Mais l'utilisateur, lui, mérite la cause la plus
      // fréquente : la porte MCP est servie par un module `policy: "dev"`, donc
      // elle N'EXISTE PAS en production — et le CLI boote en production quand
      // le terminal n'a pas posé `NODE_ENV`.
      const oauth = (e as { oauthError?: string }).oauthError;
      if (oauth === "invalid_target") {
        // Le message dit d'abord ce que ce N'EST PAS : le premier réflexe est
        // de chercher un serveur éteint — vécu — alors que cette commande n'en
        // utilise aucun. Écarter la fausse piste coûte une ligne et fait gagner
        // le quart d'heure qu'on passerait à relancer un serveur pour rien.
        const env = this.kernel?.environment ?? "?";
        this.log(
          `impossible d'émettre un jeton pour cette porte ici.\n` +
            `\n` +
            `  Ce n'est PAS un problème de serveur : cette commande n'en a pas\n` +
            `  besoin, elle signe le jeton elle-même.\n` +
            `\n` +
            `  La porte visée — ${resource} — est servie par un module de\n` +
            `  DÉVELOPPEMENT. Ce terminal n'a pas posé NODE_ENV, donc le CLI a\n` +
            `  démarré en « ${env} », où ce module n'existe pas : un jeton pour\n` +
            `  une porte absente n'aurait personne pour l'accepter.\n` +
            `\n` +
            `  → NODE_ENV=development nodefony security:token${opts.write ? " --write" : ""}\n` +
            `  → ou vise une autre porte : --resource <uri>`,
          "ERROR",
        );
        process.exitCode = 1;
        return this;
      }
      throw e;
    }
    const jeton = emis.access_token;

    if (opts.json) {
      process.stdout.write(
        `${JSON.stringify({ access_token: jeton, resource, scopes, expires_in: emis.expires_in }, null, 2)}\n`,
      );
      return this;
    }

    const w = (s: string): void => {
      process.stdout.write(s);
    };
    // Sans `--write` mais en terminal : proposer de poser la valeur plutôt que
    // de laisser copier un jeton de 400 caractères à la main.
    let ecrire = opts.write === true;
    if (!ecrire && process.stdin.isTTY && !opts.json) {
      await this.loadPrompts();
      ecrire = await this.prompts.confirm({
        message: `Écrire ${MCP_TOKEN_ENV} dans .env.local ?`,
        default: true,
      });
    }
    if (this.#cleEphemere()) {
      // Avant le jeton, pas après : on ne laisse pas copier une valeur dont on
      // sait qu'elle sera refusée.
      w(
        `\n${YELLOW}⚠ Clé de signature ÉPHÉMÈRE — ce jeton sera REFUSÉ.${RESET}\n` +
          `${DIM}  Cette application n'a pas de clé persistante : chaque process en génère\n` +
          `  une au démarrage. Le jeton ci-dessous n'est vérifiable que par le process\n` +
          `  qui vient de le signer — pas par le serveur en marche, qui a la sienne.\n` +
          `  → déclare une source de clés dans nodefony.config.ts :\n` +
          `      use("@nodefony/security", { jwt: { keystore: { dir: "var/keys" } } })\n` +
          `    ou, en production, keySetJson depuis l'environnement.${RESET}\n`,
      );
    }
    const minutes = Math.round((emis.expires_in ?? 0) / 60);
    w(
      `\n${BOLD}🔑 Jeton d'accès${RESET} ${DIM}— compte ${identifier}, audience ${resource}${RESET}\n` +
        `${DIM}   valable ${minutes} min${scopes.length ? `, scopes : ${scopes.join(" ")}` : ", aucun scope"}${RESET}\n\n`,
    );

    if (ecrire) {
      // 🔴 Le jeton ne va PLUS dans `.env.local`, et c'est un retrait motivé :
      // AUCUN code de l'application ne lit `NF_MCP_TOKEN`. C'est cohérent — une
      // application est ici le serveur de RESSOURCE : elle vérifie les jetons
      // qu'on lui présente, elle n'en porte aucun. Le secret y dormait donc sans
      // lecteur, pure surface d'attaque, pendant que le seul consommateur — un
      // agent — le cherchait ailleurs et recevait un 401 qui accusait le jeton.
      // Et la duplication ne survivait pas à la première rotation : le fichier
      // refusait d'être touché quand les agents, eux, recevaient le neuf.
      const demandes = agentsDemandes(opts.agent);
      if (demandes instanceof Error) {
        this.log(demandes.message, "ERROR");
        process.exitCode = 1;
        return this;
      }
      let cibles = demandes ?? [];
      if (demandes === undefined) {
        const presents = this.#agentsPresents();
        // ⭐ ROTATION : un agent qui PORTE déjà la clé a été câblé un jour. Le
        // relancer doit la mettre à jour SANS reposer la question — sinon
        // renouveler un jeton redevient un questionnaire, et c'est le geste le
        // plus fréquent. L'état n'est pas mémorisé : il est lu là où il vit.
        const porteurs = presents.filter((c) =>
          porteDejaLaCle(c.forme, this.#contenuDe(c), MCP_TOKEN_ENV),
        );
        const nouveaux = presents.filter((c) => !porteurs.includes(c));
        cibles = porteurs;
        if (
          porteurs.length === 0 &&
          nouveaux.length > 0 &&
          process.stdin.isTTY
        ) {
          // PREMIÈRE fois : écrire dans la configuration d'un autre outil est un
          // geste qui se voit et se refuse, donc on propose.
          const { checkbox } = await import("@inquirer/prompts");
          const choisis = (await checkbox({
            message: "Poser le jeton chez quels agents ?",
            choices: nouveaux.map((c) => ({
              name: `${c.nom} — ${c.portee === "projet" ? c.fichier : `$${c.home}/${c.fichier}`}`,
              value: c.cle,
              checked: true,
            })),
          })) as string[];
          cibles = nouveaux.filter((c) => choisis.includes(c.cle));
        } else if (porteurs.length === 0) {
          // Hors terminal : servir ce qui est détecté, sinon la commande ne
          // ferait rien du tout dans un script.
          cibles = nouveaux;
        } else if (nouveaux.length > 0) {
          // Des agents sont là mais n'ont jamais été câblés : le DIRE, sans
          // décider à leur place — la rotation ne doit pas élargir le périmètre.
          w(
            `${DIM}  ${nouveaux.map((c) => c.nom).join(", ")} ` +
              `${nouveaux.length > 1 ? "sont présents" : "est présent"} mais ne porte` +
              `${nouveaux.length > 1 ? "nt" : ""} pas encore le jeton — ` +
              `ajoute --agent ${nouveaux.map((c) => c.cle).join(",")}.${RESET}\n\n`,
          );
        }
      }
      const servis = this.#poseChezAgents(jeton, w, cibles);
      if (servis === 0) {
        w(
          `${YELLOW}⚠ aucun agent reconnu dans ce projet — rien n'est écrit.${RESET}\n` +
            `${DIM}  Les agents connus rangent leur configuration ici :${RESET}\n` +
            AGENT_TARGETS.map(
              (c) =>
                `${DIM}    ${c.nom} : ${c.portee === "projet" ? c.fichier : `$${c.home ?? "HOME"}/${c.fichier}`}${RESET}\n`,
            ).join("") +
            `\n  Le geste qui vaut pour TOUS — dans le shell d'où tu lances l'agent :\n\n` +
            `  ${BOLD}export ${MCP_TOKEN_ENV}=${jeton}${RESET}\n\n`,
        );
      }
      w(
        `${DIM}  Vibe et Codex prennent le NOM de la variable, pas le secret — ` +
          `déclare la porte une fois :${RESET}\n\n` +
          `  ${DIM}vibe mcp add nodefony --transport streamable-http \\${RESET}\n` +
          `  ${DIM}  --url ${resource} --api-key-env ${MCP_TOKEN_ENV}${RESET}\n` +
          `  ${DIM}codex mcp add nodefony --url ${resource} \\${RESET}\n` +
          `  ${DIM}  --bearer-token-env-var ${MCP_TOKEN_ENV}${RESET}\n\n`,
      );
      return this;
    }

    w(`  export ${MCP_TOKEN_ENV}=${jeton}\n\n`);
    w(
      `${DIM}  --write pose la valeur dans .env.local · nodefony ai:mcp --auth câble .mcp.json${RESET}\n\n`,
    );
    return this;
  }
}

export default SecurityToken;
