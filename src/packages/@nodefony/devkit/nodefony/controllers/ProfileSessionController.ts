import { route, controller, Controller } from "@nodefony/framework";
import type { ContextType } from "@nodefony/http";
import type { IDevkitService } from "../interfaces/IDevkitService";
import { PROFILE_TICKET_HEADER } from "../src/profileTicket";
import {
  isProfileSessionFlow,
  isProfileSessionStore,
  openProfileSession,
  PROFILE_SESSION_FACTOR,
  toProfileSessionUser,
} from "../src/profileSession";

/**
 * Ouvre la session au nom de laquelle `nodefony_profile_route` tire ses
 * requêtes.
 *
 * ## Pourquoi une route, et pas un cookie fabriqué à côté
 *
 * Une session ne s'ouvre que par le flux de session de l'application
 * (`authFlow.establishSessionFor`) : il revérifie le compte (actif, non
 * verrouillé), régénère l'identifiant et écrit l'audit. Ce flux exige une
 * requête en cours ; l'outil lui en envoie donc une, en boucle locale, et
 * récupère le cookie que la réponse pose. Fabriquer la session sans requête
 * aurait recopié la règle de connexion — deux copies divergent.
 *
 * ## Ce qui protège cette route
 *
 * - **Un ticket à usage unique** (`x-nodefony-profile-ticket`), émis dans le
 *   process par l'outil, valable dix secondes, jamais affiché ni journalisé.
 *   L'identité est fixée à l'émission : la requête n'en porte aucune.
 * - **La localité de l'appelant**, contrôlée avant tout.
 * - **La `policy: "dev"`** du module : la route n'existe pas en production.
 *
 * Elle vit sous `/nodefony/devkit/`, hors du motif de la zone d'administration
 * (`^/nodefony/[^/]+/api`), qui exigerait une session déjà ouverte.
 */
// Littéraux, et non les constantes : les outils qui lisent le source sans
// l'exécuter (revue de sécurité, inventaire des routes) doivent voir le chemin.
// L'égalité avec PROFILE_SESSION_PATH est tenue par un test.
@controller("/nodefony/devkit")
class ProfileSessionController extends Controller {
  constructor(context: ContextType) {
    super("devkit-profile-session", context);
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
   * `POST /nodefony/devkit/profile-session` — rachète le ticket et ouvre la
   * session. `200` rend le compte et le pseudonyme de session ; tout refus est
   * un `403` au message unique ; `503` quand l'application n'a pas de flux de
   * session.
   */
  @route("devkit-profile-session", {
    path: "/profile-session",
    requirements: { methods: ["POST"] },
  })
  async profileSession() {
    const context = this.context;
    if (!context?.request) {
      throw new Error("profile-session : aucun contexte de requête");
    }
    const flow: unknown = this.get("authFlow");
    const sessions: unknown = this.get("sessions");
    const verdict = await openProfileSession(
      {
        ticket: context.request.headers[PROFILE_TICKET_HEADER],
        remoteAddress: context.remoteAddress ?? undefined,
      },
      {
        tickets: this.#service().issuedProfileTickets(),
        establish: isProfileSessionFlow(flow)
          ? async (identifier) =>
              toProfileSessionUser(
                await flow.establishSessionFor(
                  context,
                  identifier,
                  PROFILE_SESSION_FACTOR,
                ),
                identifier,
              )
          : null,
        sessionRef: () => {
          const id = context.session?.id;
          return typeof id === "string" && isProfileSessionStore(sessions)
            ? sessions.sessionRef(id)
            : null;
        },
      },
    );
    return this.renderJson(verdict, verdict.status);
  }
}

export default ProfileSessionController;
