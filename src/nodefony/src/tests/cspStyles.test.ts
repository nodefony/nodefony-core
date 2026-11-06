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

describe("adoptStyles — navigateur à feuilles construites (jsdom ≥ 31)", () => {
  afterEach(() => {
    document.adoptedStyleSheets = [];
  });

  it("aucun `<style>` créé : la feuille est adoptée ET appliquée", () => {
    const previous = new CSSStyleSheet();
    document.adoptedStyleSheets = [previous];
    const el = document.createElement("p");
    el.className = "a";
    document.body.appendChild(el);
    const sheet = adoptStyles(".a{color:rgb(255, 0, 0)}");
    expect(sheet).toBeInstanceOf(CSSStyleSheet);
    // Les feuilles déjà adoptées restent, la nouvelle s'ajoute à la fin.
    expect(document.adoptedStyleSheets).toEqual([previous, sheet]);
    expect(document.querySelector("style")).toBeNull();
    expect(getComputedStyle(el).color).toBe("rgb(255, 0, 0)");
  });

  it("dans un Shadow DOM : la feuille va à la racine, pas au document", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const shadow = host.attachShadow({ mode: "open" });
    const sheet = adoptStyles(".c{}", shadow);
    expect(shadow.adoptedStyleSheets).toEqual([sheet]);
    expect(document.adoptedStyleSheets).toEqual([]);
  });
});

describe("adoptStyles — repli, navigateur SANS feuilles construites", () => {
  // jsdom connaît les feuilles construites depuis sa 31 : le repli ne
  // s'atteint plus qu'en retirant le constructeur, comme un vieux navigateur.
  const withoutConstructableSheets = (): void => {
    vi.stubGlobal("CSSStyleSheet", undefined);
  };

  it("repli : `<style>` signé du nonce de la page, dans `<head>`", () => {
    withoutConstructableSheets();
    document.head.innerHTML = cspNonceMetaTag("n-1");
    const el = adoptStyles(".b{}");
    expect(el).toBeInstanceOf(HTMLStyleElement);
    const style = document.head.querySelector("style");
    expect(style?.nonce).toBe("n-1");
    expect(style?.textContent).toBe(".b{}");
  });

  it("repli dans un Shadow DOM : le `<style>` va dans la racine", () => {
    withoutConstructableSheets();
    document.head.innerHTML = cspNonceMetaTag("n-2");
    const host = document.createElement("div");
    document.body.appendChild(host);
    const shadow = host.attachShadow({ mode: "open" });
    adoptStyles(".c{}", shadow);
    expect(shadow.querySelector("style")?.nonce).toBe("n-2");
    expect(document.head.querySelector("style")).toBeNull();
  });

  it("repli sans nonce annoncé : `<style>` sans attribut nonce", () => {
    withoutConstructableSheets();
    adoptStyles(".d{}");
    expect(document.head.querySelector("style")?.hasAttribute("nonce")).toBe(
      false,
    );
  });
});
