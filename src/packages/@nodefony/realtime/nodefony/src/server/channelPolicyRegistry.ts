import { BootConfigurationError, Injector } from "nodefony";
import type { ChannelAdmissionClass, IChannelAdmission } from "nodefony";
import type { IChannelPolicy } from "../../interfaces/IChannelPolicy";
import {
  declaresAction,
  getDeclaredChannelPolicies,
  isAdmissionClass,
  samePolicy,
} from "../../decorators/realtimeDecorators";
import type RealtimeHub from "./RealtimeHub";
import { samePresence } from "./channelPresence";

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
 * Chaque nom est déclaré au hub SORTE PAR SORTE (lecture, écriture), sans
 * héritage : le hub les fusionne avec les motifs de toutes les classes
 * (ADR-0022 §6, décision 1 quater). Deux classes qui déclarent la même sorte
 * différemment sous un même nom refusent le démarrage : la seconde effaçait la
 * première sans un mot.
 *
 * @throws BootConfigurationError Politique illisible ou contredite, `allow`
 *   posé sur une action ou sur une écriture distincte de la lecture, classe
 *   d'admission non résolue, ou deux classes en désaccord sur un nom.
 */
export function registerControllerPolicies(
  hub: RealtimeHub,
  ctor: object,
  resolveAdmission: AdmissionResolver | null,
): void {
  if (hub.hasPolicyOwner(ctor)) return;
  const declared = getDeclaredChannelPolicies(ctor);
  if (declared !== null) {
    const owner = typeof ctor === "function" ? ctor.name : "(contrôleur)";
    for (const [name, { read, write }] of Object.entries(declared.kinds)) {
      // `allow` est une règle de LECTURE, demandée au `subscribe`. Sur une
      // écriture distincte de la lecture de la même classe, rien ne
      // l'évaluerait. (Le hub refuse aussi le cas où la lecture vient d'une
      // autre déclaration — un motif, une autre classe.)
      if (
        write?.allow !== undefined &&
        read !== null &&
        !samePolicy(read, write)
      ) {
        throw new BootConfigurationError(
          `${owner} : « allow » est posé sur l'écriture du canal « ${name} », ` +
            `qui déclare aussi une lecture différente — il ne s'applique qu'à la ` +
            `lecture (demandé au subscribe). Le poser sur @RealtimeChannel ; ` +
            `l'écriture se garde par authenticated, roles ou scopes.`,
        );
      }
      // La politique qui portera `allow` au subscribe : la lecture, sinon
      // l'écriture dont elle hérite.
      const allow = (read ?? write)?.allow;
      let admission: IChannelAdmission | undefined;
      if (allow !== undefined) {
        // Une action est jugée à CHAQUE appel par le verrou ; `allow` n'est
        // demandé qu'au `subscribe`. Posé sur une action, il ne garderait rien.
        if (declaresAction(ctor, name)) {
          throw new BootConfigurationError(
            `${owner} : « allow » est posé sur l'action « ${name} » — il ne ` +
              `s'applique qu'aux canaux (demandé au subscribe). Une action se ` +
              `garde par authenticated, roles ou scopes.`,
          );
        }
        if (isAdmissionClass(allow) && resolveAdmission !== null) {
          admission = resolveAdmission(allow, name);
        }
      }
      if (read !== null) claim(hub, name, "read", ctor, owner, read);
      if (write !== null) claim(hub, name, "write", ctor, owner, write);
      hub.declareChannelPolicy(name, read, write, admission);
    }
    // Le défaut fermé de chaque action : son écriture tant que rien d'exact ne
    // déclare le nom (aucune classe) et qu'aucun motif ne pose d'écriture.
    for (const name of declared.actions) hub.declareActionDefault(name);
  }
  hub.addPolicyOwner(ctor);
}

/**
 * Revendique une sorte de politique d'un nom pour cette classe — refuse le démarrage si une AUTRE classe en a déclaré une différente : le registre est unique par nom, une seule s'appliquerait.
 */
function claim(
  hub: RealtimeHub,
  name: string,
  kind: "read" | "write",
  ctor: object,
  owner: string,
  policy: IChannelPolicy,
): void {
  const previous = hub.claimChannelPolicy(name, kind, ctor, policy);
  if (
    previous === null ||
    previous.owner === ctor ||
    (samePolicy(previous.policy, policy) &&
      samePresence(previous.policy, policy))
  )
    return;
  const which = kind === "read" ? "LECTURE" : "ÉCRITURE";
  throw new BootConfigurationError(
    `canal temps réel « ${name} » : ${previous.ownerName} et ${owner} ` +
      `déclarent des politiques de ${which} différentes sous ce nom — le ` +
      `registre est unique par nom, une seule s'appliquerait. Les accorder, ou ` +
      `renommer l'un des canaux.`,
  );
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
