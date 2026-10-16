import { route, controller, Controller, Body } from "@nodefony/framework";
import type { ContextType } from "@nodefony/http";
import { Nodefony, ADMIN_DEFAULT_ROLE, ACCESS_TOKEN_VERIFIER } from "nodefony";
import type { IAccessTokenVerifier } from "nodefony";
import {
  serveMcp,
  rejectUnsupportedMcpMethod,
  writeMcpResponse,
} from "@nodefony/ai";
import type { IDevkitService } from "../interfaces/IDevkitService";

/** Le rôle que cette porte accorde à qui l'atteint sans serveur d'autorisation. */
const DEV_OPERATOR_ROLES: readonly string[] = [ADMIN_DEFAULT_ROLE];

/**
 * Porte **Model Context Protocol** de DÉVELOPPEMENT — celle par laquelle
 * l'agent de code du développeur interroge l'application.
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
 * spec impose au transport (`checkMcpAccess`, `@nodefony/ai`) : l'en-tête
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
 * **Mince par design** : toute la mécanique vit dans `@nodefony/ai`
 * (`serveMcp`) ; ce controller ne fournit que ce que lui seul connaît — ses
 * réglages, les modules dont il sert les outils, le rôle d'opérateur. Une
 * application ouvre SA porte, en développement ou en production, de la même
 * façon, sans réécrire une ligne de protocole.
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
   * Toute la mécanique (gardes, autorisation, collecte, flux) est celle de
   * `serveMcp` (`@nodefony/ai`), partagée avec toute porte d'application. Cette
   * porte n'apporte que ce qu'elle seule sait : ses réglages (`devkit.mcp`),
   * TOUS les modules chargés (l'outillage de développement sert aussi les outils
   * de l'application, pour les éprouver), et le rôle d'opérateur — accordé
   * parce que son PÉRIMÈTRE la protège (`policy: "dev"`), écrit ici et nulle
   * part ailleurs.
   *
   * Le vérificateur de jeton est résolu par NOM dans le conteneur, jamais
   * importé : ce module ne peut pas dépendre de `@nodefony/security`, qui
   * porte la cryptographie et survit à la production, lui non.
   */
  // `requirements.methods`, pas l'option `method` : seule la première
  // restreint le match — avec la seconde, cette route servait aussi `GET`.
  @route("devkit-mcp", { path: "/mcp", requirements: { methods: ["POST"] } })
  mcp(@Body() body: unknown) {
    const kernel = Nodefony.getKernel();
    return serveMcp(this, body, {
      settings: this.#service().mcpSettings(),
      modules: kernel?.modules,
      verifier:
        this.get<IAccessTokenVerifier>(ACCESS_TOKEN_VERIFIER) ?? undefined,
      operatorRoles: DEV_OPERATOR_ROLES,
      serverInfo: {
        name: kernel?.projectName ?? "nodefony",
        version: Nodefony.version,
      },
    });
  }

  /**
   * `GET` et `DELETE /nodefony/mcp` — refusés en `405`, avec `Allow: POST`.
   *
   * Sans cette route, la requête tombait dans le repli SPA du Studio
   * (`/nodefony/{page}`) : `200` + HTML, que le client prenait pour un flux
   * rompu et rouvrait à chaque seconde, indéfiniment.
   */
  @route("devkit-mcp-unsupported", {
    path: "/mcp",
    requirements: { methods: ["GET", "DELETE"] },
  })
  unsupported() {
    return writeMcpResponse(
      this,
      rejectUnsupportedMcpMethod(this.#service().mcpSettings()),
    );
  }
}

export default McpController;
