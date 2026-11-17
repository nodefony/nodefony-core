import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { REDIS_GATE } from "../../../../../../../scripts/test/vitest/gates";

/**
 * **Une base de test par fichier — vérifié, pas seulement recommandé.**
 *
 * Les bancs d'intégration purgent leur base (`flushDb`). Deux fichiers sur la
 * même base s'effacent mutuellement en parallèle : la suite passe en isolation
 * et échoue en groupe, ce qui fait chercher le défaut dans le code alors qu'il
 * est dans le décor. `redisTestUrl(db)` porte la règle en commentaire — deux
 * fichiers l'avaient quand même violée (base 12 partagée).
 *
 * Un commentaire ne garde rien : cette sentinelle relit les bancs et refuse un
 * doublon. Elle mord au moment où on ajoute un fichier, pas trois sessions plus
 * tard sur un échec intermittent.
 */
describe("bases Redis de test — une par fichier", () => {
  const dir = fileURLToPath(new URL("../integration", import.meta.url));

  /** `fichier → index de base` pour chaque banc qui en réclame une. */
  function allocations(): Map<string, number[]> {
    const out = new Map<string, number[]>();
    for (const file of readdirSync(dir)) {
      if (!file.endsWith(".test.ts")) continue;
      const source = readFileSync(`${dir}/${file}`, "utf8");
      const found = [...source.matchAll(/redisTestUrl\((\d+)\)/g)].map((m) =>
        Number(m[1]),
      );
      if (found.length > 0) out.set(file, found);
    }
    return out;
  }

  it("aucune base n'est réclamée par deux fichiers", () => {
    const owner = new Map<number, string>();
    const clashes: string[] = [];
    for (const [file, dbs] of allocations()) {
      for (const db of dbs) {
        const previous = owner.get(db);
        if (previous && previous !== file) {
          clashes.push(`base ${db} : ${previous} et ${file}`);
        }
        owner.set(db, file);
      }
    }
    assert.deepEqual(
      clashes,
      [],
      "deux bancs qui purgent la même base se saccagent en parallèle",
    );
  });

  it("aucun banc ne purge une base que la gate de test:all donne à quelqu'un d'autre", () => {
    // `test:all` lève un serveur qui écrit ses sessions dans la base de
    // `NF_REDIS_URL`, et `NF_REDIS_TEST_URL` nu vise la sienne : un banc qui
    // purge l'une de ces bases fait tomber `flushDb` en délai sous `test:all`,
    // et vert en isolation. La source est la gate, pas une copie de ses index.
    const taken = new Map<number, string>();
    for (const [name, url] of Object.entries(REDIS_GATE.values())) {
      taken.set(Number(new URL(url).pathname.slice(1) || "0"), name);
    }
    const clashes: string[] = [];
    for (const [file, dbs] of allocations()) {
      for (const db of dbs) {
        const owner = taken.get(db);
        if (owner) clashes.push(`base ${db} : ${file} et ${owner}`);
      }
    }
    assert.deepEqual(clashes, []);
  });

  it("les index restent dans les 16 bases de Redis", () => {
    for (const [file, dbs] of allocations()) {
      for (const db of dbs) {
        assert.ok(
          db >= 0 && db <= 15,
          `${file} réclame la base ${db} — Redis n'en expose que 0-15`,
        );
      }
    }
  });

  it("la base 15 reste au banc comportemental (NF_REDIS_TEST_URL nu)", () => {
    for (const [file, dbs] of allocations()) {
      assert.ok(
        !dbs.includes(15),
        `${file} prend la base 15, réservée à l'URL de gate documentée`,
      );
    }
  });
});
