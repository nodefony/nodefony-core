import {
  INSPECT_SUBJECTS,
  readAdminSubject,
  readSymbolsGraph,
  lookupSymbol,
  collectCheckReport,
  countCheckFindings,
  type IAdminBrokerLike,
} from "nodefony";

/**
 * Catalogue des outils MCP, et leur exécution.
 *
 * ⚠️ **Rien n'est calculé ici.** Chaque outil traduit un appel JSON-RPC vers une
 * brique qui répond DÉJÀ à une autre porte : `inspect` lit le plan
 * d'administration par `readAdminSubject` (la même fonction que la commande
 * `nodefony inspect`), `card` appelle le service du module (la même que la route
 * HTTP). Une source, plusieurs portes — un outil qui recalculerait sa réponse
 * finirait par contredire la commande, et c'est lui qu'on croirait sur parole.
 *
 * ⭐ **La description d'un outil est le premier critère de son déclenchement.**
 * Un modèle n'appelle pas ce qu'il ne comprend pas : le POC de 2026-05 l'a payé
 * cash — un outil à description neutre n'a jamais été appelé, un skill
 * auto-déclenché prenait la main à chaque fois. Ces descriptions disent donc ce
 * que l'outil rend ET quand s'en servir, pas seulement son nom.
 */

/** Ce dont les outils ont besoin pour répondre — injecté, jamais lu ici. */
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

/** Un outil tel que `tools/list` le publie. */
export interface IMcpToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

/** Ce que rend `tools/call` — du contenu, et l'aveu d'un échec métier. */
export interface IMcpToolResult {
  content: { type: "text"; text: string }[];
  isError?: boolean;
}

/** Préfixe des noms d'outils — un agent voit à qui il parle. */
const PREFIX = "nodefony_";

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

/** Catalogue complet, avant filtrage par l'allowlist de configuration. */
function catalogue(): Record<string, IMcpToolDefinition> {
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
    },
    card: {
      name: `${PREFIX}card`,
      description:
        "Carte de visite de l'application : son identité, les modules " +
        "chargés, où trouver la documentation, et les commandes à lancer. À " +
        "utiliser en ARRIVANT sur une application inconnue, avant toute autre " +
        "exploration — elle dit en un appel ce qu'il y a et où aller ensuite.",
      inputSchema: { type: "object", properties: {} },
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
    },
  };
}

/**
 * Outils publiés, filtrés par l'allowlist de configuration.
 *
 * Une clé inconnue dans la configuration est simplement ignorée : elle ne peut
 * rien ouvrir. C'est le sens d'une allowlist — ce qui n'est pas nommé ICI
 * n'existe pas, et la faute de frappe d'un utilisateur ne peut pas activer
 * autre chose que ce qu'il voulait.
 *
 * ⚠️ **`Object.hasOwn` n'est pas une précaution de style.** Sans lui,
 * `tools: ["toString"]` résolvait une méthode héritée d'`Object.prototype` :
 * la valeur n'étant pas `undefined`, elle franchissait le filtre et un outil
 * fantôme entrait dans le catalogue publié. Trouvé par le test, pas à la
 * relecture.
 *
 * @param enabled - clés d'outils autorisées (`devkit.mcp.tools`)
 */
export function listMcpTools(enabled: readonly string[]): IMcpToolDefinition[] {
  const all = catalogue();
  return enabled
    .filter((key) => Object.hasOwn(all, key))
    .map((key) => all[key])
    .filter((tool): tool is IMcpToolDefinition => tool !== undefined);
}

/** Rend un contenu textuel — les données partent en JSON indenté, lisible. */
function text(value: unknown, isError = false): IMcpToolResult {
  const rendered =
    typeof value === "string" ? value : JSON.stringify(value, null, 2);
  return isError
    ? { content: [{ type: "text", text: rendered }], isError: true }
    : { content: [{ type: "text", text: rendered }] };
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
 * @param name - nom public de l'outil (`nodefony_inspect`…)
 * @param args - arguments fournis par l'agent
 * @param enabled - allowlist de configuration
 * @param deps - briques qui répondent réellement
 * @returns le résultat de l'outil, ou `null` si le nom n'est pas exposé
 */
export async function callMcpTool(
  name: string,
  args: Record<string, unknown>,
  enabled: readonly string[],
  deps: IMcpToolDeps,
): Promise<IMcpToolResult | null> {
  const exposed = listMcpTools(enabled).find((tool) => tool.name === name);
  if (!exposed) {
    return null;
  }

  if (name === `${PREFIX}card`) {
    return text(deps.getCard());
  }

  if (name === `${PREFIX}inspect`) {
    const subject = typeof args.subject === "string" ? args.subject : "";
    const target = typeof args.target === "string" ? args.target : undefined;
    const read = await readAdminSubject(deps.broker, subject, target);
    if (!read.ok) {
      return text(read.message, true);
    }
    return text(read.data);
  }

  if (name === `${PREFIX}check`) {
    const report = await collectCheckReport(deps.projectRoot);
    // Le VERDICT accompagne le rapport : sans lui, un agent devrait recompter
    // trois listes pour savoir s'il peut passer à la suite — et c'est
    // exactement le genre de calcul qu'on lui fait rater.
    return text({
      verdict: countCheckFindings(report) === 0 ? "ok" : "manquements",
      total: countCheckFindings(report),
      ...report,
    });
  }

  if (name === `${PREFIX}symbols`) {
    const graph = readSymbolsGraph(deps.projectRoot);
    if (graph === null) {
      // Dire que le graphe MANQUE, et comment le rétablir : le silence
      // laisserait croire que le symbole cherché n'existe pas.
      return text(
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
        ? text(sym)
        : text(
            `« ${wanted} » est introuvable dans le graphe (${Object.keys(graph.symbols).length} symboles)`,
            true,
          );
    }

    const entries = Object.values(graph.symbols).filter(
      (s) => module === null || s.module === module,
    );
    if (module !== null) {
      return text(entries.sort((a, b) => a.name.localeCompare(b.name)));
    }
    // Résumé : combien, et dans quels paquets — la question qu'on se pose en
    // premier quand un symbole manque à l'appel.
    const parPaquet: Record<string, number> = Object.create(null);
    for (const sym of entries) {
      parPaquet[sym.module] = (parPaquet[sym.module] ?? 0) + 1;
    }
    return text({ total: entries.length, parPaquet });
  }

  // Inatteignable tant que le catalogue et cette fonction restent alignés ;
  // rendu explicite plutôt que silencieux, pour que l'oubli se VOIE au premier
  // appel au lieu de rendre une réponse vide qui passerait pour un résultat.
  return text(`outil « ${name} » publié mais non implémenté`, true);
}
