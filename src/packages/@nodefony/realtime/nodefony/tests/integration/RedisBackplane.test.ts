import { describe, it, expect, afterEach, afterAll } from "vitest";
import { createClient, type RedisClientType } from "redis";
import { CBOR_FRAME_CODEC } from "nodefony/cbor";
import {
  RedisBackplane,
  createRedisServiceTransport,
} from "../../src/backplane/RedisBackplane.js";
import { sealBackplaneEnvelope } from "../../src/backplane/envelope.js";
import { RealtimeHub } from "../../src/server/RealtimeHub.js";
import type { IBackplaneMessage } from "../../interfaces/IBackplane.js";
import { runBackplaneConformance } from "../../testing/index.js";
import {
  REDIS_GATE,
  gateValue,
} from "../../../../../../../scripts/test/vitest/gates";

/**
 * Tests d'INTÉGRATION (Redis réel) — exigent l'infra :
 *   docker compose -f src/packages/@nodefony/redis/docker/docker-compose.yml up -d
 *
 * Prouve le fan-out **cross-pod** RÉEL via pub/sub Redis v5 : deux paires de
 * clients (pod A, pod B) → `createRedisServiceTransport` → deux `RedisBackplane`.
 * Auto-skip si Redis injoignable (CI sans docker) — probe au chargement.
 */
const PASSWORD = process.env.NF_REDIS_PASSWORD ?? "nodefony-dev";
const HOST = process.env.NF_REDIS_HOST ?? "localhost";
const PORT = Number.parseInt(process.env.NF_REDIS_PORT ?? "6379", 10);

/**
 * L'URL vient de `REDIS_GATE` — la gate qui contrôle ce banc, jamais un nom
 * retapé ici. Ce banc a lu `NF_REDIS_HOST`/`NF_REDIS_PORT`, puis `REDIS_URL` :
 * dans les deux cas suivre le mode d'emploi du rapport ne débloquait rien, et la
 * seconde forme a fini par faire échouer la passe pendant que les onze cas
 * ci-dessous tournaient contre un vrai serveur. Le triplet reste accepté en
 * repli (le compose expose les deux).
 */
function mkClient(): RedisClientType {
  const url = gateValue(REDIS_GATE, "NF_REDIS_URL");
  const c = createClient(
    url
      ? { url, socket: { reconnectStrategy: false } }
      : {
          socket: { host: HOST, port: PORT, reconnectStrategy: false },
          password: PASSWORD,
        },
  ) as RedisClientType;
  c.on("error", () => {}); // silence (probe / teardown)
  return c;
}

async function redisReachable(): Promise<boolean> {
  const probe = mkClient();
  try {
    await probe.connect();
    await probe.ping();
    await probe.quit();
    return true;
  } catch {
    try {
      probe.destroy();
    } catch {
      /* déjà fermé */
    }
    return false;
  }
}

const REDIS_UP = await redisReachable();
const wait = (ms: number): Promise<void> =>
  new Promise((r) => setTimeout(r, ms));

/**
 * Attend qu'une condition devienne vraie. Jamais un délai fixe : la livraison
 * pub/sub n'a aucune borne sous charge (passe complète, VM Docker saturée) — un
 * `wait(150)` y rougit au hasard, et rend VERTE toute assertion « rien reçu ».
 */
async function until(
  cond: () => boolean,
  what: string,
  everyMs = 10,
  timeoutMs = 5000,
): Promise<void> {
  const end = Date.now() + timeoutMs;
  while (!cond()) {
    if (Date.now() > end) {
      throw new Error(`délai dépassé (${timeoutMs} ms) : ${what}`);
    }
    await wait(everyMs);
  }
}

/**
 * Attend que Redis ait TRAITÉ les publications du backplane : la file bornée ne
 * rend ses octets qu'à l'acquittement du `PUBLISH`. Après, tout abonné que ce
 * `PUBLISH` visait a déjà le message dans sa connexion.
 */
function published(bp: RedisBackplane): Promise<void> {
  return until(
    () => bp.describe().queue?.bytes === 0,
    `acquittement Redis des publications de ${bp.originId}`,
  );
}

// Le contrat du driver — diffusion, ordre, rejeu, sceau, ordres de contrôle,
// espace réservé, handler, arrêt — se prouve par la suite de conformité, la même
// que celle offerte aux drivers tiers. Un éditeur partagé (les PUBLISH d'un même
// client sont servis dans l'ordre : les sentinelles de la suite font foi), un
// abonné par pair.
describe.skipIf(!REDIS_UP)("RedisBackplane — intégration (Redis réel)", () => {
  const clients: RedisClientType[] = [];
  const channel = `nodefony:rt:conformance:${Date.now()}`;
  let publisher: RedisClientType | null = null;
  let next = 0;

  afterAll(async () => {
    await Promise.allSettled(
      clients.map(async (c) => {
        if (c.isOpen) await c.quit();
      }),
    );
  });

  runBackplaneConformance(
    "redis",
    async (secret) => {
      if (publisher === null) {
        publisher = mkClient();
        await publisher.connect();
        clients.push(publisher);
      }
      const sub = mkClient();
      await sub.connect();
      clients.push(sub);
      return new RedisBackplane(
        createRedisServiceTransport(publisher, sub),
        `pod-${(next += 1)}`,
        channel,
        secret,
        // Seuil bas : le cas « ordre sous saturation » sature la file sans
        // déverser des mégaoctets dans Redis.
        { maxQueueBytes: 64 * 1024 },
      );
    },
    { describe, it, floodBytes: 256 * 1024 },
  );
});

/**
 * F83 — **injection depuis le bus**, sur Redis RÉEL. L'attaquant n'est pas un pod :
 * c'est un client Redis brut (autre application d'un Redis mutualisé, credential
 * fuité, SSRF vers le port) qui écrit directement sur le canal de transport. On
 * mesure au bout de la chaîne : ce qu'un abonné du hub reçoit vraiment.
 */
describe.skipIf(!REDIS_UP)("F83 — injection tierce sur le bus Redis", () => {
  const clients: RedisClientType[] = [];
  const backplanes: RedisBackplane[] = [];
  const hubs: RealtimeHub[] = [];
  const channel = `nodefony:rt:f83:${Date.now()}`;
  const SECRET = `f83-${"k".repeat(32)}`;
  const factory = (): (() => void) => () => {};

  /** Pod complet : hub + backplane Redis, comme en production. */
  async function mkHubPod(
    originId: string,
    secret: string | null,
  ): Promise<{ hub: RealtimeHub; bp: RedisBackplane }> {
    const pub = mkClient();
    const sub = mkClient();
    await pub.connect();
    await sub.connect();
    clients.push(pub, sub);
    const bp = new RedisBackplane(
      createRedisServiceTransport(pub, sub),
      originId,
      channel,
      secret,
    );
    await bp.start();
    const hub = new RealtimeHub();
    hub.setBackplane(bp);
    backplanes.push(bp);
    hubs.push(hub);
    return { hub, bp };
  }

  /** L'attaquant : un client Redis nu qui publie ce qu'il veut sur le canal. */
  async function mkAttacker(): Promise<RedisClientType> {
    const c = mkClient();
    await c.connect();
    clients.push(c);
    return c;
  }

  afterEach(async () => {
    for (const h of hubs) h.clear();
    hubs.length = 0;
    await Promise.allSettled(backplanes.map((b) => b.stop()));
    backplanes.length = 0;
    await Promise.allSettled(
      clients.map(async (c) => {
        if (c.isOpen) await c.quit();
      }),
    );
    clients.length = 0;
  });

  it("CONTRÔLE NÉGATIF : sans secret, l'injection tierce ARRIVE aux abonnés", async () => {
    // Reproduit la faille d'origine sur du vrai Redis — sans ce cas, on ne
    // prouverait pas que le banc sait détecter une injection.
    const { hub } = await mkHubPod("pod-victime", null);
    hub.markBroadcastChannel("chat:");
    const got: unknown[] = [];
    hub.subscribe("chat:room1", (p) => got.push(p), factory);
    const evil = await mkAttacker();

    await evil.publish(
      channel,
      JSON.stringify({
        channel: "chat:room1",
        payload: { msg: "je suis l'admin" },
        originId: "evil",
      }),
    );
    await until(() => got.length > 0, "l'injection non scellée arrive");

    expect(got).to.deep.equal([{ msg: "je suis l'admin" }]);
  });

  it("secret posé : la même injection NON SCELLÉE est ignorée", async () => {
    const { hub } = await mkHubPod("pod-victime", SECRET);
    hub.markBroadcastChannel("chat:");
    const got: unknown[] = [];
    hub.subscribe("chat:room1", (p) => got.push(p), factory);
    const evil = await mkAttacker();

    await evil.publish(
      channel,
      JSON.stringify({
        channel: "chat:room1",
        payload: { msg: "je suis l'admin" },
        originId: "evil",
      }),
    );
    // Sentinelle SCELLÉE, publiée après : quand elle arrive, l'injection est
    // passée par le pod — et n'a rien livré.
    await evil.publish(
      channel,
      sealBackplaneEnvelope(
        {
          channel: "chat:room1",
          payload: { msg: "sentinelle" },
          originId: "evil",
        },
        SECRET,
      ),
    );
    await until(() => got.length > 0, "la sentinelle scellée arrive");

    expect(got).to.deep.equal([{ msg: "sentinelle" }]);
  });

  it("secret VOLÉ : le canal système reste hors d'atteinte (admission du hub)", async () => {
    // Défense en profondeur : l'attaquant scelle correctement (il a le secret),
    // mais `nodefony:audit` n'est pas un canal broadcast → le hub refuse.
    const { hub } = await mkHubPod("pod-victime", SECRET);
    const got: unknown[] = [];
    hub.subscribe("nodefony:audit", (p) => got.push(p), factory);
    hub.markBroadcastChannel("chat:");
    const sentinel: unknown[] = [];
    hub.subscribe("chat:room1", (p) => sentinel.push(p), factory);
    const evil = await mkAttacker();

    await evil.publish(
      channel,
      sealBackplaneEnvelope(
        {
          channel: "nodefony:audit",
          payload: { action: "faux évènement d'audit" },
          originId: "evil",
        },
        SECRET,
      ),
    );
    // Sentinelle sur un canal broadcast, publiée après : quand elle arrive,
    // le faux évènement d'audit a été jugé par le hub.
    await evil.publish(
      channel,
      sealBackplaneEnvelope(
        {
          channel: "chat:room1",
          payload: { msg: "sentinelle" },
          originId: "evil",
        },
        SECRET,
      ),
    );
    await until(() => sentinel.length > 0, "la sentinelle broadcast arrive");

    expect(got).to.deep.equal([]);
    expect(hub.probe().ingressRejectedTotal).to.equal(1);
  });
});

/**
 * Cinq propriétés que SEUL du Redis réel peut mettre en défaut — un bus en mémoire
 * (unit tests) ne peut ni saturer une vraie file d'acquittement réseau, ni couper
 * une vraie connexion TCP, ni exercer le routage par canal du serveur Redis.
 */
describe.skipIf(!REDIS_UP)(
  "RedisBackplane — contre-pression, cloisonnement, abonnement tardif, ordre FIFO (Redis réel)",
  () => {
    const clients: RedisClientType[] = [];
    const backplanes: RedisBackplane[] = [];
    const channel = `nodefony:rt:test2:${Date.now()}`;

    /** Pod complet, avec option de canal et de seuil de file — pour ces 4 bancs. */
    async function mkPod(
      originId: string,
      opts: { channel?: string; maxQueueBytes?: number } = {},
    ): Promise<RedisBackplane> {
      const pub = mkClient();
      const sub = mkClient();
      await pub.connect();
      await sub.connect();
      clients.push(pub, sub);
      const bp = new RedisBackplane(
        createRedisServiceTransport(pub, sub),
        originId,
        opts.channel ?? channel,
        null,
        opts.maxQueueBytes !== undefined
          ? { maxQueueBytes: opts.maxQueueBytes }
          : {},
      );
      backplanes.push(bp);
      return bp;
    }

    afterEach(async () => {
      await Promise.allSettled(backplanes.map((b) => b.stop()));
      backplanes.length = 0;
      await Promise.allSettled(
        clients.map(async (c) => {
          if (c.isOpen) await c.quit();
        }),
      );
      clients.length = 0;
    });

    it("contre-pression RÉELLE : le client Redis authentique alimente la file bornée (pas une promesse simulée)", async () => {
      // Même gabarit que le banc unitaire de `BackplanePublishQueue` (seuil 2000,
      // charge ~1 Ko) — mais ICI `publisher.publish()` est le vrai client `redis`.
      // L'incrément de la file est SYNCHRONE (juste après l'appel `emit()`, cf
      // `BackplanePublishQueue.send`) : il ne dépend donc pas de la latence réseau
      // réelle — seul compte que la promesse rendue par le client réel soit bien
      // PROPAGÉE jusqu'à la file, pas avalée en route.
      const KB = "x".repeat(1000);
      const a = await mkPod("pod-A", { maxQueueBytes: 2000 });
      const b = await mkPod("pod-B");
      const got: IBackplaneMessage[] = [];
      b.onMessage((m) => got.push(m));
      await a.start();
      await b.start();

      a.publish("chat:room", KB); // file vide → admis
      a.publish("chat:room", KB); // file < seuil → admis
      a.publish("chat:room", KB); // file ≥ seuil → JETÉ

      expect(
        a.describe().queue?.droppedTotal,
        "la file bornée doit jeter la 3e publication AVANT même l'acquittement réseau",
      ).to.equal(1);

      await published(a);
      await until(() => got.length >= 2, "B reçoit les 2 publications admises");
      expect(
        got,
        "B ne reçoit que les 2 publications réellement parties",
      ).to.have.lengthOf(2);
      expect(
        a.describe().queue?.bytes,
        "la file a drainé une fois les acquittements réseau reçus",
      ).to.equal(0);
    });

    it("cloisonnement RÉEL : deux backplanes sur des namespaces distincts ne se voient PAS, même sur le même serveur Redis", async () => {
      const chanA = `${channel}:ns-a`;
      const chanB = `${channel}:ns-b`; // canal distinct → le serveur Redis ne route rien vers B
      const a = await mkPod("pod-A", { channel: chanA });
      const b = await mkPod("pod-B", { channel: chanB });
      const got: IBackplaneMessage[] = [];
      b.onMessage((m) => got.push(m));
      await a.start();
      await b.start();

      a.publish("chat:room", "message namespace A");
      await published(a);
      // Sentinelle sur le namespace de B, publiée après le traitement du
      // PUBLISH de A : quand elle arrive, un cross-talk serait déjà là.
      const raw = mkClient();
      await raw.connect();
      clients.push(raw);
      await raw.publish(
        chanB,
        JSON.stringify({
          channel: "chat:room",
          payload: "sentinelle",
          originId: "pod-témoin",
        }),
      );
      await until(
        () => got.length > 0,
        "B reçoit la sentinelle de son namespace",
      );

      expect(
        got,
        "aucun cross-talk entre namespaces sur le même serveur Redis",
      ).to.deep.equal([
        { channel: "chat:room", payload: "sentinelle", originId: "pod-témoin" },
      ]);
    });
  },
);

/**
 * RECONNEXION — coupure **réelle** de la connexion Redis, pas un `.quit()`
 * volontaire (chemin intentionnel côté client qui ne déclenche PAS le
 * `reconnectStrategy` — `RedisSocket#destroy` pose `#isOpen = false` avant de
 * fermer, donc le handler de fermeture inattendue `#onSocketError` s'auto-annule).
 * On simule un incident réel (redémarrage Redis, coupure réseau, LB qui recycle la
 * connexion) via `CLIENT KILL` émis depuis une connexion tierce : le client abonné
 * voit une fermeture INATTENDUE, déclenche son `reconnectStrategy`, et le driver
 * `redis` ré-abonne automatiquement les canaux actifs (mécanisme interne
 * `commands-queue.js` → `resubscribe`, rejoué à chaque (re)connexion du socket).
 * `RedisBackplane` ne porte AUCUNE logique de reconnexion propre — ce banc prouve
 * que rien dans le branchement (transport, handler conservé après coupure) ne fait
 * obstacle à ce mécanisme.
 */
describe.skipIf(!REDIS_UP)(
  "RedisBackplane — reconnexion (coupure réelle de connexion Redis)",
  () => {
    const clients: RedisClientType[] = [];
    const backplanes: RedisBackplane[] = [];
    const channel = `nodefony:rt:test3:${Date.now()}`;

    /** Client dont le `reconnectStrategy` est ACTIF (contrairement à `mkClient()`). */
    function mkReconnectingClient(): RedisClientType {
      const url = gateValue(REDIS_GATE, "NF_REDIS_URL");
      const c = createClient(
        url
          ? { url, socket: { reconnectStrategy: () => 100 } }
          : {
              socket: { host: HOST, port: PORT, reconnectStrategy: () => 100 },
              password: PASSWORD,
            },
      ) as RedisClientType;
      c.on("error", () => {}); // silence — le test observe l'effet, pas l'event brut
      return c;
    }

    afterEach(async () => {
      await Promise.allSettled(backplanes.map((b) => b.stop()));
      backplanes.length = 0;
      await Promise.allSettled(
        clients.map(async (c) => {
          if (c.isOpen) await c.quit();
        }),
      );
      clients.length = 0;
    });

    it("reconnexion : le backplane se rétablit après une coupure de la connexion Redis (CLIENT KILL réel)", async () => {
      const pubA = mkClient();
      const subA = mkClient();
      await pubA.connect();
      await subA.connect();
      clients.push(pubA, subA);
      const a = new RedisBackplane(
        createRedisServiceTransport(pubA, subA),
        "pod-A",
        channel,
      );
      backplanes.push(a);

      const pubB = mkClient();
      const subB = mkReconnectingClient();
      await pubB.connect();
      await subB.connect();
      clients.push(pubB, subB);
      const subBId = await subB.clientId();
      const b = new RedisBackplane(
        createRedisServiceTransport(pubB, subB),
        "pod-B",
        channel,
      );
      backplanes.push(b);

      const got: IBackplaneMessage[] = [];
      b.onMessage((m) => got.push(m));
      await a.start();
      await b.start();

      a.publish("chat:room", "avant coupure");
      await until(
        () => got.length > 0,
        "la liaison fonctionne avant la coupure",
      );
      expect(
        got,
        "sanity : la liaison fonctionne avant la coupure",
      ).to.have.lengthOf(1);

      // Coupure RÉELLE depuis le serveur (pas un arrêt volontaire du client).
      const admin = mkClient();
      await admin.connect();
      clients.push(admin);
      await admin.clientKill({ filter: "ID", id: subBId });

      // Sonde répétée : ce qui est publié pendant la coupure est perdu (pub/sub
      // ne rejoue rien), et la fin du ré-abonnement n'est pas observable.
      await until(
        () => {
          if (got.length >= 2) return true;
          a.publish("chat:room", "après reconnexion");
          return false;
        },
        "le backplane doit avoir repris la réception après la coupure",
        100,
      );
      expect(got[1]).to.deep.equal({
        channel: "chat:room",
        payload: "après reconnexion",
        originId: "pod-A",
      });
    });
  },
);

describe.skipIf(!REDIS_UP)(
  "RedisBackplane — sujet binaire sur un Redis réel (ADR-0021 S6, #618)",
  () => {
    const clients: RedisClientType[] = [];
    const backplanes: RedisBackplane[] = [];
    const channel = `nodefony:rt:test:bytes:${Date.now()}`;

    async function mkPod(
      originId: string,
      secret: string | null,
    ): Promise<RedisBackplane> {
      const pub = mkClient();
      const sub = mkClient();
      await pub.connect();
      await sub.connect();
      clients.push(pub, sub);
      const bp = new RedisBackplane(
        createRedisServiceTransport(pub, sub, sub),
        originId,
        channel,
        secret,
      );
      backplanes.push(bp);
      return bp;
    }

    afterEach(async () => {
      await Promise.allSettled(backplanes.map((b) => b.stop()));
      backplanes.length = 0;
      await Promise.allSettled(
        clients.map(async (c) => {
          if (c.isOpen) await c.quit();
        }),
      );
      clients.length = 0;
    });

    it.each([
      ["nu", null],
      ["scellé", "secret-partagé"],
    ])(
      "bus %s : les 256 valeurs d'octet traversent Redis intactes, imbriquées comme en tête",
      async (_n, secret) => {
        const a = await mkPod("pod-A", secret);
        const b = await mkPod("pod-B", secret);
        a.enableBytes(CBOR_FRAME_CODEC);
        b.enableBytes(CBOR_FRAME_CODEC);
        const got: IBackplaneMessage[] = [];
        b.onMessage((m) => got.push(m));
        await a.start();
        await b.start();

        // Toutes les valeurs, dont celles qu'un décodage UTF-8 détruirait (0x80-0xFF).
        const all = Uint8Array.from({ length: 256 }, (_v, i) => i);
        a.publish("media:room1", all);
        a.publish("media:room1", { seq: 2, frame: all.subarray(250) });
        await until(() => got.length === 2, "B reçoit les deux publications");

        expect(got[0]?.payload).to.be.instanceOf(Uint8Array);
        expect(Array.from(got[0]?.payload as Uint8Array)).to.deep.equal(
          Array.from(all),
        );
        const nested = got[1]?.payload as { seq: number; frame: Uint8Array };
        expect(nested.seq).to.equal(2);
        expect(Array.from(nested.frame)).to.deep.equal([
          250, 251, 252, 253, 254, 255,
        ]);
        expect(b.describe().sealRejectedTotal ?? 0).to.equal(0);
      },
    );

    it("un exemplaire non armé, sur le même Redis, ne reçoit rien du sujet binaire", async () => {
      const a = await mkPod("pod-A", null);
      const old = await mkPod("pod-old", null);
      a.enableBytes(CBOR_FRAME_CODEC);
      const got: IBackplaneMessage[] = [];
      old.onMessage((m) => got.push(m));
      await a.start();
      await old.start();
      a.publish("media:room1", new Uint8Array([1, 2, 3]));
      // Sentinelle texte publiée APRÈS : quand elle arrive, l'éventuel octet serait passé.
      a.publish("chat:room", { text: "sentinelle" });
      await until(
        () => got.length > 0,
        "l'ancien exemplaire reçoit la sentinelle",
      );
      expect(got).to.deep.equal([
        {
          channel: "chat:room",
          payload: { text: "sentinelle" },
          originId: "pod-A",
        },
      ]);
    });
  },
);
