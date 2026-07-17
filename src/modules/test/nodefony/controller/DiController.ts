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

  /**
   * Round-trip du token : un service dont le NOM DE CLASSE diffère de sa clé
   * container est-il résoluble par son nom de classe ?
   *
   * 5 des 7 `@injectable` du repo divergent (`Router` → `"router"`,
   * `SessionsService` → `"sessions"`, `AdminBroker` → `"adminBroker"`…). Résoudre
   * par le nom interrogeait le container avec la mauvaise clé → `null` → service
   * RECONSTRUIT, cache vide, en silence. Le nom ne doit plus servir qu'à
   * retrouver la classe ; c'est elle qui sait où l'instance vit.
   *
   * @returns pour chaque service : sa clé container, et si son nom de classe
   *   retrouve bien LA même instance.
   */
  @route("di-tokens", { path: "/tokens", requirements: { methods: ["GET"] } })
  tokens() {
    const kernel = Nodefony.getKernel() as Kernel;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const injector = kernel.injector as any;

    // (nom de classe tel qu'enregistré par @injectable, clé container réelle)
    const cases: Array<[string, string]> = [
      ["Router", "router"],
      ["SessionsService", "sessions"],
      ["AdminBroker", "adminBroker"],
      ["MemoryIdempotencyStore", "idempotencyStore"],
      ["FrontendService", "frontend"],
      ["HttpKernel", "HttpKernel"], // le seul aligné — contrôle positif
    ];

    const results = cases.map(([className, containerKey]) => {
      const posed = kernel.get(containerKey);
      const Ctor = injector.constructor.injectables[className];
      const learned = Ctor ? injector.constructor.containerKeyOf(Ctor) : null;
      return {
        className,
        containerKey,
        posed: Boolean(posed),
        // La classe sait-elle où son instance vit ?
        learnedKey: learned,
        roundTrips: Boolean(posed) && learned === containerKey,
      };
    });

    return this.renderJson({
      // Tous les services POSÉS doivent round-tripper par leur nom de classe.
      allRoundTrip: results.every((r) => !r.posed || r.roundTrips),
      results,
    });
  }
}

export default DiController;
