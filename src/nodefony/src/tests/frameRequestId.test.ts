/**
 * L'identifiant d'une frame du pont WebSocket — produit par `@nodefony/http`,
 * lu par le profileur, la console et la barre : une seule règle.
 */
import { describe, expect, it } from "vitest";
import { frameIndexOf, frameRequestId } from "../runtime/frameRequestId";

describe("frameRequestId / frameIndexOf", () => {
  const rid = "192c78c9-6c48-4f28-bf6e-5dc68d334cf5";

  it("🔴 aller-retour : la frame n de la connexion se relit n", () => {
    expect(frameRequestId(rid, 1)).toBe(`${rid}.1`);
    expect(frameIndexOf(frameRequestId(rid, 12), rid)).toBe(12);
  });

  it("la connexion elle-même n'est pas une de ses frames", () => {
    expect(frameIndexOf(rid, rid)).toBe(null);
  });

  it("🔴 un identifiant qui ne fait que COMMENCER comme la connexion n'en est pas une", () => {
    expect(frameIndexOf(`${rid}0.1`, rid)).toBe(null);
    expect(frameIndexOf(`autre.${rid}.1`, rid)).toBe(null);
  });

  it("un rang qui n'est pas un entier positif : null", () => {
    expect(frameIndexOf(`${rid}.`, rid)).toBe(null);
    expect(frameIndexOf(`${rid}.0`, rid)).toBe(null);
    expect(frameIndexOf(`${rid}.1.2`, rid)).toBe(null);
    expect(frameIndexOf(`${rid}.x`, rid)).toBe(null);
  });
});
