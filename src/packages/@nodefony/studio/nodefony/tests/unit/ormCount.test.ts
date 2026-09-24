/// <reference types="node" />
/**
 * Unit — lecture des comptes de lignes rendus par `/nodefony/orm/api/counts`.
 *
 * Le serveur qualifie la clé (`connecteur:nom`) quand deux connecteurs portent
 * une entité homonyme — cas de toute application MongoDB, où `@nodefony/drizzle`
 * et `@nodefony/mongoose` déclarent chacun `session`. Trois écrans recopiaient
 * la lecture « qualifiée d'abord », et le troisième l'avait oubliée : la carte
 * de connecteur affichait « — » pour l'entité homonyme.
 */
import { describe, it } from "vitest";
import { expect } from "chai";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { entityCount } from "../../../frontend/src/utils/ormFormat";

describe("entityCount — la clé qualifiée d'abord", () => {
  it("deux homonymes : chacun SON compte, jamais celui de sa jumelle", () => {
    const counts = { "default:session": 3, "nodefony:session": 7 };
    expect(
      entityCount(counts, { name: "session", connector: "default" }),
    ).to.equal(3);
    expect(
      entityCount(counts, { name: "session", connector: "nodefony" }),
    ).to.equal(7);
  });

  it("sans ambiguïté, la clé nue est lue", () => {
    expect(
      entityCount({ post: 12 }, { name: "post", connector: "default" }),
    ).to.equal(12);
  });

  it("-1 (non comptable) traverse, l'absence rend undefined", () => {
    expect(
      entityCount({ post: -1 }, { name: "post", connector: "default" }),
    ).to.equal(-1);
    expect(entityCount({}, { name: "post", connector: "default" })).to.equal(
      undefined,
    );
  });
});

describe("entityCount — SEUL lecteur de la réponse `counts`", () => {
  it("aucun écran n'indexe `countMap[...]` lui-même", () => {
    const root = path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      "../../../frontend/src",
    );
    const offenders: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (/\.tsx?$/u.test(entry.name) && entry.name !== "ormFormat.ts") {
          if (/countMap\[/u.test(readFileSync(full, "utf8"))) {
            offenders.push(path.relative(root, full));
          }
        }
      }
    };
    walk(root);
    expect(offenders, "passer par entityCount()").to.deep.equal([]);
  });
});
