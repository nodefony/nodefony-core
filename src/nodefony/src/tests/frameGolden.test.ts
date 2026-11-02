import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { SHIPPED_CODECS, type IShippedCodec } from "./fixtures/frameCorpus";

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
 * Changer un octet impose de régénérer (`npx vitest run frameGolden -u`) dans
 * le MÊME commit que l'entrée de rupture du changelog : le diff du fichier EST
 * la rupture, lisible en revue.
 *
 * Format d'une ligne : `<forme>\t<t|b>\t<trame>` — `t` = trame texte telle
 * quelle, `b` = trame binaire en hexadécimal.
 */

const GOLDEN_DIR = path.join(import.meta.dirname, "fixtures", "golden");

const HEADER =
  "# Octets de référence d'un codec de la socket (#629). Ne pas éditer à la main :\n" +
  "# npx vitest run frameGolden -u — dans le commit qui porte l'entrée de rupture.\n";

/** Hexadécimal sans `Buffer` : le même test doit pouvoir tourner en navigateur. */
function toHex(bytes: Uint8Array): string {
  let out = "";
  for (const b of bytes) out += b.toString(16).padStart(2, "0");
  return out;
}

function fromHex(hex: string): Uint8Array {
  if (hex.length % 2 !== 0 || /[^0-9a-f]/.test(hex))
    throw new Error(`hexadécimal invalide : ${hex.slice(0, 32)}…`);
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++)
    out[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

/** Le contenu du fichier de référence, tel que le codec l'émet aujourd'hui. */
function render({ codec, corpus }: IShippedCodec): string {
  let out = HEADER;
  for (const [kind, frame] of Object.entries(corpus)) {
    const wire = codec.encode(frame);
    out +=
      typeof wire === "string"
        ? `${kind}\tt\t${wire}\n`
        : `${kind}\tb\t${toHex(wire)}\n`;
  }
  return out;
}

/** Relit un fichier de référence commité : forme → trame (texte ou octets). */
function parse(content: string): Map<string, string | Uint8Array> {
  const frames = new Map<string, string | Uint8Array>();
  for (const line of content.split("\n")) {
    if (line === "" || line.startsWith("#")) continue;
    const [kind, type, ...rest] = line.split("\t");
    const wire = rest.join("\t");
    if (kind === undefined || (type !== "t" && type !== "b"))
      throw new Error(`ligne de référence illisible : ${line.slice(0, 60)}`);
    frames.set(kind, type === "t" ? wire : fromHex(wire));
  }
  return frames;
}

describe("Octets de référence — chaque codec livré émet et relit les octets commités (#629)", () => {
  for (const shipped of SHIPPED_CODECS) {
    const file = path.join(GOLDEN_DIR, shipped.golden);

    it(`${shipped.name} : émet exactement les octets commités`, async () => {
      await expect(render(shipped)).toMatchFileSnapshot(file);
    });

    it(`${shipped.name} : relit les octets commités en le corpus`, () => {
      const frames = parse(fs.readFileSync(file, "utf8"));
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
