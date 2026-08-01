import { route, controller, Controller } from "@nodefony/framework";
import type { ContextType } from "@nodefony/http";
import type { IDevkitService } from "../interfaces/IDevkitService";

/**
 * La carte de visite de l'application, servie en HTTP.
 *
 * ## Pourquoi cette route n'est pas `/`
 *
 * Ce qu'elle rend — modules chargés, chemins de documentation, commandes à
 * lancer — aide pendant le développement et n'est, en production, qu'une
 * divulgation de l'architecture. Elle vit donc dans un module `policy: "dev"`,
 * absent du boot en production, et sous le préfixe réservé `/nodefony` plutôt
 * qu'à la racine : `/` appartient à l'application, qui doit pouvoir y répondre
 * ce qu'elle assume devant ses utilisateurs.
 *
 * ## Pourquoi aucune garde `@IsGranted`
 *
 * Le module n'existe qu'en développement : c'est la `policy` qui le protège, pas
 * un rôle. Exiger un rôle imposerait `@nodefony/security` à toute application
 * qui installe le devkit — y compris celles qui n'ont pas de firewall du tout.
 * Une garde qui force une dépendance protège moins qu'elle ne coûte.
 *
 * **Mince par design** : la composition de la carte vit dans le service (et sa
 * construction dans une fonction pure) ; le controller ne fait que traduire en
 * HTTP.
 */
@controller("/nodefony/devkit/api")
class DevkitController extends Controller {
  constructor(context: ContextType) {
    super("devkit", context);
  }

  /** Résout le service depuis le conteneur partagé (clé d'instance). */
  #service(): IDevkitService {
    const svc = this.get<IDevkitService>("devkit");
    if (!svc) {
      throw new Error("DevkitService non enregistré");
    }
    return svc;
  }

  /**
   * `GET /nodefony/devkit/api/card` — qui répond, et où aller ensuite.
   *
   * La réponse est recalculée à chaque appel : elle décrit l'application TELLE
   * QU'ELLE EST, pas telle qu'elle était au démarrage.
   */
  @route("devkit-card", { path: "/card", method: "GET" })
  async card() {
    return this.renderJson(this.#service().getCard());
  }
}

export default DevkitController;
