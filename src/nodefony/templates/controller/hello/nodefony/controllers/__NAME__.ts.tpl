import {
  route,
  controller,
  Controller,
  CurrentUser,
  Param,
<% if (it.roleGuard) { %>  IsGranted,
<% } %>} from "@nodefony/framework";
import type { ContextType } from "@nodefony/http";

/**
 * <%= it.nameClass %> — UN controller, DEUX protocoles (le différenciateur
 * Nodefony) : HTTP et WebSocket sont co-citoyens du même contexte controller,
 * même pipeline (firewall, audit, logs).
 *
 * Routes montées sous `<%= it.route %>` (couvertes par la zone firewall `^/api`
 * si tu as gardé le manifeste par défaut : identité résolue, jamais bloquante).
 *
 * C'est le MÊME gabarit qui sert le controller d'accueil d'une app neuve et
 * `nodefony create controller --kind hello` : le premier exemple que tu lis est
 * donc exactement celui que la commande te régénérera.
 */
<% if (it.roleGuard) { %>/**
 * Habilitation exigée pour TOUT ce controller.
 *
 * Posée sur la CLASSE : chaque action en hérite, y compris celles qu'on
 * ajoutera demain — c'est ce qui distingue une règle d'un rappel. Le refus
 * est rendu par le framework AVANT que le controller ne soit instancié
 * (403), donc aucune ligne de contrôle d'accès n'a sa place dans une action.
 *
 * L'administrateur y a accès sans porter ce rôle : `nodefony.config.ts` le
 * déclare sous `ROLE_ADMIN` dans `roleHierarchy` — administrer, c'est déjà
 * pouvoir tout consulter. Une hiérarchie vaut pour TOUTES les routes gardées
 * par ce rôle, présentes et futures ; lister les rôles un par un sur chaque
 * action ne généralise pas.
 */
@IsGranted("<%= it.role %>")
<% } %>@controller("<%= it.route %>")
class <%= it.nameClass %> extends Controller {
  constructor(context: ContextType) {
    super("<%= it.kebab %>", context);
  }

  // ── `initialize()` — le constructeur ASYNCHRONE du controller ──────────────
  // Un `constructor` ne peut pas être `async` : tout ce qui demande un `await`
  // avant l'action se fait ici. Le hook est optionnel — ne l'écris que si tu en
  // as besoin.
  //
  //   async initialize(): Promise<this> {
  //     this.setContextJson();                        // format de sortie
  //     const user = RequestContext.getUser();        // identité déjà résolue
  //     this.prefs = await this.get("prefs").load(user.identifier);
  //     return this;
  //   }
  //
  // Quand il tourne :
  //  • en HTTP — APRÈS le firewall et la garde `@IsGranted` : l'identité est
  //    résolue, et rien ne s'exécute pour un appelant qui sera rejeté ;
  //  • en WebSocket — AVANT l'accept du handshake, donc avant le firewall :
  //    l'identité n'y est PAS encore résolue. C'est en revanche la dernière
  //    fenêtre pour poser un cookie ou un en-tête sur la réponse de handshake.
  //    Pour de la mise en place par connexion AUTHENTIFIÉE, fais-la au
  //    handshake (`echo(null)` ci-dessous), qui lui est post-firewall.
  //
  // À ne pas y mettre : une décision d'autorisation (c'est `@IsGranted`, qui
  // s'évalue avant), ni un travail qu'une seule action sur cinq utilise — il
  // serait payé par toutes.

  @route("<%= it.kebab %>-index", { path: "<%= it.indexPath %>", method: "GET" })
  // `@CurrentUser()` injecte l'utilisateur posé dans l'ALS par le firewall.
  // `identifier` = identifiant fonctionnel ; l'anonyme est un VRAI user
  // (AnonymousUser, identifier "anon."), jamais null en zone firewall.
  async index(@CurrentUser() user?: { identifier?: string }) {
    const authenticated = !!user?.identifier && user.identifier !== "anon.";
    return this.renderJson({
      hello: "<%= it.helloName %>",
      pid: process.pid,
      who: authenticated ? user!.identifier! : "anonyme",
    });
  }

  /**
   * Une valeur PORTÉE PAR LE CHEMIN — et c'est la seule syntaxe de Nodefony qui
   * diffère de ce que tu connais ailleurs.
   *
   * Le segment variable s'écrit **`{name}`**, entre accolades. `:name` — la
   * forme d'Express, de Nest et de Fastify — compile, se monte, s'affiche dans
   * `nodefony inspect routes`… et ne correspond à AUCUNE URL réelle : il est
   * pris pour un segment littéral. Le symptôme est un 404 sur une route qu'on
   * VOIT dans le code. (`nodefony doctor` nomme ce cas et rend le chemin
   * corrigé.)
   *
   * La valeur se lit avec `@Param("name")`. Elle arrive aussi en argument
   * positionnel, dans l'ordre des variables du chemin, mais le décorateur
   * nomme ce qu'il injecte : il survit à un segment ajouté devant.
   *
   * Contraindre le format se fait dans le chemin : `{id}(\d+)` n'accepte que
   * des chiffres, et `/{slug}?` rend le segment optionnel.
   */
  @route("<%= it.kebab %>-greet", { path: "/hello/{name}", method: "GET" })
  async greet(@Param("name") name: string) {
    return this.renderJson({ hello: name, pid: process.pid });
  }

<% if (it.secureRoute) { %>  /**
   * Route PROTÉGÉE par la zone `secure` (`^/api/secure`, session SEULE — cf
   * nodefony.config.ts) : sans session, le firewall répond 401 AVANT d'entrer
   * ici. Le controller peut donc supposer un utilisateur authentifié.
   *
   * Elle n'est générée que pour l'app, parce qu'une route protégée n'a de sens
   * que si une ZONE la couvre — et c'est le manifeste de l'app qui la déclare.
   * Sous un autre préfixe (`/api/blog/secure/…`), la même méthode serait
   * ouverte à tous : un exemple qui enseigne le contraire de ce qu'il montre.
   */
  @route("<%= it.kebab %>-secure", { path: "/secure/hello", method: "GET" })
  async secureHello(@CurrentUser() user?: { identifier?: string }) {
    return this.renderJson({
      message: `Bonjour ${user?.identifier ?? "?"}`,
      zone: "secure",
      pid: process.pid,
    });
  }

<% } %>  /**
   * WebSocket natif : `wscat -c wss://127.0.0.1:5152<%= it.route %>/echo`
   * puis tape un message — la réponse repasse par le MÊME pipeline.
   *
   * ⚠ Cet echo BRUT est une DÉMO du pipeline HTTP/WS partagé, pas un modèle :
   * pour du WS métier (canaux pub/sub, actions RPC, reconnexion, policies),
   * génère la bonne couche — `nodefony create controller <nom> --kind realtime`
   * (socket Nodefony JSON-RPC, côté client `RealtimeClient`/hooks React).
   */
  @route("<%= it.kebab %>-echo", {
    path: "/echo",
    requirements: { methods: ["WEBSOCKET"] },
  })
  async echo(message: string | Buffer | null) {
    if (!message) {
      return this.renderJson({ handshake: true });
    }
    return this.renderJson({ echo: message.toString() });
  }
}

export default <%= it.nameClass %>;
