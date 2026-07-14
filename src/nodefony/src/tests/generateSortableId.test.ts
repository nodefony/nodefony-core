/*
 *   `Nodefony.generateSortableId()` — UUID v7 (RFC 9562), clé primaire par défaut
 *   des entités générées.
 *
 *   Ce qui est figé ici : la CONFORMITÉ (version 7, variant RFC, horodatage réel) et
 *   la propriété qui motive le choix (localité d'index : deux identifiants séparés
 *   dans le temps s'ordonnent). Ce qui n'est PAS promis : l'ordre à l'intérieur d'une
 *   même milliseconde — Node n'implémente pas le compteur monotone optionnel de la
 *   RFC. Un test qui l'exigerait serait une fausse garantie, et il casserait.
 */

import assert from "node:assert";
import { Nodefony } from "../Nodefony";

const UUID_SHAPE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;

/** Millisecondes encodées dans les 48 bits de tête (RFC 9562 §5.7). */
const timestampOf = (uuid: string): number =>
  parseInt(uuid.slice(0, 8) + uuid.slice(9, 13), 16);

describe("Nodefony.generateSortableId — UUID v7", () => {
  it("respecte la forme UUID", () => {
    assert.match(Nodefony.generateSortableId(), UUID_SHAPE);
  });

  it("porte la version 7 et le variant RFC", () => {
    const id = Nodefony.generateSortableId();
    assert.strictEqual(id[14], "7", "nibble de version");
    assert.ok(
      ["8", "9", "a", "b"].includes(id[19]),
      `variant RFC attendu, reçu « ${id[19]} »`,
    );
  });

  it("encode l'instant de création (horodatage plausible)", () => {
    const before = Date.now();
    const t = timestampOf(Nodefony.generateSortableId());
    const after = Date.now();
    assert.ok(
      t >= before - 1000 && t <= after + 1000,
      `horodatage hors plage : ${new Date(t).toISOString()}`,
    );
  });

  it("s'ordonne dans le temps — la propriété qui donne la localité d'index", async () => {
    const first = Nodefony.generateSortableId();
    await new Promise((r) => setTimeout(r, 5));
    const second = Nodefony.generateSortableId();
    assert.ok(
      first < second,
      "deux identifiants séparés de quelques ms doivent s'ordonner lexicographiquement",
    );
  });

  it("ne collisionne pas (10 000 tirages)", () => {
    const ids = new Set<string>();
    for (let i = 0; i < 10_000; i++) ids.add(Nodefony.generateSortableId());
    assert.strictEqual(ids.size, 10_000);
  });

  it("reste DISTINCT de generateId (v4) — les deux usages coexistent", () => {
    // v4 = imprévisible (jeton, requestId) ; v7 = ordonné (clé primaire).
    assert.strictEqual(Nodefony.generateId()[14], "4");
    assert.strictEqual(Nodefony.generateSortableId()[14], "7");
  });
});
