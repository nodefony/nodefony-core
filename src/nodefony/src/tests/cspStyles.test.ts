// @vitest-environment jsdom
/**
 * Transmission du nonce CSP au navigateur et styles créés à l'exécution
 * (ADR-0024 §C2) : `cspNonceMetaTag` (serveur), `readCspNonce` et
 * `adoptStyles` (client).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { CSP_NONCE_META_PROPERTY, cspNonceMetaTag } from "../runtime/cspNonce";
import { adoptStyles, readCspNonce } from "../client/cspStyles";

afterEach(() => {
  document.head.innerHTML = "";
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

describe("cspNonceMetaTag", () => {
  it("porte le nonce dans l'attribut `nonce`, jamais dans `content`", () => {
    expect(cspNonceMetaTag("AbC+/=")).toBe(
      `<meta property="${CSP_NONCE_META_PROPERTY}" nonce="AbC+/=">`,
    );
  });

  it("nonce vide → aucune balise", () => {
    expect(cspNonceMetaTag("")).toBe("");
  });

  it("la convention est celle que lit le client de Vite", () => {
    expect(CSP_NONCE_META_PROPERTY).toBe("csp-nonce");
  });
});

describe("readCspNonce", () => {
  it("lit la balise meta", () => {
    document.head.innerHTML = cspNonceMetaTag("n-meta");
    expect(readCspNonce()).toBe("n-meta");
  });

  it("sans balise, retrouve le nonce d'un `<script>` signé de la page", () => {
    document.head.innerHTML = `<script nonce="n-script"></script>`;
    expect(readCspNonce()).toBe("n-script");
  });

  it("la balise prime sur un script", () => {
    document.head.innerHTML = `<script nonce="n-script"></script>${cspNonceMetaTag("n-meta")}`;
    expect(readCspNonce()).toBe("n-meta");
  });

  it("page sans nonce → undefined", () => {
    document.head.innerHTML = `<script></script>`;
    expect(readCspNonce()).toBeUndefined();
  });
});

describe("adoptStyles", () => {
  it("navigateur à feuilles construites : aucun `<style>` créé, feuille adoptée", () => {
    const replaced: string[] = [];
    class FakeSheet {
      replaceSync(css: string): void {
        replaced.push(css);
      }
    }
    vi.stubGlobal("CSSStyleSheet", FakeSheet);
    const previous = { fake: true };
    Object.defineProperty(document, "adoptedStyleSheets", {
      value: [previous],
      writable: true,
      configurable: true,
    });
    try {
      const sheet = adoptStyles(".a{color:red}");
      expect(sheet).toBeInstanceOf(FakeSheet);
      expect(replaced).toEqual([".a{color:red}"]);
      // Les feuilles déjà adoptées restent, la nouvelle s'ajoute à la fin.
      const adopted: unknown[] = Reflect.get(document, "adoptedStyleSheets");
      expect(adopted).toEqual([previous, sheet]);
      expect(document.querySelector("style")).toBeNull();
    } finally {
      Reflect.deleteProperty(document, "adoptedStyleSheets");
    }
  });

  it("repli : `<style>` signé du nonce de la page, dans `<head>`", () => {
    document.head.innerHTML = cspNonceMetaTag("n-1");
    const el = adoptStyles(".b{}");
    expect(el).toBeInstanceOf(HTMLStyleElement);
    const style = document.head.querySelector("style");
    expect(style?.nonce).toBe("n-1");
    expect(style?.textContent).toBe(".b{}");
  });

  it("repli dans un Shadow DOM : le `<style>` va dans la racine", () => {
    document.head.innerHTML = cspNonceMetaTag("n-2");
    const host = document.createElement("div");
    document.body.appendChild(host);
    const shadow = host.attachShadow({ mode: "open" });
    adoptStyles(".c{}", shadow);
    expect(shadow.querySelector("style")?.nonce).toBe("n-2");
    expect(document.head.querySelector("style")).toBeNull();
  });

  it("repli sans nonce annoncé : `<style>` sans attribut nonce", () => {
    adoptStyles(".d{}");
    expect(document.head.querySelector("style")?.hasAttribute("nonce")).toBe(
      false,
    );
  });
});
