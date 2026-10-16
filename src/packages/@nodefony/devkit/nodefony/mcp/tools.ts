import {
  INSPECT_SUBJECTS,
  readAdminSubject,
  callAdminEndpoint,
  outlineMarkdown,
  ADMIN_SCOPE_READ,
  adminReadCatalog,
  findAdminReadEntry,
  readSymbolsGraph,
  lookupSymbol,
  collectDoctorReport,
  countCheckFindings,
  skippedChecks,
} from "nodefony";
import type {
  IAdminBrokerLike,
  InspectResult,
  IAdminCaller,
  IAdminCatalogView,
  IMcpTool,
  IMcpToolAnnotations,
  IMcpToolResult,
  IMcpCaller,
} from "nodefony";
import { mcpText, MCP_TEXT_MAX_CHARS, MCP_RESERVED_PREFIX } from "@nodefony/ai";

/**
 * Outils MCP du framework : le catalogue `nodefony_*`, que `@nodefony/devkit`
 * déclare par `getMcpTools()` comme n'importe quel module d'application.
 *
 * ⚠️ **Rien n'est calculé ici.** Chaque outil intégré traduit un appel JSON-RPC
 * vers une brique qui répond DÉJÀ à une autre porte : `inspect` lit le plan
 * d'administration par {@link readAdminSubject} (la même fonction que la
 * commande `nodefony inspect`), `check` appelle {@link collectDoctorReport} (la
 * même que `nodefony doctor`). Une source, plusieurs portes — un outil qui
 * recalculerait sa réponse finirait par contredire la commande, et c'est lui
 * qu'on croirait sur parole.
 *
 * ⭐ **La description d'un outil est le premier critère de son déclenchement.**
 * Un modèle n'appelle pas ce qu'il ne comprend pas : le POC de 2026-05 l'a payé
 * cash — un outil à description neutre n'a jamais été appelé, un skill
 * auto-déclenché prenait la main à chaque fois. Ces descriptions disent donc ce
 * que l'outil rend ET quand s'en servir, pas seulement son nom.
 */

/**
 * Marge laissée au corps d'un refus. Un producteur qui explique pourquoi il
 * refuse tient en quelques centaines d'octets (un plan de page, une liste de
 * valeurs) ; au-delà, c'est une donnée déguisée en message d'erreur, et une
 * réponse démesurée sature la fenêtre de celui qui la lit.
 */
const MCP_ERROR_BODY_MAX_CHARS = 4_000;

/**
 * Rend un refus du plan d'administration — la phrase ET ce que le producteur a
 * joint pour la corriger.
 *
 * ⚠️ Rendre la seule phrase faisait conclure l'inverse de la vérité : demander
 * une section absente d'une page PRÉSENTE produit « … introuvable (404) », et
 * l'agent en déduisait que la page n'existait pas — alors que le producteur
 * joignait le plan de cette page, c'est-à-dire la réponse. Une porte qui résume
 * un refus lui fait dire autre chose.
 *
 * @param read - l'échec rendu par la lecture, corps du producteur inclus.
 * @returns le résultat d'outil, en erreur, borné en volume.
 */
function mcpAdminFailure(
  read: Extract<InspectResult, { ok: false }>,
): IMcpToolResult {
  if (read.body === undefined || read.body === null) {
    return mcpText(read.message, true);
  }
  const rendered = JSON.stringify(read.body, null, 2);
  const body =
    rendered.length <= MCP_ERROR_BODY_MAX_CHARS
      ? rendered
      : `${rendered.slice(0, MCP_ERROR_BODY_MAX_CHARS)}\n… body du refus tronqué (${rendered.length} caractères)`;
  return mcpText(`${read.message}\n\n${body}`, true);
}

/**
 * Marge laissée à l'enveloppe JSON d'une page : `frontmatter`, `slug`, guillemets
 * échappés. Sous-estimer ferait retomber la page dans le résumé générique — celui
 * qui rend des CLÉS, c'est-à-dire rien d'utile sur un markdown.
 */
const DOC_ENVELOPE_CHARS = 4_000;

/**
 * Une page de documentation, ou son PLAN quand elle est trop lourde.
 *
 * Le résumé générique ({@link summarize}) sait ramener une liste à son compte et un
 * objet à ses clés ; sur une page de 78 ko il rendrait
 * `keys: [slug, frontmatter, markdown]` et conseillerait « demande une branche
 * précise » — une phrase qui ne désigne aucun geste possible. Le plan, lui, se lit
 * en quelques centaines d'octets et nomme exactement ce qu'il faut redemander.
 *
 * @param data - ce que le producteur a rendu pour la page
 * @param module - module interrogé, pour rédiger le geste suivant
 * @param slug - page interrogée, idem
 */
function pageOrOutline(data: unknown, module: string, slug: string): unknown {
  const page = data as { markdown?: unknown } | null;
  const markdown = typeof page?.markdown === "string" ? page.markdown : null;
  if (
    markdown === null ||
    markdown.length <= MCP_TEXT_MAX_CHARS - DOC_ENVELOPE_CHARS
  ) {
    return data;
  }
  return {
    ...(data as object),
    markdown: undefined,
    chars: markdown.length,
    note:
      `cette page pèse ${markdown.length} caractères — voici son PLAN. ` +
      `Rappelle l'outil avec section: "<titre>" ` +
      `(module: "${module}", slug: "${slug}") pour n'obtenir que le passage utile.`,
    outline: outlineMarkdown(markdown),
  };
}

/**
 * Clé de module telle que le kernel la connaît, depuis un nom de package npm.
 *
 * Le graphe symbolique indexe par nom npm (`@nodefony/http`) ; le plan
 * d'administration, lui, désigne les modules par leur clé courte (`http`), et
 * le socle sous le nom logique `core` — son package réel s'appelant `nodefony`
 * pour des raisons d'histoire. Deux vocabulaires pour une même chose : la
 * traduction vit ICI, une fois, plutôt que dans chaque appelant.
 */
function moduleKey(packageName: string): string {
  if (packageName === "nodefony" || packageName === "@nodefony/core") {
    return "core";
  }
  return packageName.replace(/^@nodefony\//u, "");
}

/**
 * Largeur maximale d'un résumé dans le catalogue d'administration.
 *
 * Le catalogue vaut par sa densité : soixante lignes qu'on parcourt d'un coup
 * d'œil. Un résumé de trois phrases y ferait perdre la colonne de gauche — le
 * chemin, c'est-à-dire la seule chose qu'on recopie ensuite.
 */
const CATALOG_SUMMARY_MAX = 96;

/** Largeur de la colonne des chemins, au-delà de laquelle on cesse d'aligner. */
const CATALOG_PATH_COLUMN = 34;

/**
 * Budget du catalogue rendu, sous la borne générique de {@link mcpText}.
 *
 * 🔴 Il ne s'agit pas de politesse : au-delà de sa borne, `mcpText` remplace une
 * CHAÎNE par une note générique — le résumé sait ramener une liste à son compte
 * et un objet à ses clés, mais d'un texte il ne garde rien. Le catalogue
 * disparaîtrait donc en entier, en conseillant « demande une branche précise »,
 * un geste qui ne désigne rien ici. On borne nous-mêmes, en gardant des entrées
 * ET en nommant les deux restrictions qui EXISTENT.
 */
const CATALOG_MAX_CHARS = 24_000;

/**
 * Met le catalogue en forme pour un lecteur qui va s'en servir tout de suite.
 *
 * Texte plutôt que JSON, et ce n'est pas une question de goût : la même
 * information sérialisée en objets indentés pèse environ trois fois plus, pour
 * une porte dont l'unique raison d'être est de ne pas coûter de contexte. Le
 * groupement par producteur porte la seule structure nécessaire — le producteur
 * est le premier argument de l'appel qui suit.
 *
 * @param view - ce que le cœur a retenu, et ce qu'il a écarté.
 * @returns le catalogue rendu, écarts annoncés.
 */
function renderAdminCatalog(view: IAdminCatalogView): string {
  const gaps: string[] = [];
  if (view.mutations > 0) {
    gaps.push(
      `${view.mutations} mutations (POST/PATCH/DELETE — cette porte ne fait que LIRE)`,
    );
  }
  if (view.selfService > 0) {
    gaps.push(
      `${view.selfService} self-service liés à une session (« me », « sessions/mine ») — cette porte n'a pas d'utilisateur connecté`,
    );
  }
  if (view.denied > 0) {
    gaps.push(`${view.denied} hors des droits de ce jeton`);
  }
  if (view.filtered > 0) {
    gaps.push(`${view.filtered} hors du filtre demandé`);
  }

  const lines: string[] = [
    `${view.entries.length} lectures appelables — sur ${view.total} endpoints déclarés par cette application.`,
    `Appel : nodefony_admin_call { namespace, path, params?, query? } — recopier « path » TEL QUEL, variables comprises.`,
  ];
  if (gaps.length > 0) {
    lines.push(`Non listés : ${gaps.join(" · ")}.`);
  }

  let namespace: string | null = null;
  for (const entry of view.entries) {
    if (entry.namespace !== namespace) {
      namespace = entry.namespace;
      const count = view.entries.filter(
        (other) => other.namespace === namespace,
      ).length;
      lines.push("", `## ${namespace} (${count})`);
    }
    const summary =
      entry.summary.length > CATALOG_SUMMARY_MAX
        ? `${entry.summary.slice(0, CATALOG_SUMMARY_MAX - 1)}…`
        : entry.summary;
    const suffix = summary === "" ? "" : `  ${summary}`;
    lines.push(`${entry.path.padEnd(CATALOG_PATH_COLUMN)}${suffix}`.trimEnd());
    // Ce que l'endpoint accepte dans sa query, quand il rend une liste. Le
    // plan REFUSE en 400 tout tri ou filtre non déclaré : le taire ferait
    // conclure à un endpoint cassé là où il n'a rien promis.
    const caps: string[] = [];
    if (entry.page?.sortable.length) {
      caps.push(`tri: ${entry.page.sortable.join(",")}`);
    }
    if (entry.page?.filters.length) {
      caps.push(`filtres: ${entry.page.filters.join(",")}`);
    }
    if (entry.page?.search) caps.push("recherche q");
    if (caps.length > 0) {
      lines.push(`${" ".repeat(4)}${caps.join(" | ")}`);
    }
  }
  if (view.entries.length === 0) {
    lines.push("", "(aucune entrée ne répond à cette demande)");
  }
  const rendered = lines.join("\n");
  if (rendered.length <= CATALOG_MAX_CHARS) return rendered;
  // Bornage ANNONCÉ, et le geste proposé existe vraiment — restreindre par
  // producteur ou par termes. Une troncature muette ferait conclure que le
  // reste du plan n'existe pas.
  const cut = rendered.slice(0, CATALOG_MAX_CHARS);
  const clean = cut.slice(0, cut.lastIndexOf("\n"));
  return `${clean}\n\n… catalogue tronqué (${rendered.length} caractères pour ${view.entries.length} entrées). Rappelle l'outil avec namespace: "<producteur>" ou q: "<termes>" pour voir le reste.`;
}

/**
 * Projette un argument d'agent en table de chaînes, ou dit pourquoi il ne l'est
 * pas.
 *
 * Refuser plutôt qu'ignorer : un paramètre accepté puis jeté produit une
 * réponse qui a l'air d'avoir honoré la demande, et c'est le pire des deux
 * mondes — l'appelant en tire une conclusion fausse sans jamais voir d'erreur.
 *
 * @param value - ce que l'agent a passé.
 * @param field - nom du champ, pour rédiger le refus.
 * @param arrays - accepter les listes de chaînes (vrai pour une query string).
 * @returns la table, ou le motif du refus.
 */
function stringTable(
  value: unknown,
  field: string,
  arrays: false,
): { ok: true; value: Record<string, string> } | { ok: false; why: string };
function stringTable(
  value: unknown,
  field: string,
  arrays: true,
):
  | { ok: true; value: Record<string, string | string[]> }
  | { ok: false; why: string };
function stringTable(
  value: unknown,
  field: string,
  arrays: boolean,
):
  | { ok: true; value: Record<string, string | string[]> }
  | { ok: false; why: string } {
  if (value === undefined || value === null) return { ok: true, value: {} };
  if (typeof value !== "object" || Array.isArray(value)) {
    return {
      ok: false,
      why: `« ${field} » doit être un objet { clé: valeur }`,
    };
  }
  const table: Record<string, string | string[]> = {};
  for (const [key, raw] of Object.entries(value)) {
    if (typeof raw === "string") {
      table[key] = raw;
      continue;
    }
    if (typeof raw === "number" || typeof raw === "boolean") {
      // Un agent écrit volontiers `{ limit: 20 }` : le convertir est fidèle à
      // son intention, une URL ne transporte de toute façon que du texte.
      table[key] = String(raw);
      continue;
    }
    if (
      arrays &&
      Array.isArray(raw) &&
      raw.every((item) => typeof item === "string")
    ) {
      table[key] = raw;
      continue;
    }
    return {
      ok: false,
      why: `« ${field}.${key} » n'est pas une valeur transportable — attendu du texte${arrays ? " ou une liste de textes" : ""}`,
    };
  }
  return { ok: true, value: table };
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

/**
 * Préfixe des noms d'outils du framework — un agent voit à qui il parle. Sa
 * réserve aux modules `@nodefony/*` vit dans `@nodefony/ai`, à la collecte.
 */
const PREFIX = MCP_RESERVED_PREFIX;

/**
 * Ce que promettent les sept outils intégrés : ils ne font que LIRE l'état de
 * l'application (même `admin_call`, qui n'atteint que le catalogue de lecture),
 * et ne sortent pas de l'application. Partagé : un objet figé ne retient rien.
 */
const READ_ONLY_CLOSED: IMcpToolAnnotations = Object.freeze({
  readOnlyHint: true,
  openWorldHint: false,
});

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
  "docs",
  "admin_list",
  "admin_call",
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
 * ces outils d'être des {@link IMcpTool} ordinaires, du même type que
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
      annotations: READ_ONLY_CLOSED,
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
      handler: async (args, caller) => {
        const subject = typeof args.subject === "string" ? args.subject : "";
        const target =
          typeof args.target === "string" ? args.target : undefined;
        const read = await readAdminSubject(
          deps.broker,
          subject,
          adminCallerFromMcp(caller),
          target,
        );
        return read.ok ? mcpText(read.data) : mcpAdminFailure(read);
      },
    },

    card: {
      name: `${PREFIX}card`,
      annotations: READ_ONLY_CLOSED,
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
      annotations: READ_ONLY_CLOSED,
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
        const report = await collectDoctorReport(deps.projectRoot);
        // Le VERDICT accompagne le rapport : sans lui, un agent devrait
        // recompter trois listes pour savoir s'il peut passer à la suite — et
        // c'est exactement le genre de calcul qu'on lui fait rater.
        const total = countCheckFindings(report);
        // ⚠️ Un verdict « ok » sur un contrôle qui n'a rien pu regarder est le
        // pire message qu'on puisse rendre à un agent : il ne relira pas, et
        // conclura que la voie est libre. Le troisième mot existe pour ça — et
        // il ne se confond avec « ok » dans aucune comparaison.
        const skipped = skippedChecks(report.execution);
        return mcpText({
          verdict:
            total > 0
              ? "manquements"
              : skipped.length > 0
                ? "ok-mais-incomplet"
                : "ok",
          total,
          skipped,
          ...report,
        });
      },
    },

    docs: {
      name: `${PREFIX}docs`,
      annotations: READ_ONLY_CLOSED,
      description:
        "Cherche et lit la DOCUMENTATION des modules installés — la prose " +
        "écrite par leurs auteurs : concepts, recettes, pièges, exemples. À " +
        "utiliser AVANT d'écrire du code qui utilise une brique du framework, " +
        "et avant de conclure qu'une capacité n'existe pas. ⭐ Cette " +
        "documentation vit sous `node_modules`, que les outils de recherche de " +
        "fichiers EXCLUENT par défaut (dossier ignoré par git) : elle est " +
        "livrée avec les paquets mais introuvable autrement qu'ici.\n\n" +
        "Sans argument : ce que l'application documente, module par module. " +
        "Avec `query` : les pages qui portent tous les termes, avec leurs " +
        "extraits. Avec `module` et `slug` : la page. Une page pèse souvent " +
        "plus que ce qu'une réponse peut porter — demander alors `outline` " +
        "pour son plan, puis `section` pour le seul passage utile.",
      inputSchema: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description:
              "Texte cherché dans toute la documentation ; les espaces " +
              "séparent des termes CUMULATIFS (`session redis` = les deux)",
          },
          module: {
            type: "string",
            description:
              "Module dont on veut la documentation (`http`, `security`, `core`…)",
          },
          slug: {
            type: "string",
            description:
              "Page à lire, telle que la recherche ou l'index la nomme",
          },
          section: {
            type: "string",
            description:
              "Titre de la seule section voulue (approchant suffit : sans " +
              "accent, sans casse, sans emoji)",
          },
          outline: {
            type: "boolean",
            description:
              "Rendre le PLAN de la page au lieu de son body — le premier " +
              "geste sur une page volumineuse",
          },
          limit: {
            type: "integer",
            description:
              "Nombre maximum de documents rendus par `query` (défaut 20)",
          },
        },
      },
      handler: async (args, caller) => {
        const admin = adminCallerFromMcp(caller);
        const module = typeof args.module === "string" ? args.module : "";
        const slug = typeof args.slug === "string" ? args.slug : "";
        const query = typeof args.query === "string" ? args.query.trim() : "";
        const section = typeof args.section === "string" ? args.section : "";

        // Lire UNE page : c'est le seul cas qui demande les deux coordonnées.
        if (module !== "" && slug !== "") {
          const read = await callAdminEndpoint(
            deps.broker,
            {
              namespace: "kernel",
              path: "module/{name}/docs/{slug}",
              params: { name: module, slug },
              query:
                section !== ""
                  ? { section }
                  : args.outline === true
                    ? { outline: "1" }
                    : {},
              label: `${module}/${slug}`,
            },
            admin,
          );
          if (!read.ok) return mcpAdminFailure(read);
          return mcpText(pageOrOutline(read.data, module, slug));
        }
        if (query !== "") {
          // ⚠️ `limit` est TRANSMIS, pas avalé : le producteur l'honore depuis
          // toujours, seul le pont l'ignorait — un paramètre accepté puis jeté
          // rend une réponse qui a l'air d'avoir obéi, et c'est le pire des
          // deux mondes.
          const limit =
            typeof args.limit === "number" && Number.isFinite(args.limit)
              ? Math.trunc(args.limit)
              : null;
          const read = await callAdminEndpoint(
            deps.broker,
            {
              namespace: "kernel",
              path: "docs/search",
              query:
                limit !== null && limit > 0
                  ? { q: query, limit: String(limit) }
                  : { q: query },
              label: `recherche « ${query} »`,
            },
            admin,
          );
          return read.ok ? mcpText(read.data) : mcpAdminFailure(read);
        }
        // Un module sans page nommée : son sommaire. Sans module : tout.
        const read =
          module !== ""
            ? await callAdminEndpoint(
                deps.broker,
                {
                  namespace: "kernel",
                  path: "module/{name}/docs",
                  params: { name: module },
                  label: module,
                },
                admin,
              )
            : await callAdminEndpoint(
                deps.broker,
                {
                  namespace: "kernel",
                  path: "docs",
                  label: "documentation",
                },
                admin,
              );
        return read.ok ? mcpText(read.data) : mcpAdminFailure(read);
      },
    },

    symbols: {
      name: `${PREFIX}symbols`,
      annotations: READ_ONLY_CLOSED,
      description:
        "Donne la SIGNATURE RÉELLE d'un symbole du framework — ses " +
        "paramètres, ses types de retour, sa documentation — plus ce qu'il " +
        "étend ou implémente et où il est défini. À utiliser AVANT d'appeler " +
        "une classe, une interface ou une fonction du framework, plutôt que " +
        "d'en deviner les arguments. ⭐ La déclaration est lue dans les types " +
        "LIVRÉS du paquet installé (`node_modules`, que les outils de " +
        "recherche de fichiers excluent) : c'est la version qui tourne " +
        "vraiment, pas une supposition. Sans argument, rend le résumé du " +
        "graphe ; avec `module`, la surface exportée d'un paquet.",
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
      handler: async (args, caller) => {
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
          if (!sym) {
            return mcpText(
              `« ${wanted} » est introuvable dans le graphe (${Object.keys(graph.symbols).length} symboles)`,
              true,
            );
          }
          // Le graphe dit qu'il existe ; la DÉCLARATION dit ce qu'il prend.
          // Sans elle, l'agent en est réduit à deviner une signature — et le
          // `.d.ts` qui la porte vit sous `node_modules`, que ses outils de
          // recherche excluent.
          const declared = await callAdminEndpoint(
            deps.broker,
            {
              namespace: "kernel",
              path: "module/{name}/symbol/{symbol}",
              params: { name: moduleKey(sym.module), symbol: sym.name },
              label: sym.name,
            },
            adminCallerFromMcp(caller),
          );
          return mcpText(
            declared.ok
              ? { ...sym, ...(declared.data as object) }
              : { ...sym, declaration: null, why: declared.message },
          );
        }

        // Deux vocabulaires pour une même chose : le graphe indexe par nom npm
        // (`@nodefony/redis`), le plan d'administration désigne les modules par
        // leur clé courte (`redis`). Une clé courte rendait donc un tableau
        // VIDE — indistinguable d'un paquet sans symbole exporté, et l'agent
        // en concluait que la brique n'existait pas.
        const entries = Object.values(graph.symbols).filter(
          (s) =>
            module === null ||
            s.module === module ||
            moduleKey(s.module) === moduleKey(module),
        );
        if (module !== null) {
          if (entries.length === 0) {
            // Un vide se DIT, avec ce qui existe : sans cela, il ressemble à
            // une réponse.
            const packages = [
              ...new Set(Object.values(graph.symbols).map((s) => s.module)),
            ].sort();
            return mcpText(
              `aucun symbole pour « ${module} » — paquets présents dans le graphe : ${packages.join(", ")}`,
              true,
            );
          }
          return mcpText(entries.sort((a, b) => a.name.localeCompare(b.name)));
        }
        // Résumé : combien, et dans quels paquets — la question qu'on se pose en
        // premier quand un symbole manque à l'appel.
        const perPackage = Object.create(null) as Record<string, number>;
        for (const sym of entries) {
          perPackage[sym.module] = (perPackage[sym.module] ?? 0) + 1;
        }
        return mcpText({ total: entries.length, perPackage });
      },
    },

    admin_list: {
      name: `${PREFIX}admin_list`,
      annotations: READ_ONLY_CLOSED,
      description:
        "Catalogue des lectures d'ADMINISTRATION que cette application " +
        "expose — bien au-delà des sujets de `nodefony_inspect` : journaux, " +
        "sessions, comptes, clés d'API, webhooks, profileur, santé des " +
        "connexions, entités, capacités de pagination. Chaque ligne est " +
        "directement appelable par `nodefony_admin_call`. À utiliser dès que " +
        "`nodefony_inspect` ne couvre pas ce qu'on cherche, plutôt que de " +
        "supposer que la donnée n'existe pas.\n\n" +
        "Un seul appel rend tout le catalogue ; `namespace` et `q` servent à " +
        "le réduire quand on sait déjà ce qu'on cherche.",
      inputSchema: {
        type: "object",
        properties: {
          namespace: {
            type: "string",
            description:
              "Ne garder qu'un producteur (`kernel`, `http`, `security`, `syslog`, `user`, `orm`…)",
          },
          q: {
            type: "string",
            description:
              "Termes cherchés dans le chemin et le résumé ; les espaces " +
              "séparent des termes CUMULATIFS (`session redis` = les deux)",
          },
        },
      },
      requiresAuth: true,
      scopes: [ADMIN_SCOPE_READ],
      handler: (args, caller) =>
        mcpText(
          renderAdminCatalog(
            adminReadCatalog(deps.broker, adminCallerFromMcp(caller), {
              namespace:
                typeof args.namespace === "string" ? args.namespace : undefined,
              q: typeof args.q === "string" ? args.q : undefined,
            }),
          ),
        ),
    },

    admin_call: {
      name: `${PREFIX}admin_call`,
      annotations: READ_ONLY_CLOSED,
      description:
        "Appelle une lecture d'administration, telle que `nodefony_admin_list` " +
        "la nomme. La réponse vient de l'application qui TOURNE — pas d'une " +
        "lecture des sources — et elle est identique à ce que rendrait la " +
        "console d'administration, redaction des secrets comprise.\n\n" +
        "LECTURE seule : les mutations du plan (créer, modifier, supprimer) ne " +
        "passent pas par ici. Recopier `namespace` et `path` tels quels ; " +
        "`params` porte les variables du chemin (`module/{name}` → " +
        '`{ name: "http" }`), `query` les paramètres de requête que ' +
        "l'endpoint accepte (pagination `page`/`limit`, tri `sort`, recherche " +
        "`q`). Le catalogue publie, sous chaque entrée qui rend une liste, les " +
        "tris et filtres RÉELLEMENT acceptés — tout le reste est refusé en 400, " +
        "jamais ignoré.",
      inputSchema: {
        type: "object",
        properties: {
          namespace: {
            type: "string",
            description: "Producteur, tel que le catalogue le titre",
          },
          path: {
            type: "string",
            description:
              "Chemin, recopié TEL QUEL du catalogue (variables `{…}` comprises)",
          },
          params: {
            type: "object",
            description:
              'Valeurs des variables du chemin, par nom (`{ name: "http" }`)',
            additionalProperties: { type: "string" },
          },
          query: {
            type: "object",
            description:
              'Paramètres de requête, comme une URL les porterait (`{ limit: "20" }`)',
          },
        },
        required: ["namespace", "path"],
      },
      requiresAuth: true,
      scopes: [ADMIN_SCOPE_READ],
      handler: async (args, caller) => {
        const admin = adminCallerFromMcp(caller);
        const namespace =
          typeof args.namespace === "string" ? args.namespace.trim() : "";
        const path = typeof args.path === "string" ? args.path.trim() : "";
        if (namespace === "" || path === "") {
          return mcpText(
            "« namespace » et « path » sont requis — demande d'abord " +
              "nodefony_admin_list, puis recopie les deux tels quels",
            true,
          );
        }

        // ⭐ Résolu DANS le catalogue, jamais à côté : ce qui n'y est pas
        // listé n'est pas appelable, et l'inverse est vrai aussi. Un second
        // parcours « équivalent » du registre finirait par diverger, et ce
        // serait celui-ci — le moins relu — qui deviendrait le permissif.
        const entry = findAdminReadEntry(deps.broker, admin, namespace, path);
        if (!entry) {
          const proches = adminReadCatalog(deps.broker, admin, { namespace });
          return mcpText(
            proches.entries.length === 0
              ? `« ${namespace}/${path} » n'est pas appelable ici, et « ${namespace} » ne propose aucune lecture — soit ce module n'est pas chargé, soit ce jeton ne l'ouvre pas. nodefony_admin_list rend le catalogue réel.`
              : `« ${namespace}/${path} » n'est pas appelable ici. Chemins de « ${namespace} » : ${proches.entries.map((other) => other.path).join(", ")}`,
            true,
          );
        }

        const params = stringTable(args.params, "params", false);
        if (!params.ok) return mcpText(params.why, true);
        const query = stringTable(args.query, "query", true);
        if (!query.ok) return mcpText(query.why, true);

        // Une variable de chemin absente ne produit pas une erreur lisible : le
        // handler reçoit `undefined` et refuse pour une raison qui n'a plus
        // aucun rapport avec l'oubli. On la nomme ici, où on la voit encore.
        const missing = entry.params.filter(
          (name) => typeof params.value[name] !== "string",
        );
        if (missing.length > 0) {
          return mcpText(
            `« ${namespace}/${path} » attend ${missing.length > 1 ? "les variables" : "la variable"} ${missing.map((name) => `« ${name} »`).join(", ")} dans « params »`,
            true,
          );
        }

        const read = await callAdminEndpoint(
          deps.broker,
          {
            namespace,
            path,
            method: "GET",
            params: params.value,
            query: query.value,
            label: `${namespace}/${path}`,
          },
          admin,
        );
        return read.ok ? mcpText(read.data) : mcpAdminFailure(read);
      },
    },
  };
}

/**
 * Présente un appelant MCP au plan d'administration.
 *
 * Aucune décision ici : les rôles ont été posés par la porte, qui seule sait si
 * elle est protégée et par qui. Cette fonction ne fait que TRADUIRE — et c'est
 * volontaire : la traduction est le seul endroit où une identité pourrait se
 * perdre, alors elle ne fait rien d'autre que la transporter.
 *
 * @param caller - l'appelant établi par la porte.
 * @returns la même identité, dans le vocabulaire du plan d'administration.
 */
function adminCallerFromMcp(caller: IMcpCaller): IAdminCaller {
  return {
    user: null,
    roles: caller.roles,
    label: caller.subject
      ? `le porteur « ${caller.subject} »`
      : caller.authenticated
        ? "un porteur authentifié"
        : "un appelant anonyme",
  };
}

/**
 * Les outils du catalogue que l'allowlist de configuration retient.
 *
 * C'est la forme sous laquelle `@nodefony/devkit` les déclare (`getMcpTools()`) :
 * des {@link IMcpTool} ordinaires, collectés par `@nodefony/ai` comme ceux de
 * n'importe quel module — seul le préfixe `nodefony_`, réservé aux modules
 * `@nodefony/*`, les distingue.
 *
 * @param allowlist - clés courtes retenues (cf {@link BUILTIN_MCP_TOOL_KEYS})
 * @param deps - briques qui répondent réellement
 * @returns les outils retenus, dans l'ordre de l'allowlist
 */
export function selectBuiltinMcpTools(
  allowlist: readonly string[],
  deps: IMcpToolDeps,
): IMcpTool[] {
  const builtin = builtinMcpTools(deps);
  const selected: IMcpTool[] = [];
  for (const key of allowlist) {
    // `Object.hasOwn` n'est pas une précaution de style : sans lui,
    // `tools: ["toString"]` résolvait une méthode héritée d'`Object.prototype`,
    // la valeur n'étant pas `undefined` elle franchissait le filtre, et un
    // outil fantôme entrait dans le catalogue publié.
    if (isBuiltinKey(builtin, key)) {
      selected.push(builtin[key]);
    }
  }
  return selected;
}

/**
 * La clé désigne-t-elle un outil du catalogue — en PROPRE, jamais par héritage ?
 *
 * @param catalog - le catalogue construit
 * @param key - clé lue dans la configuration
 * @returns `true` si `catalog` porte cette clé en propre
 */
function isBuiltinKey(
  catalog: Readonly<Record<BuiltinMcpToolKey, IMcpTool>>,
  key: string,
): key is BuiltinMcpToolKey {
  return Object.hasOwn(catalog, key);
}
