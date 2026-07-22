import { describe, it, expect } from "vitest";
import { RealtimeHub } from "../../src/server/RealtimeHub.js";
import { JsonRpcPeer } from "nodefony";

/**
 * **Fan-out mutualisé (plan S1)** — sur un canal diffusé, la frame envoyée est
 * IDENTIQUE pour tous les abonnés : la sérialiser une fois par abonné revient à
 * refaire N fois le même calcul. Le hub étant agnostique du protocole, c'est
 * l'abonné qui lui fournit un sérialiseur ; le hub décide quand il vaut le coup.
 *
 * Ce que ces tests verrouillent :
 *  - le travail est fait UNE fois quel que soit le nombre d'abonnés ;
 *  - la frame reçue est **exactement** celle du chemin non mutualisé (aucune
 *    divergence de format possible entre les deux voies) ;
 *  - le chemin historique (sink à un seul argument) est intact ;
 *  - une charge non sérialisable ne casse pas le fan-out — chaque abonné retombe
 *    sur son propre filet.
 */

/** Charge qui compte combien de fois elle est sérialisée. */
function countingPayload(): { value: { v: number }; count: () => number } {
  let n = 0;
  const value = {
    v: 1,
    toJSON(): unknown {
      n += 1;
      return { v: 1 };
    },
  };
  return { value: value as unknown as { v: number }, count: () => n };
}

/** Sérialiseur d'un canal : la frame JSON-RPC de notification, telle qu'envoyée. */
const serializeNotification =
  (channel: string) =>
  (payload: unknown): string =>
    JSON.stringify(JsonRpcPeer.buildNotification(channel, payload));

describe("Fan-out — sérialisation mutualisée (plan S1)", () => {
  it("N abonnés ⇒ UNE seule sérialisation (au lieu de N)", () => {
    const hub = new RealtimeHub();
    const received: string[] = [];
    const sink = (_p: unknown, raw?: string): void => {
      received.push(raw ?? "NON_MUTUALISE");
    };
    // 3 abonnés sur le même canal, tous servis par le même provider.
    hub.subscribe(
      "chat:room",
      sink,
      () => () => {},
      serializeNotification("chat:room"),
    );
    hub.subscribe(
      "chat:room",
      (_p, raw) => received.push(raw ?? "NON_MUTUALISE"),
      () => () => {},
      serializeNotification("chat:room"),
    );
    hub.subscribe(
      "chat:room",
      (_p, raw) => received.push(raw ?? "NON_MUTUALISE"),
      () => () => {},
      serializeNotification("chat:room"),
    );

    const { value, count } = countingPayload();
    hub.publish("chat:room", value);

    expect(received).to.have.lengthOf(3);
    expect(count()).to.equal(1); // le cœur du plan S1
  });

  it("la frame mutualisée est EXACTEMENT celle du chemin par abonné", () => {
    const hub = new RealtimeHub();
    let mutualisee = "";
    hub.subscribe(
      "chat:room",
      (_p, raw) => {
        mutualisee = raw ?? "";
      },
      () => () => {},
      serializeNotification("chat:room"),
    );
    hub.subscribe(
      "chat:room",
      () => {},
      () => () => {},
      serializeNotification("chat:room"),
    );

    hub.publish("chat:room", { msg: "hello", n: 42 });

    // Référence : ce qu'un peer aurait envoyé via `notify`.
    const attendue = JSON.stringify(
      JsonRpcPeer.buildNotification("chat:room", { msg: "hello", n: 42 }),
    );
    expect(mutualisee).to.equal(attendue);
  });

  it("un seul abonné ⇒ pas de mutualisation (on ne paie pas ce qui ne sert à rien)", () => {
    const hub = new RealtimeHub();
    let recu: string | undefined = "pas-appele";
    hub.subscribe(
      "chat:room",
      (_p, raw) => {
        recu = raw;
      },
      () => () => {},
      serializeNotification("chat:room"),
    );

    hub.publish("chat:room", { a: 1 });

    expect(recu).to.equal(undefined); // l'abonné sérialise lui-même, comme avant
  });

  it("CONTRÔLE — canal SANS sérialiseur : le chemin historique est intact", () => {
    const hub = new RealtimeHub();
    const recus: unknown[] = [];
    // Sink à un seul argument, tel qu'écrit avant le plan S1.
    hub.subscribe(
      "stats:cpu",
      (p) => recus.push(p),
      () => () => {},
    );
    hub.subscribe(
      "stats:cpu",
      (p) => recus.push(p),
      () => () => {},
    );

    hub.publish("stats:cpu", { load: 0.5 });

    expect(recus).to.deep.equal([{ load: 0.5 }, { load: 0.5 }]);
  });

  it("charge NON sérialisable : le fan-out tient, chaque abonné garde son filet", () => {
    const hub = new RealtimeHub();
    const vus: (string | undefined)[] = [];
    const cyclique: Record<string, unknown> = {};
    cyclique.self = cyclique; // JSON.stringify lève

    hub.subscribe(
      "chat:room",
      (_p, raw) => vus.push(raw),
      () => () => {},
      serializeNotification("chat:room"),
    );
    hub.subscribe(
      "chat:room",
      (_p, raw) => vus.push(raw),
      () => () => {},
      serializeNotification("chat:room"),
    );

    expect(() => hub.publish("chat:room", cyclique)).to.not.throw();
    // Pas de frame mutualisée → chacun retombe sur son propre chemin (qui log et
    // répond une erreur), exactement comme avant le plan S1.
    expect(vus).to.deep.equal([undefined, undefined]);
  });
});
