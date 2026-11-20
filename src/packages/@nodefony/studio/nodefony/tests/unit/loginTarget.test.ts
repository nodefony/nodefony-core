/**
 * Une seule page de connexion vue (#801) : la console conduit l'anonyme à la
 * page de l'application quand le framework la sert, et garde la sienne
 * (`/nodefony/login`) en secours seulement.
 *
 * Deux faces : la décision du navigateur (`consoleAccess`, `readLoginPage`) et
 * ce que le serveur annonce sur `/studio/api/info` (`loginPage`).
 */
import { describe, expect, it } from "vitest";
import "reflect-metadata";
import {
  consoleAccess,
  readLoginPage,
} from "../../../frontend/src/auth/loginTarget";
import StudioController from "../../controller/StudioController.js";

describe("consoleAccess — où mène une page de la console", () => {
  it("🔴 anonyme + page de l'application servie → la page de l'application, retour porté par ?from=", () => {
    expect(consoleAccess(false, "/login", "/nodefony")).toEqual({
      kind: "app",
      href: "/login?from=%2Fnodefony",
    });
    expect(consoleAccess(false, "/login", "/nodefony/logs?tab=debug")).toEqual({
      kind: "app",
      href: "/login?from=%2Fnodefony%2Flogs%3Ftab%3Ddebug",
    });
  });

  it("le chemin déplacé par l'application (`security.loginPage.path`) est suivi", () => {
    expect(consoleAccess(false, "/connexion", "/nodefony")).toEqual({
      kind: "app",
      href: "/connexion?from=%2Fnodefony",
    });
  });

  it("🔴 anonyme + aucune page servie → la page de secours de la console", () => {
    expect(consoleAccess(false, null, "/nodefony")).toEqual({
      kind: "console",
    });
  });

  it("rien n'est décidé tant que la session ou la page ne sont pas connues", () => {
    expect(consoleAccess(null, "/login", "/nodefony").kind).toBe("wait");
    expect(consoleAccess(false, undefined, "/nodefony").kind).toBe("wait");
  });

  it("connecté → la console, quelle que soit la page de l'application", () => {
    expect(consoleAccess(true, "/login", "/nodefony").kind).toBe("pass");
    expect(consoleAccess(true, null, "/nodefony").kind).toBe("pass");
    expect(consoleAccess(true, undefined, "/nodefony").kind).toBe("pass");
  });
});

describe("readLoginPage — le chemin annoncé sert d'adresse de navigation", () => {
  it("un chemin local passe tel quel", () => {
    expect(readLoginPage("/login")).toBe("/login");
  });

  it("🔴 absent, vide ou d'une autre origine → page de secours, jamais une redirection ouverte", () => {
    for (const value of [
      undefined,
      null,
      42,
      "",
      "login",
      "//evil.example/login",
      "/\\evil.example",
      "https://evil.example/login",
    ]) {
      expect(readLoginPage(value), String(value)).toBeNull();
    }
  });
});

/** Appelle l'action `apiInfo` sur un décor minimal : conteneur, noyau, rendu JSON. */
function info(authFlow: unknown): Record<string, unknown> {
  const decor = {
    context: {
      container: {
        get: (name: string) => (name === "authFlow" ? authFlow : undefined),
      },
    },
    kernel: { environment: "development", path: undefined },
    renderJson: (body: Record<string, unknown>) => body,
  };
  const action: (this: typeof decor) => unknown =
    StudioController.prototype.apiInfo;
  const body = action.call(decor);
  if (typeof body !== "object" || body === null) {
    throw new Error("apiInfo doit rendre un objet JSON");
  }
  return Object.fromEntries(Object.entries(body));
}

describe("/studio/api/info — la page de connexion annoncée à la console", () => {
  it("🔴 page servie par le framework → `loginPage` porte son chemin", () => {
    expect(
      info({ describeLoginPage: () => ({ path: "/login" }) }).loginPage,
    ).toBe("/login");
    expect(
      info({ describeLoginPage: () => ({ path: "/connexion" }) }).loginPage,
    ).toBe("/connexion");
  });

  it("🔴 page désactivée (`describeLoginPage` → null) → aucun champ", () => {
    expect(info({ describeLoginPage: () => null })).not.toHaveProperty(
      "loginPage",
    );
  });

  it("security absent (pas de service `authFlow`) → aucun champ, réponse d'avant", () => {
    expect(info(undefined)).toEqual({
      name: "Nodefony Studio",
      version: "10.0.0-poc.1",
      env: "development",
    });
  });
});
