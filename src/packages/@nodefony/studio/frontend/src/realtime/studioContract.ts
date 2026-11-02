/**
 * studioContract — le **contrat temps réel de Studio**, déclaré une fois pour les
 * deux bouts de `WS /nodefony/studio/api/realtime`.
 *
 * Le serveur l'implémente (`StudioRealtimeController extends
 * ContractRealtimeController<StudioContract>`) : une méthode oubliée ou mal formée
 * ne compile pas. Le navigateur l'ouvre (`NodefonySocket.fromContract<StudioContract>`,
 * `RootStore`) : la santé de la socket se lit `RealtimeHealthReport` sans conversion,
 * et chaque appel RPC rend le type que le serveur s'est engagé à servir.
 *
 * Types seuls : 0 octet compilé. Il vit côté front parce que c'est là que la
 * frontière est stricte — le bundle du navigateur n'importe aucun module serveur,
 * alors que l'import de TYPES que fait le contrôleur s'efface à la compilation.
 *
 * Ce que le contrat ne valide PAS : les paramètres arrivent du réseau. Les
 * handlers du serveur les reçoivent `unknown` et les vérifient eux-mêmes ; le
 * type `in` ne décrit que ce qu'un client conforme envoie.
 */
import type {
  IPlatformRealtimeContract,
  IScaffoldChange,
  KernelPingResult,
  NodefonySocket,
  PLATFORM_CHANNELS,
  PLATFORM_METHODS,
  PlatformServerToClient,
  ThroughputPayloadSize,
} from "nodefony/client";
import type {
  IScaffoldCancelResult,
  IScaffoldJobState,
  ScaffoldStep,
  TAnswers,
} from "../routes/create/createModel";

/** Réponse de `nodefony:kernel:gc` — delta du tas, ou `available: false` sans `--expose-gc`. */
export interface IKernelGcResult {
  available: boolean;
  /** Tas utilisé avant le cycle (octets). */
  before?: number;
  /** Tas utilisé après le cycle (octets). */
  after?: number;
  /** Octets libérés (`before - after`). */
  freed?: number;
}

/**
 * Réponse de `nodefony:scaffold:preview` — le PLAN d’une génération, sans
 * rien écrire : la destination résolue et chaque fichier créé ou réécrit (avec
 * son contenu actuel quand il serait remplacé).
 */
export interface IScaffoldPreview {
  dest: string;
  changes: IScaffoldChange[];
}

/** Réponse de `nodefony:realtime:throughput` — la charge de taille fixe demandée. */
export interface IThroughputResult {
  size: ThroughputPayloadSize;
  bytes: Uint8Array<ArrayBuffer>;
}

/** Canaux de plateforme servis par Studio dont la charge n'a pas de forme publiée. */
type StudioUntypedChannel =
  "syslog" | "supervision" | "debugbar" | "ormHealth" | "ormFlow";

/**
 * Forme de chaque méthode de plateforme servie par Studio, rangée sous sa CLÉ
 * de `PLATFORM_METHODS` — le nom sur le fil vient de la constante, jamais
 * d'une chaîne recopiée. Une méthode ajoutée à `PLATFORM_METHODS` sans forme
 * ici ne compile pas.
 */
interface IStudioMethodShapes {
  /** Liveness + base du temps d'aller-retour. */
  ping: { out: KernelPingResult };
  /** Force un cycle GC si le pod tourne avec `--expose-gc`. */
  gc: { out: IKernelGcResult };
  /** Plan d’un scaffold sans rien écrire — mêmes réponses, mêmes gardes que `run`. */
  scaffoldPreview: {
    in: { type: string; answers?: TAnswers };
    out: IScaffoldPreview;
  };
  /** Démarre un job de génération ; la suite se lit sur `nodefony:scaffold:job@<id>`. */
  scaffoldRun: {
    in: { type: string; answers?: TAnswers; steps?: ScaffoldStep[] };
    out: IScaffoldJobState;
  };
  /** Arrête le process en cours d'un job. */
  scaffoldCancel: {
    in: { id: string };
    out: IScaffoldCancelResult;
  };
  /** Charge d'octets de taille fixe, pour mesurer un codec sur le fil. */
  throughput: {
    in: { size: ThroughputPayloadSize };
    out: IThroughputResult;
  };
}

/**
 * Le contrat de la socket de Studio : les canaux de plateforme
 * (`nodefony:socket` → `RealtimeHealthReport`) et les six méthodes que le
 * contrôleur sert.
 */
export interface StudioContract extends IPlatformRealtimeContract {
  /**
   * Les canaux que le contrôleur annonce au handshake. `nodefony:socket` a sa
   * forme publiée au cœur ; les autres n'en ont pas encore : déclarés par leur
   * nom, leur charge se lit `unknown` et l'appelant la vérifie. Les variantes
   * dynamiques (cadence `:<ms>`, forage `@<pid>`, job `@<uuid>`) ne s'annoncent
   * pas : la socket cliente s'y abonne par leur nom.
   */
  serverToClient: PlatformServerToClient & {
    [K in (typeof PLATFORM_CHANNELS)[StudioUntypedChannel]]: unknown;
  };
  /** Nom sur le fil (`PLATFORM_METHODS`) → forme ({@link IStudioMethodShapes}). */
  serverMethods: {
    [
      K in keyof typeof PLATFORM_METHODS as (typeof PLATFORM_METHODS)[K]
    ]: IStudioMethodShapes[K];
  };
}

/** La socket de Studio vue à travers son contrat (`RootStore.realtime`). */
export type StudioSocket = ReturnType<
  typeof NodefonySocket.fromContract<StudioContract>
>;
