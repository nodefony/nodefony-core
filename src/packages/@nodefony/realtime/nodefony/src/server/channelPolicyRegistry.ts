import { BootConfigurationError, Injector } from "nodefony";
import type { ChannelAdmissionClass, IChannelAdmission } from "nodefony";
import {
  declaresAction,
  getChannelPoliciesOf,
  isAdmissionClass,
} from "../../decorators/realtimeDecorators";
import type RealtimeHub from "./RealtimeHub";

/**
 * Résout l'instance d'une classe d'admission pour un canal — fournie par le module realtime au démarrage, absente à la poignée de main.
 */
export type AdmissionResolver = (
  admissionClass: ChannelAdmissionClass,
  channel: string,
) => IChannelAdmission;

/**
 * Inscrit au hub les politiques déclarées par une classe de contrôleur — une fois par classe et par hub, et seulement si l'inscription entière réussit.
 *
 * Appelée pour chaque contrôleur connu au démarrage du noyau, puis à la
 * poignée de main pour une classe qui y aurait échappé : celle-ci ne paie alors
 * qu'un `has`. Une politique refusée ne marque PAS la classe — elle est refusée
 * de nouveau à la poignée de main suivante plutôt que de laisser le canal
 * ouvert.
 *
 * @param hub - le hub qui porte le registre.
 * @param ctor - constructeur du contrôleur.
 * @param resolveAdmission - résolution des classes d'admission ; `null` hors
 *   démarrage, et le hub refuse alors une politique qui en désigne une.
 * @throws BootConfigurationError Politique illisible, `allow` posé sur une
 *   action, ou classe d'admission non résolue.
 */
export function registerControllerPolicies(
  hub: RealtimeHub,
  ctor: object,
  resolveAdmission: AdmissionResolver | null,
): void {
  if (hub.hasPolicyOwner(ctor)) return;
  const policies = getChannelPoliciesOf(ctor);
  if (policies !== null) {
    for (const name in policies) {
      const policy = policies[name];
      if (policy === undefined) continue;
      const allow = policy.allow;
      let admission: IChannelAdmission | undefined;
      if (allow !== undefined) {
        // Une action est jugée à CHAQUE appel par le verrou ; `allow` n'est
        // demandé qu'au `subscribe`. Posé sur une action, il ne garderait rien.
        if (declaresAction(ctor, name)) {
          throw new BootConfigurationError(
            `${typeof ctor === "function" ? ctor.name : "(contrôleur)"} : ` +
              `« allow » est posé sur l'action « ${name} » — il ne s'applique ` +
              `qu'aux canaux (demandé au subscribe). Une action se garde par ` +
              `authenticated, roles ou scopes.`,
          );
        }
        if (isAdmissionClass(allow) && resolveAdmission !== null) {
          admission = resolveAdmission(allow, name);
        }
      }
      hub.registerChannelPolicy(name, policy, admission);
    }
  }
  hub.addPolicyOwner(ctor);
}

/**
 * Fabrique la résolution des classes d'admission du démarrage : portée singleton exigée, instance du conteneur réutilisée, sinon construite UNE fois par l'injecteur.
 *
 * @param get - l'instance déjà construite d'une classe : le démarrage la lit
 *   dans le conteneur du noyau par sa clé (`null` tant que la classe n'y a
 *   jamais été rangée), le harnais de test parmi les instances que le test lui
 *   donne. `undefined` → construite par l'injecteur.
 * @param log - journal du module (une ligne par canal résolu).
 * @returns le résolveur, qui mémorise l'instance de chaque classe.
 */
export function createAdmissionResolver(
  get: (key: string | null, admissionClass: ChannelAdmissionClass) => unknown,
  log: (message: string) => void,
): AdmissionResolver {
  // Une classe sert souvent plusieurs canaux : une instance pour tous.
  // `Map` : clés = constructeurs (références), quelques entrées, lues au boot.
  const resolved = new Map<ChannelAdmissionClass, IChannelAdmission>();
  return (admissionClass, channel) => {
    let admission = resolved.get(admissionClass);
    if (admission === undefined) {
      admission = resolveAdmissionInstance(admissionClass, channel, get);
      resolved.set(admissionClass, admission);
    }
    log(`canal ${channel}, admission ${admissionClass.name}, résolue`);
    return admission;
  };
}

/** Résout l'instance d'une classe d'admission ou refuse le démarrage en nommant la classe ET le canal. */
function resolveAdmissionInstance(
  admissionClass: ChannelAdmissionClass,
  channel: string,
  get: (key: string | null, admissionClass: ChannelAdmissionClass) => unknown,
): IChannelAdmission {
  const where = `canal temps réel « ${channel} » : la classe d'admission ${admissionClass.name}`;
  // Garde redoublée : `isAdmissionClass` l'a déjà dit, mais c'est ce prédicat
  // qui donne à TypeScript le constructeur de service que l'injecteur exige.
  if (!Injector.isInjectable(admissionClass)) {
    throw new BootConfigurationError(`${where} ne porte pas @injectable`);
  }
  const scope = Injector.scopeOf(admissionClass);
  if (scope !== "singleton") {
    throw new BootConfigurationError(
      `${where} est de portée « ${scope} » : une seule instance sert tous ` +
        `les abonnés en même temps, elle doit être un singleton (et ne garder ` +
        `aucun état par abonné).`,
    );
  }
  const key = Injector.containerKeyOf(admissionClass);
  let instance: unknown = get(key, admissionClass);
  if (!(instance instanceof admissionClass)) {
    try {
      instance = Injector.instantiate(admissionClass);
    } catch (error) {
      throw new BootConfigurationError(
        `${where} ne se résout pas — ${error instanceof Error ? error.message : String(error)}`,
        { cause: error },
      );
    }
  }
  if (
    !(instance instanceof admissionClass) ||
    typeof instance.allow !== "function"
  ) {
    throw new BootConfigurationError(`${where} n'a pas de méthode allow`);
  }
  return instance;
}
