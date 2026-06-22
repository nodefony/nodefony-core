import { expect } from "chai";
import { isAdminGranted } from "../../src/adminRbac.js";

// RBAC du data plane admin (Studio) — décision PURE. Verrouille le fix du
// FAIL-OPEN : avant, le 403 était court-circuité par `roles.length > 0 &&`
// (vestige « mode mock » d'avant P6) → un compte authentifié SANS rôle
// franchissait TOUT endpoint admin. Aucun test ne couvrait cette surface :
// c'est ce trou que ce banc ferme et garde fermé. Zero Trust = fail-closed.

const ADMIN = "ROLE_NODEFONY_ADMIN";

describe("adminRbac.isAdminGranted — fail-closed (RBAC data plane admin)", () => {
  // ── LE TROU : authentifié sans rôle → REFUSÉ ────────────────────────────────
  it("roles=[] + rôle requis → REFUSÉ (ex-fail-open comblé)", () => {
    expect(isAdminGranted([], ADMIN)).to.equal(false);
  });

  it("authentifié non-admin (ROLE_USER) + rôle requis → REFUSÉ", () => {
    expect(isAdminGranted(["ROLE_USER"], ADMIN)).to.equal(false);
  });

  it("rôle voisin mais pas exact → REFUSÉ (pas de hiérarchie ici)", () => {
    // La hiérarchie (ROLE_NODEFONY_ADMIN ⊃ ROLE_ADMIN) est résolue en amont
    // par le firewall ; `request.roles` arrive déjà aplati → comparaison stricte.
    expect(isAdminGranted(["ROLE_ADMIN"], ADMIN)).to.equal(false);
  });

  // ── ACCÈS LÉGITIME ──────────────────────────────────────────────────────────
  it("porteur du rôle requis → ACCORDÉ", () => {
    expect(isAdminGranted([ADMIN], ADMIN)).to.equal(true);
  });

  it("rôle requis présent parmi d'autres → ACCORDÉ", () => {
    expect(isAdminGranted(["ROLE_USER", ADMIN, "ROLE_DEV"], ADMIN)).to.equal(
      true,
    );
  });

  // ── ENDPOINT PUBLIC (role === "" / undefined) ───────────────────────────────
  it('role="" (public déclaré, ex. livez) → ACCORDÉ même sans rôle', () => {
    expect(isAdminGranted([], "")).to.equal(true);
  });

  it("role=undefined → ACCORDÉ (pas de RBAC sur cet endpoint)", () => {
    expect(isAdminGranted([], undefined)).to.equal(true);
  });

  it("public accordé même à un porteur de rôles quelconques", () => {
    expect(isAdminGranted(["ROLE_USER"], "")).to.equal(true);
  });
});
