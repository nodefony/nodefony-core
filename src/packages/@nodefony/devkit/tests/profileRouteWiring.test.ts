import { describe, expect, it } from "vitest";
import { Container, Event, ROLES_WITHIN } from "nodefony";
import type { IRolesWithin, Module } from "nodefony";
import DevkitService from "../nodefony/service/DevkitService";

/**
 * `nodefony_profile_route` ne porte pas la règle « jouer un autre compte » :
 * il lit celle que `@nodefony/security` pose sous `ROLES_WITHIN`. Ce banc
 * éprouve ce câblage — le seul endroit où devkit la rencontre. Absent, l'outil
 * doit refuser `as`, jamais l'accorder.
 */
function service(container: Container): DevkitService {
  return new DevkitService({
    container,
    notificationsCenter: new Event(),
    options: {},
  } as unknown as Module);
}

describe("DevkitService — `as` lit la règle de @nodefony/security", () => {
  it("transmet la règle posée au conteneur, telle quelle", async () => {
    const container = new Container();
    const calls: string[] = [];
    const rule: IRolesWithin = async (owner, target) => {
      calls.push(`${owner}>${target}`);
      return { ok: false, reason: "refus de la règle" };
    };
    container.set(ROLES_WITHIN, rule);
    const within = service(container).mcpToolDeps().profileRoute?.rolesWithin;
    expect(within).toBe(rule);
    expect(await within?.("alice", "admin")).toEqual({
      ok: false,
      reason: "refus de la règle",
    });
    expect(calls).toEqual(["alice>admin"]);
  });

  // Le refus qui en découle est éprouvé dans `mcpProfileRoute.test.ts`
  // (« `as` sans règle de comparaison »).
  it("🔴 sans @nodefony/security : aucune règle transmise", () => {
    const within = service(new Container()).mcpToolDeps().profileRoute
      ?.rolesWithin;
    expect(within).toBeUndefined();
  });
});
