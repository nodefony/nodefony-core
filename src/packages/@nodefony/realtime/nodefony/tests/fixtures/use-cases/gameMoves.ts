import { Inject, Module, Service, injectable } from "nodefony";
import { controller, route } from "@nodefony/framework";
import type { ContextType } from "@nodefony/http";
import {
  RealtimeChannel,
  RealtimeController,
  RealtimeInbound,
} from "../../../../index";
import type { IRealtimeConnection, RealtimePublish } from "../../../../index";

type Point = { x: number; y: number };
type Direction = { dx: number; dy: number };

/**
 * Le jeu : l'état partagé, les règles, le moteur. UN exemplaire par serveur —
 * le service singleton que `nodefony create service Arena` génère, déclaré
 * dans le module (`@services([ArenaService])`). Il ne connaît pas la socket :
 * il reçoit des directions, et rend des états.
 */
@injectable()
export class ArenaService extends Service {
  /** Rythme du serveur : au plus vingt états par seconde, quel que soit le nombre de joueurs. */
  static readonly TICK_MS = 50;
  /** Vitesse d'un joueur, en unités par seconde : c'est le SERVEUR qui l'applique. */
  static readonly SPEED = 200;
  /** L'arène va de 0 à `SIZE` sur chaque axe ; personne n'en sort. */
  static readonly SIZE = 1000;

  readonly #directions = new Map<string, Direction>();
  readonly #positions = new Map<string, Point>();

  constructor(module: Module) {
    super("arena", module.container ?? undefined, module.notificationsCenter);
  }

  /** Retient la DERNIÈRE direction d'un joueur, bornée à [-1, 1] : elle remplace la précédente. */
  steer(player: string, { dx, dy }: Direction): void {
    this.#directions.set(player, {
      dx: ArenaService.clamp(dx, -1, 1),
      dy: ArenaService.clamp(dy, -1, 1),
    });
  }

  /** Un pas de simulation, à la vitesse du serveur. `null` quand personne n'a bougé. */
  step(): Record<string, Point> | null {
    const stride = (ArenaService.SPEED * ArenaService.TICK_MS) / 1000;
    const center = ArenaService.SIZE / 2;
    let moved = false;
    for (const [player, { dx, dy }] of this.#directions) {
      const at = this.#positions.get(player);
      const from = at ?? { x: center, y: center };
      const to = {
        x: ArenaService.clamp(from.x + dx * stride, 0, ArenaService.SIZE),
        y: ArenaService.clamp(from.y + dy * stride, 0, ArenaService.SIZE),
      };
      if (at === undefined || to.x !== at.x || to.y !== at.y) {
        this.#positions.set(player, to);
        moved = true;
      }
    }
    return moved ? Object.fromEntries(this.#positions) : null;
  }

  /** Démarre le moteur : un pas tous les `TICK_MS`, publié s'il a changé le monde. Rend l'arrêt. */
  start(publish: (state: Record<string, Point>) => void): () => void {
    const timer = setInterval(() => {
      const state = this.step();
      if (state !== null) publish(state);
    }, ArenaService.TICK_MS);
    timer.unref(); // un serveur qui s'arrête n'attend pas le prochain pas
    return () => clearInterval(timer);
  }

  /** Où est ce joueur, selon le serveur. */
  position(player: string): Point | undefined {
    return this.#positions.get(player);
  }

  private static clamp(value: number, min: number, max: number): number {
    return Math.min(max, Math.max(min, value));
  }
}

// Sa socket : `/api/arena/realtime` (préfixe + route). Elle ne sert que les canaux déclarés ici.
@controller("/api/arena")
export class ArenaRealtime extends RealtimeController {
  // Instancié PAR CONNEXION : l'état du jeu ne peut pas vivre dans `this`. Il
  // vit dans `ArenaService`, le même pour tous, que l'injecteur fournit.
  constructor(
    context: ContextType,
    @Inject("ArenaService") private readonly arena: ArenaService,
  ) {
    super("ArenaRealtime", context);
  }

  // Le point d'entrée : `handleRealtime` fait tout le protocole et route vers les décorateurs.
  @route("arena-realtime", {
    path: "/realtime",
    requirements: { methods: ["WEBSOCKET"] },
  })
  async realtime(message: string | Uint8Array | null): Promise<void> {
    this.handleRealtime(message);
  }

  // Le joueur envoie ce qu'il VEUT faire (une direction), jamais où il EST.
  // Le rôle est contrôlé à la première commande, puis retenu sur la connexion.
  @RealtimeInbound("game:steer", { roles: ["ROLE_PLAYER"] })
  steer(
    params: unknown,
    _reply: unknown,
    connection: IRealtimeConnection,
  ): void {
    if (connection.userId === null || !ArenaRealtime.isDirection(params)) {
      return;
    }
    this.arena.steer(connection.userId, params);
  }

  // Le moteur démarre au PREMIER joueur abonné et s'arrête au DERNIER : la
  // fonction rendue est l'arrêt. Personne d'autre ne l'appelle.
  @RealtimeChannel("game:state", { roles: ["ROLE_PLAYER"] })
  state(channel: string, publish: RealtimePublish): () => void {
    return this.arena.start((state) => publish(channel, state));
  }

  /** Ce qui arrive du réseau n'est pas fiable : deux nombres finis, ou rien. */
  private static isDirection(value: unknown): value is Direction {
    return (
      typeof value === "object" &&
      value !== null &&
      "dx" in value &&
      "dy" in value &&
      typeof value.dx === "number" &&
      typeof value.dy === "number" &&
      Number.isFinite(value.dx) &&
      Number.isFinite(value.dy)
    );
  }
}
