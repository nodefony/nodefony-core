/// <reference types="node" />
import { expect } from "chai";
import { Container, RequestContext } from "nodefony";
import AdminApiController from "../../controller/AdminApiController.js";
import type { ContextType } from "@nodefony/http";

// Le plan d'administration décide d'un rôle par COMPARAISON DE NOMS
// (`isAdminGranted` : `roles.includes(requiredRole)`). Les deux autres portes
// qui jugent le même nom — le jury d'autorisation et le verrou de frame —
// consultent la hiérarchie de rôles. Sans aplatissement en amont, le même
// compte et le même rôle exigé recevaient donc deux verdicts opposés selon la
// porte empruntée, et c'était la porte qu'on relit le moins qui était la plus
// stricte.
//
// Ce banc verrouille l'aplatissement là où il a lieu : la construction de la
// requête d'administration.

/** Parcours de hiérarchie réduit à ce que le pont en consomme. */
function walkerDe(hierarchie: Record<string, string[]>) {
  return {
    reachableRoles(roles: readonly string[]): Set<string> {
      const out = new Set<string>(roles);
      for (const r of roles) for (const h of hierarchie[r] ?? []) out.add(h);
      return out;
    },
  };
}

/**
 * Appelle la méthode privée d'extraction sur un contrôleur monté par proxy —
 * le vrai constructeur exige nom + contexte + injection.
 */
function rolesVus(opts: {
  roles: unknown;
  hierarchie?: Record<string, string[]>;
}): readonly string[] {
  const ctrl = Object.create(
    AdminApiController.prototype,
  ) as AdminApiController;
  const container = new Container();
  if (opts.hierarchie) {
    container.set("roleHierarchy", walkerDe(opts.hierarchie));
  }
  // `context` est un GETTER du prototype adossé à un champ privé : une
  // affectation directe lèverait. On le masque par une propriété d'instance.
  Object.defineProperty(ctrl, "context", {
    value: { container } as unknown,
    configurable: true,
  });
  return (
    ctrl as unknown as {
      extractRoles(user: unknown): readonly string[];
    }
  ).extractRoles({ roles: opts.roles });
}

describe("Plan d'administration — la hiérarchie de rôles est consultée", () => {
  it("un rôle en couvre un autre : le couvert est vu par le plan", () => {
    const vus = rolesVus({
      roles: ["ROLE_NODEFONY_ADMIN"],
      hierarchie: { ROLE_NODEFONY_ADMIN: ["ROLE_DEV", "ROLE_SUPERVISOR"] },
    });
    expect(vus).to.include("ROLE_DEV");
    expect(vus).to.include("ROLE_SUPERVISOR");
  });

  it("le rôle porté reste présent (on n'échange pas, on ajoute)", () => {
    const vus = rolesVus({
      roles: ["ROLE_NODEFONY_ADMIN"],
      hierarchie: { ROLE_NODEFONY_ADMIN: ["ROLE_DEV"] },
    });
    expect(vus).to.include("ROLE_NODEFONY_ADMIN");
  });

  it("la hiérarchie n'INVENTE rien : un rôle non couvert reste absent", () => {
    const vus = rolesVus({
      roles: ["ROLE_USER"],
      hierarchie: { ROLE_NODEFONY_ADMIN: ["ROLE_DEV"] },
    });
    expect(vus).to.deep.equal(["ROLE_USER"]);
  });

  // Fail-safe : le module de sécurité peut ne pas être chargé. On rend alors ce
  // que l'appelant porte — jamais moins, jamais rien.
  it("aucune hiérarchie posée : les rôles bruts sont rendus tels quels", () => {
    expect(rolesVus({ roles: ["ROLE_ADMIN"] })).to.deep.equal(["ROLE_ADMIN"]);
  });

  it("aucun rôle : rien à aplatir, aucun appel au parcours", () => {
    expect(rolesVus({ roles: [] })).to.deep.equal([]);
    expect(rolesVus({ roles: "pas-un-tableau" })).to.deep.equal([]);
  });
});
