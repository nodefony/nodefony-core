/**
 * Suite de conformité d'un **driver de backplane** — la définition exécutable du
 * contrat {@link IBackplane}, une seule pour tous les drivers (ADR-0022 §6,
 * décision 4).
 *
 * Un driver écrit par un tiers (journal partitionné, bus de messages…) compile et
 * démarre même mal réglé : un groupe de lecteurs partagé entre serveurs répartit
 * les messages au lieu de les diffuser, une lecture depuis le début du journal
 * rejoue des fins de partie sur des parties rouvertes. Rien ne lève, tout se perd
 * en silence. Cette suite rend ces défauts visibles : elle relie plusieurs pairs du
 * driver sur un même bus et vérifie ce que le hub tient pour acquis.
 *
 * ```ts
 * import { describe, it } from "vitest";
 * import { runBackplaneConformance } from "@nodefony/realtime/testing";
 *
 * runBackplaneConformance("mon-bus", (secret) => new MonBackplane({ url, secret }), { describe, it });
 * ```
 *
 * Le lanceur de tests est PASSÉ, jamais importé : le paquet publié ne dépend
 * d'aucun lanceur, et la suite tourne sous vitest, `node:test` ou `bun test`. Les
 * assertions passent par `node:assert`, qu'ils rapportent tous.
 *
 * @packageDocumentation
 */
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { ownField, PLATFORM_BUS_CHANNELS, PLATFORM_CHANNELS } from "nodefony";
import type { IBackplane, IBackplaneMessage } from "../interfaces/IBackplane";
import { RealtimeHub } from "../src/server/RealtimeHub";
import {
  readControlOrder,
  type ControlOrder,
} from "../src/backplane/controlOrder";
import { DEFAULT_MAX_QUEUE_BYTES } from "../src/backplane/publishQueue";
import { presenceClient, presenceView } from "./presenceClient";

/**
 * Lanceur de tests de l'appelant — le sous-ensemble que la suite emploie.
 *
 * Formes compatibles telles quelles : `{ describe, it }` de vitest, de
 * `node:test` et de `bun:test`.
 */
export interface IConformanceRunner {
  /** Ouvre un groupe de cas. */
  describe(name: string, body: () => void): unknown;
  /** Déclare un cas asynchrone ; un rejet le fait échouer. */
  it(name: string, body: () => Promise<void>): unknown;
}

/**
 * Réglages de {@link runBackplaneConformance}.
 */
export interface IBackplaneConformanceOptions extends IConformanceRunner {
  /**
   * Le driver scelle-t-il ses messages (`sealBackplaneEnvelope`) ? Défaut `true`.
   * `false` n'est admis que pour un driver dont le bus ne quitte pas la machine :
   * un driver qui se déclare `crossPod` sans sceller fait échouer la suite.
   */
  sealed?: boolean;
  /**
   * Silence attendu, en millisecondes, avant de conclure qu'un message n'arrivera
   * PAS (refus, rejeu, écho). Défaut 100 ; à relever pour un bus lent.
   */
  quietMs?: number;
  /** Délai maximal d'arrivée d'un message attendu, en millisecondes. Défaut 2 000. */
  timeoutMs?: number;
  /**
   * Octets publiés d'une traite avant l'ordre du cas « ordre sous saturation ».
   * Défaut : deux fois le seuil par défaut de la file d'envoi (16 Mio). Un driver
   * dont la file est bornée plus haut relève cette valeur : si la rafale ne
   * sature pas la file que `describe().queue` déclare, le cas échoue plutôt que
   * de passer sans rien prouver.
   */
  floodBytes?: number;
}

/**
 * Fabrique d'un pair du driver, relié au MÊME bus que les autres pairs de la suite.
 *
 * Appelée plusieurs fois par cas : chaque appel rend un nouveau pair, d'`originId`
 * propre, non démarré (la suite appelle `start` et `stop`).
 *
 * @param secret - secret du sceau, ou `null` pour un bus nu.
 */
export type BackplanePeerFactory = (
  secret: string | null,
) => IBackplane | Promise<IBackplane>;

/** Noms des cas — stables : un test négatif les désigne. */
export const BACKPLANE_CONFORMANCE_CASES = {
  fanout:
    "diffusion : chaque pair reçoit TOUT, l'émetteur ne reçoit pas son écho",
  order:
    "ordre par émetteur : les publications d'un pair arrivent dans l'ordre",
  noReplay:
    "pas de rejeu : un pair démarré après une publication ne la reçoit pas",
  seal: "sceau : un message non scellé ou mal scellé est refusé",
  control: "ordres de contrôle : le canal de contrôle traverse intact",
  controlUnderLoad:
    "ordre sous saturation : un ordre de contrôle n'est jamais jeté pour faire place aux publications",
  aliveUnderLoad:
    "preuve de vie sous saturation : la preuve de vie de la présence n'est jamais jetée pour faire place aux publications",
  reserved:
    "espace réservé : refusé et compté à l'entrée du hub, la diffusion passe sans revenir",
  presence:
    "présence entre deux pods : chaque hub voit les présents de l'autre, l'arrêt propre les retire sans attendre l'oubli, sans doublon ni rejeu",
  replaceHandler: "onMessage remplace le handler précédent",
  stop: "stop coupe la réception, et se rappelle sans erreur",
} as const;

const POLL_MS = 5;

/** Charges de contrôle de fidélité : objet imbriqué, tableau, texte non ASCII. */
function sample(seq: number): { seq: number; text: string; list: unknown[] } {
  return { seq, text: "é — 😀", list: [seq, "a", null, { deep: true }] };
}

/** Un pair démarré et la boîte qui l'écoute depuis avant son démarrage. */
interface IOpenPeer {
  readonly peer: IBackplane;
  readonly inbox: Inbox;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function seqOf(payload: unknown): unknown {
  return typeof payload === "object" && payload !== null && "seq" in payload
    ? payload.seq
    : undefined;
}

function isFrom(payload: unknown, from: string): boolean {
  return (
    typeof payload === "object" &&
    payload !== null &&
    "from" in payload &&
    payload.from === from
  );
}

/** Attend qu'une condition tienne, ou échoue en nommant ce qui manquait (lu à l'échec). */
async function until(
  done: () => boolean,
  timeoutMs: number,
  what: () => string,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!done()) {
    if (Date.now() > deadline) {
      assert.fail(`délai dépassé (${timeoutMs} ms) : ${what()}`);
    }
    await sleep(POLL_MS);
  }
}

/**
 * Boîte de réception d'un pair, filtrée sur les canaux du cas courant. Posée
 * AVANT `start`, comme le hub le fait : un driver qui livrerait dès l'abonnement
 * (un rejeu, par exemple) est vu.
 */
class Inbox {
  readonly messages: IBackplaneMessage[] = [];
  readonly #prefix: string;

  constructor(peer: IBackplane, prefix: string) {
    this.#prefix = prefix;
    peer.onMessage((msg) => {
      if (msg.channel.startsWith(this.#prefix)) this.messages.push(msg);
    });
  }

  payloads(): unknown[] {
    return this.messages.map((m) => m.payload);
  }
}

/**
 * Déclare la suite de conformité d'un driver de backplane auprès du lanceur de
 * tests de l'appelant.
 *
 * Vérifie, sur plusieurs pairs reliés au même bus : la diffusion à TOUS les pairs
 * sans écho, l'ordre par émetteur, l'absence de rejeu au démarrage, le sceau
 * (message non scellé ou mal scellé refusé), le transport des ordres de contrôle,
 * même quand une rafale de publications sature la file d'envoi, le refus de
 * l'espace réservé à l'entrée du hub, la présence répartie entre deux hubs
 * (ADR-0025), le remplacement du handler et l'arrêt.
 *
 * @param name - nom du driver, affiché dans le rapport.
 * @param makePeer - fabrique d'un pair relié au bus commun.
 * @param options - le lanceur (`describe`, `it`) et les réglages.
 */
export function runBackplaneConformance(
  name: string,
  makePeer: BackplanePeerFactory,
  options: IBackplaneConformanceOptions,
): void {
  const sealed = options.sealed ?? true;
  const quietMs = options.quietMs ?? 100;
  const timeoutMs = options.timeoutMs ?? 2_000;
  const floodBytes = options.floodBytes ?? 2 * DEFAULT_MAX_QUEUE_BYTES;
  // Un secret par suite : deux suites sur le même bus ne se scellent pas mutuellement.
  const secret = sealed ? randomBytes(32).toString("hex") : null;
  const C = BACKPLANE_CONFORMANCE_CASES;

  /**
   * Cadre d'un cas : pairs ouverts puis tous arrêtés, et un préfixe de canal
   * unique — un bus partagé entre cas ne mélange jamais leurs messages.
   */
  const scenario = (
    body: (
      open: (peerSecret?: string | null) => Promise<IOpenPeer>,
      prefix: string,
    ) => Promise<void>,
  ): (() => Promise<void>) => {
    return async () => {
      const peers: IBackplane[] = [];
      const prefix = `conformance:${randomUUID()}:`;
      const open = async (
        peerSecret: string | null = secret,
      ): Promise<IOpenPeer> => {
        const peer = await makePeer(peerSecret);
        peers.push(peer);
        const inbox = new Inbox(peer, prefix);
        await peer.start();
        return { peer, inbox };
      };
      try {
        await body(open, prefix);
      } finally {
        await Promise.all(
          peers.map(async (p) => {
            await p.stop();
          }),
        );
      }
    };
  };

  options.describe(`conformité du backplane « ${name} »`, () => {
    options.it(
      C.fanout,
      scenario(async (open, prefix) => {
        const a = await open();
        const b = await open();
        const c = await open();
        // Plusieurs messages : un bus qui RÉPARTIT entre lecteurs passerait sur un seul.
        const sent = Array.from({ length: 10 }, (_, i) => sample(i));
        for (const p of sent) a.peer.publish(`${prefix}fanout`, p);

        await until(
          () =>
            b.inbox.messages.length >= sent.length &&
            c.inbox.messages.length >= sent.length,
          timeoutMs,
          () =>
            `B et C attendaient ${sent.length} messages, reçus ${b.inbox.messages.length} et ${c.inbox.messages.length} — le bus répartit-il les messages entre pairs ?`,
        );
        // Sentinelle de B, publiée après : sur un bus qui sert ses abonnés dans
        // l'ordre, l'écho de A serait arrivé avant elle.
        b.peer.publish(`${prefix}fanout`, { seq: -1 });
        await until(
          () => a.inbox.messages.some((m) => m.originId === b.peer.originId),
          timeoutMs,
          () => "A n'a pas reçu la sentinelle de B",
        );
        await sleep(quietMs);
        assert.deepEqual(
          b.inbox.payloads(),
          sent,
          "B : charges reçues fidèlement",
        );
        assert.deepEqual(
          c.inbox.messages
            .filter((m) => m.originId === a.peer.originId)
            .map((m) => m.payload),
          sent,
          "C : charges reçues fidèlement",
        );
        for (const m of b.inbox.messages)
          assert.equal(m.originId, a.peer.originId);
        assert.ok(
          a.inbox.messages.every((m) => m.originId === b.peer.originId),
          "l'émetteur a reçu son propre écho",
        );
      }),
    );

    options.it(
      C.order,
      scenario(async (open, prefix) => {
        const a = await open();
        const b = await open();
        const count = 100;
        for (let i = 0; i < count; i += 1)
          a.peer.publish(`${prefix}order`, { seq: i });

        await until(
          () => b.inbox.messages.length >= count,
          timeoutMs,
          () =>
            `B attendait ${count} messages, reçus ${b.inbox.messages.length}`,
        );
        assert.deepEqual(
          b.inbox.payloads().map(seqOf),
          Array.from({ length: count }, (_, i) => i),
          "ordre d'émission perdu — la clé de partition doit être l'émetteur, jamais le canal",
        );
      }),
    );

    options.it(
      C.noReplay,
      scenario(async (open, prefix) => {
        const a = await open();
        const witness = await open();
        a.peer.publish(`${prefix}replay`, { seq: 0 });
        // Le témoin prouve que le message est passé AVANT que le retardataire démarre.
        await until(
          () => witness.inbox.messages.length === 1,
          timeoutMs,
          () => "le témoin n'a pas reçu la première publication",
        );
        const late = await open();
        a.peer.publish(`${prefix}replay`, { seq: 1 });

        await until(
          () => late.inbox.messages.some((m) => seqOf(m.payload) === 1),
          timeoutMs,
          () =>
            "le pair démarré en retard n'a pas reçu la publication suivante",
        );
        await sleep(quietMs);
        assert.deepEqual(
          late.inbox.payloads().map(seqOf),
          [1],
          "rejeu au démarrage — lire à partir du dernier message, jamais depuis le début",
        );
      }),
    );

    options.it(
      C.seal,
      scenario(async (open, prefix) => {
        if (!sealed) {
          const { peer } = await open(null);
          assert.notEqual(
            peer.describe().crossPod,
            true,
            "un bus qui quitte la machine (crossPod) doit sceller : retirer `sealed: false`",
          );
          return;
        }
        const receiver = await open();
        const bare = await open(null);
        const forged = await open(randomBytes(32).toString("hex"));
        const genuine = await open();
        bare.peer.publish(`${prefix}seal`, { from: "non scellé" });
        forged.peer.publish(`${prefix}seal`, { from: "autre secret" });
        genuine.peer.publish(`${prefix}seal`, { from: "scellé" });

        await until(
          () =>
            receiver.inbox.messages.some((m) => isFrom(m.payload, "scellé")),
          timeoutMs,
          () => "le message scellé du bon secret n'est pas arrivé",
        );
        await sleep(quietMs);
        assert.deepEqual(
          receiver.inbox.payloads(),
          [{ from: "scellé" }],
          "un message non scellé ou mal scellé a été accepté",
        );
      }),
    );

    options.it(
      C.control,
      scenario(async (open, prefix) => {
        const a = await open();
        const b = await open();
        const got: ControlOrder[] = [];
        b.peer.onMessage((msg) => {
          if (msg.channel !== PLATFORM_BUS_CHANNELS.control) return;
          const order = readControlOrder(msg.payload);
          if (order?.channel.startsWith(prefix) === true) got.push(order);
        });
        const orders: ControlOrder[] = [
          { op: "close", channel: `${prefix}room` },
          {
            op: "evictUser",
            channel: `${prefix}chat`,
            user: "u-42",
            generation: 3,
          },
        ];
        for (const o of orders)
          a.peer.publish(PLATFORM_BUS_CHANNELS.control, o);

        await until(
          () => got.length >= orders.length,
          timeoutMs,
          () => `ordres de contrôle reçus : ${got.length} sur ${orders.length}`,
        );
        assert.deepEqual(got, orders);
      }),
    );

    /**
     * Rafale qui sature la file d'envoi de A, puis UN message sur un canal
     * prioritaire : il doit arriver chez B. `pick` reconnaît le message du cas.
     */
    const underLoad = (
      channel: string,
      payload: (prefix: string) => unknown,
      pick: (msg: unknown, prefix: string) => boolean,
      lost: string,
    ): (() => Promise<void>) =>
      scenario(async (open, prefix) => {
        const a = await open();
        const b = await open();
        const got: unknown[] = [];
        b.peer.onMessage((msg) => {
          if (msg.channel === channel && pick(msg.payload, prefix))
            got.push(msg.payload);
        });
        // Rafale d'une traite, sans rendre la main : rien n'est acquitté entre
        // deux envois, la file d'envoi se remplit comme sous une vraie charge.
        const chunk = Math.min(64 * 1024, Math.ceil(floodBytes / 4));
        const pad = "x".repeat(chunk);
        const count = Math.ceil(floodBytes / chunk);
        for (let i = 0; i < count; i += 1)
          a.peer.publish(`${prefix}flood`, { seq: i, pad });
        const sent = payload(prefix);
        a.peer.publish(channel, sent);

        const queue = a.peer.describe().queue;
        if (queue !== undefined && queue.maxBytes > 0)
          assert.ok(
            queue.droppedTotal > 0,
            `la rafale de ${floodBytes} octets n'a pas saturé la file (seuil ${queue.maxBytes}) : relever floodBytes, sinon ce cas ne prouve rien`,
          );
        await until(
          () => got.length > 0,
          timeoutMs,
          () => lost,
        );
        assert.deepEqual(got, [sent]);
      });

    options.it(
      C.controlUnderLoad,
      underLoad(
        PLATFORM_BUS_CHANNELS.control,
        (prefix): ControlOrder => ({
          op: "evictUser",
          channel: `${prefix}chat`,
          user: "mallory",
        }),
        (msg, prefix) =>
          readControlOrder(msg)?.channel.startsWith(prefix) === true,
        "l'ordre d'éjection émis sous saturation n'est pas arrivé — la file l'a-t-elle jeté avec les publications ?",
      ),
    );

    options.it(
      C.aliveUnderLoad,
      underLoad(
        PLATFORM_BUS_CHANNELS.presenceAlive,
        // La forme de la preuve de vie appartient à la présence (ADR-0025 P2) ;
        // le bus, lui, ne la lit pas : seul le canal décide de la priorité.
        (prefix) => ({ probe: prefix }),
        (msg, prefix) => ownField(msg, "probe") === prefix,
        "la preuve de vie émise sous saturation n'est pas arrivée — la file l'a-t-elle jetée avec les publications ? Un pair oublierait ce pod vivant.",
      ),
    );

    options.it(
      C.reserved,
      scenario(async (open, prefix) => {
        const a = await open();
        const b = await open();
        const hubA = new RealtimeHub();
        const hubB = new RealtimeHub();
        try {
          // Pairs déjà démarrés : le `start` que rejoue `setBackplane` est idempotent.
          hubA.setBackplane(a.peer);
          hubB.setBackplane(b.peer);
          hubA.markBroadcastChannel(prefix);
          hubB.markBroadcastChannel(prefix);
          const noop = (): (() => void) => () => {};
          const channel = `${prefix}room`;
          const gotA: unknown[] = [];
          const gotB: unknown[] = [];
          const audit: unknown[] = [];
          hubA.subscribe(channel, (p) => gotA.push(p), noop);
          hubB.subscribe(channel, (p) => gotB.push(p), noop);
          hubB.subscribe(PLATFORM_CHANNELS.audit, (p) => audit.push(p), noop);

          // Un pair hostile écrit sur le bus, sous le hub : le hub B doit le refuser.
          a.peer.publish(PLATFORM_CHANNELS.audit, {
            forged: "faux évènement d'audit",
          });
          hubA.publish(channel, { ok: 1 });

          await until(
            () => gotB.length > 0,
            timeoutMs,
            () => "la diffusion déclarée n'a pas atteint le hub B",
          );
          await sleep(quietMs);
          assert.deepEqual(
            audit,
            [],
            "un canal réservé a atteint les abonnés locaux",
          );
          assert.equal(
            hubB.probe().ingressRejectedTotal,
            1,
            "rejet non compté",
          );
          assert.deepEqual(gotB, [{ ok: 1 }]);
          // Le hub B n'a rien republié : le hub A ne reçoit que son fan-out local.
          assert.deepEqual(
            gotA,
            [{ ok: 1 }],
            "message renvoyé sur le bus (boucle)",
          );
        } finally {
          hubA.clear();
          hubB.clear();
        }
      }),
    );

    options.it(
      C.presence,
      scenario(async (open, prefix) => {
        const a = await open();
        const b = await open();
        const hubA = new RealtimeHub();
        const hubB = new RealtimeHub();
        try {
          for (const hub of [hubA, hubB]) {
            hub.declareChannelPolicy(`${prefix}*`, { presence: true }, null);
            hub.markBroadcastChannel(prefix);
          }
          // Pairs déjà démarrés : le `start` que rejoue `setBackplane` est idempotent.
          hubA.setBackplane(a.peer);
          hubB.setBackplane(b.peer);
          const channel = `${prefix}room`;
          const same = (
            hub: RealtimeHub,
            want: Record<string, number>,
          ): boolean =>
            JSON.stringify(presenceView(hub, channel)) === JSON.stringify(want);
          presenceClient(hubA, channel, "alice");
          presenceClient(hubA, channel, null);
          presenceClient(hubB, channel, "alice");
          presenceClient(hubB, channel, "bob");

          // Une identité dans deux onglets sur deux pods = UN présent ; l'anonyme
          // compte dans `unnamed`, jamais nommé.
          const both = { alice: 2, bob: 1 };
          await until(
            () =>
              same(hubB, both) &&
              hubB.presence(channel)?.unnamed === 1 &&
              hubB.presence(channel)?.partial === false &&
              same(hubA, both),
            timeoutMs,
            () =>
              `présence attendue ${JSON.stringify(both)} — A voit ${JSON.stringify(presenceView(hubA, channel))}, B voit ${JSON.stringify(presenceView(hubB, channel))} (lots, demandes ou réponses de présence perdus par le bus ?)`,
          );

          // Arrêt propre de A : retiré chez B par la preuve de vie finale, bien
          // avant le délai d'oubli (plusieurs secondes).
          hubA.endPresence();
          await until(
            () =>
              same(hubB, { alice: 1, bob: 1 }) &&
              hubB.presence(channel)?.unnamed === 0,
            timeoutMs,
            () =>
              `après l'arrêt propre de A, B voit encore ${JSON.stringify(presenceView(hubB, channel))} — la preuve de vie finale a-t-elle traversé le bus ?`,
          );
          const probe = hubB.probe().presence;
          assert.equal(probe?.endedTotal, 1, "arrêt propre non reçu");
          assert.equal(
            probe.forgottenTotal,
            0,
            "A oublié au lieu d'être retiré",
          );
          assert.equal(
            probe.presenceStaleDiscardedTotal,
            0,
            "messages de présence reçus en double ou rejoués — le bus livre-t-il deux fois ?",
          );
          assert.equal(
            probe.presenceRejectedTotal,
            0,
            "messages de présence refusés — la charge a-t-elle été altérée en route ?",
          );
        } finally {
          hubA.clear();
          hubB.clear();
        }
      }),
    );

    options.it(
      C.replaceHandler,
      scenario(async (open, prefix) => {
        const a = await open();
        // Le premier handler est la boîte posée par `open` ; on la remplace.
        const b = await open();
        const second: unknown[] = [];
        b.peer.onMessage((m) => {
          if (m.channel.startsWith(prefix)) second.push(m.payload);
        });
        a.peer.publish(`${prefix}handler`, { seq: 0 });

        await until(
          () => second.length > 0,
          timeoutMs,
          () => "le second handler n'a rien reçu",
        );
        await sleep(quietMs);
        assert.equal(
          b.inbox.messages.length,
          0,
          "l'ancien handler reçoit encore",
        );
        assert.deepEqual(second, [{ seq: 0 }]);
      }),
    );

    options.it(
      C.stop,
      scenario(async (open, prefix) => {
        const a = await open();
        const b = await open();
        const witness = await open();
        await b.peer.stop();
        await b.peer.stop();
        // Handler posé APRÈS l'arrêt : c'est le transport qui doit être coupé, pas
        // seulement le handler détaché.
        const after = new Inbox(b.peer, prefix);
        a.peer.publish(`${prefix}stop`, { seq: 0 });

        await until(
          () => witness.inbox.messages.length > 0,
          timeoutMs,
          () => "le témoin n'a pas reçu la publication",
        );
        await sleep(quietMs);
        assert.equal(after.messages.length, 0, "un pair arrêté reçoit encore");
      }),
    );
  });
}
