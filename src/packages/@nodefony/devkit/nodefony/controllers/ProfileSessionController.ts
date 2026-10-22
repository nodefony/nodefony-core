import { route, controller, Controller } from "@nodefony/framework";
import type { ContextType } from "@nodefony/http";
import type { IDevkitService } from "../interfaces/IDevkitService";

/**
 * Ouvre la session au nom de laquelle `nodefony_profile_route` tire ses
 * requêtes.
 *
 * **Mince par design** : la mécanique (ticket à usage unique, localité,
 * ouverture par le flux de session de l'application, verdict uniforme) est la
 * porte `defineTicketSessionGate` de `@nodefony/ai`, définie dans
 * `DevkitService.profileSessionGate()`. Ce controller ne fait que DÉCLARER la
 * route, comme le ferait une application pour ses propres outils.
 *
 * Ce qui protège cette route : le ticket (émis dans le process, valable dix
 * secondes, jamais affiché ni journalisé, identité fixée à l'émission), la
 * localité de l'appelant (défaut de la porte), et la `policy: "dev"` du module.
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
    return this.#service().profileSessionGate().serve(this);
  }
}

export default ProfileSessionController;
