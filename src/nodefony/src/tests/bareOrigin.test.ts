import { describe, it, expect } from "vitest";
import { parseBareOrigin } from "../runtime/bareOrigin";

const HTTP = ["http:", "https:"] as const;
const SOCKET = ["ws:", "wss:", "http:", "https:"] as const;

describe("parseBareOrigin — une origine nue, rien d'autre", () => {
  it("accepte schéma, hôte et port", () => {
    expect(parseBareOrigin("https://app.example.com", HTTP)?.host).toBe(
      "app.example.com",
    );
    expect(parseBareOrigin("wss://rt.example.com:8443", SOCKET)?.host).toBe(
      "rt.example.com:8443",
    );
    expect(parseBareOrigin("http://127.0.0.1:5151/", HTTP)?.port).toBe("5151");
  });

  it("refuse un schéma non permis", () => {
    expect(parseBareOrigin("wss://rt.example.com", HTTP)).toBeNull();
    expect(parseBareOrigin("ftp://rt.example.com", SOCKET)).toBeNull();
    expect(parseBareOrigin("javascript:alert(1)", SOCKET)).toBeNull();
  });

  it("refuse chemin, requête, fragment et identifiants", () => {
    for (const bad of [
      "https://a.example/socket",
      "https://a.example?x=1",
      "https://a.example#f",
      "https://user:pass@a.example",
    ]) {
      expect(parseBareOrigin(bad, HTTP), bad).toBeNull();
    }
  });

  it("refuse un joker et un texte qui n'est pas une URL", () => {
    expect(parseBareOrigin("https://*.example.com", HTTP)).toBeNull();
    expect(parseBareOrigin("*", HTTP)).toBeNull();
    expect(parseBareOrigin("a.example.com", HTTP)).toBeNull();
    expect(parseBareOrigin("", HTTP)).toBeNull();
  });
});
