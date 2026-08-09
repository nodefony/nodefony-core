import type {
  IAdminApi,
  IAdminEndpoint,
  IAdminRequest,
} from "../../types/IAdminApi";

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
  if (
    result !== null &&
    typeof result === "object" &&
    "body" in result &&
    ("status" in result || "headers" in result)
  ) {
    const envelope = result as { status?: number; body: unknown };
    return { status: envelope.status ?? 200, data: envelope.body };
  }
  return { status: 200, data: result };
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
  | "not-found";

/** Résultat d'une lecture de sujet : la donnée, ou la raison de l'échec. */
export type InspectResult =
  | { ok: true; status: number; data: unknown }
  | { ok: false; reason: InspectFailure; message: string; status?: number };

/** Vue minimale du broker dont cette lecture a besoin. */
export interface IAdminBrokerLike {
  list(): readonly IAdminApi[];
}

/**
 * Lit un sujet d'inspection dans le plan d'administration.
 *
 * Le rôle d'administrateur est **annoncé**, pas contourné : certains
 * producteurs graduent leur réponse selon les rôles, et un appelant qui se
 * présenterait en anonyme obtiendrait une vue amputée — il mentirait par
 * omission face à la même donnée lue en HTTP. Le contrôle d'accès du plan
 * d'administration protège le RÉSEAU ; la redaction des secrets, elle, vit dans
 * les producteurs et s'applique donc à toutes les portes.
 *
 * @param broker - le service `adminBroker` du conteneur
 * @param subject - clé de {@link INSPECT_SUBJECTS}
 * @param target - valeur du paramètre, pour les sujets qui en portent un
 * @returns la donnée du producteur, ou la raison précise de l'échec
 */
export async function readAdminSubject(
  broker: IAdminBrokerLike | undefined,
  subject: string,
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

  const producer = broker
    ?.list()
    .find((api) => api.adminNamespace === spec.namespace);
  if (!producer) {
    // Un producteur peut légitimement manquer : `orm` n'existe que si un
    // pilote a démarré. On le DIT, avec le module qu'il faudrait charger.
    return {
      ok: false,
      reason: "producer-missing",
      message: `« ${subject} » est servi par le module « ${spec.namespace} », qui n'est pas chargé dans cette app`,
    };
  }

  const endpoint = producer
    .adminEndpoints()
    .find((candidate: IAdminEndpoint) => candidate.path === spec.path);
  if (!endpoint) {
    return {
      ok: false,
      reason: "endpoint-missing",
      message: `endpoint « ${spec.namespace}/${spec.path} » introuvable — version de module incompatible ?`,
    };
  }

  const request: IAdminRequest = {
    params: spec.param && target ? { [spec.param]: target } : {},
    query: {},
    body: null,
    user: null,
    roles: ["ROLE_NODEFONY_ADMIN"],
  };

  let status = 200;
  let data: unknown;
  try {
    ({ status, data } = unwrapAdminResult(await endpoint.handler(request)));
  } catch (error) {
    return {
      ok: false,
      reason: "handler-failed",
      message: `inspection impossible : ${(error as Error).message}`,
    };
  }

  if (status >= 400) {
    return {
      ok: false,
      reason: "not-found",
      status,
      message: `« ${target ?? subject} » introuvable (${status})`,
    };
  }
  return { ok: true, status, data };
}
