import { Controller, route, Get, controller } from "@nodefony/framework";
import { Context } from "@nodefony/http";
import { Injector, RequestContext, inject } from "nodefony";
import {
  RequestProbe,
  RequestProbeConsumer,
  RequestProbeReader,
  probeTracker,
  requestProbeState,
} from "./requestProbe";

/**
 * Bancs de la portée `request` de l'injecteur (#485) sur le serveur réel.
 * Contrôleur de portée request (le défaut) : il peut recevoir des services
 * `request` par son constructeur.
 */
@controller("/nodefony/test/request-scope")
class RequestScopeController extends Controller {
  constructor(
    context: Context,
    @inject("RequestProbe") private readonly probe: RequestProbe,
    @inject("RequestProbeConsumer")
    private readonly consumer: RequestProbeConsumer,
  ) {
    super("RequestScopeController", context);
  }

  // Un exemplaire par requête, partagé par ses consommateurs, rangé sur le
  // scope de CETTE requête et retrouvé par une nouvelle résolution.
  @Get("/probe")
  probeHttp() {
    const reader = Injector.instantiate<RequestProbeReader>(RequestProbeReader);
    return this.renderJson({
      serial: this.probe.serial,
      requestId: RequestContext.getRequestId() ?? null,
      bornIn: this.probe.bornIn,
      sameInConsumer: this.consumer.probe === this.probe,
      sameOnResolve: reader.probe === this.probe,
      ownedByScope:
        RequestContext.getScope()?.get("requestProbe") === this.probe,
    });
  }

  // Ce que les exemplaires refermés ont laissé : nombre de `clean()` et leur
  // ordre, par numéro d'exemplaire.
  @Get("/state")
  state() {
    return this.renderJson({
      created: requestProbeState.created,
      cleanedBySerial: Object.fromEntries(requestProbeState.cleanedBySerial),
      cleanOrderBySerial: Object.fromEntries(
        requestProbeState.cleanOrderBySerial,
      ),
    });
  }

  /** Ouvre une époque : seuls les exemplaires nés après seront comptés. */
  @Get("/instances/mark")
  instancesMark() {
    probeTracker.mark();
    return this.renderJson({ epoch: probeTracker.epoch });
  }

  // Exemplaires de l'époque encore VIVANTS, après GC forcé. Le GC ne fait que
  // planifier les rappels de finalisation : on alterne GC et retour à la
  // boucle jusqu'à ce que le compte ne bouge plus (borné).
  @Get("/instances")
  async instances() {
    const gc = (globalThis as { gc?: () => void }).gc;
    const settled = () => probeTracker.finalized + probeTracker.scopesFinalized;
    let previous = -1;
    for (let i = 0; i < 5 && previous !== settled(); i++) {
      previous = settled();
      gc?.();
      await new Promise((r) => setTimeout(r, 0));
    }
    return this.renderJson({
      gc: gc !== undefined,
      epoch: probeTracker.epoch,
      created: probeTracker.created,
      finalized: probeTracker.finalized,
      alive: probeTracker.created - probeTracker.finalized,
      // Un scope par exemplaire : ce qui n'est pas réclamé est retenu.
      scopesAlive: probeTracker.created - probeTracker.scopesFinalized,
    });
  }

  // WebSocket : le scope est celui de la CONNEXION. Chaque message résout le
  // service à nouveau (lecteur transient) — même exemplaire du handshake à la
  // fermeture, nettoyé une fois quand la connexion se ferme.
  @route("request-scope-ws", {
    path: "/ws",
    requirements: { methods: ["WEBSOCKET"] },
  })
  async ws(message: string | Buffer | null | undefined) {
    const reader = Injector.instantiate<RequestProbeReader>(RequestProbeReader);
    return this.renderJson({
      handshake: message == null,
      serial: reader.probe.serial,
      sameAsController: reader.probe === this.probe,
    });
  }
}

export { RequestScopeController };
