import { Inject } from "nodefony";
import { route, controller } from "@nodefony/framework";
import type { ContextType } from "@nodefony/http";
import {
  ContractRealtimeController,
  RealtimeChannel,
  RealtimePolicy,
} from "@nodefony/realtime";
import type { ContractRealtimePublish } from "@nodefony/realtime";
import {
  DEMO_PULSE_CHANNEL,
  type DemoContract,
} from "../../frontend/src/pulse";
import type DemoPulseService from "../service/DemoPulseService";

/**
 * La socket de la démo, `/demo/realtime` : le pouls de l'accueil (D4).
 *
 * Guide pour un agent : une socket TYPÉE par un contrat partagé
 * (`frontend/src/pulse.ts`) — le serveur et la page lisent le même fichier, et
 * une faute de nom ou de charge ne compile d'aucun côté. `extends
 * ContractRealtimeController<C>` exige la table `realtimeActions()` COMPLÈTE :
 * une méthode du contrat oubliée est une erreur de compilation. Équivalent
 * généré (sans contrat) : `npx nodefony create controller --kind realtime`.
 *
 * Lecture publique, assumée et ÉCRITE : le pouls ne porte que des compteurs.
 * Un canal sans politique est libre ; une méthode, fermée par défaut — d'où
 * `@RealtimePolicy`, qui l'ouvre à la déclaration.
 */
@controller("/demo")
@RealtimePolicy({ "demo:pulse:now": { authenticated: false } })
class DemoRealtimeController extends ContractRealtimeController<DemoContract> {
  // Instancié PAR CONNEXION : le pouls vit dans le service, le même pour tous.
  constructor(
    context: ContextType,
    @Inject("DemoPulseService") private readonly pulse: DemoPulseService,
  ) {
    super("demo-realtime", context);
  }

  /** Point d'entrée : `handleRealtime` porte tout le protocole. */
  @route("demo-realtime", {
    path: "/realtime",
    requirements: { methods: ["WEBSOCKET"] },
  })
  async realtime(message: string | Uint8Array | null): Promise<void> {
    this.handleRealtime(message);
  }

  /** Les méthodes du contrat — toutes, par cette table seule. */
  protected realtimeActions() {
    return { "demo:pulse:now": () => this.pulse.snapshot() };
  }

  /**
   * Le canal d'état. Sa fabrique tourne au PREMIER abonné de ce processus, son
   * retour au départ du dernier : le pouls ne publie que pour qui regarde.
   */
  @RealtimeChannel(DEMO_PULSE_CHANNEL)
  pulseChannel(
    _channel: string,
    publish: ContractRealtimePublish<DemoContract>,
  ): () => void {
    return this.pulse.attach((value) => publish("demo:pulse", value));
  }
}

export default DemoRealtimeController;
