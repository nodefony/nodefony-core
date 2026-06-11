import type {
  IBackplane,
  BackplaneHandler,
  IBackplaneInfo,
} from "../../interfaces/IBackplane.js";
import { resolveBackplaneOriginId } from "./originId.js";

/**
 * Backplane **mono-process no-op** — implémentation de RÉFÉRENCE du port
 * {@link IBackplane} quand il n'existe **aucun pair** (1 process = 1 pod).
 *
 * `publish` ne sort rien (pas de pair à qui propager), `onMessage` ne fire jamais
 * (rien n'arrive de l'extérieur) → 0 fan-out cross-process, le hub se comporte
 * exactement comme en local pur.
 *
 * Rôle : (1) matérialiser le contrat pour les tests (cible de vérification du câblage
 * du hub) ; (2) câblage explicite « backplane présent mais inactif ». NB perf : en
 * mono-process le {@link RealtimeHub} garde `#backplane === null` (0 overhead réel,
 * style lazy du fichier) — ce Loopback n'est donc PAS sur le hot path par défaut, il
 * sert à prouver que brancher un backplane ne change rien tant qu'il n'y a pas de pair.
 *
 * SERVEUR uniquement (`process.pid`) — pas isomorphe.
 */
export class LoopbackBackplane implements IBackplane {
  /** Nom du driver — source unique du littéral (registre + config). */
  static readonly driver = "loopback";

  readonly originId: string;

  constructor(originId: string = resolveBackplaneOriginId()) {
    this.originId = originId;
  }

  start(): void {
    /* no-op — aucun transport */
  }

  publish(_channel: string, _payload: unknown): void {
    /* no-op — aucun pair */
  }

  onMessage(_handler: BackplaneHandler): void {
    /* no-op — rien n'arrive jamais */
  }

  stop(): void {
    /* no-op */
  }

  describe(): IBackplaneInfo {
    return {
      driver: LoopbackBackplane.driver,
      kind: "local",
      originId: this.originId,
      crossPod: false,
    };
  }
}

export default LoopbackBackplane;
