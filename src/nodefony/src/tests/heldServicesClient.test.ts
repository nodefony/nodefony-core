/**
 * Le client des services portés côté serveur (ADR-0030 §D3-§D5) : un plan
 * part COMPLET en un message, l'acquittement tient ou rejette les attendants,
 * les états vont à la clé qui les attend. Lien fictif : ce qui part est
 * enregistré, ce qui arrive est poussé à la main.
 */
import { describe, expect, it } from "vitest";
import {
  HeldServicesClient,
  type IHeldChannelLink,
} from "../kernel/heldServicesClient";
import {
  DEV_CHANNEL,
  isDevChannelMessage,
  type DevChannelMessage,
  type IDevHeldPlan,
  type IHeldServiceDeclaration,
} from "../service/dev/devChannel";
import type { IHeldHostStatus } from "../service/dev/heldChannel";

function fakeLink(sendResult = true): {
  link: IHeldChannelLink;
  sent: DevChannelMessage[];
  deliver: (m: DevChannelMessage) => void;
  listeners: () => number;
} {
  const sent: DevChannelMessage[] = [];
  const handlers = new Set<(m: DevChannelMessage) => void>();
  return {
    sent,
    link: {
      send: (m) => {
        sent.push(m);
        return sendResult;
      },
      listen: (h) => {
        handlers.add(h);
        return () => handlers.delete(h);
      },
    },
    deliver: (m) => {
      for (const h of handlers) h(m);
    },
    listeners: () => handlers.size,
  };
}

function decl(key: string): IHeldServiceDeclaration {
  return {
    key,
    module: "/abs/host.mjs",
    fingerprint: `fp-${key}`,
    spec: {},
    cwd: "/abs",
    env: {},
  };
}

function ack(
  plan: IDevHeldPlan,
  reason: string | null = null,
): DevChannelMessage {
  return {
    channel: DEV_CHANNEL,
    type: "held-plan-ack",
    id: plan.id,
    owner: plan.owner,
    accepted: reason === null,
    reason,
  };
}

function status(key: string, state: IHeldHostStatus["state"]): IHeldHostStatus {
  return {
    key,
    state,
    pid: 1,
    data: null,
    lastError: null,
    restartCount: 0,
    missedPongs: 0,
  };
}

/** Le seul plan envoyé. */
function onlyPlan(sent: DevChannelMessage[]): IDevHeldPlan {
  expect(sent).to.have.length(1);
  const [plan] = sent;
  if (plan?.type !== "held-plan") throw new Error("pas un plan");
  return plan;
}

describe("HeldServicesClient — composition du plan", () => {
  it("le plan ne part qu'une fois TOUTES les clés attendues apportées, en UN message conforme au canal", async () => {
    const { link, sent, deliver } = fakeLink();
    const client = new HeldServicesClient("frontend", link);
    client.expect(["vite:default", "vite:angular"]);
    const a = client.submit(decl("vite:default"));
    expect(sent).to.deep.equal([]);
    const b = client.submit(decl("vite:angular"));
    const plan = onlyPlan(sent);
    expect(isDevChannelMessage(plan)).to.equal(true);
    expect(plan.owner).to.equal("frontend");
    expect(plan.services.map((s) => s.key)).to.deep.equal([
      "vite:default",
      "vite:angular",
    ]);
    deliver(ack(plan));
    await expect(Promise.all([a, b])).resolves.toBeDefined();
  });

  it("une clé retirée (préparation en échec) ne retient pas le plan, et n'y figure pas", () => {
    const { link, sent } = fakeLink();
    const client = new HeldServicesClient("frontend", link);
    client.expect(["vite:default", "vite:angular"]);
    void client.submit(decl("vite:default"));
    client.withdraw("vite:angular");
    expect(onlyPlan(sent).services.map((s) => s.key)).to.deep.equal([
      "vite:default",
    ]);
  });

  it("aucune clé attendue : un plan VIDE part aussitôt (le superviseur arrête tout ce propriétaire)", () => {
    const { link, sent } = fakeLink();
    new HeldServicesClient("frontend", link).expect([]);
    expect(onlyPlan(sent).services).to.deep.equal([]);
  });

  it("une clé non attendue est refusée sans rien envoyer", async () => {
    const { link, sent } = fakeLink();
    const client = new HeldServicesClient("frontend", link);
    client.expect(["vite:default"]);
    await expect(client.submit(decl("vite:other"))).rejects.toThrow(
      /not expected/,
    );
    expect(sent).to.deep.equal([]);
  });

  it("deux compositions à la fois sont refusées ; la suivante, après envoi, reprend un id neuf", () => {
    const { link, sent } = fakeLink();
    const client = new HeldServicesClient("frontend", link);
    client.expect(["vite:default"]);
    expect(() => client.expect(["vite:default"])).to.throw(/already/);
    void client.submit(decl("vite:default"));
    client.expect([]);
    const ids = sent.map((m) => (m.type === "held-plan" ? m.id : -1));
    expect(ids).to.deep.equal([1, 2]);
  });
});

describe("HeldServicesClient — acquittement", () => {
  it("refusé : chaque attendant rejette avec la cause NOMMÉE par le superviseur", async () => {
    const { link, sent, deliver } = fakeLink();
    const client = new HeldServicesClient("frontend", link);
    client.expect(["vite:default"]);
    const p = client.submit(decl("vite:default"));
    deliver(ack(onlyPlan(sent), "supervisor is stopping"));
    await expect(p).rejects.toThrow(/supervisor is stopping/);
  });

  it("l'acquittement d'un AUTRE propriétaire ou d'un autre id ne tient rien", async () => {
    const { link, sent, deliver } = fakeLink();
    const client = new HeldServicesClient("frontend", link, 60);
    client.expect(["vite:default"]);
    const p = client.submit(decl("vite:default"));
    const plan = onlyPlan(sent);
    deliver({ ...ack(plan), owner: "ai" } as DevChannelMessage);
    deliver({ ...ack(plan), id: plan.id + 1 } as DevChannelMessage);
    // Seule l'échéance tranche : aucun des deux n'a été pris pour le bon.
    await expect(p).rejects.toThrow(/not acknowledged within 60 ms/);
  });

  it("sans acquittement à l'heure : rejet qui le dit", async () => {
    const { link } = fakeLink();
    const client = new HeldServicesClient("frontend", link, 30);
    client.expect(["vite:default"]);
    await expect(client.submit(decl("vite:default"))).rejects.toThrow(
      /not acknowledged within 30 ms/,
    );
  });

  it("sans canal (envoi refusé) : rejet immédiat qui le dit", async () => {
    const { link } = fakeLink(false);
    const client = new HeldServicesClient("frontend", link);
    client.expect(["vite:default"]);
    await expect(client.submit(decl("vite:default"))).rejects.toThrow(
      /no channel/,
    );
  });

  it("close : un plan en vol est rejeté, l'écoute est retirée", async () => {
    const { link, listeners } = fakeLink();
    const client = new HeldServicesClient("frontend", link);
    client.expect(["vite:default"]);
    const p = client.submit(decl("vite:default"));
    expect(listeners()).to.equal(1);
    client.close();
    await expect(p).rejects.toThrow(/closed/);
    expect(listeners()).to.equal(0);
  });
});

describe("HeldServicesClient — états poussés", () => {
  it("l'état va à la clé qui l'attend, et seulement pour ce propriétaire", () => {
    const { link, deliver } = fakeLink();
    const client = new HeldServicesClient("frontend", link);
    const seen: string[] = [];
    client.watch("vite:default", (s) => seen.push(`default:${s.state}`));
    client.watch("vite:angular", (s) => seen.push(`angular:${s.state}`));
    const push = (owner: string, s: IHeldHostStatus): void =>
      deliver({ channel: DEV_CHANNEL, type: "held-state", owner, status: s });
    push("frontend", status("vite:default", "ready"));
    push("ai", status("vite:default", "crashed"));
    push("frontend", status("vite:angular", "starting"));
    push("frontend", status("vite:unknown", "ready"));
    expect(seen).to.deep.equal(["default:ready", "angular:starting"]);
  });

  it("l'écoute est posée UNE fois, dès le premier watch — avant tout envoi", () => {
    const { link, sent, listeners } = fakeLink();
    const client = new HeldServicesClient("frontend", link);
    client.watch("vite:default", () => {});
    expect(listeners()).to.equal(1);
    expect(sent).to.deep.equal([]);
    client.expect(["vite:default"]);
    client.watch("vite:angular", () => {});
    expect(listeners()).to.equal(1);
  });

  it("la désinscription d'un watch ne retire pas son remplaçant", () => {
    const { link, deliver } = fakeLink();
    const client = new HeldServicesClient("frontend", link);
    const seen: string[] = [];
    const off = client.watch("vite:default", () => seen.push("old"));
    client.watch("vite:default", () => seen.push("new"));
    off();
    deliver({
      channel: DEV_CHANNEL,
      type: "held-state",
      owner: "frontend",
      status: status("vite:default", "ready"),
    });
    expect(seen).to.deep.equal(["new"]);
  });
});

describe("garde du canal — held-owners", () => {
  const msg = (owners: unknown): unknown => ({
    channel: DEV_CHANNEL,
    type: "held-owners",
    owners,
  });

  it("une liste bornée d'identifiants passe, vide comprise", () => {
    expect(isDevChannelMessage(msg([]))).to.equal(true);
    expect(isDevChannelMessage(msg(["frontend", "ai"]))).to.equal(true);
  });

  it("refusé : pas un tableau, identifiant invalide ou trop long, liste démesurée", () => {
    expect(isDevChannelMessage(msg("frontend"))).to.equal(false);
    expect(isDevChannelMessage(msg([42]))).to.equal(false);
    expect(isDevChannelMessage(msg(["../x"]))).to.equal(false);
    expect(isDevChannelMessage(msg(["a".repeat(65)]))).to.equal(false);
    expect(
      isDevChannelMessage(msg(Array.from({ length: 33 }, (_, i) => `o${i}`))),
    ).to.equal(false);
  });
});
