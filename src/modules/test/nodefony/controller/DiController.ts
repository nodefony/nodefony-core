import { Controller, route, controller } from "@nodefony/framework";
import { Context } from "@nodefony/http";
import { Nodefony } from "nodefony";
import type { Kernel } from "nodefony";

/**
 * Sonde d'intégration du conteneur d'injection — expose l'IDENTITÉ réelle des
 * services au runtime, ce qu'aucun test HTTP ne peut observer autrement (le
 * serveur vit dans un autre process).
 *
 * Elle répond à la seule question qui compte pour le DI en conditions réelles :
 * **les consommateurs d'un service partagent-ils bien LA même instance ?** Un
 * doublon ne casse rien de visible — chaque copie « marche » — mais son état
 * (cache, compteur, connexion) est dupliqué et perdu. Le dégât est silencieux :
 * c'est exactement ce que la couverture ne voyait pas.
 *
 * Vécu : `HttpKernel` déplacé de trois lignes dans le `@services([...])` de
 * `@nodefony/http` → chaque serveur recevait son HttpKernel privé.
 */
@controller("/nodefony/test/di")
class DiController extends Controller {
  constructor(context: Context) {
    super("DiController", context);
  }

  /**
   * Identité des services partagés, vue du container réel.
   *
   * `httpKernelShared` : les consommateurs de `HttpKernel` (sessions, serveurs,
   * upload) tiennent-ils tous la même instance que le container ? `true` = un
   * seul HttpKernel dans le process, ce que le scope `singleton` promet.
   *
   * @returns un JSON d'identités booléennes — jamais d'objet de service (fuite).
   */
  @route("di-probe", { path: "/probe", requirements: { methods: ["GET"] } })
  probe() {
    const kernel = Nodefony.getKernel() as Kernel;
    const httpKernel = kernel.get("HttpKernel");
    const sessions = kernel.get("sessions") as { httpKernel?: unknown } | null;
    const upload = kernel.get("upload") as { httpKernel?: unknown } | null;
    const http = kernel.get("http") as { httpKernel?: unknown } | null;

    // Un consommateur ABSENT ne prouve rien : on ne le compte pas comme partagé
    // (sinon un service disparu rendrait le test vert — un faux négatif).
    const consumers = [
      { name: "sessions", holder: sessions },
      { name: "upload", holder: upload },
    ].filter((c) => c.holder != null && c.holder.httpKernel !== undefined);

    return this.renderJson({
      httpKernelPresent: Boolean(httpKernel),
      consumersChecked: consumers.map((c) => c.name),
      // TOUS les consommateurs tiennent-ils l'instance du container ?
      httpKernelShared:
        Boolean(httpKernel) &&
        consumers.length > 0 &&
        consumers.every((c) => c.holder!.httpKernel === httpKernel),
      // Le module http expose-t-il la même instance (cohérence module↔container) ?
      moduleAgrees: http?.httpKernel ? http.httpKernel === httpKernel : null,
      // Fetch : posé au container → une seule instance pour tout le kernel.
      fetchPresent: Boolean(kernel.get("Fetch")),
    });
  }
}

export default DiController;
