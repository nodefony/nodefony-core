/**
 * Les agents de développement, et ce que Nodefony sait faire pour eux.
 *
 * Deux gestes distincts vivent ici, et il ne faut pas les confondre :
 *
 *  1. **poser le SECRET** là où l'agent lit ses variables (`security:token`) ;
 *  2. **déclarer la PORTE** — l'URL du serveur MCP — dans sa configuration
 *     (`ai:mcp --agent`).
 *
 * La frontière est celle-ci : **Nodefony possède le jeton et l'URL, l'agent
 * possède le format de sa déclaration.** On n'écrit donc jamais le fichier de
 * configuration d'un outil tiers pour la déclaration : on appelle SA CLI, qui
 * est la seule à savoir ce qu'elle attend et à survivre à ses propres versions.
 * Le secret, lui, se pose bien dans un fichier — parce qu'aucune de ces CLI
 * n'offre de le faire, et parce que l'emplacement a été CONSTATÉ, agent par
 * agent.
 *
 * Ce fichier vit dans le CŒUR et non dans `@nodefony/security` : `ai:mcp` et
 * `create app` sont des commandes du cœur, et une table recopiée à deux
 * endroits diverge en silence.
 */

import path from "node:path";
import { homedir } from "node:os";
import { MCP_SERVER_KEY, MCP_TOKEN_ENV, MCP_CONFIG_FILE } from "./aiMcpReport";

/**
 * Comment la porte MCP se déclare chez un agent.
 *
 * `fichier-projet` : l'agent lit lui-même le `.mcp.json` que `ai:mcp` écrit —
 * il n'y a rien de plus à faire, et le refaire par sa CLI créerait une SECONDE
 * déclaration, dans une autre portée, que plus rien ne tiendrait à jour.
 *
 * `cli` : l'agent ignore `.mcp.json` (constaté) et tient sa propre
 * configuration — on lui parle par sa ligne de commande.
 */
export type VoieDeclaration = "fichier-projet" | "cli";

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
export interface IAgentTarget {
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
  /** Par quelle voie sa configuration apprend l'existence de la porte MCP. */
  declaration: VoieDeclaration;
  /** Exécutable de sa CLI — présent si et seulement si `declaration === "cli"`. */
  bin?: string;
  /**
   * Arguments qui DÉCLARENT la porte, hors nom de l'exécutable.
   *
   * Rendus par une fonction plutôt que par un gabarit à trous : les quatre
   * grammaires ne se ressemblent pas (positionnel chez l'un, `--url` chez
   * l'autre, valeur de l'en-tête ici, NOM de la variable là), et un gabarit
   * commun les aurait déformées toutes les quatre.
   */
  argvAjout?: (ctx: IDeclarationContexte) => string[];
  /** Arguments qui RETIRENT la déclaration. */
  argvRetrait?: () => string[];
  /**
   * Arguments qui LISTENT les serveurs déclarés, quand la CLI sait le faire.
   *
   * 🔴 Elle existe parce qu'un code de sortie ne prouve rien. Mesuré ici :
   * `gemini mcp remove nodefony` répond « not found in project settings »,
   * **sort en 0**, et laisse l'entrée que `gemini mcp add` venait d'écrire.
   * Sans ce second regard, notre commande annonçait « déclaration retirée »
   * sur une déclaration toujours en place — un mensonge qu'on ne découvre
   * qu'en cherchant ailleurs.
   *
   * Absente chez un agent qui n'offre pas de lecture : on ne prétend alors
   * rien, plutôt que de deviner.
   */
  argvListe?: () => string[];
  /**
   * Ce qu'il reste à faire APRÈS une déclaration réussie, quand l'agent pose
   * une condition de son cru.
   *
   * ⭐ Elle existe pour un cas CONSTATÉ : Gemini accepte la déclaration, la
   * liste — et l'affiche `Disabled`, parce que le dossier n'est pas « de
   * confiance » chez lui. Sans cette phrase, on obtient un succès annoncé suivi
   * d'un outil qui n'apparaît nulle part : le pire retour possible, et une
   * heure passée à soupçonner le jeton.
   */
  noteApres?: string;
}

/** Ce qu'il faut savoir pour composer la déclaration chez un agent. */
export interface IDeclarationContexte {
  /** URL absolue de la porte MCP (`http://localhost:5151/nodefony/mcp`). */
  url: string;
  /** Nom sous lequel le serveur est déclaré. */
  nom: string;
  /** Nom de la variable qui porte le jeton — jamais le jeton lui-même. */
  tokenEnv: string;
}

/**
 * Agents dont l'emplacement de secret a été CONSTATÉ — au comportement ou au
 * source, jamais sur la foi d'une page de blog.
 *
 * Deux stratégies pour le SECRET, et elles ne se ressemblent pas :
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
 *
 * ## Pourquoi certains sont déclarés LOCALEMENT et d'autres non
 *
 * ⚠️ **Deux questions distinctes, et les confondre mène à la faute** : ce que
 * l'agent LIT, et ce que sa CLI ÉCRIT. Les quatre savent lire une configuration
 * de projet ; deux d'entre eux ne savent pas en écrire une.
 *
 * | agent  | lit le projet                        | sa CLI y écrit           |
 * | ------ | ------------------------------------ | ------------------------ |
 * | claude | `.mcp.json`                          | oui                      |
 * | gemini | `.gemini/settings.json`              | oui (`--scope project`)  |
 * | codex  | `.codex/config.toml` **si de confiance** | non — « Added global » |
 * | vibe   | `.vibe/config.toml` **si de confiance**  | non (`persist_allowed`) |
 *
 * Pour Codex et Vibe, la portée projet EXISTE mais leur ligne de commande ne
 * l'écrit pas : `codex mcp add` répond « Added **global** MCP server », et le
 * source de Vibe subordonne l'écriture à la source « user »
 * (`persist_allowed`). Y déposer nous-mêmes un TOML serait écrire le format
 * d'un tiers — précisément ce que ce fichier existe pour éviter — et ce fichier
 * ne serait lu que si l'utilisateur a déclaré le dépôt DE CONFIANCE dans son
 * agent, un geste de sécurité qui lui appartient et que Nodefony ne peut pas
 * poser à sa place.
 *
 * On passe donc par leur CLI, donc en global, et la commande l'ANNONCE : deux
 * applications Nodefony sur un poste se disputent sinon le même nom de serveur,
 * et la seconde efface la première sans un mot.
 *
 * ⚠️ Le premier état de ce commentaire affirmait que Codex « n'a aucune notion
 * de projet ». C'était FAUX, et la sonde qui l'avait « prouvé » ne l'était pas :
 * elle tournait dans un dépôt NON approuvé, donc elle mesurait la confiance, pas
 * la portée. Le binaire le dit lui-même — « Project `.codex/config.toml`:
 * settings for a trusted repository, including [...] MCP ». Une absence de trace
 * n'est pas une preuve, et une sonde doit être discriminante SUR LA BONNE
 * VARIABLE.
 *
 * Et pour la DÉCLARATION de la porte, le partage est net, lui aussi constaté :
 * **seul Claude Code lit le `.mcp.json` du projet**. Gemini a été mesuré
 * l'ignorant — `.mcp.json` déclarant `nodefony` sur le disque, `gemini mcp list`
 * répond « No MCP servers configured ». Les trois autres reçoivent donc leur
 * déclaration par leur propre CLI, dans la grammaire lue de leur `--help`.
 */
export const AGENT_TARGETS: readonly IAgentTarget[] = [
  {
    cle: "claude",
    nom: "Claude Code",
    portee: "projet",
    marqueur: ".claude",
    fichier: ".claude/settings.local.json",
    forme: "json-env",
    // Il lit le `.mcp.json` du projet — celui que cette commande vient
    // d'écrire. `claude mcp add` poserait une seconde entrée en portée
    // « local » (`~/.claude.json`), invisible dans le dépôt et jamais
    // rafraîchie : deux déclarations pour une porte, dont une qui ment.
    declaration: "fichier-projet",
  },
  {
    cle: "gemini",
    nom: "Gemini CLI",
    portee: "projet",
    marqueur: ".gemini",
    fichier: ".gemini/.env",
    forme: "dotenv",
    declaration: "cli",
    bin: "gemini",
    // `--scope project` écrit dans `.gemini/settings.json`, à côté du `.env` où
    // le jeton est posé : la porte et sa clé restent dans le même projet.
    argvAjout: (c) => [
      "mcp",
      "add",
      c.nom,
      c.url,
      "--transport",
      "http",
      "--scope",
      "project",
      "--header",
      // La chaîne part LITTÉRALE : `spawn` n'ouvre pas de shell, donc
      // `${VAR}` arrive tel quel et c'est Gemini qui le résout à la lecture.
      // L'écrire développé graverait le jeton dans un fichier de projet.
      `Authorization: Bearer \${${c.tokenEnv}}`,
    ],
    argvRetrait: () => ["mcp", "remove", MCP_SERVER_KEY, "--scope", "project"],
    argvListe: () => ["mcp", "list"],
    // Constaté : après une déclaration parfaitement acceptée, `gemini mcp list`
    // rend « Disabled » et l'avertissement « this folder is untrusted ».
    noteApres:
      "Gemini n'active un serveur que dans un dossier de CONFIANCE — sinon il " +
      "reste « Disabled ». Accorde la confiance au premier lancement, ou " +
      "`gemini --skip-trust` le temps d'une session.",
  },
  {
    cle: "vibe",
    nom: "Vibe (Mistral)",
    portee: "utilisateur",
    marqueur: ".vibe",
    fichier: ".env",
    forme: "dotenv",
    home: "VIBE_HOME",
    declaration: "cli",
    bin: "vibe",
    noteApres:
      "Déclaration GLOBALE : sa CLI n'écrit que la configuration utilisateur. " +
      "Vibe SAIT lire `<projet>/.vibe/config.toml`, mais seulement dans un " +
      "dossier qu'il tient pour de confiance — à toi de l'y porter si tu veux " +
      "cloisonner par projet.",
    // Il prend le NOM de la variable, pas sa valeur : le secret ne transite ni
    // par la ligne de commande (visible dans `ps`) ni par sa configuration.
    argvAjout: (c) => [
      "mcp",
      "add",
      c.nom,
      "--transport",
      "streamable-http",
      "--url",
      c.url,
      "--api-key-env",
      c.tokenEnv,
    ],
    argvRetrait: () => ["mcp", "remove", MCP_SERVER_KEY],
  },
  {
    cle: "codex",
    nom: "Codex",
    portee: "utilisateur",
    marqueur: ".codex",
    fichier: ".env",
    forme: "dotenv",
    home: "CODEX_HOME",
    declaration: "cli",
    bin: "codex",
    noteApres:
      "Déclaration GLOBALE : `codex mcp add` répond « Added global MCP " +
      "server », il n'a pas de portée projet en écriture. Codex SAIT lire " +
      "`<projet>/.codex/config.toml`, mais seulement dans un dépôt de " +
      "CONFIANCE — à toi de l'approuver si tu veux cloisonner par projet.",
    argvAjout: (c) => [
      "mcp",
      "add",
      c.nom,
      "--url",
      c.url,
      "--bearer-token-env-var",
      c.tokenEnv,
    ],
    argvRetrait: () => ["mcp", "remove", MCP_SERVER_KEY],
    argvListe: () => ["mcp", "list"],
  },
];

/**
 * Ce qu'il faut lancer — ou ne pas lancer — pour qu'un agent connaisse la porte.
 *
 * PURE : c'est la DÉCISION, le `spawn` n'est que de la plomberie. Rendre un plan
 * plutôt que d'exécuter permet de l'afficher tel quel quand la CLI manque, et
 * c'est ce qui fait du repli une vraie sortie et non un message d'excuse.
 */
export type IDeclarationPlan =
  | {
      voie: "fichier-projet";
      /** Le fichier qui porte DÉJÀ la déclaration — rien à lancer. */
      fichier: string;
    }
  | {
      voie: "cli";
      /** Exécutable à chercher dans le `PATH`. */
      bin: string;
      /** Ses arguments. */
      argv: string[];
    };

/**
 * Compose la déclaration de la porte MCP chez un agent.
 *
 * @param cible - l'agent visé
 * @param ctx - l'URL de la porte et le nom de la variable qui porte le jeton
 * @param retirer - `true` pour retirer la déclaration au lieu de la poser
 * @returns le plan d'exécution, jamais `null` — un agent sans CLI est un agent
 *          dont la déclaration vit déjà dans un fichier du projet
 */
export function planAgentDeclaration(
  cible: IAgentTarget,
  ctx: Pick<IDeclarationContexte, "url" | "tokenEnv">,
  retirer = false,
): IDeclarationPlan {
  if (cible.declaration === "fichier-projet" || !cible.bin) {
    return { voie: "fichier-projet", fichier: MCP_CONFIG_FILE };
  }
  const argv = retirer
    ? (cible.argvRetrait?.() ?? [])
    : (cible.argvAjout?.({ ...ctx, nom: MCP_SERVER_KEY }) ?? []);
  return { voie: "cli", bin: cible.bin, argv };
}

/**
 * Rend le plan sous la forme qu'on peut recopier dans un terminal.
 *
 * C'est le repli quand la CLI est absente : dire ce qu'il aurait fallu lancer
 * vaut mieux que constater l'absence — la commande reste juste le jour où
 * l'agent sera installé.
 *
 * @param plan - un plan de voie `cli` (les autres n'ont rien à recopier)
 */
export function renderPlanShell(plan: IDeclarationPlan): string {
  if (plan.voie !== "cli") return "";
  return [
    plan.bin,
    ...plan.argv.map((a) => (/[\s"$]/u.test(a) ? `"${a}"` : a)),
  ].join(" ");
}

/**
 * Racine où vit la configuration d'une cible : le projet, ou son dossier maison.
 *
 * PURE au sens qui compte : l'environnement et le dossier de l'utilisateur sont
 * INJECTÉS, jamais lus ici. C'est ce qui permet d'éprouver la résolution — y
 * compris la grammaire de chemins d'une autre plateforme — sans dépendre du
 * poste qui exécute le test.
 *
 * @param cible - l'agent visé
 * @param ctx - racine du projet, dossier de l'utilisateur, environnement
 */
export function racineAgent(
  cible: IAgentTarget,
  ctx: {
    projectRoot: string;
    home?: string;
    env?: Record<string, string | undefined>;
  },
): string {
  if (cible.portee === "projet") return ctx.projectRoot;
  const surcharge = cible.home
    ? (ctx.env ?? process.env)[cible.home]
    : undefined;
  return path.resolve(
    surcharge ?? path.join(ctx.home ?? homedir(), cible.marqueur),
  );
}

/**
 * Agents dont la présence est CONSTATÉE sur ce poste.
 *
 * On ne crée pas la configuration d'un outil que personne n'utilise ici : le
 * marqueur (`.claude`, `.codex`…) est la seule preuve qu'on ait, et il vaut
 * mieux qu'une déduction depuis le `PATH` — un binaire installé ne dit pas que
 * quelqu'un s'en sert dans CE projet.
 *
 * Le test d'existence est INJECTÉ : c'est ce qui permet d'éprouver la détection
 * sans dépendre du poste qui exécute le test, et de la rejouer pour une
 * arborescence qui n'existe nulle part.
 *
 * @param ctx - racine du projet, dossier de l'utilisateur, environnement, et le
 *              prédicat qui répond « ce chemin existe-t-il ? »
 */
export function agentsPresents(ctx: {
  projectRoot: string;
  home?: string;
  env?: Record<string, string | undefined>;
  existe: (chemin: string) => boolean;
}): IAgentTarget[] {
  return AGENT_TARGETS.filter((c) => {
    // 🔴 On cherche le marqueur DANS LE PROJET **et** chez l'utilisateur, quelle
    // que soit la portée d'écriture — parce que ce sont deux questions
    // distinctes que `portee` confondait : « où prouve-t-on que cet agent
    // sert ? » et « où écrit-on sa déclaration ? ».
    //
    // Le cercle que cela fermait : Gemini écrit en portée PROJET
    // (`--scope project` crée `.gemini/`), donc exiger que `.gemini/` préexiste
    // dans le projet revenait à ne proposer de configurer que ce qui l'était
    // déjà. Un utilisateur de Gemini — `~/.gemini` bien présent — ne le voyait
    // jamais dans la liste, et concluait que Nodefony ne le gérait pas.
    //
    // Élargir ne concède rien : rien n'est coché par défaut, la question est un
    // choix explicite, et un dossier d'agent chez l'utilisateur prouve qu'il
    // s'en sert — pas seulement qu'un binaire traîne dans le `PATH`.
    const dansProjet = ctx.existe(path.resolve(ctx.projectRoot, c.marqueur));
    const chezUtilisateur = ctx.existe(
      racineAgent({ ...c, portee: "utilisateur" }, ctx),
    );
    return dansProjet || chezUtilisateur;
  });
}

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
/**
 * Valeur d'une variable dans le fichier de configuration d'un agent.
 *
 * Fonction PURE — elle prend le contenu, elle rend la valeur. Elle existe pour
 * qu'on puisse RENSEIGNER sur un jeton posé (son échéance, ce qu'il autorise)
 * sans jamais le divulguer : c'est l'appelant qui décide ce qu'il en montre, et
 * ce qu'il en montre n'est pas le jeton.
 *
 * @param forme - grammaire du fichier
 * @param contenu - contenu actuel, ou chaîne vide
 * @param cle - nom de la variable
 * @returns la valeur, ou `null` si elle est absente ou vide
 */
export function litVariable(
  forme: IAgentTarget["forme"],
  contenu: string,
  cle: string,
): string | null {
  if (contenu.trim() === "") return null;
  if (forme === "dotenv") {
    const trouve = new RegExp(`^\\s*${cle}\\s*=\\s*(.*)$`, "m").exec(contenu);
    if (!trouve?.[1]) return null;
    // Les guillemets sont une convention d'écriture, pas une part de la valeur.
    const brut = trouve[1].trim().replace(/^["']|["']$/gu, "");
    return brut === "" ? null : brut;
  }
  try {
    const doc = JSON.parse(contenu) as { env?: Record<string, unknown> };
    const valeur = doc.env?.[cle];
    return typeof valeur === "string" && valeur !== "" ? valeur : null;
  } catch {
    return null;
  }
}

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
 * Trois formes : rien (les cibles détectées, décidé par l'appelant), `none`
 * (aucune écriture), ou une liste de clés. Une clé inconnue est REFUSÉE en
 * nommant celles qui existent — ignorée en silence, elle ferait croire à un
 * agent servi qui ne l'est pas, et c'est exactement ce genre de silence qui a
 * déjà coûté une heure de diagnostic ici.
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

/** Ré-export de commodité — la table et la variable vont toujours ensemble. */
export { MCP_TOKEN_ENV };
