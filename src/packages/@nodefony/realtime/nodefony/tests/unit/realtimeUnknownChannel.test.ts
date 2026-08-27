import { describe, it, expect, beforeEach } from "vitest";
import "reflect-metadata";
import { RealtimeController } from "../../src/server/RealtimeController.js";
import { getRealtimeHub } from "../../src/server/RealtimeHub.js";
import type { RealtimePublish } from "../../interfaces/IRealtimeController.js";
import type { ContextType } from "@nodefony/http";

/**
 * Un abonnement qui échoue se DIT — même quand la cause n'est pas un refus.
 *
 * Le trou fermé ici, constaté contre un pod réel : `subscribe {channel}` vers un
 * canal que PERSONNE ne produit était ignoré sans un mot. Deux motifs de refus
 * étaient déjà observables (`limit` au plafond de canaux, `forbidden` au plancher
 * de plateforme et à la décision du firewall) ; le troisième — la faute de frappe
 * dans un nom de canal, le canal d'un module non chargé — ne l'était pas. L'écran
 * restait muet, indiscernable d'un canal calme, et le développeur cherchait son
 * bug côté producteur alors que son abonnement n'avait jamais existé.
 *
 * Le motif `unknown` ne fabrique aucun oracle : un canal PROTÉGÉ est tranché en
 * amont par le verrou de frame (`forbidden`, qu'il existe ou non). Ce qui reste
 * ici n'est jamais gardé — dire qu'il n'a pas de producteur ne révèle rien.
 */

const OPEN = 1;

function makeCtx() {
  const sent: Array<Record<string, unknown>> = [];
  const conn = {
    readyState: OPEN,
    send: (data: string, cb?: (err?: Error) => void) => {
      sent.push(JSON.parse(data));
      cb?.();
    },
    close: () => {},
  };
  const ctx = {
    connection: conn,
    once: () => {},
    request: { headers: {}, url: "/" },
    cookies: {},
    url: "/",
    remoteAddress: "127.0.0.1",
    origin: "",
  };
  return { ctx, sent };
}

/** Controller qui ne produit QUE `connu:*` — tout le reste est un canal orphelin. */
class TestRt extends RealtimeController {
  constructor(ctx: unknown) {
    super("test-rt-unknown", ctx as ContextType);
  }
  createRealtimeChannel(channel: string, _publish: RealtimePublish) {
    return channel.startsWith("connu:") ? () => {} : null;
  }
  feed(message: string | null): void {
    this.handleRealtime(message);
  }
}

const frame = (channel: string): string =>
  JSON.stringify({ jsonrpc: "2.0", method: "subscribe", params: { channel } });

const deniedFor = (sent: Array<Record<string, unknown>>): unknown[] =>
  sent.filter((f) => f.method === "realtime:denied").map((f) => f.params);

describe("subscribe vers un canal sans producteur — le refus se DIT", () => {
  beforeEach(() => {
    getRealtimeHub().clear();
    getRealtimeHub().setMaxChannelsPerConnection(256);
  });

  it("canal inexistant → realtime:denied {reason:'unknown'}, jamais un silence", () => {
    const { ctx, sent } = makeCtx();
    const rt = new TestRt(ctx);
    rt.feed(null);
    rt.feed(frame("app:canal-qui-nexiste-pas"));
    expect(deniedFor(sent)).to.deep.equal([
      { channel: "app:canal-qui-nexiste-pas", reason: "unknown" },
    ]);
  });

  it("canal servi → aucun refus (le motif ne se déclenche pas à tort)", () => {
    const { ctx, sent } = makeCtx();
    const rt = new TestRt(ctx);
    rt.feed(null);
    rt.feed(frame("connu:flux"));
    expect(deniedFor(sent)).to.have.length(0);
  });

  it("le plancher de plateforme garde son motif générique (forbidden ≠ unknown)", () => {
    // Sans module de sécurité (aucun verrou de frame posé), le namespace réservé
    // est fermé à toute connexion : c'est une décision d'autorisation, pas une
    // absence de producteur — le client ne doit pas lire « canal inconnu ».
    const { ctx, sent } = makeCtx();
    const rt = new TestRt(ctx);
    rt.feed(null);
    rt.feed(frame("nodefony:syslog"));
    expect(deniedFor(sent)).to.deep.equal([
      { channel: "nodefony:syslog", reason: "forbidden" },
    ]);
  });
});
