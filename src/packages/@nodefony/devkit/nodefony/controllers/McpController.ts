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
  JsonRpcError,
  jsonRpcFailure,
} from "nodefony";
import type { IAdminBrokerLike, IJsonRpcMessage } from "nodefony";
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
 * Pas d'OAuth : l'autorisation MCP est optionnelle (« SHOULD conform »), et le
 * rôle qu'elle demande n'est pas encore livré. ⚠️ **Ce rôle est plus petit
 * qu'il n'y paraît, et l'écrire trop grand a longtemps servi d'excuse** : la
 * spec fait du serveur MCP un simple *resource server* OAuth 2.1 — valider un
 * jeton, publier ses métadonnées (RFC 9728), refuser en `401` avec
 * `WWW-Authenticate` (RFC 6750) et vérifier l'audience (RFC 8707). Le serveur
 * d'AUTORISATION, lui, « may be hosted with the resource server **or a separate
 * entity** » et reste « beyond the scope of this specification » : il n'y a
 * jamais eu besoin d'en écrire un. Nodefony a déjà de quoi valider un porteur
 * (`JwtAuthenticator`, `JwtKeystore`, `ApiKeyAuthenticator`) ; ce qui manque est
 * le rôle resource-server, inscrit au P6.9.
 *
 * Ce qui borne le risque en attendant, c'est le périmètre — ce module est
 * `policy: "dev"`, donc **cette route n'existe pas en production**. Restent les
 * deux gardes que la spec impose au transport lui-même, portées par
 * {@link checkMcpAccess} :
 * l'en-tête `Origin` et la localité de l'appelant. Elles visent le seul vecteur
 * réel contre un serveur local — une page web ouverte dans le navigateur du
 * développeur.
 *
 * ⚠️ **Écart assumé** : la spec ajoute « Servers SHOULD implement proper
 * authentication for all connections ». Ce n'est pas fait, et c'est dit —
 * ici, dans la configuration, et dans la documentation du module.
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

    const kernel = Nodefony.getKernel();
    // Les outils sont ramassés À CHAQUE requête, jamais mémorisés : c'est ce
    // qui fait qu'un module ajouté — ou rechargé par le superviseur de
    // développement — apparaît sans qu'aucun cache soit à invalider. Le coût
    // est celui d'un parcours de `kernel.modules`, payé uniquement par les
    // requêtes MCP, sur une porte qui n'existe pas en production.
    // ⚠️ ANONYME, et ce n'est pas un oubli : cette porte ne valide aucun jeton
    // (le rôle *resource server* OAuth 2.1 n'est pas livré — cf le TSDoc de
    // classe). L'annoncer explicitement plutôt que d'omettre le champ est ce
    // qui rend le comportement PRÉVISIBLE : tout outil exigeant une identité ou
    // des scopes est retenu ici, et le sera tant que personne ne prouve rien.
    const caller = { authenticated: false, scopes: [] as string[] };

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
      onWithheld: (name, why) =>
        this.log(`MCP — outil « ${name} » retenu : ${why}`, "DEBUG"),
      deps: {
        // Le plan d'administration peut légitimement manquer (application sans
        // `@nodefony/framework` monté) : les outils le DISENT alors, ils ne
        // plantent pas.
        broker: this.get<IAdminBrokerLike>("adminBroker") ?? undefined,
        getCard: () => this.#service().getCard(),
        // La racine de l'APPLICATION, pas `process.cwd()` : le serveur répond
        // dans le process de l'app, dont le dossier courant n'est pas garanti
        // être celui du projet — un diagnostic sur le mauvais dossier conclurait
        // « rien à signaler » avec aplomb.
        projectRoot: kernel?.path ?? process.cwd(),
      },
    });

    const reply = await handleMcpMessage(
      body as IJsonRpcMessage,
      {
        tools,
        caller,
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
