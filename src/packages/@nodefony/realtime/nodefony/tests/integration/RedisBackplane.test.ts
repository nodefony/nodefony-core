import { describe, it, expect, afterEach } from "vitest";
import { createClient, type RedisClientType } from "redis";
import {
  RedisBackplane,
  createRedisServiceTransport,
} from "../../src/backplane/RedisBackplane.js";
import { sealBackplaneEnvelope } from "../../src/backplane/envelope.js";
import { RealtimeHub } from "../../src/server/RealtimeHub.js";
import type { IBackplaneMessage } from "../../interfaces/IBackplane.js";

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
 * `REDIS_URL` est la façon dont TOUT le dépôt désigne un Redis de test — c'est
 * ce que pose `REDIS_GATE` (`vitest.gates.ts`) et ce qu'affiche le mode d'emploi
 * quand la cible manque. Ce banc lisait `NF_REDIS_HOST`/`NF_REDIS_PORT` : suivre le
 * message d'aide n'aurait donc RIEN débloqué ici. On accepte l'URL d'abord, le
 * triplet ensuite (le compose expose les deux).
 */
function mkClient(): RedisClientType {
  const url = process.env.REDIS_URL;
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
      await probe.destroy();
    } catch {
      /* déjà fermé */
    }
    return false;
  }
}

const REDIS_UP = await redisReachable();
const wait = (ms: number): Promise<void> =>
  new Promise((r) => setTimeout(r, ms));

describe.skipIf(!REDIS_UP)("RedisBackplane — intégration (Redis réel)", () => {
  const clients: RedisClientType[] = [];
  const backplanes: RedisBackplane[] = [];
  // canal Redis unique par run (évite la diaphonie entre exécutions parallèles)
  const channel = `nodefony:rt:test:${Date.now()}`;

  /** Crée un "pod" : publisher + subscriber dédiés branchés sur un RedisBackplane. */
  async function mkPod(originId: string): Promise<RedisBackplane> {
    const pub = mkClient();
    const sub = mkClient();
    await pub.connect();
    await sub.connect();
    clients.push(pub, sub);
    const bp = new RedisBackplane(
      createRedisServiceTransport(pub, sub),
      originId,
      channel,
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

  it("fan-out cross-pod RÉEL : A.publish → B reçoit, A filtre son echo", async () => {
    const a = await mkPod("pod-A");
    const b = await mkPod("pod-B");
    const gotA: IBackplaneMessage[] = [];
    const gotB: IBackplaneMessage[] = [];
    a.onMessage((m) => gotA.push(m));
    b.onMessage((m) => gotB.push(m));
    await a.start();
    await b.start();
    await wait(80); // garantit l'abonnement effectif avant publication

    a.publish("nodefony:syslog", { line: "hello" });

    // pub/sub Redis = best-effort async → on attend la livraison
    await wait(150);
    expect(
      gotA,
      "anti-echo : l'émetteur ignore son propre message",
    ).to.have.lengthOf(0);
    expect(gotB).to.deep.equal([
      {
        channel: "nodefony:syslog",
        payload: { line: "hello" },
        originId: "pod-A",
      },
    ]);
  });

  it("stop() coupe la réception (B ne reçoit plus après stop)", async () => {
    const a = await mkPod("pod-A");
    const b = await mkPod("pod-B");
    let fired = 0;
    b.onMessage(() => (fired += 1));
    await a.start();
    await b.start();
    await wait(80);
    await b.stop();
    await wait(30);

    a.publish("c", 1);
    await wait(120);
    expect(fired).to.equal(0);
  });
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
    await wait(80);

    await evil.publish(
      channel,
      JSON.stringify({
        channel: "chat:room1",
        payload: { msg: "je suis l'admin" },
        originId: "evil",
      }),
    );
    await wait(150);

    expect(got).to.deep.equal([{ msg: "je suis l'admin" }]);
  });

  it("secret posé : la même injection NON SCELLÉE est ignorée", async () => {
    const { hub } = await mkHubPod("pod-victime", SECRET);
    hub.markBroadcastChannel("chat:");
    const got: unknown[] = [];
    hub.subscribe("chat:room1", (p) => got.push(p), factory);
    const evil = await mkAttacker();
    await wait(80);

    await evil.publish(
      channel,
      JSON.stringify({
        channel: "chat:room1",
        payload: { msg: "je suis l'admin" },
        originId: "evil",
      }),
    );
    await wait(150);

    expect(got).to.deep.equal([]);
  });

  it("secret VOLÉ : le canal système reste hors d'atteinte (admission du hub)", async () => {
    // Défense en profondeur : l'attaquant scelle correctement (il a le secret),
    // mais `nodefony:audit` n'est pas un canal broadcast → le hub refuse.
    const { hub } = await mkHubPod("pod-victime", SECRET);
    const got: unknown[] = [];
    hub.subscribe("nodefony:audit", (p) => got.push(p), factory);
    const evil = await mkAttacker();
    await wait(80);

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
    await wait(150);

    expect(got).to.deep.equal([]);
    expect(hub.probe().ingressRejectedTotal).to.equal(1);
  });

  it("NOMINAL : deux pods au même secret gardent leur fan-out cross-pod", async () => {
    const a = await mkHubPod("pod-A", SECRET);
    const b = await mkHubPod("pod-B", SECRET);
    a.hub.markBroadcastChannel("chat:");
    b.hub.markBroadcastChannel("chat:");
    const got: unknown[] = [];
    b.hub.subscribe("chat:room1", (p) => got.push(p), factory);
    await wait(80);

    a.hub.publish("chat:room1", { msg: "vrai message" });
    await wait(150);

    expect(got).to.deep.equal([{ msg: "vrai message" }]);
    expect(b.hub.probe().ingressRejectedTotal).to.equal(0);
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
      await wait(80);

      a.publish("chat:room", KB); // file vide → admis
      a.publish("chat:room", KB); // file < seuil → admis
      a.publish("chat:room", KB); // file ≥ seuil → JETÉ

      expect(
        a.describe().queue?.droppedTotal,
        "la file bornée doit jeter la 3e publication AVANT même l'acquittement réseau",
      ).to.equal(1);

      await wait(200); // laisse Redis acquitter + livrer les 2 publications admises
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
      await wait(80);

      a.publish("chat:room", "message namespace A");
      await wait(150);

      expect(
        got,
        "aucun cross-talk entre namespaces sur le même serveur Redis",
      ).to.have.lengthOf(0);
    });

    it("abonnement tardif : un pod qui s'abonne APRÈS une publication ne reçoit pas le message passé, mais reçoit bien les suivants", async () => {
      const a = await mkPod("pod-A");
      await a.start();
      await wait(50);

      a.publish("chat:room", "avant abonnement"); // personne n'écoute encore sur ce canal
      await wait(150);

      const b = await mkPod("pod-B"); // s'abonne APRÈS la publication passée
      const got: IBackplaneMessage[] = [];
      b.onMessage((m) => got.push(m));
      await b.start();
      await wait(80);

      a.publish("chat:room", "après abonnement");
      await wait(150);

      expect(
        got,
        "pub/sub Redis ne rejoue jamais le passé : seul le message postérieur à l'abonnement arrive",
      ).to.deep.equal([
        {
          channel: "chat:room",
          payload: "après abonnement",
          originId: "pod-A",
        },
      ]);
    });

    it("ordre FIFO : les messages d'un même émetteur arrivent dans l'ordre d'émission", async () => {
      const a = await mkPod("pod-A");
      const b = await mkPod("pod-B");
      const got: IBackplaneMessage[] = [];
      b.onMessage((m) => got.push(m));
      await a.start();
      await b.start();
      await wait(80);

      const N = 30;
      for (let i = 0; i < N; i += 1) a.publish("chat:room", i);
      await wait(300);

      expect(got.map((m) => m.payload)).to.deep.equal(
        Array.from({ length: N }, (_, i) => i),
      );
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
      const url = process.env.REDIS_URL;
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
      await wait(80);

      a.publish("chat:room", "avant coupure");
      await wait(150);
      expect(
        got,
        "sanity : la liaison fonctionne avant la coupure",
      ).to.have.lengthOf(1);

      // Coupure RÉELLE depuis le serveur (pas un arrêt volontaire du client).
      const admin = mkClient();
      await admin.connect();
      clients.push(admin);
      await admin.clientKill({ filter: "ID", id: subBId });

      await wait(800); // laisse le client se reconnecter puis se ré-abonner

      a.publish("chat:room", "après reconnexion");
      await wait(300);

      expect(
        got,
        "le backplane doit avoir repris la réception après la coupure",
      ).to.have.lengthOf(2);
      expect(got[1]).to.deep.equal({
        channel: "chat:room",
        payload: "après reconnexion",
        originId: "pod-A",
      });
    });
  },
);
