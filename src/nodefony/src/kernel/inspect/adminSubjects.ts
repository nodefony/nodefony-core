import type {
  IAdminApi,
  IAdminEndpoint,
  IAdminRequest,
} from "../../types/IAdminApi";
import { resolveAdminRole } from "../adminPlane/adminRbac";
import type { IAdminCaller } from "../adminPlane/adminCaller";
import {
  executeAdminEndpoint,
  normalizeAdminResult,
} from "../adminPlane/executeAdmin";

/**
 * Ce qu'un sujet inspectable désigne : où le lire dans le plan d'administration.
 */
export interface IInspectSubject {
  /** Producteur d'administration (`kernel`, `framework`, `orm`…). */
  namespace: string;
  /** Chemin de l'endpoint, tel que le producteur le déclare. */
  path: string;
  /** Ce que le sujet montre, en une ligne. */
  summary: string;
  /** Nom du paramètre attendu, quand le chemin en porte un (`module/{name}`). */
  param?: string;
}

/**
 * Sujets inspectables, et l'endpoint d'administration qui les sert.
 *
 * **Aucune donnée n'est calculée ici.** Chaque sujet pointe le producteur qui
 * répond déjà en HTTP : toutes les portes rendent le même objet, parce que
 * c'est le même code qui le produit. Une table de correspondance peut se
 * périmer ; une réimplémentation, elle, diverge en silence — et c'est la porte
 * secondaire qu'on croirait sur parole.
 *
 * ⚠️ Cette table est la SOURCE UNIQUE des sujets. La commande `inspect`, le
 * serveur MCP et toute porte future la lisent ici — aucune n'en tient une
 * copie.
 */
export const INSPECT_SUBJECTS: Record<string, IInspectSubject> = {
  routes: {
    namespace: "framework",
    path: "routes",
    summary: "toutes les routes (chemin, méthodes, controller, action)",
  },
  modules: {
    namespace: "kernel",
    path: "modules",
    summary: "modules chargés, avec leur version",
  },
  services: {
    namespace: "kernel",
    path: "services",
    summary: "services enregistrés, et le module qui les porte",
  },
  config: {
    namespace: "kernel",
    path: "config",
    summary: "config effective de chaque module (+ schéma, + provenance)",
  },
  module: {
    namespace: "kernel",
    path: "module/{name}",
    summary: "un module en détail (config, services, dépendances)",
    param: "name",
  },
  stores: {
    namespace: "kernel",
    path: "stores",
    summary: "où sont réellement écrites les données (sessions, cache…)",
  },
  entities: {
    namespace: "orm",
    path: "entities",
    summary: "entités déclarées à l'ORM",
  },
  graph: {
    namespace: "orm",
    path: "graph",
    summary: "graphe des entités et de leurs relations",
  },
};

/**
 * Extrait la donnée d'une réponse d'administration.
 *
 * Un handler rend soit la donnée, soit une enveloppe `{status, body}` (pour
 * porter un 404). Même discrimination que le pont HTTP : enveloppe **si et
 * seulement si** `body` est présent AVEC `status` ou `headers` — un objet
 * métier qui posséderait un champ `body` n'est pas une enveloppe.
 */
export function unwrapAdminResult(result: unknown): {
  status: number;
  data: unknown;
} {
  const { status, body } = normalizeAdminResult(result);
  return { status, data: body };
}

/** Pourquoi une lecture de sujet n'a pas abouti — chaque porte le traduit. */
export type InspectFailure =
  /** Le sujet demandé n'est pas dans {@link INSPECT_SUBJECTS}. */
  | "unknown-subject"
  /** Le sujet exige un paramètre qui n'a pas été fourni. */
  | "missing-target"
  /** Le module qui sert ce sujet n'est pas chargé dans cette application. */
  | "producer-missing"
  /** Le producteur existe mais ne déclare pas cet endpoint (version ?). */
  | "endpoint-missing"
  /** Le handler a levé. */
  | "handler-failed"
  /** Le handler a répondu un statut d'erreur (404 sur une cible inconnue). */
  | "not-found"
  /**
   * L'appelant n'a pas le rôle exigé par l'endpoint.
   *
   * Distinct de `not-found` : confondre « tu n'as pas le droit » avec « ça
   * n'existe pas » envoie chercher une cible valide au lieu d'un jeton.
   */
  | "forbidden";

/** Résultat d'une lecture de sujet : la donnée, ou la raison de l'échec. */
export type InspectResult =
  | { ok: true; status: number; data: unknown }
  | {
      ok: false;
      reason: InspectFailure;
      message: string;
      status?: number;
      /**
       * Le corps que le PRODUCTEUR a préparé pour ce refus, quand il en a
       * préparé un — le plan d'une page dont la section demandée n'existe pas,
       * la liste des valeurs acceptées, le nom du champ fautif.
       *
       * ⚠️ Ce champ a été ajouté parce que son absence faisait conclure
       * l'inverse de la vérité : un refus « section inconnue » (la page existe,
       * son plan est joint) arrivait à l'appelant sous la forme « introuvable
       * (404) », et un agent en déduisait que la PAGE n'existait pas. Une porte
       * qui résume un refus lui fait dire autre chose.
       */
      body?: unknown;
    };

/** Vue minimale du broker dont cette lecture a besoin. */
export interface IAdminBrokerLike {
  list(): readonly IAdminApi[];
}

/** Ce qu'il faut pour joindre un endpoint du plan d'administration. */
export interface IAdminCall {
  /** Producteur d'administration (`kernel`, `framework`, `orm`…). */
  namespace: string;
  /** Chemin de l'endpoint, tel que le producteur le déclare. */
  path: string;
  /** Variables de route, quand le chemin en porte (`module/{name}`). */
  params?: Readonly<Record<string, string>>;
  /** Paramètres de requête, tels qu'une URL les porterait. */
  query?: Readonly<Record<string, string | string[]>>;
  /** Ce qu'on nomme dans les messages d'échec — le sujet, la cible, l'appel. */
  label?: string;
}

/**
 * Appelle un endpoint du plan d'administration, hors HTTP.
 *
 * ⭐ **Une source, plusieurs portes** : cette fonction ne fait que RÉSOUDRE
 * l'endpoint (par producteur et chemin, là où la route HTTP le résout par nom
 * de route), puis délègue à {@link ../adminPlane/executeAdmin.executeAdminEndpoint} —
 * la même exécution que le transport HTTP. Autorisation, normalisation du
 * retour et traduction des erreurs sont donc identiques par CONSTRUCTION, et
 * non par vigilance.
 *
 * Ce que la version précédente perdait : elle appelait le handler directement
 * et ne gardait, d'un statut d'erreur, que le nombre. Le corps préparé par le
 * producteur — le plan d'une page, les valeurs acceptées — disparaissait, et
 * l'appelant concluait l'inverse de la vérité. Il voyage désormais entier
 * ({@link InspectResult}`.body`).
 *
 * Le rôle d'administrateur est **annoncé**, pas contourné : certains
 * producteurs graduent leur réponse selon les rôles, et un appelant qui se
 * présenterait en anonyme obtiendrait une vue amputée — il mentirait par
 * omission face à la même donnée lue en HTTP. Le contrôle d'accès du plan
 * d'administration protège le RÉSEAU ; la redaction des secrets, elle, vit dans
 * les producteurs et s'applique donc à toutes les portes.
 *
 * @param broker - le service `adminBroker` du conteneur
 * @param call - producteur, chemin, et ce qu'on lui passe
 * @returns la donnée du producteur, ou la raison précise de l'échec
 */
export async function callAdminEndpoint(
  broker: IAdminBrokerLike | undefined,
  call: IAdminCall,
  caller: IAdminCaller,
): Promise<InspectResult> {
  const label = call.label ?? `${call.namespace}/${call.path}`;
  const producer = broker
    ?.list()
    .find((api) => api.adminNamespace === call.namespace);
  if (!producer) {
    // Un producteur peut légitimement manquer : `orm` n'existe que si un
    // pilote a démarré. On le DIT, avec le module qu'il faudrait charger.
    return {
      ok: false,
      reason: "producer-missing",
      message: `« ${label} » est servi par le module « ${call.namespace} », qui n'est pas chargé dans cette app`,
    };
  }

  const endpoint = producer
    .adminEndpoints()
    .find((candidate: IAdminEndpoint) => candidate.path === call.path);
  if (!endpoint) {
    return {
      ok: false,
      reason: "endpoint-missing",
      message: `endpoint « ${call.namespace}/${call.path} » introuvable — version de module incompatible ?`,
    };
  }

  const request: IAdminRequest = {
    params: call.params ?? {},
    query: call.query ?? {},
    body: null,
    // L'identité vient de l'APPELANT, elle n'est plus fabriquée ici. C'est ce
    // qui fait mordre le contrôle de rôle : un jeton dont les scopes n'ouvrent
    // pas le plan d'administration se présente sans rôle, et se voit refusé.
    user: caller.user,
    roles: caller.roles,
  };

  let thrown: Error | null = null;
  const execution = await executeAdminEndpoint({
    endpoint,
    request,
    requiredRole: resolveAdminRole(endpoint),
    // `null` est un CHOIX : cette porte ne sert aujourd'hui que des lectures,
    // et l'idempotence est un no-op sur une méthode sûre. Le jour où elle
    // servira des mutations, l'absence de porte sera visible ICI — pas cachée
    // dans un paramètre qu'on aurait omis.
    gate: null,
    onServerError: (error) => {
      thrown = error;
    },
  });

  // Une panne du handler n'est pas un refus : on la distingue, comme avant, par
  // ce que la porte a NOTIFIÉ — pas en devinant depuis un statut 500 qu'un
  // producteur pourrait légitimement rendre lui-même.
  if (thrown) {
    return {
      ok: false,
      reason: "handler-failed",
      message: `inspection impossible : ${(thrown as Error).message}`,
    };
  }

  if (execution.status === 403) {
    const requis = (execution.body as { required?: string } | null)?.required;
    return {
      ok: false,
      reason: "forbidden",
      status: 403,
      message:
        `« ${label} » refusé — ${caller.label}` +
        (requis
          ? ` ne porte pas le rôle « ${requis} »`
          : " n'a pas le droit de lire ceci"),
      body: execution.body,
    };
  }

  if (execution.status >= 400) {
    return {
      ok: false,
      reason: "not-found",
      status: execution.status,
      message: `« ${label} » introuvable (${execution.status})`,
      // Le refus du producteur voyage ENTIER : c'est lui qui sait pourquoi il
      // refuse, et souvent ce qu'il fallait demander à la place.
      body: execution.body,
    };
  }
  return { ok: true, status: execution.status, data: execution.body };
}

/**
 * Lit un sujet d'inspection dans le plan d'administration.
 *
 * Résout le sujet dans {@link INSPECT_SUBJECTS}, puis délègue à
 * {@link callAdminEndpoint} — ce qui vaut pour l'appel vaut donc ici.
 *
 * @param broker - le service `adminBroker` du conteneur
 * @param subject - clé de {@link INSPECT_SUBJECTS}
 * @param target - valeur du paramètre, pour les sujets qui en portent un
 * @returns la donnée du producteur, ou la raison précise de l'échec
 */
export async function readAdminSubject(
  broker: IAdminBrokerLike | undefined,
  subject: string,
  caller: IAdminCaller,
  target?: string,
): Promise<InspectResult> {
  const spec = INSPECT_SUBJECTS[subject];
  if (!spec) {
    return {
      ok: false,
      reason: "unknown-subject",
      message: `sujet inconnu « ${subject} » — attendus : ${Object.keys(INSPECT_SUBJECTS).join(", ")}`,
    };
  }
  if (spec.param && !target) {
    return {
      ok: false,
      reason: "missing-target",
      message: `« ${subject} » attend un argument : ${spec.param}`,
    };
  }

  return callAdminEndpoint(
    broker,
    {
      namespace: spec.namespace,
      path: spec.path,
      params: spec.param && target ? { [spec.param]: target } : {},
      label: target ?? subject,
    },
    caller,
  );
}
