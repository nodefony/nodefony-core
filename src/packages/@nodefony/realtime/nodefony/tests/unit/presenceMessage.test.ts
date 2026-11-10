import { describe, expect, it } from "vitest";
import { MAX_CONTROL_FIELD_LENGTH } from "../../src/backplane/controlOrder";
import {
  MAX_PRESENCE_CHANNELS,
  MAX_PRESENCE_INTERVAL_MS,
  MAX_PRESENCE_MEMBERS,
  MAX_PRESENCE_PARTS,
  MIN_PRESENCE_INTERVAL_MS,
  isUnknownPresenceMessage,
  readPresenceAlive,
  readPresenceMessage,
} from "../../src/backplane/presenceMessage";

// Incarnation réaliste : Date.now() × 1024 + aléa — au-delà de 2^32, sous MAX_SAFE_INTEGER.
const INC = 1_762_800_000_000 * 1024 + 517;

const batch = () => ({
  op: "batch",
  incarnation: INC,
  seq: 5,
  prev: 3,
  channels: [
    {
      channel: "room:1",
      set: ["alice", 2, "bob", 1],
      gone: ["carol"],
      unnamed: 4,
    },
    { channel: "room:2", unnamed: 0 },
  ],
});
const request = () => ({
  op: "request",
  incarnation: INC,
  seq: 6,
  channels: ["room:1", "room:2"],
  to: "host-b:42",
});
const state = () => ({
  op: "state",
  incarnation: INC,
  seq: 7,
  last: 5,
  i: 0,
  n: 2,
  channels: [{ channel: "room:1", members: ["alice", 2], unnamed: 1 }],
});
const alive = () => ({
  incarnation: INC,
  seq: 8,
  last: 5,
  interval: 5000,
  final: true,
});

/** Copie modifiée d'un message — `undefined` retire le champ. */
function withField(
  base: Record<string, unknown>,
  key: string,
  value: unknown,
): Record<string, unknown> {
  const copy: Record<string, unknown> = { ...base };
  if (value === undefined) delete copy[key];
  else copy[key] = value;
  return copy;
}
function withEntry(
  base: Record<string, unknown> & { channels: unknown[] },
  key: string,
  value: unknown,
): Record<string, unknown> {
  const first = base.channels[0];
  const entry: Record<string, unknown> =
    typeof first === "object" && first !== null ? { ...first } : {};
  if (value === undefined) delete entry[key];
  else entry[key] = value;
  return { ...base, channels: [entry] };
}

const LONG = "x".repeat(MAX_CONTROL_FIELD_LENGTH + 1);

describe("#760 lot D — lecteur à liste fermée des messages de présence", () => {
  it("lit chaque type connu, sans copier les tableaux reçus", () => {
    const b = batch();
    const read = readPresenceMessage(b);
    expect(read).toEqual({
      op: "batch",
      incarnation: INC,
      seq: 5,
      prev: 3,
      channels: [
        {
          channel: "room:1",
          set: ["alice", 2, "bob", 1],
          gone: ["carol"],
          unnamed: 4,
        },
        { channel: "room:2", set: null, gone: null, unnamed: 0 },
      ],
    });
    // Zéro copie : les paires rendues SONT celles reçues.
    expect(read?.op === "batch" && read.channels[0]?.set).toBe(
      b.channels[0]?.set,
    );
    expect(readPresenceMessage(request())).toEqual(request());
    expect(
      readPresenceMessage(withField(request(), "to", undefined)),
    ).toMatchObject({ to: null });
    expect(readPresenceMessage(state())).toEqual(state());
    expect(readPresenceAlive(alive())).toEqual(alive());
    expect(
      readPresenceAlive(withField(alive(), "final", undefined)),
    ).toMatchObject({ final: false });
  });

  it("un champ inconnu est toléré (déploiement progressif), au message comme à l'entrée", () => {
    expect(readPresenceMessage({ ...batch(), future: 1 })).not.toBeNull();
    expect(
      readPresenceMessage(withEntry(batch(), "states", { x: 1 })),
    ).not.toBeNull();
    expect(readPresenceAlive({ ...alive(), zone: "eu" })).not.toBeNull();
  });

  it("un type inconnu n'est pas lu, mais se distingue d'une forme fausse", () => {
    const future = { ...batch(), op: "since" };
    expect(readPresenceMessage(future)).toBeNull();
    expect(isUnknownPresenceMessage(future)).toBe(true);
    // Type connu de forme fausse : invalide, pas « inconnu ».
    const broken = { ...batch(), seq: -1 };
    expect(readPresenceMessage(broken)).toBeNull();
    expect(isUnknownPresenceMessage(broken)).toBe(false);
    for (const op of [undefined, 3, "", LONG])
      expect(isUnknownPresenceMessage({ op })).toBe(false);
  });

  it("🔴 un champ hérité du prototype ne passe pas", () => {
    const proto = Object.create(batch()) as object;
    expect(readPresenceMessage(proto)).toBeNull();
    const aliveProto = Object.create(alive()) as object;
    expect(readPresenceAlive(aliveProto)).toBeNull();
  });

  const NUMBERS: [string, unknown][] = [
    ["négatif", -1],
    ["fractionnaire", 1.5],
    ["au-delà des entiers sûrs", 2 ** 53],
    ["texte", "5"],
    ["NaN", Number.NaN],
    ["absent", undefined],
  ];

  it.each(NUMBERS)("🔴 incarnation %s : refusé partout", (_, value) => {
    expect(
      readPresenceMessage(withField(batch(), "incarnation", value)),
    ).toBeNull();
    expect(
      readPresenceMessage(withField(request(), "incarnation", value)),
    ).toBeNull();
    expect(
      readPresenceMessage(withField(state(), "incarnation", value)),
    ).toBeNull();
    expect(
      readPresenceAlive(withField(alive(), "incarnation", value)),
    ).toBeNull();
  });

  it.each([...NUMBERS, ["nul", 0]] as [string, unknown][])(
    "🔴 seq %s : refusé partout (seq ≥ 1)",
    (_, value) => {
      expect(readPresenceMessage(withField(batch(), "seq", value))).toBeNull();
      expect(
        readPresenceMessage(withField(request(), "seq", value)),
      ).toBeNull();
      expect(readPresenceMessage(withField(state(), "seq", value))).toBeNull();
      expect(readPresenceAlive(withField(alive(), "seq", value))).toBeNull();
    },
  );

  it("🔴 prev / last : entier sûr ≥ 0 STRICTEMENT sous seq", () => {
    for (const [, value] of NUMBERS) {
      expect(readPresenceMessage(withField(batch(), "prev", value))).toBeNull();
      expect(readPresenceMessage(withField(state(), "last", value))).toBeNull();
      expect(readPresenceAlive(withField(alive(), "last", value))).toBeNull();
    }
    expect(readPresenceMessage(withField(batch(), "prev", 5))).toBeNull();
    expect(readPresenceMessage(withField(state(), "last", 7))).toBeNull();
    expect(readPresenceAlive(withField(alive(), "last", 8))).toBeNull();
    expect(readPresenceMessage(withField(batch(), "prev", 0))).not.toBeNull();
    expect(readPresenceAlive(withField(alive(), "last", 0))).not.toBeNull();
  });

  it("🔴 entrées d'un lot : canal, paires, départs, non nommés", () => {
    const bad: [string, unknown][] = [
      ["channel", undefined],
      ["channel", ""],
      ["channel", LONG],
      ["channel", 1],
      ["unnamed", -1],
      ["unnamed", undefined],
      ["set", ["alice"]], // longueur impaire
      ["set", ["alice", 0]], // onglets ≥ 1
      ["set", ["alice", 1.5]],
      ["set", ["alice", "1"]],
      ["set", [1, 1]],
      ["set", ["", 1]],
      ["set", [LONG, 1]],
      ["set", { alice: 1 }],
      ["gone", ["alice", 3]],
      ["gone", [""]],
      ["gone", "alice"],
    ];
    for (const [key, value] of bad)
      expect(
        readPresenceMessage(withEntry(batch(), key, value)),
        `${key}=${String(value)}`,
      ).toBeNull();
    expect(readPresenceMessage({ ...batch(), channels: "room:1" })).toBeNull();
    expect(readPresenceMessage({ ...batch(), channels: [null] })).toBeNull();
    expect(readPresenceMessage({ ...batch(), channels: [] })).not.toBeNull();
  });

  it("🔴 plafonds : membres par canal, entrées par message, parts", () => {
    const pairs = new Array<string | number>((MAX_PRESENCE_MEMBERS + 1) * 2);
    for (let i = 0; i < pairs.length; i += 2) {
      pairs[i] = `u${i}`;
      pairs[i + 1] = 1;
    }
    expect(readPresenceMessage(withEntry(batch(), "set", pairs))).toBeNull();
    expect(
      readPresenceMessage(withEntry(batch(), "set", pairs.slice(0, -2))),
    ).not.toBeNull();
    const many = Array.from({ length: MAX_PRESENCE_CHANNELS + 1 }, (_, i) => ({
      channel: `c${i}`,
      unnamed: 0,
    }));
    expect(readPresenceMessage({ ...batch(), channels: many })).toBeNull();
    expect(
      readPresenceMessage({ ...batch(), channels: many.slice(1) }),
    ).not.toBeNull();
    expect(
      readPresenceMessage({
        ...request(),
        channels: many.map((m) => m.channel),
      }),
    ).toBeNull();
    expect(
      readPresenceMessage(withField(state(), "n", MAX_PRESENCE_PARTS + 1)),
    ).toBeNull();
    expect(
      readPresenceMessage(withField(state(), "n", MAX_PRESENCE_PARTS)),
    ).not.toBeNull();
  });

  it("🔴 demande : canaux, cible", () => {
    expect(
      readPresenceMessage({ ...request(), channels: ["ok", ""] }),
    ).toBeNull();
    expect(
      readPresenceMessage({ ...request(), channels: undefined }),
    ).toBeNull();
    expect(readPresenceMessage({ ...request(), to: "" })).toBeNull();
    expect(readPresenceMessage({ ...request(), to: 3 })).toBeNull();
    expect(readPresenceMessage({ ...request(), to: LONG })).toBeNull();
    expect(readPresenceMessage({ ...request(), to: null })).toMatchObject({
      to: null,
    });
  });

  it("🔴 part de réponse : rang, nombre, membres complets", () => {
    for (const [i, n] of [
      [2, 2],
      [-1, 2],
      [0, 0],
      [0, 1.5],
    ] as const)
      expect(readPresenceMessage({ ...state(), i, n }), `${i}/${n}`).toBeNull();
    expect(
      readPresenceMessage(withEntry(state(), "members", undefined)),
    ).toBeNull();
    expect(
      readPresenceMessage(withEntry(state(), "members", ["a", 0])),
    ).toBeNull();
    expect(
      readPresenceMessage(withEntry(state(), "unnamed", undefined)),
    ).toBeNull();
  });

  it("🔴 preuve de vie : intervalle borné, final booléen", () => {
    expect(
      readPresenceAlive(
        withField(alive(), "interval", MIN_PRESENCE_INTERVAL_MS - 1),
      ),
    ).toBeNull();
    expect(
      readPresenceAlive(
        withField(alive(), "interval", MAX_PRESENCE_INTERVAL_MS + 1),
      ),
    ).toBeNull();
    expect(
      readPresenceAlive(
        withField(alive(), "interval", MIN_PRESENCE_INTERVAL_MS),
      ),
    ).not.toBeNull();
    expect(
      readPresenceAlive(
        withField(alive(), "interval", MAX_PRESENCE_INTERVAL_MS),
      ),
    ).not.toBeNull();
    expect(
      readPresenceAlive(withField(alive(), "interval", undefined)),
    ).toBeNull();
    expect(readPresenceAlive(withField(alive(), "final", "true"))).toBeNull();
    expect(readPresenceAlive(withField(alive(), "final", 1))).toBeNull();
  });

  it("une charge qui n'est pas un objet : refusée sans lever", () => {
    for (const payload of [null, undefined, 3, "batch", [], true]) {
      expect(readPresenceMessage(payload)).toBeNull();
      expect(readPresenceAlive(payload)).toBeNull();
      expect(isUnknownPresenceMessage(payload)).toBe(false);
    }
  });
});
