import { z } from "zod";
import { canonicalResourceUri, BUILTIN_MCP_TOOL_KEYS } from "nodefony";

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
 * Rôle **serveur de ressource OAuth 2.1** de la porte MCP — éteint par défaut.
 *
 * ⭐ **Un seul réglage commande : {@link authorizationServers}.** Vide, la porte
 * se comporte exactement comme avant — anonyme, aucune métadonnée publiée,
 * aucun `401`. Non vide, le rôle s'allume ENTIÈREMENT. Un interrupteur séparé
 * aurait permis deux états qui se contredisent (« protégé mais sans serveur
 * d'autorisation », « métadonnées publiées mais jetons ignorés »), et c'est
 * précisément ce genre d'état que personne ne diagnostique.
 *
 * ⚠️ **Allumer ce rôle ne suffit pas à protéger quoi que ce soit** : il faut
 * aussi qu'un service du conteneur sache VÉRIFIER un jeton. S'il n'y en a pas,
 * la porte refuse de servir (et le dit fort) plutôt que d'accepter n'importe
 * quel porteur.
 */
const mcpAuthorizationSchema = z
  .object({
    /**
     * Serveurs d'autorisation capables d'émettre un jeton pour cette porte.
     *
     * Vide (défaut) = rôle éteint. Non vide, la spécification MCP impose que le
     * document de métadonnées les publie (« MUST include the
     * `authorization_servers` field containing at least one authorization
     * server ») : sans eux, un client apprendrait qu'un jeton est nécessaire
     * sans jamais pouvoir en obtenir un.
     */
    authorizationServers: z
      .array(z.string())
      .default([])
      .describe(
        "Émetteurs de jetons acceptés (issuer OAuth) ; vide = aucune autorisation",
      ),

    /**
     * URI canonique publique de cette porte — l'audience que les jetons doivent
     * porter (RFC 8707).
     *
     * 🔴 **Elle s'écrit, elle ne se devine pas depuis l'en-tête `Host`.** Si
     * l'URI publiée et l'audience attendue venaient toutes deux de la requête,
     * un `Host` forgé obtiendrait un jeton d'audience arbitraire *et* passerait
     * la vérification : la liaison d'audience, dont c'est l'unique raison
     * d'être, ne protégerait plus rien.
     *
     * Ex. `https://mon-app.example/nodefony/mcp`.
     */
    resource: z
      .string()
      .default("")
      .describe("URI publique de la porte MCP (audience attendue des jetons)"),

    /**
     * Autres adresses de CETTE MÊME porte, dont les jetons sont aussi acceptés.
     *
     * Le cas courant : l'application sert la porte en clair sur un port et en
     * TLS sur un autre. Un jeton émis pour l'une était alors refusé sur l'autre
     * — la liaison d'audience (RFC 8707) faisant son travail. Nommer la seconde
     * adresse est la bonne réponse ; relâcher la liaison n'en serait pas une.
     *
     * 🔴 Ces valeurs s'ÉCRIVENT. Dérivées du `Host`, un en-tête forgé
     * obtiendrait un jeton d'audience arbitraire ET passerait la vérification.
     * Seule `resource` est publiée en RFC 9728 : le document n'admet qu'une
     * valeur, et un client n'a besoin que d'une adresse.
     *
     * ⚠️ L'ÉMETTEUR doit servir ces audiences (`security.jwt.audiences`), sinon
     * il refuse de les émettre — `invalid_target`, et à juste titre.
     */
    additionalResources: z
      .array(z.string())
      .default([])
      .describe(
        "Autres URI de la même porte dont les jetons sont acceptés (jamais dérivées du Host)",
      ),

    /** Nom lisible, affiché pendant le consentement. */
    resourceName: z.string().optional().describe("Nom affiché au consentement"),

    /** Page de documentation destinée à un humain. */
    resourceDocumentation: z
      .string()
      .optional()
      .describe("URL de documentation de la ressource"),

    /**
     * Servir une requête SANS jeton comme anonyme, au lieu de la refuser.
     *
     * `false` (défaut) : sans jeton, `401` + `WWW-Authenticate` — c'est ce qui
     * apprend au client qu'une autorisation existe et où l'obtenir.
     * `true` : la porte reste ouverte aux outils publics, et les outils
     * réservés restent retenus. Utile en développement ; c'est un choix qui
     * s'écrit, jamais un comportement dont on hérite.
     */
    anonymous: z
      .boolean()
      .default(false)
      .describe("Tolérer les requêtes sans jeton (outils publics seulement)"),
  })
  .superRefine((value, ctx) => {
    // Le rôle est éteint : rien à exiger.
    if (value.authorizationServers.length === 0) return;

    // Un serveur d'autorisation sans audience produirait un document que la
    // RFC 9728 rejette, et une vérification qui ne peut rien comparer. Le dire
    // au BOOT plutôt qu'à la première requête : une porte mal configurée ne se
    // découvre autrement que le jour où un agent s'y casse les dents.
    if (value.resource.length === 0) {
      ctx.addIssue({
        code: "custom",
        path: ["resource"],
        message:
          "`mcp.authorization.resource` est requis dès qu'un serveur " +
          "d'autorisation est déclaré : c'est l'URI publique de la porte, et " +
          "l'audience que les jetons doivent porter (RFC 8707).",
      });
      return;
    }

    // Contrôlée par la fonction qui composera le document, jamais par une
    // seconde règle écrite ici : deux validations d'une même URI finiraient par
    // diverger, et c'est la plus laxiste qui laisserait passer.
    try {
      canonicalResourceUri(value.resource);
    } catch (error) {
      ctx.addIssue({
        code: "custom",
        path: ["resource"],
        message: (error as Error).message,
      });
    }
  });

/**
 * Réglages du serveur MCP — extrait en constante pour une raison mécanique.
 *
 * ⚠️ **Piège Zod 4** : un `.default({})` posé à plat sur un sous-objet NE
 * ré-applique PAS les défauts de ses champs. Le pattern du dépôt est donc
 * `sous.default(() => sous.parse({}))` — le callback force la ré-évaluation, et
 * une application qui n'écrit rien obtient bien les valeurs d'usine.
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
    // Le défaut est DÉRIVÉ du catalogue intégré, jamais retapé : une liste
    // recopiée ici aurait tu chaque outil ajouté au cœur — déclaré dans le
    // code, absent de la porte, et sans le moindre message pour l'expliquer.
    .default([...BUILTIN_MCP_TOOL_KEYS])
    .describe("Outils MCP activés (allowlist, lecture seule)"),

  /**
   * Rôle serveur de ressource OAuth 2.1 — **éteint par défaut**.
   *
   * Tant qu'aucun serveur d'autorisation n'est déclaré, la porte se comporte
   * comme elle l'a toujours fait : anonyme, protégée par son seul périmètre
   * (`policy: "dev"` + gardes `Origin`/localité).
   */
  authorization: mcpAuthorizationSchema
    .default(() => mcpAuthorizationSchema.parse({}))
    .describe("Serveur de ressource OAuth 2.1 (RFC 9728/6750/8707)"),
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
