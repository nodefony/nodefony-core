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
  key: string;
  /** Nom affiché. */
  name: string;
  /**
   * Où vit sa configuration : dans le PROJET, ou dans le dossier de
   * l'utilisateur. La distinction commande la garde appliquée — un fichier de
   * projet peut se retrouver commité, celui de l'utilisateur non.
   */
  scope: "projet" | "utilisateur";
  /** Ce dont la présence prouve que l'agent est utilisé — résolu selon `scope`. */
  marker: string;
  /** Fichier à écrire — relatif au projet, ou au dossier de l'agent. */
  file: string;
  /** Grammaire du fichier. */
  forme: "json-env" | "dotenv";
  /**
   * Variable qui déplace le dossier de l'agent — `VIBE_HOME`, `CODEX_HOME`.
   *
   * Elle sert DEUX fois. À la lecture, elle dit où l'agent tient ses variables
   * quand l'utilisateur l'a déplacé. À l'écriture, elle est ce qui donne une
   * portée PROJET à une CLI qui n'en offre pas : pointée sur
   * `<projet>/<marker>`, la commande de l'agent écrit son propre format dans
   * le projet au lieu du foyer. Sa présence vaut donc capacité — un agent qui
   * la porte peut être déclaré par projet ; les autres ne le peuvent pas.
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
  argvAdd?: (ctx: IDeclarationContext) => string[];
  /** Arguments qui RETIRENT la déclaration. */
  argvRemove?: () => string[];
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
  argvList?: () => string[];
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
  noteAfter?: string;
  /**
   * Le fichier d'instructions que cet agent lit **d'office**, et s'il s'agit
   * d'`AGENTS.md` lui-même.
   *
   * ⭐ **Pourquoi cette colonne existe** : `AGENTS.md` est le standard — porté
   * par l'**Agentic AI Foundation** (Linux Foundation), règle de précédence
   * « le plus proche gagne ». Mais tous les agents ne le lisent pas : deux
   * d'entre eux ouvrent un fichier À LEUR NOM et ne verront JAMAIS l'`AGENTS.md`
   * d'une application, si bien qu'ils travaillent sans aucune instruction sans
   * que rien ne le signale. Un POINTEUR à leur nom ferme le trou sans dupliquer
   * la matière : un fichier à NOUS, dans notre projet — on ne touche pas à la
   * configuration d'un outil tiers (même règle que la déclaration MCP, qui
   * passe par SA CLI).
   *
   * `proof` ancre le fait dans le SOURCE de l'agent, pas dans sa
   * documentation : c'est elle qui se re-vérifie le jour où l'un d'eux change
   * d'avis, et la doc de l'un d'eux dit déjà autre chose que son code.
   */
  instructions: {
    /** Nom du fichier lu d'office (relatif à la racine du projet). */
    file: string;
    /** `true` quand ce fichier EST `AGENTS.md` — rien à poser. */
    natif: boolean;
    /** Où le constater dans le source de l'agent (ou la mesure qui l'a établi). */
    proof: string;
  };
}

/** Ce qu'il faut savoir pour composer la déclaration chez un agent. */
export interface IDeclarationContext {
  /** URL absolue de la porte MCP (`http://localhost:5151/nodefony/mcp`). */
  url: string;
  /** Nom sous lequel le serveur est déclaré. */
  name: string;
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
 * de projet, et les quatre y écrivent — deux d'entre eux seulement à condition
 * qu'on déplace leur dossier.
 *
 * | agent  | lit le projet                            | comment sa CLI y écrit    |
 * | ------ | ---------------------------------------- | ------------------------- |
 * | claude | `.mcp.json`                              | on écrit le fichier       |
 * | gemini | `.gemini/settings.json`                  | `--scope project`         |
 * | codex  | `.codex/config.toml` **si de confiance** | `CODEX_HOME=<projet>/.codex` |
 * | vibe   | `.vibe/config.toml` **si de confiance**  | `VIBE_HOME=<projet>/.vibe`   |
 *
 * Pour Codex et Vibe, la portée projet EXISTE mais leur ligne de commande n'a
 * pas d'option pour la viser : `codex mcp add` répond « Added **global** MCP
 * server », et le source de Vibe subordonne l'écriture à la source « user »
 * (`persist_allowed`).
 *
 * ⭐ **La sortie n'est ni de renoncer, ni d'écrire leur TOML nous-mêmes** — ce
 * serait reprendre à notre compte le format d'un tiers, précisément ce que ce
 * fichier existe pour éviter. Les deux obéissent à une variable qui déplace
 * leur dossier (`VIBE_HOME`, `CODEX_HOME`) : pointée sur `<projet>/<marker>`,
 * c'est LEUR binaire qui écrit LEUR format, dans le PROJET. Vérifié au disque
 * pour les deux, ligne d'authentification comprise.
 *
 * Et il le fallait, parce que le global est FAUX ici, pas seulement intrusif :
 * l'URL d'une porte porte un PORT, et deux applications Nodefony n'écoutent pas
 * sur le même. Une déclaration dans le foyer ne peut donc en désigner qu'UNE —
 * la dernière câblée efface la précédente sans un mot. L'annoncer, comme on le
 * faisait, ne répare rien.
 *
 * Ce qui reste vrai, et que la commande DIT : ces fichiers ne sont lus que dans
 * un dossier que l'agent tient pour DE CONFIANCE — un geste de sécurité qui
 * appartient à l'utilisateur. Un fichier non lu est inerte ; une déclaration
 * globale qui pointe la mauvaise application est active. Entre échouer en
 * silence et réussir à côté, on choisit le premier. `--global` reste offert à
 * qui veut délibérément l'autre.
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
    key: "claude",
    name: "Claude Code",
    scope: "projet",
    marker: ".claude",
    file: ".claude/settings.local.json",
    forme: "json-env",
    instructions: {
      file: "CLAUDE.md",
      natif: false,
      // Mesuré sur le binaire 2.1.240, outils de lecture COUPÉS : un projet
      // n'ayant qu'un `AGENTS.md` rend « INCONNU », le même projet avec un
      // `CLAUDE.md` restitue son contenu. Son propre binaire porte pourtant la
      // phrase « Claude Code hardcodes CLAUDE.md / AGENTS.md discovery » — elle
      // parle des noms non configurables, pas de deux fichiers lus.
      proof: "mesure : CLAUDE.md chargé, AGENTS.md seul ignoré (2.1.240)",
    },
    // Il lit le `.mcp.json` du projet — celui que cette commande vient
    // d'écrire. `claude mcp add` poserait une seconde entrée en portée
    // « local » (`~/.claude.json`), invisible dans le dépôt et jamais
    // rafraîchie : deux déclarations pour une porte, dont une qui ment.
    declaration: "fichier-projet",
  },
  {
    key: "gemini",
    name: "Gemini CLI",
    scope: "projet",
    marker: ".gemini",
    file: ".gemini/.env",
    forme: "dotenv",
    instructions: {
      file: "GEMINI.md",
      natif: false,
      // `DEFAULT_CONTEXT_FILENAME = 'GEMINI.md'`. Le nom est configurable
      // (`context.fileName`, qui accepte un TABLEAU), mais cela vit dans SA
      // configuration : on pose un pointeur à nous plutôt que d'y écrire.
      proof:
        "gemini-cli packages/core/src/tools/memoryTool.ts (DEFAULT_CONTEXT_FILENAME)",
    },
    declaration: "cli",
    bin: "gemini",
    // `--scope project` écrit dans `.gemini/settings.json`, à côté du `.env` où
    // le jeton est posé : la porte et sa clé restent dans le même projet.
    argvAdd: (c) => [
      "mcp",
      "add",
      c.name,
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
    argvRemove: () => ["mcp", "remove", MCP_SERVER_KEY, "--scope", "project"],
    argvList: () => ["mcp", "list"],
    // Constaté : après une déclaration parfaitement acceptée, `gemini mcp list`
    // rend « Disabled » et l'avertissement « this folder is untrusted ».
    noteAfter:
      "Gemini n'active un serveur que dans un dossier de CONFIANCE — sinon il " +
      "reste « Disabled ». Accorde la confiance au premier lancement, ou " +
      "`gemini --skip-trust` le temps d'une session.",
  },
  {
    key: "vibe",
    name: "Vibe (Mistral)",
    scope: "utilisateur",
    marker: ".vibe",
    file: ".env",
    forme: "dotenv",
    home: "VIBE_HOME",
    instructions: {
      file: "AGENTS.md",
      natif: true,
      proof: "mistral-vibe vibe/core/paths/conventions.py (AGENTS_MD_FILENAME)",
    },
    declaration: "cli",
    bin: "vibe",
    noteAfter:
      "Déclaration de PROJET (`.vibe/config.toml`), écrite par sa propre CLI " +
      "via `VIBE_HOME`. Vibe ne la lira que dans un dossier qu'il tient pour " +
      "de CONFIANCE : `vibe --trust` une fois, ici. `--global` la remet dans " +
      "ton foyer, où elle vaudra pour tous tes projets — donc pour un seul, " +
      "puisque l'URL porte un port.",
    // Il prend le NOM de la variable, pas sa valeur : le secret ne transite ni
    // par la ligne de commande (visible dans `ps`) ni par sa configuration.
    argvAdd: (c) => [
      "mcp",
      "add",
      c.name,
      "--transport",
      "streamable-http",
      "--url",
      c.url,
      "--api-key-env",
      c.tokenEnv,
    ],
    argvRemove: () => ["mcp", "remove", MCP_SERVER_KEY],
  },
  {
    key: "codex",
    name: "Codex",
    scope: "utilisateur",
    marker: ".codex",
    file: ".env",
    forme: "dotenv",
    home: "CODEX_HOME",
    instructions: {
      file: "AGENTS.md",
      natif: true,
      // `DEFAULT_AGENTS_MD_FILENAME` + `AGENTS.override.md` en surcharge locale.
      proof:
        "codex codex-rs/core/src/agents_md.rs (DEFAULT_AGENTS_MD_FILENAME)",
    },
    declaration: "cli",
    bin: "codex",
    noteAfter:
      "Déclaration de PROJET (`.codex/config.toml`), écrite par sa propre CLI " +
      "via `CODEX_HOME` — il répond « Added global », mot qui parle de SON " +
      "dossier, pas du tien. Codex ne la lira que dans un dépôt de CONFIANCE " +
      "(`trust_level`). `--global` la remet dans ton foyer.",
    argvAdd: (c) => [
      "mcp",
      "add",
      c.name,
      "--url",
      c.url,
      "--bearer-token-env-var",
      c.tokenEnv,
    ],
    argvRemove: () => ["mcp", "remove", MCP_SERVER_KEY],
    argvList: () => ["mcp", "list"],
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
      file: string;
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
 * @param target - l'agent visé
 * @param ctx - l'URL de la porte et le nom de la variable qui porte le jeton
 * @param remove - `true` pour retirer la déclaration au lieu de la poser
 * @returns le plan d'exécution, jamais `null` — un agent sans CLI est un agent
 *          dont la déclaration vit déjà dans un fichier du projet
 */
export function planAgentDeclaration(
  target: IAgentTarget,
  ctx: Pick<IDeclarationContext, "url" | "tokenEnv">,
  remove = false,
): IDeclarationPlan {
  if (target.declaration === "fichier-projet" || !target.bin) {
    return { voie: "fichier-projet", file: MCP_CONFIG_FILE };
  }
  const argv = remove
    ? (target.argvRemove?.() ?? [])
    : (target.argvAdd?.({ ...ctx, name: MCP_SERVER_KEY }) ?? []);
  return { voie: "cli", bin: target.bin, argv };
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
 * @param target - l'agent visé
 * @param ctx - racine du projet, dossier de l'utilisateur, environnement
 */
export function agentRoot(
  target: IAgentTarget,
  ctx: {
    projectRoot: string;
    home?: string;
    env?: Record<string, string | undefined>;
  },
): string {
  if (target.scope === "projet") return ctx.projectRoot;
  const surcharge = target.home
    ? (ctx.env ?? process.env)[target.home]
    : undefined;
  return path.resolve(
    surcharge ?? path.join(ctx.home ?? homedir(), target.marker),
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
  exists: (filePath: string) => boolean;
}): IAgentTarget[] {
  return AGENT_TARGETS.filter((c) => {
    // 🔴 On cherche le marqueur DANS LE PROJET **et** chez l'utilisateur, quelle
    // que soit la portée d'écriture — parce que ce sont deux questions
    // distinctes que `scope` confondait : « où prouve-t-on que cet agent
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
    const inProject = ctx.exists(path.resolve(ctx.projectRoot, c.marker));
    const inUserHome = ctx.exists(
      agentRoot({ ...c, scope: "utilisateur" }, ctx),
    );
    return inProject || inUserHome;
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
/**
 * La chaîne sans ses sauts de ligne FINAUX — sans expression régulière.
 *
 * `/\n*$/` a l'air anodin et coûte du temps quadratique : sur une queue de
 * sauts de ligne, le moteur réessaie depuis chaque position. Une boucle qui
 * recule dit la même chose en un seul passage, et se lit mieux.
 *
 * `trimEnd()` ne convient pas : il emporterait aussi espaces et tabulations,
 * alors qu'on ne veut normaliser QUE la fin de ligne avant d'ajouter la nôtre.
 */
function withoutTrailingNewlines(text: string): string {
  let fin = text.length;
  while (fin > 0 && text.charCodeAt(fin - 1) === 10) fin -= 1;
  return text.slice(0, fin);
}

export function poseVariable(
  forme: IAgentTarget["forme"],
  current: string,
  key: string,
  value: string,
): string | Error {
  if (forme === "dotenv") {
    const line = `${key}=${value}`;
    const pattern = new RegExp(`^\\s*${key}\\s*=.*$`, "m");
    if (pattern.test(current)) return current.replace(pattern, line);
    return current.length === 0
      ? `${line}\n`
      : `${withoutTrailingNewlines(current)}\n${line}\n`;
  }
  let doc: Record<string, unknown>;
  try {
    doc =
      current.trim() === ""
        ? {}
        : (JSON.parse(current) as Record<string, unknown>);
  } catch {
    // Un fichier corrompu ne se réécrit pas en silence : il porte les réglages
    // de quelqu'un, et les remplacer par les nôtres serait pire que ne rien faire.
    return new Error("le fichier existe mais n'est pas du JSON valide");
  }
  const env = (doc.env ?? {}) as Record<string, unknown>;
  env[key] = value;
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
 * @param content - contenu actuel, ou chaîne vide
 * @param key - nom de la variable
 * @returns la valeur, ou `null` si elle est absente ou vide
 */
export function litVariable(
  forme: IAgentTarget["forme"],
  content: string,
  key: string,
): string | null {
  if (content.trim() === "") return null;
  if (forme === "dotenv") {
    const found = new RegExp(`^\\s*${key}\\s*=\\s*(.*)$`, "m").exec(content);
    if (!found?.[1]) return null;
    // Les guillemets sont une convention d'écriture, pas une part de la valeur.
    const brut = found[1].trim().replace(/^["']|["']$/gu, "");
    return brut === "" ? null : brut;
  }
  try {
    const doc = JSON.parse(content) as { env?: Record<string, unknown> };
    const value = doc.env?.[key];
    return typeof value === "string" && value !== "" ? value : null;
  } catch {
    return null;
  }
}

export function alreadyHasKey(
  forme: IAgentTarget["forme"],
  content: string,
  key: string,
): boolean {
  if (content.trim() === "") return false;
  if (forme === "dotenv") {
    return new RegExp(`^\\s*${key}\\s*=`, "m").test(content);
  }
  try {
    const doc = JSON.parse(content) as { env?: Record<string, unknown> };
    return typeof doc.env?.[key] === "string" && doc.env[key] !== "";
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
export function requestedAgents(
  raw: string | undefined,
): readonly IAgentTarget[] | undefined | Error {
  if (raw === undefined) return undefined;
  const keys = raw
    .split(/[\s,]+/u)
    .map((c) => c.trim().toLowerCase())
    .filter(Boolean);
  if (keys.length === 1 && keys[0] === "none") return [];
  if (keys.length === 1 && keys[0] === "all") return AGENT_TARGETS;
  const known = AGENT_TARGETS.map((c) => c.key);
  const unknown = keys.filter((c) => !known.includes(c));
  if (unknown.length > 0) {
    return new Error(
      `--agent : « ${unknown.join(", ")} » inconnu — attendus : ` +
        `${known.join(", ")}, all, none`,
    );
  }
  return AGENT_TARGETS.filter((c) => keys.includes(c.key));
}

/**
 * Les fichiers-POINTEURS à poser pour qu'aucun agent ne travaille aveugle.
 *
 * PURE, dérivée de {@link AGENT_TARGETS} : un agent qui lit déjà `AGENTS.md`
 * n'a besoin de rien, les autres reçoivent un fichier à LEUR nom qui renvoie
 * au standard. Deux agents qui liraient le même nom sont regroupés — le
 * pointeur est écrit une fois et les nomme tous les deux.
 *
 * 🔴 **Le filtrage n'est pas un confort.** Sans `keys`, cette fonction rendait
 * TOUS les pointeurs, et une application créée en répondant « Claude » naissait
 * avec un `GEMINI.md` que personne n'avait demandé. Rapporté tel quel :
 * « j'ai demandé un agent claude, je me retrouve avec un GEMINI.md ». Poser
 * chez quelqu'un le fichier d'un outil qu'il n'utilise pas n'est pas une
 * prévenance : c'est du bruit dans SON dépôt, qu'il devra expliquer à son
 * équipe. L'agent qui arrive plus tard reçoit son pointeur au moment où on le
 * câble (`nodefony ai:mcp --agent <clé>`), c'est-à-dire quand il entre
 * réellement dans le projet.
 *
 * @param keys - clés d'agents retenues. **Obligatoire** : rendre tous les
 *   pointeurs par défaut est précisément le défaut corrigé. Une liste vide ne
 *   rend rien — coder seul est un choix.
 * @returns un couple `file` → agents concernés, trié par nom de fichier.
 */
export function pointeursInstructions(keys: readonly string[]): readonly {
  file: string;
  agents: readonly string[];
}[] {
  const kept = new Set(keys);
  const par = new Map<string, string[]>();
  for (const target of AGENT_TARGETS) {
    if (target.instructions.natif) continue;
    if (!kept.has(target.key)) continue;
    const already = par.get(target.instructions.file);
    if (already) already.push(target.name);
    else par.set(target.instructions.file, [target.name]);
  }
  return [...par.entries()]
    .map(([file, agents]) => ({ file: file, agents }))
    .sort((a, b) => a.file.localeCompare(b.file));
}

/** Ré-export de commodité — la table et la variable vont toujours ensemble. */
export { MCP_TOKEN_ENV };
