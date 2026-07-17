import type Module from "../kernel/Module";
import type Kernel from "../kernel/Kernel";
import Service from "../Service";
import Container from "../Container";

/**
 * Service `Fetch` — façade DI au-dessus de l'API `fetch` **native** de Node.js.
 *
 * Depuis Node 21, `fetch`, `Response`, `Request` et `Headers` sont des globaux
 * stables (implémentation undici intégrée). Ce service les expose via le
 * conteneur d'injection (`@inject("Fetch")`) — la dépendance `node-fetch` n'est
 * donc plus nécessaire (un appel réseau de moins à bundler, perfs undici natives).
 *
 * `fetch` est lié à `globalThis` pour éviter le `TypeError: Illegal invocation`
 * quand il est appelé via `this.fetch(...)` (undici exige `globalThis` comme `this`).
 *
 * Posé au container par l'{@link Injector} à la construction du kernel : une
 * instance par kernel, partagée par tous ses consommateurs.
 */
class Fetch extends Service {
  public fetch: typeof globalThis.fetch;
  public Response: typeof globalThis.Response;
  public Request: typeof globalThis.Request;
  public Headers: typeof globalThis.Headers;
  /**
   * @param owner - porteur du service : le kernel (service core) ou un module.
   *   Seul son `container` est utilisé — c'est ce dont un `Service` a besoin pour exister.
   */
  constructor(owner: Module | Kernel) {
    super("Fetch", owner.container as Container);
    this.fetch = globalThis.fetch.bind(globalThis);
    this.Response = globalThis.Response;
    this.Request = globalThis.Request;
    this.Headers = globalThis.Headers;
  }
}

export default Fetch;
