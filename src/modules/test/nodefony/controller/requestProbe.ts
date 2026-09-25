import { Service, injectable, inject, RequestContext } from "nodefony";
import type { Container, Scope } from "nodefony";

/**
 * Sondes de la portée `request` de l'injecteur (#485), relues par les bancs
 * d'intégration et le gate mémoire. L'état vit au niveau du module : les
 * services sont par requête, ils ne survivraient pas à la leur.
 */
export const requestProbeState = {
  /** Exemplaires de `RequestProbe` construits depuis le démarrage. */
  created: 0,
  /** Nombre de `clean()` reçus, par numéro d'exemplaire. */
  cleanedBySerial: {} as Record<number, number>,
  /** Ordre des `clean()` d'une requête, par numéro de son `RequestProbe`. */
  cleanOrderBySerial: {} as Record<number, string[]>,
};

const recordClean = (serial: number, who: string): void => {
  (requestProbeState.cleanOrderBySerial[serial] ??= []).push(who);
};

/**
 * Compteur EXACT des exemplaires de `RequestProbe` encore vivants, par
 * `FinalizationRegistry` : un service par requête retenu après la fermeture de
 * son scope se voit ici, là où la pente du tas ne le chiffre qu'en octets.
 * Tenu par ÉPOQUE (`mark()`), comme le traceur de contextes d'`AlsController` :
 * sans cela, la base compterait les exemplaires du test précédent que le GC
 * n'a pas encore réclamés.
 */
export const probeTracker = {
  epoch: 0,
  created: 0,
  finalized: 0,
  /** Scopes qui ont porté un `RequestProbe` : réclamés eux aussi, ou retenus. */
  scopesFinalized: 0,
  registry: new FinalizationRegistry<number>((epoch) => {
    if (epoch === probeTracker.epoch) probeTracker.finalized++;
  }),
  scopes: new FinalizationRegistry<number>((epoch) => {
    if (epoch === probeTracker.epoch) probeTracker.scopesFinalized++;
  }),
  mark(): void {
    probeTracker.epoch++;
    probeTracker.created = 0;
    probeTracker.finalized = 0;
    probeTracker.scopesFinalized = 0;
  },
};

/** Service de portée `request` : un exemplaire par requête, par connexion WS. */
@injectable({ name: "RequestProbe", scope: "request" })
export class RequestProbe extends Service {
  readonly serial: number;
  /** Identifiant de la requête (ou de la connexion) qui l'a fait naître. */
  readonly bornIn: string | null;

  constructor(scope: Scope) {
    super("requestProbe", scope, false);
    this.serial = ++requestProbeState.created;
    this.bornIn = RequestContext.getRequestId() ?? null;
    probeTracker.created++;
    probeTracker.registry.register(this, probeTracker.epoch);
    probeTracker.scopes.register(scope, probeTracker.epoch);
  }

  override clean(syslog = false): void {
    requestProbeState.cleanedBySerial[this.serial] =
      (requestProbeState.cleanedBySerial[this.serial] ?? 0) + 1;
    recordClean(this.serial, "requestProbe");
    super.clean(syslog);
  }
}

/** Service `request` qui dépend du précédent : créé après lui, nettoyé avant. */
@injectable({ name: "RequestProbeConsumer", scope: "request" })
export class RequestProbeConsumer extends Service {
  constructor(
    scope: Scope,
    @inject("RequestProbe") readonly probe: RequestProbe,
  ) {
    super("requestProbeConsumer", scope, false);
  }

  override clean(syslog = false): void {
    recordClean(this.probe.serial, "requestProbeConsumer");
    super.clean(syslog);
  }
}

/**
 * Lecteur TRANSIENT : instancié à chaque message WebSocket, il RÉSOUT le
 * service `request` à nouveau — c'est ce qui prouve que la résolution rend
 * l'exemplaire de la connexion, et pas seulement une référence gardée par le
 * contrôleur.
 */
@injectable({ name: "RequestProbeReader", scope: "transient" })
export class RequestProbeReader extends Service {
  constructor(@inject("RequestProbe") readonly probe: RequestProbe) {
    super("requestProbeReader", probe.container as Container, false);
  }
}
