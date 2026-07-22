import { describe, it, expect } from "vitest";
import {
  RedisBackplane,
  type IRedisBackplaneTransport,
} from "../../src/backplane/RedisBackplane.js";

/**
 * **File d'envoi bornée du backplane** — un `publish` vers un bus partagé est
 * fire-and-forget : le client Redis met la commande en file tant que la socket
 * n'est pas drainée. Sans borne, une rafale gonfle cette file sans limite
 * (583 MB observés sur le banc multi-pods, pour 152 MB au repos).
 *
 * Ce que ces tests verrouillent — la MÊME doctrine que le transport WS (seuil,
 * compteur de jetés, avertissement) : on protège la mémoire du pod, mais on ne
 * jette JAMAIS en silence (cf `project_resilience_no_silent_degradation`).
 */

/** Publication en attente d'acquittement — pilotée à la main par le test. */
interface Pending {
  resolve: () => void;
  reject: (e: Error) => void;
}

/**
 * Transport Redis **asynchrone contrôlable** : chaque `publish` rend une promesse
 * que le test acquitte quand il veut → simule exactement une socket qui ne draine
 * pas (le cas qui fait grossir la file du client Redis).
 */
class SlowTransport implements IRedisBackplaneTransport {
  readonly sent: string[] = [];
  readonly pending: Pending[] = [];

  publish(_channel: string, message: string): Promise<void> {
    this.sent.push(message);
    return new Promise<void>((resolve, reject) => {
      this.pending.push({ resolve, reject: (e) => reject(e) });
    });
  }
  subscribe(): void {}
  unsubscribe(): void {}

  /** Acquitte toutes les publications en vol (la socket a drainé). */
  async settleAll(): Promise<void> {
    const inflight = this.pending.splice(0);
    inflight.forEach((p) => p.resolve());
    await Promise.resolve();
    await Promise.resolve();
  }

  /** Fait échouer toutes les publications en vol (Redis coupé en plein envoi). */
  async failAll(message = "redis gone"): Promise<void> {
    const inflight = this.pending.splice(0);
    inflight.forEach((p) => p.reject(new Error(message)));
    await Promise.resolve();
    await Promise.resolve();
  }
}

/** Transport **synchrone** (bus mémoire des tests) : aucune file, rien à borner. */
class SyncTransport implements IRedisBackplaneTransport {
  readonly sent: string[] = [];
  publish(_channel: string, message: string): void {
    this.sent.push(message);
  }
  subscribe(): void {}
  unsubscribe(): void {}
}

/** Charge d'environ 1 Ko — deux publications suffisent à saturer un seuil de 2 Ko. */
const KB = "x".repeat(1000);

describe("Backplane — file d'envoi bornée (mémoire du pod)", () => {
  it("sature : au-delà du seuil, le transport n'est PLUS appelé et les jetés sont comptés", () => {
    const t = new SlowTransport();
    const bp = new RedisBackplane(t, "pod-A", "ch", null, {
      maxQueueBytes: 2000,
    });

    bp.publish("chat:room", KB); // file vide → admis
    bp.publish("chat:room", KB); // file < seuil → admis (la file passe au-dessus)
    bp.publish("chat:room", KB); // file ≥ seuil → JETÉ
    bp.publish("chat:room", KB); // JETÉ

    expect(t.sent).to.have.lengthOf(2);
    const q = bp.describe().queue;
    expect(q?.droppedTotal).to.equal(2);
    expect(q?.bytes).to.be.greaterThan(2000);
    expect(q?.maxBytes).to.equal(2000);
  });

  it("une charge PLUS GROSSE que le seuil passe quand la file est vide (pas de famine)", () => {
    const t = new SlowTransport();
    const bp = new RedisBackplane(t, "pod-A", "ch", null, {
      maxQueueBytes: 100,
    });

    bp.publish("chat:room", KB); // 1 Ko > seuil 100 o, mais file vide → part

    expect(t.sent).to.have.lengthOf(1);
    expect(bp.describe().queue?.droppedTotal).to.equal(0);
  });

  it("draine : une fois les publications acquittées, les suivantes repassent", async () => {
    const t = new SlowTransport();
    const bp = new RedisBackplane(t, "pod-A", "ch", null, {
      maxQueueBytes: 2000,
    });

    bp.publish("chat:room", KB);
    bp.publish("chat:room", KB);
    bp.publish("chat:room", KB); // jeté (file saturée)
    expect(t.sent).to.have.lengthOf(2);

    await t.settleAll(); // la socket draine
    expect(bp.describe().queue?.bytes).to.equal(0);

    bp.publish("chat:room", KB); // la voie est libre
    expect(t.sent).to.have.lengthOf(3);
  });

  it("un ÉCHEC de publication libère la file, est compté, et ne fuit pas en rejet non géré", async () => {
    const t = new SlowTransport();
    const bp = new RedisBackplane(t, "pod-A", "ch", null, {
      maxQueueBytes: 2000,
    });

    bp.publish("chat:room", KB);
    bp.publish("chat:room", KB);
    await t.failAll(); // Redis coupé pendant l'envoi

    const q = bp.describe().queue;
    expect(q?.bytes).to.equal(0); // la place est rendue, sinon la file se fige
    expect(q?.failedTotal).to.equal(2);
  });

  it("CONTRÔLE NÉGATIF — transport synchrone (aucune file) : jamais de drop", () => {
    const t = new SyncTransport();
    const bp = new RedisBackplane(t, "pod-A", "ch", null, {
      maxQueueBytes: 100,
    });

    for (let i = 0; i < 50; i += 1) bp.publish("chat:room", KB);

    expect(t.sent).to.have.lengthOf(50);
    const q = bp.describe().queue;
    expect(q?.bytes).to.equal(0);
    expect(q?.droppedTotal).to.equal(0);
  });

  it("seuil 0 = illimité (opt-out explicite) — rien n'est jeté", () => {
    const t = new SlowTransport();
    const bp = new RedisBackplane(t, "pod-A", "ch", null, { maxQueueBytes: 0 });

    for (let i = 0; i < 50; i += 1) bp.publish("chat:room", KB);

    expect(t.sent).to.have.lengthOf(50);
    expect(bp.describe().queue?.droppedTotal).to.equal(0);
  });

  it("ANNONCE la dégradation : 1 alerte à la saturation (pas une par message), 1 retour à la normale", async () => {
    const notices: { message: string; severity: string }[] = [];
    const t = new SlowTransport();
    const bp = new RedisBackplane(t, "pod-A", "ch", null, {
      maxQueueBytes: 2000,
      onNotice: (message, severity) => notices.push({ message, severity }),
    });

    bp.publish("chat:room", KB);
    bp.publish("chat:room", KB);
    for (let i = 0; i < 10; i += 1) bp.publish("chat:room", KB); // 10 jetés

    const warnings = notices.filter((n) => n.severity === "WARNING");
    expect(warnings).to.have.lengthOf(1); // pas de tempête de logs
    expect(warnings[0]?.message).to.match(/file|saturé/i);

    await t.settleAll();
    const infos = notices.filter((n) => n.severity === "INFO");
    expect(infos).to.have.lengthOf(1);
    expect(infos[0]?.message).to.include("10"); // combien ont été perdus
  });

  it("sans option, la file est bornée par défaut (une app non configurée est protégée)", () => {
    const bp = new RedisBackplane(new SlowTransport(), "pod-A");
    expect(bp.describe().queue?.maxBytes).to.be.greaterThan(0);
  });
});
