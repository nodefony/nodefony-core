import { describe, it, expect } from "vitest";
import { parseFrontmatter, metaString, metaList } from "../../src/frontmatter";

describe("parseFrontmatter", () => {
  it("sans bloc → meta vide, body = raw", () => {
    const raw = "# Titre\n\ncorps";
    const { meta, body } = parseFrontmatter(raw);
    expect(meta).toEqual({});
    expect(body).toBe(raw);
  });

  it("parse les scalaires et retire les quotes", () => {
    const raw = `---\ntitle: "Mon titre"\nversion: '1.2'\n---\ncorps`;
    const { meta, body } = parseFrontmatter(raw);
    expect(meta.title).toBe("Mon titre");
    expect(meta.version).toBe("1.2");
    expect(body).toBe("corps");
  });

  it("parse une liste inline [a, b]", () => {
    const { meta } = parseFrontmatter(
      `---\naudience: [developer, "devops"]\n---\n`,
    );
    expect(meta.audience).toEqual(["developer", "devops"]);
  });

  it("parse une liste en bloc (- item)", () => {
    const raw = `---\naudience:\n  - developer\n  - admin\n---\n`;
    expect(parseFrontmatter(raw).meta.audience).toEqual(["developer", "admin"]);
  });

  it("ignore les lignes vides et les commentaires #", () => {
    const raw = `---\n# un commentaire\n\ntitle: X\n---\n`;
    expect(parseFrontmatter(raw).meta).toEqual({ title: "X" });
  });

  it("tolère un BOM et des espaces avant le bloc", () => {
    const { meta, body } = parseFrontmatter(`﻿---\ntitle: X\n---\nbody`);
    expect(meta.title).toBe("X");
    expect(body).toBe("body");
  });

  it("clé déclarée sans valeur → liste vide", () => {
    expect(parseFrontmatter(`---\naudience:\n---\n`).meta.audience).toEqual([]);
  });

  it("liste inline vide [] → []", () => {
    expect(parseFrontmatter(`---\naudience: []\n---\n`).meta.audience).toEqual(
      [],
    );
  });

  it("supporte les fins de ligne CRLF", () => {
    const { meta, body } = parseFrontmatter(`---\r\ntitle: X\r\n---\r\nbody`);
    expect(meta.title).toBe("X");
    expect(body).toBe("body");
  });

  it("ignore une clé mal formée (pas de `key:`)", () => {
    expect(
      parseFrontmatter(`---\njuste du texte\ntitle: X\n---\n`).meta,
    ).toEqual({
      title: "X",
    });
  });
});

describe("metaString", () => {
  it("renvoie un scalaire", () => {
    expect(metaString({ title: "X" }, "title")).toBe("X");
  });
  it("renvoie le 1er élément d'une liste", () => {
    expect(metaString({ a: ["x", "y"] }, "a")).toBe("x");
  });
  it("undefined si absent", () => {
    expect(metaString({}, "title")).toBeUndefined();
  });
});

describe("metaList", () => {
  it("wrappe un scalaire en liste", () => {
    expect(metaList({ a: "x" }, "a")).toEqual(["x"]);
  });
  it("renvoie la liste telle quelle", () => {
    expect(metaList({ a: ["x", "y"] }, "a")).toEqual(["x", "y"]);
  });
  it("[] si la clé est absente", () => {
    expect(metaList({}, "a")).toEqual([]);
  });
});
