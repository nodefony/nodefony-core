import { describe, it, expect } from "vitest";
import { checkMcpAccess, isLocalAddress } from "../index";

/**
 * La garde de transport d'une porte MCP — fonction PURE : le refus s'éprouve à
 * volonté, sans monter de serveur.
 */
describe("MCP — la garde d'accès", () => {
  it("reconnaît les trois formes d'adresse locale", () => {
    expect(isLocalAddress("127.0.0.1")).toBe(true);
    expect(isLocalAddress("::1")).toBe(true);
    // La forme que rend une pile double : c'est celle qu'une comparaison naïve
    // à "127.0.0.1" rate.
    expect(isLocalAddress("::ffff:127.0.0.1")).toBe(true);
  });

  it("sens négatif : une adresse absente ne vaut PAS locale", () => {
    // Pas d'adresse = pas de preuve de localité. Le doute ne vaut pas un OUI.
    expect(isLocalAddress(undefined)).toBe(false);
    expect(isLocalAddress("")).toBe(false);
  });

  it("sens négatif : une adresse publique n'est pas locale", () => {
    expect(isLocalAddress("10.0.0.4")).toBe(false);
    expect(isLocalAddress("192.168.1.10")).toBe(false);
    expect(isLocalAddress("2001:db8::1")).toBe(false);
  });

  it("laisse passer un client NATIF — il n'envoie aucune Origin", () => {
    const verdict = checkMcpAccess(
      { remoteAddress: "127.0.0.1" },
      { allowedOrigins: [], allowRemote: false },
    );
    expect(verdict.allowed).toBe(true);
  });

  it("🔴 REFUSE une Origin de navigateur non déclarée (DNS rebinding)", () => {
    // Le seul vecteur réel contre un serveur MCP local : une page ouverte dans
    // le navigateur du développeur, qui, elle, pose TOUJOURS un Origin.
    const verdict = checkMcpAccess(
      { origin: "https://evil.example", remoteAddress: "127.0.0.1" },
      { allowedOrigins: [], allowRemote: false },
    );
    expect(verdict.allowed).toBe(false);
    if (!verdict.allowed) {
      expect(verdict.why).toMatch(/origine/u);
    }
  });

  it("accepte une Origin explicitement déclarée", () => {
    const verdict = checkMcpAccess(
      { origin: "https://localhost:5152", remoteAddress: "::1" },
      { allowedOrigins: ["https://localhost:5152"], allowRemote: false },
    );
    expect(verdict.allowed).toBe(true);
  });

  it("🔴 REFUSE un appel distant tant que allowRemote est faux", () => {
    const verdict = checkMcpAccess(
      { remoteAddress: "203.0.113.9" },
      { allowedOrigins: [], allowRemote: false },
    );
    expect(verdict.allowed).toBe(false);
  });

  it("la localité est jugée AVANT l'origine — un distant n'apprend rien", () => {
    // Un appelant distant ne doit même pas découvrir quelles origines seraient
    // admises : l'ordre des contrôles est le message.
    const verdict = checkMcpAccess(
      { origin: "https://localhost:5152", remoteAddress: "203.0.113.9" },
      { allowedOrigins: ["https://localhost:5152"], allowRemote: false },
    );
    expect(verdict.allowed).toBe(false);
    if (!verdict.allowed) {
      expect(verdict.why).toMatch(/adresse non locale/u);
    }
  });

  it("allowRemote ouvre la porte quand on l'a demandé", () => {
    const verdict = checkMcpAccess(
      { remoteAddress: "203.0.113.9" },
      { allowedOrigins: [], allowRemote: true },
    );
    expect(verdict.allowed).toBe(true);
  });
});
