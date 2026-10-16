import { setTimeout as sleep } from "node:timers/promises";
import { mcpText, type IMcpTool } from "@nodefony/ai";

/**
 * Les outils que la porte MCP `<%= it.route %>` offre à un agent IA — et eux seuls.
 *
 * Deux exemples à remplacer par les tiens : une lecture courte, et une
 * opération longue qui signale son avancement et s'arrête si l'agent abandonne.
 *
 * Ce qui fait un bon outil, et que l'agent lit pour choisir :
 *  • un `name` stable, en `[a-zA-Z0-9_-]` (64 caractères au plus) — jamais
 *    préfixé `nodefony_`, réservé aux outils du framework ;
 *  • une `description` qui dit QUAND s'en servir, pas seulement ce qu'il fait ;
 *  • un `inputSchema` (JSON Schema) qui borne les arguments.
 *
 * Un échec MÉTIER se rend par `mcpText(message, true)` : l'agent lit le message
 * et peut corriger son appel. Une exception, elle, devient une erreur opaque.
 *
 * Un outil réservé à certains appelants porte `scopes: ["…"]` : il n'est ni
 * listé ni appelable par qui n'a pas ces scopes<% if (!it.oauth) { %> — et une porte locale,
 * sans jeton, n'en accorde aucun : l'outil y restera invisible<% } %>.
 *
 * Ces outils sont aussi visibles par l'agent de code du développeur, sur la
 * porte de développement de `@nodefony/devkit`, si le module de l'application
 * les déclare : `getMcpTools(): IMcpTool[] { return <%= it.camel %>Tools; }`.
 */
export const <%= it.camel %>Tools: IMcpTool[] = [
  {
    name: "<%= it.toolPrefix %>_echo",
    description:
      "Renvoie le texte reçu. Lecture courte : à utiliser pour vérifier que " +
      "la porte répond avant d'appeler un outil métier.",
    inputSchema: {
      type: "object",
      properties: {
        text: { type: "string", description: "Le texte à renvoyer" },
      },
      required: ["text"],
    },
    handler: (args) => {
      const text = typeof args.text === "string" ? args.text : "";
      if (text === "") return mcpText("`text` est requis", true);
      return mcpText({ text });
    },
  },
  {
    name: "<%= it.toolPrefix %>_batch",
    description:
      "Traite un travail en plusieurs lots (3 par défaut). Long : signale " +
      "chaque lot terminé, et s'arrête proprement si l'appel est abandonné.",
    inputSchema: {
      type: "object",
      properties: {
        batches: { type: "integer", minimum: 1, maximum: 10 },
      },
    },
    // `run` est absent quand l'outil est appelé sans porte (appel en process) :
    // la progression et l'annulation sont alors simplement muettes.
    handler: async (args, _caller, run) => {
      const batches =
        typeof args.batches === "number" && Number.isInteger(args.batches)
          ? Math.min(Math.max(args.batches, 1), 10)
          : 3;
      for (let batch = 1; batch <= batches; batch += 1) {
        // L'agent a abandonné (flux fermé) : inutile de finir le travail.
        if (run?.signal.aborted === true) return mcpText("interrompu", true);
        // Le travail d'un lot — remplace cette attente par le tien.
        await sleep(150);
        // Envoyé à l'agent seulement s'il a fourni un jeton de progression et
        // accepte le flux ; sinon cet appel ne coûte rien.
        run?.progress(batch, batches, `lot ${batch}/${batches} traité`);
      }
      return mcpText(`${batches} lots traités`);
    },
  },
];
