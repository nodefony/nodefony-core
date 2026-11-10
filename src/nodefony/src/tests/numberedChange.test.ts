import { describe, it, expect } from "vitest";
import {
  classifyNumberedChange,
  type NumberedChangeOutcome,
} from "../realtime/numberedChange";
import { encodeCbor } from "../realtime/codec/encode";
import { decodeCbor } from "../realtime/codec/decode";
import type {
  RealtimePresenceFrame,
  IPresenceEntry,
  PresencePairs,
} from "../realtime/RealtimeEventMap";

// Les trois issues de RFC 5263 §4.5, partagées par la vue cliente et la vue distante
// d'un pod (ADR-0025 P2, « Une règle pure, deux bords »).

describe("Changement numéroté — numérotation continue (trame vers le navigateur)", () => {
  it("le numéro attendu s'applique", () => {
    expect(classifyNumberedChange(4, 5)).toBe("applied");
    expect(classifyNumberedChange(0, 1)).toBe("applied");
  });

  it("un numéro plus loin révèle un trou : rien n'est appliqué", () => {
    expect(classifyNumberedChange(4, 6)).toBe("gap");
    expect(classifyNumberedChange(4, 1_000)).toBe("gap");
  });

  it("un numéro déjà vu est jeté — l'égal comme le plus petit", () => {
    expect(classifyNumberedChange(4, 4)).toBe("stale");
    expect(classifyNumberedChange(4, 2)).toBe("stale");
  });

  it("une vue NON SYNCHRONISÉE rend un trou à tout changement, même celui qui « tomberait juste »", () => {
    // Reconnecté sur un autre pod, la version 1 de ce pod n'a rien à voir avec l'ancienne vue.
    expect(classifyNumberedChange(null, 1)).toBe("gap");
    expect(classifyNumberedChange(null, 0)).toBe("gap");
    expect(classifyNumberedChange(null, 42)).toBe("gap");
  });
});

describe("Changement numéroté — numérotation chaînée (lot entre pods, `seq`/`prev`)", () => {
  it("le lot dont `prev` vaut le dernier appliqué s'applique, même si `seq` a sauté (preuves de vie entre deux)", () => {
    expect(classifyNumberedChange(10, 13, 10)).toBe("applied");
  });

  it("un `prev` différent du dernier appliqué révèle un lot perdu", () => {
    expect(classifyNumberedChange(10, 13, 12)).toBe("gap");
    // Incohérent (prev antérieur à la référence) : resynchroniser plutôt que deviner.
    expect(classifyNumberedChange(10, 13, 9)).toBe("gap");
  });

  it("un `seq` déjà couvert est jeté quel que soit son `prev` (rejeu, ou lot compris dans la réponse d'état qui a fermé le trou)", () => {
    expect(classifyNumberedChange(10, 10, 9)).toBe("stale");
    expect(classifyNumberedChange(10, 7, 10)).toBe("stale");
  });

  it("vue jamais synchronisée avec ce pod : trou, même chaîne en apparence correcte", () => {
    expect(classifyNumberedChange(null, 3, 2)).toBe("gap");
  });
});

describe("Changement numéroté — propriétés", () => {
  it("seule l'issue `applied` autorise à toucher la vue, et chaque entrée a exactement une issue", () => {
    const seen = new Set<NumberedChangeOutcome>();
    for (const reference of [null, 0, 5]) {
      for (let sequence = 0; sequence <= 8; sequence += 1) {
        const outcome = classifyNumberedChange(reference, sequence);
        seen.add(outcome);
        const expected: NumberedChangeOutcome =
          reference === null
            ? "gap"
            : sequence <= reference
              ? "stale"
              : sequence === reference + 1
                ? "applied"
                : "gap";
        expect(outcome, `${String(reference)} → ${String(sequence)}`).toBe(
          expected,
        );
      }
    }
    expect([...seen].sort()).toEqual(["applied", "gap", "stale"]);
  });
});

describe("Trame `realtime:presence` — forme (ADR-0025 P2 bis)", () => {
  // Un lecteur discrimine les trois formes sans conversion : le typage le prouve à la
  // compilation (typecheck du cœur), l'exécution prouve l'ordre de lecture documenté.
  // Lecture de référence des paires à plat : de deux en deux, chaque paire gardée par
  // `typeof` — c'est ce que fera la vue cliente (étape 3) et la vue distante (lot D).
  function toView(pairs: PresencePairs): Map<string, IPresenceEntry> {
    const view = new Map<string, IPresenceEntry>();
    for (let i = 0; i + 1 < pairs.length; i += 2) {
      const identity = pairs[i];
      const tabs = pairs[i + 1];
      if (typeof identity === "string" && typeof tabs === "number")
        view.set(identity, { tabs });
    }
    return view;
  }

  function kind(frame: RealtimePresenceFrame): string {
    if (frame.changes !== undefined)
      return `changes:${toView(frame.changes.set ?? []).size}:${frame.changes.gone?.length ?? 0}`;
    if (frame.members !== undefined)
      return `members:${toView(frame.members).size}`;
    return "count";
  }

  const head = { channel: "room:42", version: 3, count: 2, unnamed: 1 };

  it("liste complète, changements, nombres seuls", () => {
    expect(kind({ ...head, members: ["alice", 2, "bob", 1] })).toBe(
      "members:2",
    );
    expect(
      kind({ ...head, changes: { set: ["carol", 1], gone: ["bob"] } }),
    ).toBe("changes:1:1");
    expect(kind({ ...head, partial: true })).toBe("count");
  });

  it("les paires ne coûtent aucun objet par membre sur le fil, et `__proto__` n'y est qu'une chaîne", () => {
    const wire = JSON.stringify(["__proto__", 1, "bob", 2]);
    expect(wire).toBe('["__proto__",1,"bob",2]');
    const pairs: PresencePairs = JSON.parse(wire);
    const view = toView(pairs);
    expect(view.get("__proto__")).toEqual({ tabs: 1 });
    expect(view.get("bob")).toEqual({ tabs: 2 });
  });

  it("une paire mal formée est ignorée, jamais rangée de travers", () => {
    expect([
      ...toView(["alice", "2", 3, 1, "bob", 1, "dangling"]).keys(),
    ]).toEqual(["bob"]);
  });
});

describe("Trame `realtime:presence` — en binaire (codec CBOR, protocole nodefony.jsonrpc.cbor.v1)", () => {
  const members: (string | number)[] = [];
  const asObject: Record<string, { tabs: number }> = {};
  for (let i = 0; i < 1_000; i += 1) {
    const id = `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`;
    members.push(id, (i % 3) + 1);
    asObject[id] = { tabs: (i % 3) + 1 };
  }
  const head = { channel: "room:42", version: 7, count: 1_000, unnamed: 3 };

  it("les trois formes font l'aller-retour à l'identique", () => {
    const frames: RealtimePresenceFrame[] = [
      { ...head, members },
      { ...head, partial: true, changes: { set: ["a", 1], gone: ["b"] } },
      { ...head },
    ];
    for (const frame of frames) {
      expect(decodeCbor(encodeCbor(frame))).toEqual(frame);
    }
  });

  it("une identité `__proto__` traverse le binaire comme une chaîne ordinaire", () => {
    expect(decodeCbor(encodeCbor(["__proto__", 1]))).toEqual(["__proto__", 1]);
  });

  it("à plat, la liste de 1 000 membres pèse moins que la forme objet — en CBOR comme en JSON", () => {
    const flatCbor = encodeCbor({ ...head, members }).byteLength;
    const objectCbor = encodeCbor({ ...head, members: asObject }).byteLength;
    const flatJson = JSON.stringify({ ...head, members }).length;
    const objectJson = JSON.stringify({ ...head, members: asObject }).length;
    expect(flatCbor).toBeLessThan(objectCbor);
    expect(flatJson).toBeLessThan(objectJson);
    // Ordre de grandeur, pour la trace du commit (pas un seuil).
    console.info(
      `présence 1 000 membres — CBOR ${flatCbor} o (objet ${objectCbor}), JSON ${flatJson} o (objet ${objectJson})`,
    );
  });
});
