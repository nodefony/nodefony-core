import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { CBOR_FRAME_CODEC } from "nodefony/cbor";
import {
  openBackplaneEnvelope,
  openBackplaneEnvelopeBytes,
  sealBackplaneEnvelope,
  sealBackplaneEnvelopeBytes,
} from "../../src/backplane/envelope.js";
import type { IBackplaneMessage } from "../../interfaces/IBackplane.js";
import {
  parseGolden,
  renderGolden,
} from "../../../../../../nodefony/src/tests/fixtures/goldenFormat.js";

/**
 * Octets de référence de l'ENVELOPPE du bus entre pods — #629, ADR-0022 §10
 * (contrôle 4) : trois champs plus le sceau.
 *
 * Pendant un déploiement progressif, deux versions de pod partagent le même
 * bus : un pod qui scellerait autrement ferait rejeter TOUT ce qu'il publie
 * par les autres, sans erreur visible — le sceau refusé ressemble à une
 * injection. Chaque forme doit donc :
 *
 * 1. SCELLER exactement les octets commités ;
 * 2. OUVRIR ces octets en le message, sceau vérifié — ce que fera un pod
 *    d'une autre version.
 *
 * Régénérer : `npx vitest run backplaneEnvelopeGolden -u`, dans le commit qui
 * porte l'entrée de rupture. Format : `goldenFormat.ts` (cœur).
 */

const FILE = path.join(
  import.meta.dirname,
  "..",
  "fixtures",
  "golden",
  "backplane-envelope.golden.txt",
);
const REGENERATE =
  "npx vitest run backplaneEnvelopeGolden -u (src/packages/@nodefony/realtime)";

/** Secret de banc : seule sa constance compte, jamais sa valeur. */
const SECRET = "golden-bus-secret";

const text: IBackplaneMessage = {
  channel: "chat:room-42",
  payload: { text: "salut é ✓", n: 0, list: [1, -2.5, null] },
  originId: "pod-a.7f3a",
};
const noPayload: IBackplaneMessage = {
  channel: "build:done",
  payload: undefined,
  originId: "pod-b.0001",
};
const bytes: IBackplaneMessage = {
  channel: "capteur:raw",
  payload: { seq: 7, raw: new Uint8Array([0, 1, 127, 128, 255]) },
  originId: "pod-c.ffff",
};

interface IEnvelopeCase {
  readonly msg: IBackplaneMessage;
  readonly secret: string | null;
  readonly binary: boolean;
}

const CASES: Record<string, IEnvelopeCase> = {
  textBare: { msg: text, secret: null, binary: false },
  textSealed: { msg: text, secret: SECRET, binary: false },
  textSealedNoPayload: { msg: noPayload, secret: SECRET, binary: false },
  bytesBare: { msg: bytes, secret: null, binary: true },
  bytesSealed: { msg: bytes, secret: SECRET, binary: true },
};

function seal({ msg, secret, binary }: IEnvelopeCase): string | Uint8Array {
  return binary
    ? sealBackplaneEnvelopeBytes(msg, CBOR_FRAME_CODEC, secret)
    : sealBackplaneEnvelope(msg, secret);
}

function open(
  wire: string | Uint8Array,
  { secret }: IEnvelopeCase,
): IBackplaneMessage | null {
  return typeof wire === "string"
    ? openBackplaneEnvelope(wire, secret)
    : openBackplaneEnvelopeBytes(wire, CBOR_FRAME_CODEC, secret);
}

describe("Octets de référence — enveloppe du bus entre pods (#629)", () => {
  it("chaque forme scelle exactement les octets commités", async () => {
    await expect(
      renderGolden(
        REGENERATE,
        Object.entries(CASES).map(([kind, c]) => [kind, seal(c)]),
      ),
    ).toMatchFileSnapshot(FILE);
  });

  it("les octets commités s'ouvrent en le message, sceau vérifié", () => {
    const frames = parseGolden(fs.readFileSync(FILE, "utf8"));
    expect([...frames.keys()]).toEqual(Object.keys(CASES));
    for (const [kind, c] of Object.entries(CASES)) {
      const wire = frames.get(kind);
      if (wire === undefined) throw new Error(`forme absente : ${kind}`);
      expect(open(wire, c), kind).toStrictEqual(structuredClone(c.msg));
    }
  });

  it("un sceau commité ne s'ouvre pas avec un autre secret", () => {
    const frames = parseGolden(fs.readFileSync(FILE, "utf8"));
    for (const kind of ["textSealed", "bytesSealed"]) {
      const wire = frames.get(kind);
      const c = CASES[kind];
      if (wire === undefined || c === undefined)
        throw new Error(`forme absente : ${kind}`);
      expect(open(wire, { ...c, secret: "autre-secret" }), kind).toBe(null);
    }
  });
});
