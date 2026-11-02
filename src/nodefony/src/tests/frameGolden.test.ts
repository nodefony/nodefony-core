import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { SHIPPED_CODECS, type IShippedCodec } from "./fixtures/frameCorpus";
import { parseGolden, renderGolden } from "./fixtures/goldenFormat";

/**
 * Octets de référence (« dorés ») des codecs de la socket — #629, ADR-0022 §10.
 *
 * L'aller-retour (`frameCodecCorpus.test.ts`) ne voit pas un changement
 * SYMÉTRIQUE : un codec qui encode et relit autrement reste égal à lui-même,
 * et c'est pourtant une rupture du fil — un onglet ouvert depuis la veille
 * garde l'ancien codec pendant des heures. Ici, les octets du corpus sont
 * commités, et chaque codec doit :
 *
 * 1. ÉMETTRE exactement ces octets ;
 * 2. RELIRE ces octets en le corpus — ce que fera un pair d'une autre version.
 *
 * Changer un octet impose de régénérer dans le MÊME commit que l'entrée de
 * rupture du changelog : le diff du fichier EST la rupture, lisible en revue.
 * Format : `fixtures/goldenFormat.ts`.
 */

const GOLDEN_DIR = path.join(import.meta.dirname, "fixtures", "golden");
const REGENERATE = "npx vitest run frameGolden -u (src/nodefony)";

/** Le contenu du fichier de référence, tel que le codec l'émet aujourd'hui. */
function render({ codec, corpus }: IShippedCodec): string {
  return renderGolden(
    REGENERATE,
    Object.entries(corpus).map(([kind, frame]) => [kind, codec.encode(frame)]),
  );
}

describe("Octets de référence — chaque codec livré émet et relit les octets commités (#629)", () => {
  for (const shipped of SHIPPED_CODECS) {
    const file = path.join(GOLDEN_DIR, shipped.golden);

    it(`${shipped.name} : émet exactement les octets commités`, async () => {
      await expect(render(shipped)).toMatchFileSnapshot(file);
    });

    it(`${shipped.name} : relit les octets commités en le corpus`, () => {
      const frames = parseGolden(fs.readFileSync(file, "utf8"));
      expect([...frames.keys()]).toEqual(Object.keys(shipped.corpus));
      for (const [kind, frame] of Object.entries(shipped.corpus)) {
        const wire = frames.get(kind);
        if (wire === undefined) throw new Error(`forme absente : ${kind}`);
        expect(shipped.codec.decode(wire), kind).toStrictEqual(
          structuredClone(frame),
        );
      }
    });
  }
});
