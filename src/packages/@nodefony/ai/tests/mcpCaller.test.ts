import { describe, it, expect } from "vitest";
import { ADMIN_SCOPE_READ } from "nodefony";
import { mcpCallerRoles } from "../index";

describe("mcpCallerRoles — une règle pour TOUTE porte MCP, présente ou future", () => {
  it("porte NON protégée → rôle d'opérateur (son périmètre EST sa protection)", () => {
    expect(
      mcpCallerRoles({ protected: false, authenticated: false, scopes: [] }),
    ).to.deep.equal(["ROLE_NODEFONY_ADMIN"]);
  });

  it("porte protégée + jeton vérifié → ce que ses SCOPES ouvrent", () => {
    expect(
      mcpCallerRoles({
        protected: true,
        authenticated: true,
        scopes: [ADMIN_SCOPE_READ],
      }),
    ).to.deep.equal(["ROLE_NODEFONY_ADMIN"]);
    expect(
      mcpCallerRoles({
        protected: true,
        authenticated: true,
        scopes: ["openid"],
      }),
    ).to.deep.equal([]);
  });

  it("porte protégée + anonyme toléré → RIEN (sinon la déclaration est vide de sens)", () => {
    expect(
      mcpCallerRoles({ protected: true, authenticated: false, scopes: [] }),
    ).to.deep.equal([]);
  });

  it("une porte plus stricte passe SES rôles d'opérateur, sans réécrire la règle", () => {
    expect(
      mcpCallerRoles(
        { protected: false, authenticated: false, scopes: [] },
        [],
      ),
    ).to.deep.equal([]);
  });
});
