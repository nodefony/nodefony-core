import { setTimeout as sleep } from "node:timers/promises";
<% if (it.oauth) { %>import { RequestContext } from "nodefony";
<% } %>import { mcpText, type IMcpTool } from "@nodefony/ai";

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
 *  • un `inputSchema` (JSON Schema) qui borne les arguments ;
 *  • des `annotations` qui disent ce que l'outil FAIT — c'est sur elles que
 *    le client de l'agent décide s'il demande confirmation à l'humain.
 *
 * Les annotations, à poser sur CHAQUE outil (le test de la porte le vérifie) :
 *  • `readOnlyHint` — `true` si l'outil ne modifie RIEN (lecture, calcul) ;
 *    `false` dès qu'il écrit, envoie, déclenche ou supprime quoi que ce soit ;
 *  • `openWorldHint` — `false` s'il reste dans l'application (sa base, ses
 *    services) ; `true` s'il sort vers le web ou une API tierce ;
 *  • pour un outil qui écrit, `destructiveHint` — `true` s'il peut effacer ou
 *    écraser, `false` s'il ne fait qu'ajouter ; et `idempotentHint` — `true` si
 *    le rappeler avec les mêmes arguments ne change plus rien.
 * Sans annotation, la spécification MCP tient l'outil pour une écriture
 * destructive vers l'extérieur : le pire cas. Et une annotation n'autorise
 * jamais rien — l'accès se décide par `scopes`, ci-dessous.
 * Guide complet : node_modules/@nodefony/ai/docs/mcp.md, « Dire ce que fait
 * l'outil — les annotations ».
 *
 * Un échec MÉTIER se rend par `mcpText(message, true)` : l'agent lit le message
 * et peut corriger son appel. Une exception, elle, devient une erreur opaque.
 *
 * Un outil réservé à certains appelants porte `scopes: ["…"]` : il n'est ni
 * listé ni appelable par qui n'a pas ces scopes<% if (!it.oauth) { %> — et une porte locale,
 * sans jeton, n'en accorde aucun : l'outil y restera invisible<% } %>.
<% if (it.anonymous) { %> * Sur cette porte mixte, `<%= it.toolPrefix %>_batch` en est l'exemple : un appel sans
 * jeton ne le voit pas, un jeton émis avec `--scope <%= it.writeScope %>` l'ouvre.
 * Qui peut OBTENIR ce scope se décide dans `grantableScopes`
 * (nodefony/config/security.ts), où la génération l'a réservé à
 * `<%= it.reservedRole %>` : un autre compte reçoit un jeton sans lui.
<% } %> *
 * Un PARAMÈTRE qui élargit ce que fait l'outil (agir pour un autre compte,
 * écrire au lieu de lire) exige son scope à l'APPEL, pas à la liste :
 * `scopesFor: (args) => (args.force === true ? ["…:write"] : [])`. L'outil reste
 * visible ; sans le scope, une porte protégée répond par un défi
 * `insufficient_scope` qui dit à l'agent quel jeton redemander.
<% if (it.oauth) { %> *
 * `<%= it.toolPrefix %>_me` montre un outil qui agit AU NOM du propriétaire du jeton
 * (`actsForUser`) : la porte retrouve son compte AVANT le handler et le pose dans
 * la requête — `RequestContext.getAuthenticatedUser()`, et tout service appelé
 * d'ici, le voient comme sous une route protégée.
<% } %> *
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
    // Lecture pure, sans sortir de l'application : aucune confirmation utile.
    annotations: {
      title: "Écho",
      readOnlyHint: true,
      openWorldHint: false,
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
    // Une ÉCRITURE : déclare-la telle quelle. Ajuste chaque indice à TON
    // travail — ce lot ajoute sans effacer, et le rejouer refait le travail.
    annotations: {
      title: "Traitement par lots",
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
<% if (it.anonymous) { %>    // Réservé : ni listé ni appelable sans un jeton qui porte ce scope.
    scopes: ["<%= it.writeScope %>"],
<% } %>    // `run` est absent quand l'outil est appelé sans porte (appel en process) :
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
<% if (it.oauth) { %>  {
    name: "<%= it.toolPrefix %>_me",
    description:
      "Rend le compte au nom duquel l'outil agit : identifiant et rôles. À " +
      "utiliser pour savoir qui l'agent représente avant d'appeler un outil " +
      "qui lit ou modifie « mes » données.",
    inputSchema: { type: "object", properties: {} },
    annotations: {
      title: "Qui suis-je",
      readOnlyHint: true,
      openWorldHint: false,
    },
    // Agit au nom du propriétaire du jeton : ses rôles ENTIERS s'appliquent,
    // le jeton ne les borne pas. D'où le scope exigé — la seule borne entre un
    // jeton étroit et un compte large ; sans lui, l'outil est refusé au démarrage.
    actsForUser: true,
    scopes: ["<%= it.readScope %>"],
    handler: () => {
      const user = RequestContext.getAuthenticatedUser();
      if (user === null) return mcpText("aucun compte connecté", true);
      return mcpText({ identifier: user.identifier, roles: user.roles });
    },
  },
<% } %>];
