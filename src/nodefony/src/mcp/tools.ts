import {
  INSPECT_SUBJECTS,
  readAdminSubject,
  type IAdminBrokerLike,
} from "../kernel/inspect/adminSubjects";
import { readSymbolsGraph, lookupSymbol } from "../cli/symbols";
import {
  collectCheckReport,
  countCheckFindings,
} from "../kernel/checks/runCheck";
import type {
  IMcpTool,
  IMcpToolDefinition,
  IMcpToolResult,
  IMcpCaller,
} from "../types/IMcpTool";

export type { IMcpTool, IMcpToolDefinition, IMcpToolResult, IMcpCaller };

/**
 * Outils MCP : le **catalogue intégré** du framework, et la **collecte** de ceux
 * qu'une application déclare.
 *
 * ⚠️ **Rien n'est calculé ici.** Chaque outil intégré traduit un appel JSON-RPC
 * vers une brique qui répond DÉJÀ à une autre porte : `inspect` lit le plan
 * d'administration par {@link readAdminSubject} (la même fonction que la
 * commande `nodefony inspect`), `check` appelle {@link collectCheckReport} (la
 * même que `nodefony check`). Une source, plusieurs portes — un outil qui
 * recalculerait sa réponse finirait par contredire la commande, et c'est lui
 * qu'on croirait sur parole.
 *
 * ⭐ **La description d'un outil est le premier critère de son déclenchement.**
 * Un modèle n'appelle pas ce qu'il ne comprend pas : le POC de 2026-05 l'a payé
 * cash — un outil à description neutre n'a jamais été appelé, un skill
 * auto-déclenché prenait la main à chaque fois. Ces descriptions disent donc ce
 * que l'outil rend ET quand s'en servir, pas seulement son nom.
 *
 * ## Pourquoi la collecte, et pas un registre
 *
 * Un module déclare ses outils par {@link IModule.getMcpTools} ; ils sont
 * ramassés **au moment de servir la requête**, jamais stockés. C'est
 * délibérément l'inverse du data plane admin ({@link IAdminRegistry}), qui a
 * besoin d'un registre parce qu'il monte des ROUTES au boot et qu'un module
 * arrivé trop tard n'aurait plus rien à monter. Un outil MCP n'a rien à monter :
 * il est lu à la demande. D'où trois propriétés gagnées gratuitement — aucune
 * structure allouée au démarrage (donc coût nul en production, où aucune porte
 * MCP n'existe), aucun ordre de `register()` à respecter, et une fraîcheur qui
 * est une propriété du mécanisme plutôt qu'une discipline à tenir.
 */

/**
 * Rend un résultat d'outil — les données partent en JSON indenté, lisible.
 *
 * Exporté parce qu'une application qui déclare un outil en a besoin : sans lui,
 * chacune réinventerait l'enveloppe `content[]`, et une enveloppe mal formée
 * n'échoue pas — elle rend un résultat vide que l'agent prend pour une réponse.
 *
 * @param value - donnée à rendre (sérialisée si ce n'est pas déjà du texte)
 * @param isError - marque un échec MÉTIER (pas une faute de protocole)
 */
export function mcpText(value: unknown, isError = false): IMcpToolResult {
  const rendered =
    typeof value === "string" ? value : JSON.stringify(value, null, 2);
  return isError
    ? { content: [{ type: "text", text: rendered }], isError: true }
    : { content: [{ type: "text", text: rendered }] };
}

/** Ce dont les outils INTÉGRÉS ont besoin — injecté, jamais lu ici. */
export interface IMcpToolDeps {
  /** Le service `adminBroker` du conteneur, ou `undefined` s'il manque. */
  broker: IAdminBrokerLike | undefined;
  /** Compose la carte de visite de l'application. */
  getCard: () => unknown;
  /**
   * Racine depuis laquelle lire le disque (graphe symbolique, diagnostic).
   *
   * Injectée plutôt que lue par `process.cwd()` : le serveur répond dans le
   * process de l'application, dont le dossier courant n'est pas garanti être
   * celui du projet — et un outil qui diagnostiquerait le mauvais dossier
   * conclurait « rien à signaler » avec aplomb.
   */
  projectRoot: string;
}

/** Préfixe des noms d'outils intégrés — un agent voit à qui il parle. */
const PREFIX = "nodefony_";

/**
 * Forme admise pour un nom d'outil.
 *
 * Ce nom ne reste pas dans le serveur : il voyage jusque dans le contexte du
 * modèle, et sert d'identifiant d'appel. Un nom porteur d'espace, de guillemet
 * ou de saut de ligne ne provoque pas d'erreur — il produit des appels que rien
 * ne résout, ce qui est bien pire à diagnostiquer. La borne haute est du même
 * ordre : un nom de 4 000 caractères passerait, et mangerait le contexte.
 */
const NAME_PATTERN = /^[a-zA-Z0-9_-]{1,64}$/;

/**
 * Clés des outils intégrés — ce que l'allowlist de configuration nomme.
 *
 * Publiée pour qu'un schéma de configuration puisse la valider au lieu de la
 * retaper : une clé inconnue en config est silencieusement sans effet, et
 * l'utilisateur croit avoir activé quelque chose.
 */
export const BUILTIN_MCP_TOOL_KEYS = [
  "inspect",
  "card",
  "check",
  "symbols",
] as const;

/** Clé d'un outil intégré. */
export type BuiltinMcpToolKey = (typeof BUILTIN_MCP_TOOL_KEYS)[number];

/**
 * Liste des sujets, rendue lisible pour la description de l'outil.
 *
 * Dérivée de {@link INSPECT_SUBJECTS} : ajouter un sujet au cœur le publie ici
 * sans rien réécrire, et il ne peut pas exister de sujet annoncé qu'on ne
 * saurait pas lire.
 */
function subjectLines(): string {
  return Object.entries(INSPECT_SUBJECTS)
    .map(([key, spec]) => `- \`${key}\` : ${spec.summary}`)
    .join("\n");
}

/**
 * Catalogue intégré du framework, indexé par clé d'allowlist.
 *
 * Chaque handler capture ses dépendances par fermeture : c'est ce qui permet à
 * ces quatre outils d'être des {@link IMcpTool} ordinaires, du même type que
 * ceux d'une application — le serveur n'a plus aucun cas particulier à traiter.
 *
 * @param deps - briques qui répondent réellement
 */
export function builtinMcpTools(
  deps: IMcpToolDeps,
): Record<BuiltinMcpToolKey, IMcpTool> {
  return {
    inspect: {
      name: `${PREFIX}inspect`,
      description:
        "Lit l'état RÉEL de cette application Nodefony : les routes réellement " +
        "montées, les modules chargés, les services enregistrés, la " +
        "configuration effective et la provenance de chaque valeur, les stores " +
        "de données, les entités de l'ORM. À utiliser avant d'écrire du code " +
        "qui suppose une route, un service ou une clé de configuration — la " +
        "réponse vient de l'application qui tourne, pas d'une lecture des " +
        "sources, donc elle ne peut pas se tromper sur ce qui est chargé.\n\n" +
        `Sujets disponibles :\n${subjectLines()}`,
      inputSchema: {
        type: "object",
        properties: {
          subject: {
            type: "string",
            enum: Object.keys(INSPECT_SUBJECTS),
            description: "Ce qu'on veut voir",
          },
          target: {
            type: "string",
            description:
              "Paramètre du sujet, quand il en attend un (ex. le nom d'un module pour `module`)",
          },
        },
        required: ["subject"],
      },
      handler: async (args) => {
        const subject = typeof args.subject === "string" ? args.subject : "";
        const target =
          typeof args.target === "string" ? args.target : undefined;
        const read = await readAdminSubject(deps.broker, subject, target);
        return read.ok ? mcpText(read.data) : mcpText(read.message, true);
      },
    },

    card: {
      name: `${PREFIX}card`,
      description:
        "Carte de visite de l'application : son identité, les modules " +
        "chargés, où trouver la documentation, et les commandes à lancer. À " +
        "utiliser en ARRIVANT sur une application inconnue, avant toute autre " +
        "exploration — elle dit en un appel ce qu'il y a et où aller ensuite.",
      inputSchema: { type: "object", properties: {} },
      handler: () => mcpText(deps.getCard()),
    },

    check: {
      name: `${PREFIX}check`,
      description:
        "Diagnostic STATIQUE de l'application : classes écrites que rien " +
        "n'enregistre (entité, controller ou service jamais câblé), paquets " +
        "importés sans être déclarés, variables d'environnement requises " +
        "absentes, modules du manifeste non installés, ports occupés, et le " +
        "bilan du dernier démarrage. À utiliser APRÈS avoir écrit ou généré du " +
        "code, avant de conclure que c'est fini : ni la compilation ni les " +
        "tests ne voient qu'une classe n'est branchée à rien.",
      inputSchema: { type: "object", properties: {} },
      handler: async () => {
        const report = await collectCheckReport(deps.projectRoot);
        // Le VERDICT accompagne le rapport : sans lui, un agent devrait
        // recompter trois listes pour savoir s'il peut passer à la suite — et
        // c'est exactement le genre de calcul qu'on lui fait rater.
        const total = countCheckFindings(report);
        return mcpText({
          verdict: total === 0 ? "ok" : "manquements",
          total,
          ...report,
        });
      },
    },

    symbols: {
      name: `${PREFIX}symbols`,
      description:
        "Interroge le graphe symbolique du framework : ce qu'est un symbole " +
        "(classe, interface, fonction), où il est défini, ce qu'il étend ou " +
        "implémente, et la première phrase de sa documentation. À utiliser " +
        "AVANT d'ouvrir un fichier pour comprendre une API du framework — la " +
        "réponse est immédiate et vaut pour la version réellement installée. " +
        "Sans argument, rend le résumé du graphe ; avec `module`, la surface " +
        "exportée d'un paquet.",
      inputSchema: {
        type: "object",
        properties: {
          name: {
            type: "string",
            description:
              "Nom exact du symbole (ex. `AbstractCrudService`, `IKernel`)",
          },
          module: {
            type: "string",
            description:
              "Paquet dont on veut la surface exportée (ex. `@nodefony/http`)",
          },
        },
      },
      handler: (args) => {
        const graph = readSymbolsGraph(deps.projectRoot);
        if (graph === null) {
          // Dire que le graphe MANQUE, et comment le rétablir : le silence
          // laisserait croire que le symbole cherché n'existe pas.
          return mcpText(
            "aucun graphe symbolique atteignable — il est publié par le paquet " +
              "`nodefony` (node_modules/nodefony/.ai/symbols.json) et régénérable " +
              "dans ce dépôt par `npm run generate-symbols`",
            true,
          );
        }
        const wanted = typeof args.name === "string" ? args.name : null;
        const module = typeof args.module === "string" ? args.module : null;

        if (wanted !== null) {
          const sym = lookupSymbol(graph, wanted);
          return sym
            ? mcpText(sym)
            : mcpText(
                `« ${wanted} » est introuvable dans le graphe (${Object.keys(graph.symbols).length} symboles)`,
                true,
              );
        }

        const entries = Object.values(graph.symbols).filter(
          (s) => module === null || s.module === module,
        );
        if (module !== null) {
          return mcpText(entries.sort((a, b) => a.name.localeCompare(b.name)));
        }
        // Résumé : combien, et dans quels paquets — la question qu'on se pose en
        // premier quand un symbole manque à l'appel.
        const parPaquet: Record<string, number> = Object.create(null);
        for (const sym of entries) {
          parPaquet[sym.module] = (parPaquet[sym.module] ?? 0) + 1;
        }
        return mcpText({ total: entries.length, parPaquet });
      },
    },
  };
}

/** Ce qu'il faut pour ramasser les outils d'une application. */
export interface IMcpCollectOptions {
  /**
   * Allowlist des outils INTÉGRÉS (clés courtes, cf
   * {@link BUILTIN_MCP_TOOL_KEYS}).
   *
   * ⚠️ Elle ne porte QUE sur les intégrés. Un outil déclaré par un module est
   * publié sans condition : exiger qu'il soit AUSSI nommé ici en ferait un
   * outil accepté puis jeté — déclaré dans le code, absent de `tools/list`, et
   * sans le moindre message pour l'expliquer.
   */
  builtins: readonly string[];
  /** Dépendances des outils intégrés. */
  deps: IMcpToolDeps;
  /**
   * Modules chargés (`kernel.modules`), dont on lit `getMcpTools()`.
   *
   * Typé large à dessein : le cœur ne peut pas dépendre de la forme concrète
   * d'un module ici, et la lecture est de toute façon défensive.
   */
  modules?: Readonly<Record<string, unknown>> | undefined;
  /**
   * Appelé pour chaque déclaration ÉCARTÉE, avec le motif.
   *
   * Sans ce rappel, un outil mal nommé ou en collision disparaîtrait en
   * silence, et son auteur chercherait la faute dans son handler — qui n'a
   * jamais été appelé.
   */
  onSkip?: (why: string) => void;
  /**
   * Ce que la porte a ÉTABLI de l'appelant. Absent = anonyme.
   *
   * Une porte sans authentification n'a rien à passer, et c'est le cas sûr :
   * l'anonyme par défaut RETIENT tout outil qui exige quoi que ce soit.
   */
  caller?: IMcpCaller;
  /**
   * Appelé pour chaque outil RETENU faute d'autorisation.
   *
   * Distinct d'{@link IMcpCollectOptions.onSkip}, et la distinction n'est pas
   * cosmétique : un `onSkip` dénonce une FAUTE de l'auteur (nom hors forme,
   * handler absent) et mérite un avertissement ; une rétention est le
   * fonctionnement NORMAL d'un catalogue filtré, et crier à chaque requête pour
   * chaque outil protégé noierait le journal. Le rappel existe quand même,
   * parce que sans lui un développeur qui déclare des scopes sur une porte non
   * authentifiée chercherait son outil sans jamais comprendre.
   */
  onWithheld?: (name: string, why: string) => void;
}

/** Appelant anonyme — le défaut, et le seul défaut sûr. */
const ANONYMOUS: IMcpCaller = { authenticated: false, scopes: [] };

/**
 * L'appelant satisfait-il ce que l'outil exige ?
 *
 * @returns `null` s'il passe, sinon le motif de la rétention
 */
function withholdReason(tool: IMcpTool, caller: IMcpCaller): string | null {
  const needsScopes = tool.scopes !== undefined && tool.scopes.length > 0;
  if (!needsScopes && tool.requiresAuth !== true) {
    return null;
  }
  if (!caller.authenticated) {
    return "exige une identité prouvée, l'appelant est anonyme";
  }
  if (!needsScopes) {
    return null;
  }
  // TOUS les scopes, pas au moins un : « lire » n'autorise pas « écrire »
  // parce qu'ils sont demandés ensemble.
  const missing = (tool.scopes as readonly string[]).filter(
    (scope) => !caller.scopes.includes(scope),
  );
  return missing.length === 0
    ? null
    : `scopes manquants : ${missing.join(", ")}`;
}

/**
 * Ramasse les outils servis par cette application : les intégrés autorisés,
 * puis ceux que les modules déclarent.
 *
 * Trois refus, tous énoncés par `onSkip` plutôt que silencieux :
 *  - **nom hors forme** ({@link NAME_PATTERN}) — il ne serait pas appelable ;
 *  - **collision** — le premier inscrit garde le nom, les intégrés passant en
 *    tête ; un module ne peut donc pas se substituer à `nodefony_inspect` et
 *    répondre à sa place ;
 *  - **déclaration en échec** — un `getMcpTools()` qui lève ne doit pas priver
 *    l'agent des outils de tous les autres modules.
 *
 * Et un quatrième, qui n'est pas un refus mais une RÉTENTION : un outil dont
 * l'appelant ne satisfait pas les exigences ({@link IMcpTool.scopes},
 * {@link IMcpTool.requiresAuth}) ne sort pas d'ici. ⭐ **Filtrer À LA COLLECTE
 * protège `tools/list` ET `tools/call` d'un seul geste** : le protocole ne
 * reçoit que les outils servis, donc un outil retenu est « inconnu » pour lui —
 * indistinguable d'un outil inexistant, ce qui ne révèle même pas son
 * existence. Filtrer la liste sans filtrer l'appel n'aurait été qu'un rideau, et
 * c'est l'erreur classique : deux points de décision, dont un qu'on oublie.
 *
 * @param options - allowlist, dépendances, modules, appelant et journaux
 * @returns les outils exécutables, dans l'ordre où ils seront publiés
 */
export function collectMcpTools(options: IMcpCollectOptions): IMcpTool[] {
  const collected: IMcpTool[] = [];
  const seen = new Set<string>();
  const caller = options.caller ?? ANONYMOUS;

  const add = (tool: IMcpTool, origin: string): void => {
    if (typeof tool?.name !== "string" || !NAME_PATTERN.test(tool.name)) {
      options.onSkip?.(
        `outil écarté (${origin}) : nom absent ou hors forme — attendu ${NAME_PATTERN.source}`,
      );
      return;
    }
    if (typeof tool.handler !== "function") {
      options.onSkip?.(
        `outil « ${tool.name} » écarté (${origin}) : sans handler`,
      );
      return;
    }
    if (seen.has(tool.name)) {
      options.onSkip?.(
        `outil « ${tool.name} » écarté (${origin}) : ce nom est déjà pris`,
      );
      return;
    }
    // Le nom est RÉSERVÉ même quand l'outil est retenu : sans cela, un module
    // pourrait publier un homonyme public d'un outil protégé qu'il ne voit
    // pas, et l'agent croirait appeler celui qu'il a lu dans la documentation.
    seen.add(tool.name);
    const withheld = withholdReason(tool, caller);
    if (withheld !== null) {
      options.onWithheld?.(tool.name, withheld);
      return;
    }
    collected.push(tool);
  };

  // Les intégrés d'abord : ils gagnent toute collision, donc aucun module ne
  // peut prendre la place de `nodefony_inspect` et répondre à sa place.
  const builtin = builtinMcpTools(options.deps);
  for (const key of options.builtins) {
    // `Object.hasOwn` n'est pas une précaution de style : sans lui,
    // `tools: ["toString"]` résolvait une méthode héritée d'`Object.prototype`,
    // la valeur n'étant pas `undefined` elle franchissait le filtre, et un
    // outil fantôme entrait dans le catalogue publié.
    if (Object.hasOwn(builtin, key)) {
      add(builtin[key as BuiltinMcpToolKey], "intégré");
    }
  }

  for (const [name, module] of Object.entries(options.modules ?? {})) {
    const declare = (module as { getMcpTools?: unknown } | null)?.getMcpTools;
    if (typeof declare !== "function") continue;
    let declared: unknown;
    try {
      declared = (declare as () => unknown).call(module);
    } catch (error) {
      options.onSkip?.(
        `module « ${name} » : getMcpTools() a échoué — ${(error as Error).message}`,
      );
      continue;
    }
    if (!Array.isArray(declared)) {
      options.onSkip?.(
        `module « ${name} » : getMcpTools() doit rendre un tableau`,
      );
      continue;
    }
    for (const tool of declared) {
      add(tool as IMcpTool, `module ${name}`);
    }
  }

  return collected;
}

/**
 * Projette les outils pour `tools/list` — sans leur implémentation.
 *
 * Le `handler` est une fermeture sur l'état du serveur ; `JSON.stringify` le
 * laisserait tomber en silence, mais compter là-dessus reviendrait à publier
 * par accident ce qu'on ne publie pas exprès.
 */
export function publishMcpTools(
  tools: readonly IMcpTool[],
): IMcpToolDefinition[] {
  return tools.map(({ name, description, inputSchema }) => ({
    name,
    description,
    inputSchema,
  }));
}

/**
 * Exécute un outil par son nom public.
 *
 * Un échec métier (sujet inconnu, module absent) rend un résultat `isError`,
 * **pas** une erreur JSON-RPC : le protocole réserve celle-ci aux fautes de
 * protocole. La distinction compte pour l'agent — une erreur de protocole
 * signifie « tu t'y prends mal », un `isError` signifie « ta demande est
 * recevable, voici pourquoi elle n'aboutit pas » ; c'est la seconde qu'il peut
 * corriger seul.
 *
 * ⭐ **Aucun contrôle d'autorisation ici, et c'est voulu** : `tools` ne contient
 * que ce que {@link collectMcpTools} a servi à CET appelant. Refaire la
 * vérification à ce niveau créerait un second point de décision — deux copies
 * d'une même règle, qui divergent en silence. Le corollaire tient en une
 * phrase : **ne jamais passer ici une liste non filtrée.**
 *
 * @param name - nom public de l'outil (`nodefony_inspect`…)
 * @param args - arguments fournis par l'agent
 * @param tools - outils servis, tels que {@link collectMcpTools} les a ramassés
 * @param caller - appelant établi, transmis au handler (anonyme par défaut)
 * @returns le résultat de l'outil, ou `null` si le nom n'est pas exposé
 */
export async function callMcpTool(
  name: string,
  args: Record<string, unknown>,
  tools: readonly IMcpTool[],
  caller: IMcpCaller = ANONYMOUS,
): Promise<IMcpToolResult | null> {
  const tool = tools.find((candidate) => candidate.name === name);
  if (!tool) {
    return null;
  }
  return tool.handler(args, caller);
}
