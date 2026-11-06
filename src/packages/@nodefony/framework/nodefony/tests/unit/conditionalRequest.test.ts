/// <reference types="node" />
/**
 * Unit — requêtes conditionnelles (RFC 9110 §8.8, §13) : validateurs d'un
 * fichier et ordre d'évaluation des préconditions, sans contrôleur.
 */
import { describe, it, expect } from "vitest";
import {
  evaluatePreconditions,
  fileValidators,
  ifRangeHolds,
  parseHttpDate,
} from "../../src/conditionalRequest";

const NOW = Date.UTC(2026, 10, 6, 12, 0, 0);
const MTIME = NOW - 3_600_000 + 250; // il y a une heure, avec des millisecondes
const v = fileValidators({ size: 4096, mtimeMs: MTIME }, NOW);
const ETAG = v.etag ?? "";
const LAST = new Date(v.lastModified ?? 0).toUTCString();
const BEFORE = new Date(MTIME - 60_000).toUTCString();
const AFTER = new Date(MTIME + 60_000).toUTCString();

describe("fileValidators", () => {
  it("ETag FORTE (sans W/), Last-Modified à la seconde", () => {
    expect(ETAG).toMatch(/^"[0-9a-f]+-[0-9a-f]+"$/);
    expect(v.lastModified).toBe(Math.floor(MTIME / 1000) * 1000);
    expect(v.lastModifiedStrong).toBe(true);
  });

  it("l'étiquette change avec la taille ET avec la date, même dans la même seconde", () => {
    expect(fileValidators({ size: 4097, mtimeMs: MTIME }, NOW).etag).not.toBe(
      ETAG,
    );
    expect(
      fileValidators({ size: 4096, mtimeMs: MTIME + 1 }, NOW).etag,
    ).not.toBe(ETAG);
  });

  it("modifié il y a moins d'une seconde : la date n'est PAS un validateur fort (§8.8.2.2)", () => {
    expect(
      fileValidators({ size: 1, mtimeMs: NOW - 400 }, NOW).lastModifiedStrong,
    ).toBe(false);
  });

  it("date de modification dans le futur : Last-Modified borné à l'instant de la réponse (§8.8.2.1)", () => {
    const future = fileValidators({ size: 1, mtimeMs: NOW + 86_400_000 }, NOW);
    expect(future.lastModified).toBe(NOW);
    expect(future.lastModifiedStrong).toBe(false);
  });
});

describe("evaluatePreconditions — RFC 9110 §13.2.2", () => {
  it("aucune condition : 200", () => {
    expect(evaluatePreconditions("GET", {}, v)).toBe(200);
  });

  it("If-None-Match égale (comparaison FAIBLE, liste, W/) : 304 en GET et HEAD, 412 sinon", () => {
    for (const value of [ETAG, `W/${ETAG}`, `"autre", ${ETAG}`, "*"]) {
      expect(evaluatePreconditions("GET", { "if-none-match": value }, v)).toBe(
        304,
      );
      expect(evaluatePreconditions("HEAD", { "if-none-match": value }, v)).toBe(
        304,
      );
      expect(
        evaluatePreconditions("DELETE", { "if-none-match": value }, v),
      ).toBe(412);
    }
    expect(
      evaluatePreconditions("GET", { "if-none-match": '"autre"' }, v),
    ).toBe(200);
  });

  it("If-Modified-Since : 304 si rien n'a changé depuis, 200 sinon ; ignoré hors GET/HEAD et si la date est invalide", () => {
    expect(evaluatePreconditions("GET", { "if-modified-since": LAST }, v)).toBe(
      304,
    );
    expect(
      evaluatePreconditions("GET", { "if-modified-since": AFTER }, v),
    ).toBe(304);
    expect(
      evaluatePreconditions("GET", { "if-modified-since": BEFORE }, v),
    ).toBe(200);
    expect(
      evaluatePreconditions("POST", { "if-modified-since": AFTER }, v),
    ).toBe(200);
    expect(
      evaluatePreconditions("GET", { "if-modified-since": "hier" }, v),
    ).toBe(200);
  });

  it("If-None-Match présent : If-Modified-Since est IGNORÉ (§13.1.3)", () => {
    expect(
      evaluatePreconditions(
        "GET",
        { "if-none-match": '"autre"', "if-modified-since": AFTER },
        v,
      ),
    ).toBe(200);
  });

  it("If-Match : comparaison FORTE — une étiquette faible ne tient pas ; `*` tient", () => {
    expect(evaluatePreconditions("PUT", { "if-match": ETAG }, v)).toBe(200);
    expect(evaluatePreconditions("PUT", { "if-match": "*" }, v)).toBe(200);
    expect(evaluatePreconditions("PUT", { "if-match": `W/${ETAG}` }, v)).toBe(
      412,
    );
    expect(evaluatePreconditions("GET", { "if-match": '"autre"' }, v)).toBe(
      412,
    );
  });

  it("If-Unmodified-Since : 412 si modifié depuis ; ignoré sous If-Match (§13.1.4)", () => {
    expect(
      evaluatePreconditions("PUT", { "if-unmodified-since": BEFORE }, v),
    ).toBe(412);
    expect(
      evaluatePreconditions("PUT", { "if-unmodified-since": AFTER }, v),
    ).toBe(200);
    expect(
      evaluatePreconditions(
        "PUT",
        { "if-match": ETAG, "if-unmodified-since": BEFORE },
        v,
      ),
    ).toBe(200);
  });

  it("If-Match faux l'emporte sur If-None-Match qui donnerait 304 (étape 1 avant l'étape 3)", () => {
    expect(
      evaluatePreconditions(
        "GET",
        { "if-match": '"autre"', "if-none-match": ETAG },
        v,
      ),
    ).toBe(412);
  });
});

describe("ifRangeHolds — RFC 9110 §13.1.5", () => {
  it("étiquette FORTEMENT égale : tient ; faible ou différente : non", () => {
    expect(ifRangeHolds(ETAG, v)).toBe(true);
    expect(ifRangeHolds(`W/${ETAG}`, v)).toBe(false);
    expect(ifRangeHolds('"autre"', v)).toBe(false);
  });

  it("date : tient si EXACTEMENT égale à un Last-Modified fort", () => {
    expect(ifRangeHolds(LAST, v)).toBe(true);
    expect(ifRangeHolds(AFTER, v)).toBe(false);
    const fresh = fileValidators({ size: 1, mtimeMs: NOW - 400 }, NOW);
    expect(
      ifRangeHolds(new Date(fresh.lastModified ?? 0).toUTCString(), fresh),
    ).toBe(false);
  });
});

describe("parseHttpDate", () => {
  it("lit une IMF-fixdate, rend null pour ce qui n'est pas une date", () => {
    expect(parseHttpDate("Thu, 01 Jan 1970 00:00:00 GMT")).toBe(0);
    expect(parseHttpDate("n'importe quoi")).toBeNull();
    expect(parseHttpDate(undefined)).toBeNull();
  });
});
