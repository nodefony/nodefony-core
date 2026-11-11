import { describe, expect, it } from "vitest";
import {
  MAX_PRESENCE_MEMBERS,
  readPresenceAlive,
  readPresenceMessage,
  type IPresenceAlive,
  type PresenceMessage,
} from "../../src/backplane/presenceMessage";
import {
  RemotePresence,
  type IPresenceAggregate,
} from "../../src/server/remotePresence";

const INTERVAL = 5000;
const FACTOR = 3;
const INC = 1_762_800_000_000 * 1024 + 1;
const A = "host-a:10";
const B = "host-b:20";

/** Agrégat de test : somme des deltas, et refus de tout compte négatif ou delta nul. */
class Agg implements IPresenceAggregate {
  readonly tabs = new Map<string, number>();
  unnamed = 0;
  calls = 0;
  remoteTabs(key: string, delta: number): void {
    this.calls += 1;
    if (delta === 0) throw new Error(`delta nul pour ${key}`);
    const next = (this.tabs.get(key) ?? 0) + delta;
    if (next < 0) throw new Error(`onglets négatifs pour ${key}`);
    if (next === 0) this.tabs.delete(key);
    else this.tabs.set(key, next);
  }
  remoteUnnamed(delta: number): void {
    this.calls += 1;
    if (delta === 0) throw new Error("delta nul (non nommés)");
    this.unnamed += delta;
    if (this.unnamed < 0) throw new Error("non nommés négatifs");
  }
  // Agrégat sans grâce : un pair parti retire ses onglets tout de suite (la
  // grâce des départs de pod est éprouvée sur `ChannelPresence`).
  remoteLeave(key: string, tabs: number): void {
    if (tabs <= 0)
      throw new Error(`départ de ${String(tabs)} onglet(s) pour ${key}`);
    this.remoteTabs(key, -tabs);
  }
  remoteUnnamedLeave(count: number): void {
    if (count <= 0) throw new Error(`départ de ${String(count)} non nommé(s)`);
    this.remoteUnnamed(-count);
  }
  snapshot(): Record<string, number> {
    return Object.fromEntries([...this.tabs].sort());
  }
}

interface IDecor {
  view: RemotePresence;
  agg: Map<string, Agg>;
  served: string[];
  /** Agrégat d'un canal servi. */
  at(channel: string): Agg;
}

/** Décor : `room:1`, `room:2` servis ; `room:3` déclaré, non servi ; le reste non déclaré. */
function decor(): IDecor {
  const agg = new Map<string, Agg>([
    ["room:1", new Agg()],
    ["room:2", new Agg()],
  ]);
  const view = new RemotePresence({
    factor: FACTOR,
    interval: INTERVAL,
    lookup: (channel) => {
      const found = agg.get(channel);
      if (found !== undefined) return found;
      return channel === "room:3" ? null : false;
    },
  });
  return {
    view,
    agg,
    served: ["room:1", "room:2"],
    at: (channel) => {
      const found = agg.get(channel);
      if (found === undefined) throw new Error(channel);
      return found;
    },
  };
}

/** Message passé par le lecteur réel — la vue ne reçoit jamais que du validé. */
function msg(payload: Record<string, unknown>): PresenceMessage {
  const read = readPresenceMessage({ incarnation: INC, ...payload });
  if (read === null)
    throw new Error(`message refusé : ${JSON.stringify(payload)}`);
  return read;
}
function alive(payload: Record<string, unknown>): IPresenceAlive {
  const read = readPresenceAlive({
    incarnation: INC,
    interval: INTERVAL,
    ...payload,
  });
  if (read === null)
    throw new Error(`preuve de vie refusée : ${JSON.stringify(payload)}`);
  return read;
}
const batch = (seq: number, prev: number, channels: unknown[], extra = {}) =>
  msg({ op: "batch", seq, prev, channels, ...extra });
const part = (
  seq: number,
  last: number,
  i: number,
  n: number,
  channels: unknown[],
  extra = {},
) => msg({ op: "state", seq, last, i, n, channels, ...extra });

/** Pod A connu, synchronisé à `reference` = 0 (aucun lot émis), vu à t=0. */
function synced(): IDecor {
  const d = decor();
  d.view.receiveAlive(A, alive({ seq: 1, last: 0 }), 0);
  expect(d.view.gaps).toBe(0);
  return d;
}

describe("#760 lot D — vue distante de la présence (RemotePresence)", () => {
  it("🔴 délai d'oubli sous 2 intervalles, intervalle non entier : refusés au démarrage", () => {
    const lookup = () => false as const;
    expect(
      () => new RemotePresence({ factor: 1, interval: INTERVAL, lookup }),
    ).toThrow(RangeError);
    expect(
      () => new RemotePresence({ factor: 2.5, interval: INTERVAL, lookup }),
    ).toThrow(RangeError);
    expect(
      () => new RemotePresence({ factor: 2, interval: 0, lookup }),
    ).toThrow(RangeError);
    expect(
      () => new RemotePresence({ factor: 2, interval: INTERVAL, lookup }),
    ).not.toThrow();
  });

  describe("premier contact", () => {
    it("preuve de vie `last: 0` : pair connu VIDE, sans trou ni demande", () => {
      const d = synced();
      expect(d.view.size).toBe(1);
      expect(d.view.takeRequests(0, d.served)).toBeNull();
      d.view.receive(
        A,
        batch(2, 0, [{ channel: "room:1", set: ["alice", 1], unnamed: 0 }]),
        1,
      );
      expect(d.at("room:1").snapshot()).toEqual({ alice: 1 });
    });

    it("pair découvert par sa DEMANDE (trou), puis preuve de vie `last: 0` : trou fermé sans aller-retour", () => {
      const d = decor();
      const request = msg({
        op: "request",
        seq: 1,
        channels: ["room:1"],
        to: null,
      });
      expect(d.view.receive(A, request, 0)).toBe(request);
      expect(d.view.gaps).toBe(1);
      d.view.receiveAlive(A, alive({ seq: 2, last: 0 }), 1);
      expect(d.view.gaps).toBe(0);
      expect(d.view.takeRequests(1, d.served)).toBeNull();
      d.view.receive(
        A,
        batch(3, 0, [{ channel: "room:1", set: ["alice", 1], unnamed: 0 }]),
        2,
      );
      expect(d.at("room:1").snapshot()).toEqual({ alice: 1 });
    });

    it("premier lot `prev: 0` d'un pair inconnu : appliqué sans demande", () => {
      const d = decor();
      d.view.receive(
        A,
        batch(1, 0, [{ channel: "room:1", set: ["alice", 1], unnamed: 2 }]),
        0,
      );
      expect(d.view.gaps).toBe(0);
      expect(d.at("room:1").snapshot()).toEqual({ alice: 1 });
      expect(d.at("room:1").unnamed).toBe(2);
    });

    it("pair inconnu en cours de vie : trou, demande CIBLÉE qui nomme les canaux servis, lots retenus sans être appliqués", () => {
      const d = decor();
      d.view.receiveAlive(A, alive({ seq: 9, last: 7 }), 0);
      expect(d.view.gaps).toBe(1);
      expect(d.view.takeRequests(0, d.served)).toEqual([A]);
      // Une seule demande par intervalle local tant que le trou dure.
      expect(d.view.takeRequests(INTERVAL - 1, d.served)).toBeNull();
      d.view.receive(
        A,
        batch(10, 7, [{ channel: "room:1", set: ["alice", 1], unnamed: 0 }]),
        1,
      );
      expect(d.at("room:1").calls).toBe(0);
      // La réponse ferme le trou à son `last` : le lot 10 (≤ last) y est compris.
      d.view.receive(
        A,
        part(11, 10, 0, 1, [
          { channel: "room:1", members: ["alice", 1, "bob", 3], unnamed: 1 },
          { channel: "room:2", members: [], unnamed: 0 },
        ]),
        2,
      );
      expect(d.view.gaps).toBe(0);
      expect(d.at("room:1").snapshot()).toEqual({ alice: 1, bob: 3 });
      expect(d.at("room:1").unnamed).toBe(1);
      // Le lot suivant chaîne sur `last`.
      d.view.receive(
        A,
        batch(12, 10, [{ channel: "room:1", gone: ["bob"], unnamed: 1 }]),
        3,
      );
      expect(d.at("room:1").snapshot()).toEqual({ alice: 1 });
      expect(d.view.takeRequests(INTERVAL * 2, d.served)).toBeNull();
    });
  });

  describe("lots chaînés (RFC 5263 §4.5)", () => {
    it("applied → gap sur `prev` inattendu : RIEN n'est appliqué, la demande part", () => {
      const d = synced();
      d.view.receive(
        A,
        batch(2, 0, [{ channel: "room:1", set: ["alice", 1], unnamed: 0 }]),
        1,
      );
      // Le lot 3 est perdu ; le 4 chaîne sur 3.
      d.view.receive(
        A,
        batch(4, 3, [{ channel: "room:1", set: ["bob", 1], unnamed: 0 }]),
        2,
      );
      expect(d.at("room:1").snapshot()).toEqual({ alice: 1 });
      expect(d.view.gaps).toBe(1);
      expect(d.view.gapTotal).toBe(1);
      expect(d.view.takeRequests(2, d.served)).toEqual([A]);
    });

    it("🔴 rejeu d'un lot : jeté et compté, agrégat intact (anti-rejeu par `seq`)", () => {
      const d = synced();
      const b = batch(2, 0, [
        { channel: "room:1", set: ["alice", 1], unnamed: 1 },
      ]);
      d.view.receive(A, b, 1);
      const calls = d.at("room:1").calls;
      d.view.receive(A, b, 2);
      expect(d.view.staleTotal).toBe(1);
      expect(d.at("room:1").calls).toBe(calls);
      expect(d.view.gaps).toBe(0);
    });

    it("valeurs ABSOLUES : un `set` qui ne change rien n'appelle pas l'agrégat", () => {
      const d = synced();
      d.view.receive(
        A,
        batch(2, 0, [{ channel: "room:1", set: ["alice", 2], unnamed: 1 }]),
        1,
      );
      const calls = d.at("room:1").calls;
      d.view.receive(
        A,
        batch(3, 2, [{ channel: "room:1", set: ["alice", 2], unnamed: 1 }]),
        2,
      );
      expect(d.at("room:1").calls).toBe(calls);
      d.view.receive(
        A,
        batch(4, 3, [{ channel: "room:1", set: ["alice", 3], unnamed: 1 }]),
        3,
      );
      expect(d.at("room:1").snapshot()).toEqual({ alice: 3 });
    });

    it("`gone` d'une identité inconnue : sans effet", () => {
      const d = synced();
      d.view.receive(
        A,
        batch(2, 0, [{ channel: "room:1", gone: ["ghost"], unnamed: 0 }]),
        1,
      );
      expect(d.at("room:1").calls).toBe(0);
    });
  });

  describe("preuve de vie", () => {
    it("`last` au-delà du dernier lot appliqué : trou (un lot est perdu)", () => {
      const d = synced();
      d.view.receiveAlive(A, alive({ seq: 3, last: 2 }), 1);
      expect(d.view.gaps).toBe(1);
    });

    it("preuve de vie perdue : aucun trou", () => {
      const d = synced();
      d.view.receive(
        A,
        batch(2, 0, [{ channel: "room:1", set: ["alice", 1], unnamed: 0 }]),
        1,
      );
      // seq 3 (preuve de vie) perdue, la suivante porte last = 2.
      d.view.receiveAlive(A, alive({ seq: 4, last: 2 }), 2);
      expect(d.view.gaps).toBe(0);
    });

    it("🔴 relevés SÉPARÉS : une demande doublée par une preuve de vie hors quota n'est pas prise pour un rejeu", () => {
      const d = synced();
      d.view.receiveAlive(A, alive({ seq: 10, last: 0 }), 1);
      const request = msg({
        op: "request",
        seq: 9,
        channels: ["room:1"],
        to: B,
      });
      expect(d.view.receive(A, request, 2)).toBe(request);
      expect(d.view.staleTotal).toBe(0);
      // Une preuve de vie rejouée, elle, est jetée.
      d.view.receiveAlive(A, alive({ seq: 10, last: 0 }), 3);
      expect(d.view.staleTotal).toBe(1);
    });

    it("demande fraîche rendue au répondeur ; rejouée : rien", () => {
      const d = synced();
      const request = msg({
        op: "request",
        seq: 2,
        channels: ["room:1"],
        to: null,
      });
      expect(d.view.receive(A, request, 1)).toBe(request);
      expect(d.view.receive(A, request, 2)).toBeNull();
    });
  });

  describe("réponse d'état — appliquée d'un bloc", () => {
    function inGap(): IDecor {
      const d = synced();
      d.view.receive(
        A,
        batch(2, 0, [{ channel: "room:1", set: ["old", 1], unnamed: 0 }]),
        1,
      );
      d.view.receiveAlive(A, alive({ seq: 4, last: 3 }), 2);
      expect(d.view.gaps).toBe(1);
      expect(d.view.takeRequests(2, d.served)).toEqual([A]);
      return d;
    }

    it("n parts consécutives : la vue n'est remplacée qu'à la dernière, un canal peut s'étendre sur deux parts", () => {
      const d = inGap();
      d.view.receive(
        A,
        part(5, 3, 0, 2, [
          { channel: "room:1", members: ["a", 1], unnamed: 2 },
        ]),
        3,
      );
      expect(d.at("room:1").snapshot()).toEqual({ old: 1 });
      d.view.receive(
        A,
        part(6, 3, 1, 2, [
          { channel: "room:1", members: ["b", 2], unnamed: 2 },
          { channel: "room:2", members: [], unnamed: 0 },
        ]),
        4,
      );
      expect(d.at("room:1").snapshot()).toEqual({ a: 1, b: 2 });
      expect(d.at("room:1").unnamed).toBe(2);
      expect(d.view.gaps).toBe(0);
    });

    it("🔴 une part perdue : vue INCHANGÉE, trou maintenu, redemandé un intervalle plus tard seulement", () => {
      const d = inGap();
      d.view.receive(
        A,
        part(5, 3, 0, 3, [
          { channel: "room:1", members: ["a", 1], unnamed: 0 },
        ]),
        3,
      );
      // Part 1 (seq 6) perdue.
      d.view.receive(
        A,
        part(7, 3, 2, 3, [{ channel: "room:2", members: [], unnamed: 0 }]),
        4,
      );
      expect(d.at("room:1").snapshot()).toEqual({ old: 1 });
      expect(d.view.gaps).toBe(1);
      expect(d.view.takeRequests(INTERVAL + 1, d.served)).toBeNull();
      expect(d.view.takeRequests(INTERVAL + 2, d.served)).toEqual([A]);
    });

    it("🔴 part hors suite (`seq` non consécutif, `n` ou `last` différents) : réponse abandonnée", () => {
      for (const [seq, n, last] of [
        [7, 2, 3],
        [6, 3, 3],
        [6, 2, 2],
      ] as const) {
        const d = inGap();
        d.view.receive(
          A,
          part(5, 3, 0, 2, [
            { channel: "room:1", members: ["a", 1], unnamed: 0 },
          ]),
          3,
        );
        d.view.receive(
          A,
          part(seq, last, 1, n, [
            { channel: "room:2", members: [], unnamed: 0 },
          ]),
          4,
        );
        expect(d.view.gaps, `${seq}/${n}/${last}`).toBe(1);
        expect(d.at("room:1").snapshot()).toEqual({ old: 1 });
      }
    });

    it("réponse qui ne COUVRE pas la demande (servie à un autre) : canaux nommés appliqués, trou maintenu", () => {
      const d = inGap();
      d.view.receive(
        A,
        part(5, 3, 0, 1, [
          { channel: "room:1", members: ["a", 1], unnamed: 0 },
        ]),
        3,
      );
      expect(d.at("room:1").snapshot()).toEqual({ a: 1 });
      expect(d.view.gaps).toBe(1);
    });

    it("🔴 deux réponses au même `last` couvrent ENSEMBLE la demande ; à des `last` différents, jamais", () => {
      const room1 = { channel: "room:1", members: ["a", 1], unnamed: 0 };
      const room2 = { channel: "room:2", members: [], unnamed: 0 };
      // Même `last` : le même état du pair, servi en deux fois.
      const d = inGap();
      d.view.receive(A, part(5, 3, 0, 1, [room1]), 3);
      expect(d.view.gaps).toBe(1);
      d.view.receive(A, part(6, 3, 0, 1, [room2]), 3);
      expect(d.view.gaps).toBe(0);
      // `last` différents : un lot a pu changer `room:1` entre les deux.
      const e = inGap();
      e.view.receive(A, part(5, 3, 0, 1, [room1]), 3);
      e.view.receive(A, part(6, 4, 0, 1, [room2]), 3);
      expect(e.view.gaps).toBe(1);
      e.view.receive(A, part(7, 4, 0, 1, [room1]), 3);
      expect(e.view.gaps).toBe(0);
    });

    it("canal demandé puis retiré, nommé quand même : la couverture compte les canaux NOMMÉS, servis ou non", () => {
      const d = inGap();
      d.agg.delete("room:2");
      d.view.receive(
        A,
        part(5, 3, 0, 1, [
          { channel: "room:1", members: [], unnamed: 0 },
          { channel: "room:2", members: ["x", 1], unnamed: 0 },
        ]),
        3,
      );
      expect(d.view.gaps).toBe(0);
      expect(d.at("room:1").snapshot()).toEqual({});
    });

    it("hors trou, `last` égal à la vue (canal neuf servi) : appliquée, la référence ne bouge pas", () => {
      const d = synced();
      d.view.receive(A, batch(2, 0, [], {}), 1);
      d.view.receive(
        A,
        part(3, 2, 0, 1, [
          { channel: "room:2", members: ["z", 1], unnamed: 4 },
        ]),
        2,
      );
      expect(d.at("room:2").snapshot()).toEqual({ z: 1 });
      expect(d.view.gaps).toBe(0);
      d.view.receive(
        A,
        batch(4, 2, [{ channel: "room:2", gone: ["z"], unnamed: 4 }]),
        3,
      );
      expect(d.at("room:2").snapshot()).toEqual({});
    });

    it("hors trou, `last` au-delà de la vue : appliquée, puis trou (des lots ont manqué)", () => {
      const d = synced();
      d.view.receive(
        A,
        part(5, 3, 0, 1, [
          { channel: "room:1", members: ["a", 1], unnamed: 0 },
        ]),
        1,
      );
      expect(d.at("room:1").snapshot()).toEqual({ a: 1 });
      expect(d.view.gaps).toBe(1);
    });

    it("plus ancienne que la vue : ignorée (elle reculerait des canaux à jour)", () => {
      const d = synced();
      d.view.receive(
        A,
        batch(2, 0, [{ channel: "room:1", set: ["a", 1], unnamed: 0 }]),
        1,
      );
      d.view.receive(
        A,
        batch(3, 2, [{ channel: "room:1", set: ["b", 1], unnamed: 0 }]),
        1,
      );
      d.view.receive(
        A,
        part(4, 2, 0, 1, [
          { channel: "room:1", members: ["a", 1], unnamed: 0 },
        ]),
        2,
      );
      expect(d.at("room:1").snapshot()).toEqual({ a: 1, b: 1 });
    });

    it("en place : seul celui qui n'est plus nommé part, seuls ceux qui changent appellent l'agrégat", () => {
      const d = synced();
      d.view.receive(
        A,
        batch(2, 0, [
          { channel: "room:1", set: ["a", 1, "b", 1, "c", 2], unnamed: 0 },
        ]),
        1,
      );
      const calls = d.at("room:1").calls;
      d.view.receive(
        A,
        part(3, 2, 0, 1, [
          { channel: "room:1", members: ["a", 1, "c", 3, "d", 1], unnamed: 0 },
        ]),
        2,
      );
      expect(d.at("room:1").snapshot()).toEqual({ a: 1, c: 3, d: 1 });
      // c (2→3), d (arrivée), b (départ) : trois appels, pas un de plus.
      expect(d.at("room:1").calls - calls).toBe(3);
    });

    it("un canal sur deux parts : ses membres comptés ENSEMBLE, aucun départ à tort", () => {
      const d = synced();
      d.view.receive(
        A,
        batch(2, 0, [{ channel: "room:1", set: ["a", 1, "b", 1], unnamed: 0 }]),
        1,
      );
      const calls = d.at("room:1").calls;
      d.view.receive(
        A,
        part(3, 2, 0, 2, [
          { channel: "room:1", members: ["a", 1], unnamed: 5 },
        ]),
        2,
      );
      d.view.receive(
        A,
        part(4, 2, 1, 2, [
          { channel: "room:1", members: ["b", 1], unnamed: 5 },
        ]),
        2,
      );
      expect(d.at("room:1").snapshot()).toEqual({ a: 1, b: 1 });
      expect(d.at("room:1").unnamed).toBe(5);
      expect(d.at("room:1").calls - calls).toBe(1); // les non nommés seuls
    });

    it("🔴 plafond jugé sur le canal ENTIER, toutes parts confondues : refusé, vue intacte", () => {
      const d = synced();
      d.view.receive(
        A,
        batch(2, 0, [{ channel: "room:1", set: ["keep", 1], unnamed: 0 }]),
        1,
      );
      const half = (from: number) => {
        const out: (string | number)[] = [];
        for (let i = 0; i < 60_000; i += 1) out.push(`u${from + i}`, 1);
        return out;
      };
      d.view.receive(
        A,
        part(3, 2, 0, 2, [{ channel: "room:1", members: half(0), unnamed: 0 }]),
        2,
      );
      d.view.receive(
        A,
        part(4, 2, 1, 2, [
          { channel: "room:1", members: half(60_000), unnamed: 0 },
        ]),
        2,
      );
      expect(d.view.rejectedTotal).toBe(1);
      expect(d.at("room:1").snapshot()).toEqual({ keep: 1 });
    });

    it("identique à la vue : aucun appel à l'agrégat (deltas seulement)", () => {
      const d = synced();
      d.view.receive(
        A,
        batch(2, 0, [{ channel: "room:1", set: ["a", 1, "b", 2], unnamed: 3 }]),
        1,
      );
      const calls = d.at("room:1").calls;
      d.view.receive(
        A,
        part(3, 2, 0, 1, [
          { channel: "room:1", members: ["b", 2, "a", 1], unnamed: 3 },
        ]),
        2,
      );
      expect(d.at("room:1").calls).toBe(calls);
    });
  });

  describe("incarnation — une vie de processus", () => {
    it("vie plus récente (conteneur redémarré sous le même `originId`) : l'ancienne purgée, la neuve repart d'un trou", () => {
      const d = synced();
      d.view.receive(
        A,
        batch(2, 0, [{ channel: "room:1", set: ["ghost", 1], unnamed: 2 }]),
        1,
      );
      d.view.receiveAlive(
        A,
        alive({ incarnation: INC + 1024, seq: 1, last: 0 }),
        2,
      );
      expect(d.at("room:1").snapshot()).toEqual({});
      expect(d.at("room:1").unnamed).toBe(0);
      expect(d.view.size).toBe(1);
      expect(d.view.gaps).toBe(0);
    });

    it("🔴 vie plus ancienne : refusée, comptée, et ne rafraîchit PAS le signe de vie", () => {
      const d = synced();
      d.view.receiveAlive(
        A,
        alive({ incarnation: INC - 1, seq: 50, last: 0 }),
        INTERVAL,
      );
      expect(d.view.staleTotal).toBe(1);
      // Vu à t=0 seulement : oublié à 3 intervalles malgré le message de t=INTERVAL.
      expect(d.view.expire(FACTOR * INTERVAL)).toBe(1);
    });

    it("après l'oubli, une vie d'horloge reculée est acceptée", () => {
      const d = synced();
      d.view.expire(FACTOR * INTERVAL);
      expect(d.view.size).toBe(0);
      d.view.receiveAlive(
        A,
        alive({ incarnation: INC - 1, seq: 1, last: 0 }),
        FACTOR * INTERVAL + 1,
      );
      expect(d.view.size).toBe(1);
      expect(d.view.staleTotal).toBe(0);
    });
  });

  describe("oubli — horloge monotone, intervalle ANNONCÉ", () => {
    it("🔴 oublié à `factor` intervalles annoncés exactement, pas une milliseconde avant ; présents retirés", () => {
      const d = synced();
      d.view.receive(
        A,
        batch(2, 0, [{ channel: "room:1", set: ["alice", 2], unnamed: 1 }]),
        0,
      );
      expect(d.view.nextDeadline()).toBe(FACTOR * INTERVAL);
      expect(d.view.expire(FACTOR * INTERVAL - 1)).toBe(0);
      expect(d.at("room:1").snapshot()).toEqual({ alice: 2 });
      expect(d.view.expire(FACTOR * INTERVAL)).toBe(1);
      expect(d.at("room:1").snapshot()).toEqual({});
      expect(d.at("room:1").unnamed).toBe(0);
      expect(d.view.forgottenTotal).toBe(1);
      expect(d.view.nextDeadline()).toBe(Number.POSITIVE_INFINITY);
    });

    it("tout message valide de la vie courante vaut signe de vie", () => {
      const d = synced();
      d.view.receive(A, batch(2, 0, [], {}), 10_000);
      expect(d.view.expire(FACTOR * INTERVAL)).toBe(0);
      expect(d.view.nextDeadline()).toBe(10_000 + FACTOR * INTERVAL);
    });

    it("🔴 deux pods d'intervalles différents (déploiement progressif) : chacun jugé sur le SIEN", () => {
      const d = synced();
      d.view.receiveAlive(B, alive({ seq: 1, last: 0, interval: 20_000 }), 0);
      // Au-delà de 3 × 5 s : A oublié, B (20 s annoncés) encore vivant.
      expect(d.view.expire(FACTOR * INTERVAL)).toBe(1);
      expect(d.view.size).toBe(1);
      expect(d.view.nextDeadline()).toBe(FACTOR * 20_000);
    });

    it("pair sans preuve de vie encore reçue : intervalle LOCAL supposé", () => {
      const d = decor();
      d.view.receive(A, batch(1, 0, [], {}), 0);
      expect(d.view.nextDeadline()).toBe(FACTOR * INTERVAL);
    });

    it("🔴 récepteur gelé 20 s : le réarmement n'oublie aucun pair vivant", () => {
      const d = synced();
      d.view.receiveAlive(B, alive({ seq: 1, last: 0 }), 0);
      d.view.rearm(20_000);
      expect(d.view.expire(20_000)).toBe(0);
      expect(d.view.nextDeadline()).toBe(20_000 + FACTOR * INTERVAL);
    });
  });

  describe("arrêt propre (`final`)", () => {
    it("🔴 présents retirés AUSSITÔT ; lot tardif de la même vie ignoré ; pierre tombale retirée à l'échéance", () => {
      const d = synced();
      d.view.receive(
        A,
        batch(2, 0, [{ channel: "room:1", set: ["alice", 1], unnamed: 1 }]),
        0,
      );
      d.view.receiveAlive(A, alive({ seq: 3, last: 2, final: true }), 1);
      expect(d.at("room:1").snapshot()).toEqual({});
      expect(d.at("room:1").unnamed).toBe(0);
      expect(d.view.gaps).toBe(0);
      // Un lot doublé par la preuve de vie finale (hors quota) arrive après.
      d.view.receive(
        A,
        batch(4, 2, [{ channel: "room:1", set: ["alice", 1], unnamed: 0 }]),
        2,
      );
      expect(d.at("room:1").snapshot()).toEqual({});
      expect(d.view.staleTotal).toBe(1);
      expect(d.view.takeRequests(2, d.served)).toBeNull();
      // L'échéance retire la pierre tombale sans la compter comme un oubli.
      expect(d.view.expire(1 + FACTOR * INTERVAL)).toBe(0);
      expect(d.view.size).toBe(0);
      expect(d.view.forgottenTotal).toBe(0);
    });

    it("une vie neuve après l'arrêt : acceptée", () => {
      const d = synced();
      d.view.receiveAlive(A, alive({ seq: 2, last: 0, final: true }), 1);
      d.view.receive(
        A,
        batch(1, 0, [{ channel: "room:1", set: ["alice", 1], unnamed: 0 }], {
          incarnation: INC + 1,
        }),
        2,
      );
      expect(d.at("room:1").snapshot()).toEqual({ alice: 1 });
    });

    it("arrêt d'un pod en trou : le compte de trous retombe", () => {
      const d = synced();
      d.view.receiveAlive(A, alive({ seq: 3, last: 2 }), 1);
      expect(d.view.gaps).toBe(1);
      d.view.receiveAlive(A, alive({ seq: 4, last: 2, final: true }), 2);
      expect(d.view.gaps).toBe(0);
    });
  });

  describe("canaux servis, déclarés, plafonnés", () => {
    it("canal déclaré mais non servi : lu puis jeté SANS stockage ni compte ; non déclaré : compté une fois par message", () => {
      const d = synced();
      d.view.receive(
        A,
        batch(2, 0, [
          { channel: "room:3", set: ["x", 1], unnamed: 1 },
          { channel: "intrus:1", set: ["y", 1], unnamed: 0 },
          { channel: "intrus:2", unnamed: 3 },
          { channel: "room:1", set: ["alice", 1], unnamed: 0 },
        ]),
        1,
      );
      expect(d.view.rejectedTotal).toBe(1);
      expect(d.at("room:1").snapshot()).toEqual({ alice: 1 });
      d.view.receive(
        A,
        part(3, 2, 0, 1, [
          { channel: "intrus:1", members: ["y", 1], unnamed: 0 },
        ]),
        2,
      );
      expect(d.view.rejectedTotal).toBe(2);
    });

    it("🔴 plafond de membres par pod et par canal : entrée refusée, comptée, rien appliqué", () => {
      const d = synced();
      const pairs: (string | number)[] = [];
      for (let i = 0; i < MAX_PRESENCE_MEMBERS; i += 1) pairs.push(`u${i}`, 1);
      d.view.receive(
        A,
        batch(2, 0, [{ channel: "room:1", set: pairs, unnamed: 0 }]),
        1,
      );
      expect(d.at("room:1").tabs.size).toBe(MAX_PRESENCE_MEMBERS);
      d.view.receive(
        A,
        batch(3, 2, [{ channel: "room:1", set: ["one-more", 1], unnamed: 0 }]),
        2,
      );
      expect(d.view.rejectedTotal).toBe(1);
      expect(d.at("room:1").tabs.has("one-more")).toBe(false);
    });

    it("dropChannel : la table du canal est libérée chez tous les pods", () => {
      const d = synced();
      d.view.receiveAlive(B, alive({ seq: 1, last: 0 }), 0);
      d.view.receive(
        A,
        batch(2, 0, [{ channel: "room:1", set: ["a", 1], unnamed: 0 }]),
        1,
      );
      d.view.receive(
        B,
        batch(2, 0, [{ channel: "room:1", set: ["b", 1], unnamed: 0 }]),
        1,
      );
      d.view.dropChannel("room:1");
      // Un nouvel agrégat (canal servi à nouveau) ne reçoit que ce qui arrive ensuite.
      const fresh = new Agg();
      d.agg.set("room:1", fresh);
      d.view.receive(
        A,
        batch(3, 2, [{ channel: "room:1", gone: ["a"], unnamed: 0 }]),
        2,
      );
      expect(fresh.calls).toBe(0);
      // L'oubli ne retire rien de ce qui a été lâché.
      d.view.expire(10 * INTERVAL);
      expect(fresh.calls).toBe(0);
    });
  });

  describe("plusieurs pods", () => {
    it("🔴 une identité dans deux onglets sur deux pods : UN présent, onglets additionnés ; l'oubli d'un pod laisse l'autre", () => {
      const d = synced();
      d.view.receiveAlive(B, alive({ seq: 1, last: 0 }), 1);
      d.view.receive(
        A,
        batch(2, 0, [{ channel: "room:1", set: ["alice", 1], unnamed: 1 }]),
        0,
      );
      d.view.receive(
        B,
        batch(2, 0, [{ channel: "room:1", set: ["alice", 1], unnamed: 2 }]),
        1,
      );
      expect(d.at("room:1").snapshot()).toEqual({ alice: 2 });
      expect(d.at("room:1").unnamed).toBe(3);
      // A vu pour la dernière fois à 0, B à 1 : seul A est échu.
      expect(d.view.expire(FACTOR * INTERVAL)).toBe(1);
      expect(d.at("room:1").snapshot()).toEqual({ alice: 1 });
      expect(d.at("room:1").unnamed).toBe(2);
    });

    it("le trou d'un pod n'affecte pas l'application des lots d'un autre", () => {
      const d = synced();
      d.view.receiveAlive(B, alive({ seq: 1, last: 0 }), 0);
      d.view.receiveAlive(A, alive({ seq: 6, last: 5 }), 0);
      d.view.receive(
        B,
        batch(2, 0, [{ channel: "room:1", set: ["bob", 1], unnamed: 0 }]),
        1,
      );
      expect(d.view.gaps).toBe(1);
      expect(d.at("room:1").snapshot()).toEqual({ bob: 1 });
      expect(d.view.takeRequests(1, d.served)).toEqual([A]);
    });
  });
});
