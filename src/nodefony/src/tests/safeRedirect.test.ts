import { describe, it, expect } from "vitest";
import { safeRedirectPath } from "../runtime/safeRedirect";
import { LOGIN_PAGE_PATH, oauth2AuthorizePath } from "../runtime/authRoutes";

/**
 * La garde anti-redirection ouverte (CWE-601) : tout ce qui n'est pas un
 * chemin LOCAL retombe sur le repli. Chaque refus ci-dessous est une forme
 * qu'un navigateur suivrait vers un autre hôte.
 */
describe("safeRedirectPath — garde anti-redirection ouverte", () => {
  it.each([
    "/",
    "/admin",
    "/admin/users?page=2&sort=name",
    "/docs#section",
    "/a/b/../c",
    "/%2F%2Fevil.example", // encodé : reste un segment de chemin local
  ])("accepte le chemin local %s", (value) => {
    expect(safeRedirectPath(value)).toBe(value);
  });

  it.each([
    ["//evil.example", "double barre = hôte"],
    ["//evil.example/path", "double barre + chemin"],
    ["/\\evil.example", "barre inverse lue comme /"],
    ["/x\\y", "barre inverse ailleurs"],
    ["https://evil.example", "schéma absolu"],
    ["http:evil.example", "schéma sans barres"],
    ["javascript:alert(1)", "pseudo-schéma"],
    ["evil.example", "hôte nu"],
    ["admin", "relatif sans barre"],
    ["/\t/evil.example", "tabulation retirée par le navigateur"],
    ["/\n/evil.example", "retour à la ligne retiré"],
    ["/ok\r\nSet-Cookie: x=1", "injection d'en-tête"],
    ["/\u007f", "DEL"],
    ["", "vide"],
    [`/${"a".repeat(2048)}`, "trop long"],
  ])("refuse %j (%s)", (value) => {
    expect(safeRedirectPath(value)).toBe("/");
  });

  it("refuse ce qui n'est pas une chaîne", () => {
    for (const value of [undefined, null, 42, ["/admin"], { href: "/" }]) {
      expect(safeRedirectPath(value)).toBe("/");
    }
  });

  it("rend le repli fourni", () => {
    expect(safeRedirectPath("//evil.example", "/home")).toBe("/home");
  });
});

describe("oauth2AuthorizePath — page de retour", () => {
  it("encode la page de retour en paramètre `from`", () => {
    expect(oauth2AuthorizePath("keycloak", "/admin?x=1")).toBe(
      "/nodefony/security/api/oauth2/keycloak/authorize?from=%2Fadmin%3Fx%3D1",
    );
  });

  it("n'ajoute rien sans page de retour", () => {
    expect(oauth2AuthorizePath("keycloak")).toBe(
      "/nodefony/security/api/oauth2/keycloak/authorize",
    );
  });
});

describe("LOGIN_PAGE_PATH", () => {
  it("est un chemin local que la garde accepte", () => {
    expect(safeRedirectPath(LOGIN_PAGE_PATH)).toBe(LOGIN_PAGE_PATH);
  });
});
