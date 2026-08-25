import {
  route,
  controller,
  Controller,
  Body,
  Headers,
} from "@nodefony/framework";
import type { ContextType } from "@nodefony/http";
import {
  Nodefony,
  checkMcpAccess,
  handleMcpMessage,
  collectMcpTools,
  authorizeProtectedResource,
  protectedResourceMetadataUrl,
  ACCESS_TOKEN_VERIFIER,
  mcpCallerRoles,
  readBearerHeader,
  JsonRpcError,
  jsonRpcFailure,
} from "nodefony";
import type {
  IJsonRpcMessage,
  IMcpCaller,
  IAccessTokenVerifier,
} from "nodefony";
import type { IDevkitService } from "../interfaces/IDevkitService";

/**
 * Serveur **Model Context Protocol** de l'application — la porte par laquelle
 * un agent externe l'interroge.
 *
 * ## Pourquoi une route, et pas un process
 *
 * La révision `2026-07-28` du transport « Streamable HTTP » a supprimé les
 * sessions de niveau protocole et le flux `GET` : il ne reste qu'**un endpoint
 * qui accepte `POST`**, chaque message étant autonome. Un serveur MCP n'a donc
 * plus besoin d'être un process séparé lancé par le client — c'est une route de
 * l'application, qui tourne déjà. Conséquence directe en développement : quand
 * le superviseur relance le serveur sur une sauvegarde, rien n'est perdu, et la
 * réponse suivante vient du code qui vient d'être rechargé. Aucun cache à
 * invalider — la fraîcheur est une propriété du protocole.
 *
 * ## Ce qui protège cette route
 *
 * **Par défaut, le périmètre — et lui seul.** Ce module est `policy: "dev"`,
 * donc cette route n'existe pas en production ; restent les deux gardes que la
 * spec impose au transport, portées par {@link checkMcpAccess} : l'en-tête
 * `Origin` et la localité de l'appelant. Elles visent le seul vecteur réel
 * contre un serveur local — une page web ouverte dans le navigateur du
 * développeur.
 *
 * **Dès qu'un serveur d'autorisation est déclaré** (`mcp.authorization`), la
 * porte prend son rôle de *resource server* OAuth 2.1 : elle publie ses
 * métadonnées (RFC 9728, publiées par `@nodefony/framework` depuis
 * `DevkitService.publishedProtectedResources()`), valide le porteur
 * présenté, et refuse en citant `resource_metadata` — l'en-tête qui apprend au
 * client où obtenir un jeton (RFC 6750). L'audience attendue est l'URI
 * canonique de la porte (RFC 8707) : c'est ce qui empêche un jeton émis pour un
 * autre service d'être rejoué ici.
 *
 * ⚠️ **Le serveur d'AUTORISATION n'est pas de notre ressort**, et ne l'a jamais
 * été : la spec le place « beyond the scope […] or a separate entity ». Avoir
 * écrit l'inverse a servi d'excuse à ne rien faire pendant tout un cycle.
 *
 * 🔴 **La vérification du jeton est déléguée, et son absence est fatale.** Ce
 * module ne peut pas dépendre de `@nodefony/security` (il disparaît en
 * production, pas elle) : il cherche un `accessTokenVerifier` dans le conteneur
 * — nom GÉNÉRIQUE, car le contrat prend l'audience en paramètre : un seul
 * vérificateur sert toutes les ressources protégées d'une application, celle-ci
 * étant seulement la première.
 * Rôle déclaré + aucun vérificateur = `503` et journal `CRITIC`, jamais une
 * porte qui laisse passer les porteurs sans les lire.
 *
 * **Mince par design** : tout le protocole vit AU CŒUR (`nodefony`, en fonctions
 * pures) ; ce controller ne fait que traduire HTTP ↔ JSON-RPC et fournir au
 * collecteur ce que lui seul connaît — le service du module, le broker
 * d'administration, la racine du projet. C'est ce qui permet à un autre module
 * d'ouvrir la même porte ailleurs (en production, sous authentification) sans
 * réécrire une ligne de protocole.
 */
@controller("/nodefony")
class McpController extends Controller {
  constructor(context: ContextType) {
    super("devkit-mcp", context);
  }

  /** Résout le service du module depuis le conteneur partagé. */
  #service(): IDevkitService {
    const svc = this.get<IDevkitService>("devkit");
    if (!svc) {
      throw new Error("DevkitService non enregistré");
    }
    return svc;
  }

  /**
   * Ce qui, dans cette application, sait valider un jeton — ou rien.
   *
   * Résolu par NOM dans le conteneur, et non importé : ce module est
   * `policy: "dev"` et ne peut pas dépendre de `@nodefony/security`, qui porte
   * la cryptographie. Une application peut donc fournir sa propre
   * implémentation du contrat sous ce nom, sans que cette porte en sache quoi
   * que ce soit.
   *
   * L'absence est un cas NORMAL (rôle éteint) ou une faute de configuration
   * (rôle allumé) — c'est l'appelant qui tranche, pas cette méthode.
   */
  #tokenVerifier(): IAccessTokenVerifier | undefined {
    return this.get<IAccessTokenVerifier>(ACCESS_TOKEN_VERIFIER) ?? undefined;
  }

  /**
   * L'en-tête porte-t-il un gabarit d'interpolation jamais substitué ?
   *
   * Un `.mcp.json` déclare son jeton par `${NF_MCP_TOKEN}` : le client
   * développe la variable, ou transmet la chaîne telle quelle si elle manque.
   * Le second cas ne se distingue d'un jeton invalide par AUCUN symptôme
   * observable de l'extérieur, et c'est pourtant le plus fréquent des deux —
   * une session lancée depuis un terminal où la variable n'était pas posée.
   *
   * @param header - la valeur brute de l'en-tête `Authorization`
   * @returns vrai si ce qui est présenté est resté un gabarit
   */
  #gabaritNonSubstitue(header: string | undefined): boolean {
    const lu = readBearerHeader(header);
    return (
      lu.kind === "token" && lu.token.startsWith("${") && lu.token.endsWith("}")
    );
  }

  /**
   * `POST /nodefony/mcp` — un message JSON-RPC entre, une réponse sort.
   *
   * Les trois statuts que rend cette route sont ceux que la spec impose, et pas
   * un de plus : `202` sans corps pour une notification acceptée, `403` pour un
   * appel dont l'origine ou l'adresse est refusée, `404` pour une méthode
   * inconnue (afin de la distinguer d'un serveur qui n'hébergerait pas
   * d'endpoint MCP du tout).
   */
  @route("devkit-mcp", { path: "/mcp", method: "POST" })
  async mcp(
    @Body() body: unknown,
    @Headers("origin") origin?: string,
    @Headers("mcp-protocol-version") protocolVersion?: string,
    @Headers("authorization") authorization?: string,
  ) {
    const settings = this.#service().mcpSettings();

    if (!settings.enabled) {
      // Coupé par configuration : la porte n'existe pas, elle ne se défend pas.
      return this.renderJson({ error: "MCP désactivé" }, 404);
    }

    const verdict = checkMcpAccess(
      { origin, remoteAddress: this.context?.remoteAddress ?? undefined },
      {
        allowedOrigins: settings.allowedOrigins,
        allowRemote: settings.allowRemote,
      },
    );
    if (!verdict.allowed) {
      // Le motif est LOGGÉ, jamais renvoyé : un appelant refusé n'a pas à
      // apprendre quelles origines seraient admises.
      this.log(`MCP refusé — ${verdict.why}`, "WARNING");
      return this.renderJson(
        jsonRpcFailure(null, JsonRpcError.INVALID_REQUEST, "origine refusée"),
        403,
      );
    }

    if (body === null || typeof body !== "object") {
      return this.renderJson(
        jsonRpcFailure(
          null,
          JsonRpcError.PARSE_ERROR,
          "corps attendu : un message JSON-RPC",
        ),
        400,
      );
    }

    // ─── Qui appelle ? ───────────────────────────────────────────────────────
    // Sans serveur d'autorisation déclaré, cette porte reste ce qu'elle a
    // toujours été : anonyme, bornée par son périmètre (`policy: "dev"`) et par
    // les gardes de transport ci-dessus. Les outils exigeant une identité ou des
    // scopes restent retenus — un appelant anonyme n'est pas une autorisation
    // implicite.
    const authz = settings.authorization;
    // 🔴 La POSTURE se lit ici — seule la porte sait si elle est protégée —
    // mais la RÈGLE qui en déduit les rôles vit au cœur (`mcpCallerRoles`),
    // partagée avec toute porte MCP à venir. Sans serveur d'autorisation
    // déclaré, cette porte accorde le rôle d'opérateur : sa protection est son
    // PÉRIMÈTRE (module `policy: "dev"`, gardes d'origine et de localité
    // ci-dessus), et la refuser ne fermerait rien — qui l'atteint lit déjà les
    // sources — tout en rendant l'outillage inutile.
    const gateProtected =
      settings.authorization.authorizationServers.length > 0;
    let caller: IMcpCaller = {
      authenticated: false,
      scopes: [],
      roles: mcpCallerRoles({
        protected: gateProtected,
        authenticated: false,
        scopes: [],
      }),
    };

    if (gateProtected) {
      const authVerdict = await authorizeProtectedResource(
        authorization,
        {
          resource: authz.resource,
          acceptedResources: authz.additionalResources,
          metadataUrl: protectedResourceMetadataUrl(authz.resource),
          // Ce que la porte EXIGE, dérivé de ses outils — la MÊME source que
          // le document RFC 9728 que ce défi fait lire. Deux listes auraient
          // envoyé le client demander des scopes qu'on n'exige pas, ou taire
          // ceux qu'on exige.
          scopes: this.#service().declaredMcpScopes(),
          allowAnonymous: authz.anonymous,
        },
        this.#tokenVerifier(),
      );

      switch (authVerdict.outcome) {
        case "unverifiable":
          // 🔴 La porte se DIT protégée et le jeton n'a pas pu être jugé.
          // Servir reviendrait à accepter n'importe quel porteur ; se taire
          // laisserait croire à une protection qui n'existe pas. On refuse, et
          // on crie. Deux causes, deux messages : rien n'est POSÉ (faute de
          // configuration) ou la vérification a ÉCHOUÉ (panne). Les confondre
          // envoyait chercher une clé manquante là où l'émetteur était
          // simplement injoignable.
          this.log(
            authVerdict.why
              ? "MCP — la vérification du jeton a ÉCHOUÉ, le jeton n'est donc " +
                  "ni accepté ni refusé : la porte refuse de servir (503). " +
                  `Cause — ${authVerdict.why}`
              : "MCP — `mcp.authorization` déclare un serveur d'autorisation, mais " +
                  "aucun service du conteneur ne sait vérifier un jeton " +
                  "(`accessTokenVerifier`). La porte refuse de servir : accepter les " +
                  "porteurs sans les valider serait pire que rester anonyme.",
            "CRITIC",
          );
          return this.renderJson(
            jsonRpcFailure(
              null,
              JsonRpcError.INTERNAL_ERROR,
              "autorisation indisponible",
            ),
            503,
          );
        case "challenge":
          // 🔴 Le refus le plus incompréhensible qui soit : un en-tête
          // `Bearer ${…}` que personne n'a substitué. Le client CROIT présenter
          // un jeton, la porte reçoit une chaîne illisible, et le seul symptôme
          // est un serveur « failed » — alors que le même client, SANS en-tête,
          // aurait obtenu les outils publics. La cause n'est pas devinable de
          // l'extérieur : elle se DIT.
          if (this.#gabaritNonSubstitue(authorization)) {
            this.log(
              "MCP — l'en-tête `Authorization` porte un GABARIT non substitué : " +
                "la variable d'environnement du jeton n'est pas posée dans le " +
                "process du client. Émettre le jeton (`nodefony security:token`) " +
                "et le poser, ou rendre la porte anonyme pour ce client " +
                "(`nodefony ai:mcp --no-auth`) — sans en-tête, les outils " +
                "publics sont servis.",
              "WARNING",
            );
          }
          // Le défi porte `resource_metadata` : c'est lui qui apprend au client
          // où obtenir un jeton. Sans cet en-tête, le refus serait un mur.
          return this.renderJson(
            jsonRpcFailure(
              null,
              JsonRpcError.INVALID_REQUEST,
              "autorisation requise",
            ),
            authVerdict.status,
            { "WWW-Authenticate": authVerdict.wwwAuthenticate },
          );
        case "authenticated":
          caller = {
            authenticated: true,
            scopes: authVerdict.principal.scopes,
            subject: authVerdict.principal.subject,
            // Les rôles VIENNENT DU JETON. L'audience (RFC 8707) prouve que le
            // jeton vise cette ressource ; elle ne dit rien de ce que son
            // porteur a le droit d'y faire. Un jeton sans scope d'administration
            // n'obtient donc aucun rôle — et se voit refuser, au lieu d'hériter
            // d'un administrateur fabriqué.
            roles: mcpCallerRoles({
              protected: true,
              authenticated: true,
              scopes: authVerdict.principal.scopes,
            }),
          };
          break;
        case "anonymous":
          // 🔴 Un jeton PRÉSENTÉ et rejeté est servi en anonyme — mais jamais
          // en silence. Sans cette ligne, un jeton expiré serait
          // indistinguable d'une requête muette : l'agent perdrait ses outils
          // réservés sans que rien n'en donne la raison, et un porteur refusé
          // ne laisserait aucune trace. `WARNING`, pas `DEBUG` : c'est le
          // symptôme d'un jeton à renouveler, ou d'une tentative.
          if (authVerdict.rejected) {
            this.log(
              "MCP — jeton REJETÉ (expiré, mauvaise audience ou signature " +
                "invalide) : la requête est servie en ANONYME, les outils " +
                "réservés restent retenus. Renouveler le jeton " +
                "(`nodefony security:token`) pour les retrouver.",
              "WARNING",
            );
          }
          // La porte a DÉCLARÉ une autorisation et tolère l'anonyme : lui
          // accorder le rôle d'opérateur viderait cette déclaration de son
          // sens. Il reste anonyme, donc sans rôle — c'est la règle qui le dit,
          // pas cette ligne.
          caller = {
            authenticated: false,
            scopes: [],
            roles: mcpCallerRoles({
              protected: true,
              authenticated: false,
              scopes: [],
            }),
          };
          break;
      }
    }

    const kernel = Nodefony.getKernel();
    // Les outils sont ramassés À CHAQUE requête, jamais mémorisés : c'est ce
    // qui fait qu'un module ajouté — ou rechargé par le superviseur de
    // développement — apparaît sans qu'aucun cache soit à invalider. Le coût
    // est celui d'un parcours de `kernel.modules`, payé uniquement par les
    // requêtes MCP, sur une porte qui n'existe pas en production.
    // Compté pour l'annonce de `server/discover` : un agent doit pouvoir
    // apprendre qu'il EXISTE des outils réservés, sinon un catalogue filtré lui
    // fait conclure « cette application n'a rien de plus » — et il ne demandera
    // jamais de jeton. Un nombre, jamais un nom.
    let withheldCount = 0;

    const tools = collectMcpTools({
      builtins: settings.tools,
      modules: kernel?.modules,
      caller,
      // Un outil écarté (nom hors forme, collision, déclaration en échec) se
      // DIT : sans ce journal, son auteur chercherait la faute dans un handler
      // que rien n'a jamais appelé.
      onSkip: (why) => this.log(`MCP — ${why}`, "WARNING"),
      // Une rétention n'est PAS une faute : c'est un catalogue filtré qui
      // fonctionne. En DEBUG, donc — un WARNING par outil protégé et par
      // requête noierait le journal, et on cesserait de le lire.
      onWithheld: (name, why) => {
        withheldCount += 1;
        this.log(`MCP — outil « ${name} » retenu : ${why}`, "DEBUG");
      },
      // Composées par le SERVICE : les mêmes dépendances servent à dériver les
      // scopes publiés, et deux compositions auraient fini par décrire deux
      // applications.
      deps: this.#service().mcpToolDeps(),
    });

    const reply = await handleMcpMessage(
      body as IJsonRpcMessage,
      {
        tools,
        caller,
        withheldCount,
        serverInfo: {
          name: kernel?.projectName ?? "nodefony",
          version: Nodefony.version,
        },
      },
      // L'en-tête de révision voyage jusqu'au protocole : c'est lui qui, face
      // au `_meta` du corps, permet de refuser une requête dont deux
      // intermédiaires liraient des versions différentes.
      { protocolVersion },
    );

    if (reply.body === null) {
      // `202 Accepted` **sans corps** — la spec l'exige pour une notification
      // acceptée. Un objet JSON ici ferait échouer un client conforme, qui
      // n'attend rien à lire.
      return this.renderResponse("", undefined, reply.status);
    }
    return this.renderJson(reply.body, reply.status);
  }
}

export default McpController;
