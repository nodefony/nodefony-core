import { z } from "zod";

/**
 * @nodefony/devkit — CONFIGURATION DU MODULE (schéma Zod = source unique).
 *
 * ⭐ TL;DR : CE SCHÉMA EST LA CONFIG. Chaque `.default(...)` est la valeur d'usine ;
 * changer un défaut du module = ÉDITER ICI (et nulle part ailleurs). L'app, elle,
 * ne surcharge que ses écarts, via `use("@nodefony/devkit", { … })`.
 *
 * RÈGLE D'OR (ADR-0006) : ce fichier porte le schéma commenté (type + validation +
 * défaut + doc) ET matérialise les défauts par `parse({})`. Le builder
 * (`defineDevkitConfig`) importe le schéma d'ici et ne retape aucune valeur —
 * un défaut écrit à deux endroits finit toujours par diverger.
 *
 * SURCHARGE (précédence croissante) :
 *   • défauts du schéma (ce fichier) ;
 *   • app : `use("@nodefony/devkit", { … })` dans `nodefony.config.ts` ;
 *   • déploiement : `NF__DEVKIT__<CHEMIN>=valeur` (override env générique, `__` = niveau).
 *
 * Le schéma reste **PUR** : aucune lecture de `process.env`, aucun accès au kernel
 * (il est évalué à l'import — le kernel n'existe pas encore).
 *
 * Champ sensible (clé, mot de passe) → `.meta({ secret: true })` EN DERNIER de la
 * chaîne : chaque méthode zod clone, une `.default()` posée après `.meta()` perdrait
 * la métadonnée. Ces flags ressortent dans le JSON Schema lu par Studio.
 */
/**
 * Réglages du serveur MCP — extrait en constante pour une raison mécanique.
 *
 * ⚠️ **Piège Zod 4** : un `.default({})` posé à plat sur un sous-objet NE
 * ré-applique PAS les défauts de ses champs. Le pattern du dépôt est donc
 * `sous.default(() => sous.parse({}))` — le callback force la ré-évaluation, et
 * une application qui n'écrit rien obtient bien les quatre valeurs d'usine.
 */
const mcpSchema = z.object({
  /** Répond-on aux requêtes MCP ? Coupé, la route rend `404`. */
  enabled: z
    .boolean()
    .default(true)
    .describe("Active l'endpoint MCP (POST /nodefony/mcp)"),

  /**
   * Origines acceptées quand l'en-tête `Origin` est PRÉSENT.
   *
   * ⭐ La subtilité qui fait toute la sécurité : un client MCP natif est un
   * process, pas un navigateur — **il n'envoie pas d'`Origin`**. Une page web
   * malveillante, elle, en envoie toujours un vers `localhost`. La règle est
   * donc : *absent → on passe* ; *présent et hors de cette liste → `403`*.
   * C'est ce que la spec exige (`transports/streamable-http` §Security :
   * « Servers MUST validate the `Origin` header […] MUST respond with HTTP 403
   * Forbidden »), et c'est ce qui ferme le DNS rebinding.
   *
   * Vide (défaut) = aucune origine de navigateur n'est admise.
   */
  allowedOrigins: z
    .array(z.string())
    .default([])
    .describe("Origines navigateur admises ; vide = aucune"),

  /**
   * Accepter un appel dont l'adresse distante n'est pas locale.
   *
   * La spec recommande de n'écouter que sur la boucle locale ; le serveur de
   * l'application, lui, écoute pour le développement. La garde est donc portée
   * par la route : toute adresse non locale reçoit `403`.
   */
  allowRemote: z
    .boolean()
    .default(false)
    .describe("Autorise les appels depuis une adresse non locale"),

  /**
   * Outils exposés — **allowlist**, et lecture seule.
   *
   * Tant qu'aucun outil n'écrit, le pire qu'obtienne un appelant illégitime est
   * la description de l'application. Le jour où un générateur sera exposé, ce
   * sera un ajout explicite ici — et cette ligne sera l'endroit où quelqu'un
   * décide de donner à un agent le droit d'écrire des fichiers.
   */
  tools: z
    .array(z.string())
    .default(["inspect", "check", "symbols", "card"])
    .describe("Outils MCP activés (allowlist, lecture seule)"),
});

export const devkitConfigSchema = z.object({
  /** Interrupteur du module — l'app peut le charger sans l'activer. */
  enabled: z
    .boolean()
    .default(true)
    .describe("Active les fonctionnalités du module devkit"),

  /**
   * Serveur MCP — la porte par laquelle un agent externe interroge l'app.
   *
   * ## Pourquoi aucune autorisation OAuth
   *
   * L'autorisation MCP est **optionnelle** (spec 2026-07-28, `authorization`
   * §« Protocol Requirements »), et la faire en HTTP signifierait implémenter
   * OAuth 2.1 en entier — serveur de ressource, métadonnées `RFC 9728`,
   * découverte du serveur d'autorisation, PKCE, liaison d'audience. Un client
   * MCP conforme ne sait de toute façon pas présenter un cookie de session
   * Nodefony : il ne connaît que le jeton Bearer OAuth.
   *
   * Ce qui protège ici, c'est le PÉRIMÈTRE, et il est borné par construction :
   * le module est `policy: "dev"`, donc **cette route n'existe pas en
   * production** (le Kernel écarte le module au boot). Restent les deux gardes
   * que la spec impose au transport lui-même, et qui visent le risque réel
   * d'un serveur local — une page web ouverte dans le navigateur du
   * développeur : {@link allowedOrigins} et {@link allowRemote}.
   *
   * ⚠️ **Écart assumé et énoncé** : la spec dit aussi « Servers SHOULD
   * implement proper authentication for all connections ». Nous ne le faisons
   * pas. Une capacité absente s'énonce plutôt qu'elle ne se masque.
   */
  mcp: mcpSchema
    .default(() => mcpSchema.parse({}))
    .describe("Serveur MCP pour agents externes (développement uniquement)"),
});

/** Config telle que l'APP l'écrit dans `use()` — tous les champs optionnels. */
export type DevkitConfigInput = z.input<typeof devkitConfigSchema>;

/** Config telle que le CODE la lit — défauts appliqués, rien d'optionnel. */
export type DevkitConfig = z.output<typeof devkitConfigSchema>;

/** Défauts matérialisés (passés au `super()` du Module). */
const defaults: DevkitConfig = devkitConfigSchema.parse({});

export default defaults;
