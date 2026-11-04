import { describe, expect, it } from "vitest";
import { Eta } from "eta";
import { signTemplateTags, VIEW_NONCE_LOCAL } from "../../src/viewNonce";

/**
 * ADR-0024 §C0 — une page écrite vite, par quelqu'un qui ignore la CSP, n'est
 * pas bloquée : chaque `<script>` et `<style>` ÉCRIT dans le gabarit reçoit le
 * nonce de la requête. Et la signature ne profite JAMAIS à une balise apportée
 * par les données — sinon le nonce ne protégerait plus de rien.
 */
describe("signTemplateTags — le gabarit signé par le framework", () => {
  const ATTR = `nonce="<%= it.${VIEW_NONCE_LOCAL} %>"`;

  it("signe un script en ligne, un script servi et un style", () => {
    const out = signTemplateTags(
      '<style>a{}</style><script>go()</script><script type="module" src="/app/x.js"></script>',
    );
    expect(out).toBe(
      `<style ${ATTR}>a{}</style><script ${ATTR}>go()</script><script ${ATTR} type="module" src="/app/x.js"></script>`,
    );
  });

  it("casse indifférente, attributs conservés", () => {
    expect(signTemplateTags('<SCRIPT defer src="/a.js"></SCRIPT>')).toBe(
      `<SCRIPT ${ATTR} defer src="/a.js"></SCRIPT>`,
    );
  });

  it("une balise déjà signée par l'auteur n'est pas touchée", () => {
    const src = '<script nonce="<%= it.cspNonce %>">go()</script>';
    expect(signTemplateTags(src)).toBe(src);
  });

  it("rien à signer : la MÊME chaîne", () => {
    const src = "<main><p><%= it.name %></p></main>";
    expect(signTemplateTags(src)).toBe(src);
  });

  it("un `<script` écrit DANS une balise Eta (du code) n'est jamais touché", () => {
    const src = `<%~ "<script>" + "x" %><script>go()</script>`;
    expect(signTemplateTags(src)).toBe(
      `<%~ "<script>" + "x" %><script ${ATTR}>go()</script>`,
    );
  });

  it("🔴 un `<script>` dont un attribut vient des DONNÉES n'est pas signé", () => {
    const src = `<script src="<%= it.url %>"></script><script>go()</script>`;
    expect(signTemplateTags(src)).toBe(
      `<script src="<%= it.url %>"></script><script ${ATTR}>go()</script>`,
    );
  });

  it("une donnée APRÈS l'ouverture (contenu, autre balise) ne retire pas la signature", () => {
    const src = `<script src="/a.js"></script><p><%= it.x %></p><style media="<%= it.m %>">p{}</style>`;
    expect(signTemplateTags(src)).toBe(
      `<script ${ATTR} src="/a.js"></script><p><%= it.x %></p><style ${ATTR} media="<%= it.m %>">p{}</style>`,
    );
  });

  it("ni `<scripts>` ni `<styled>` : seules les vraies balises", () => {
    const src = "<scripts></scripts><styled></styled>";
    expect(signTemplateTags(src)).toBe(src);
  });
});

describe("signTemplateTags — rendu RÉEL par Eta (options du framework)", () => {
  const eta = new Eta({ autoEscape: true, useWith: true, cache: false });
  const render = (src: string, data: Record<string, unknown>): string =>
    eta.renderString(signTemplateTags(src), data);

  it("les balises du gabarit portent le nonce de la requête", () => {
    const html = render(
      '<style>p{}</style><script src="/app/debugbar.js"></script><p><%= name %></p>',
      { name: "Ada", [VIEW_NONCE_LOCAL]: "N0nce+/=" },
    );
    expect(html).toBe(
      '<style nonce="N0nce+/=">p{}</style><script nonce="N0nce+/=" src="/app/debugbar.js"></script><p>Ada</p>',
    );
  });

  it("🔴 une balise apportée par les DONNÉES n'est jamais signée", () => {
    const evil = "<script>alert(1)</script><style>*{}</style>";
    const html = render("<div><%~ raw %></div><script>ok()</script>", {
      raw: evil,
      [VIEW_NONCE_LOCAL]: "N0nce",
    });
    // Le script du gabarit est signé, l'injecté reste nu : le navigateur le refuse.
    expect(html).toBe(`<div>${evil}</div><script nonce="N0nce">ok()</script>`);
  });

  it("🔴 une URL de script apportée par les DONNÉES reste non signée", () => {
    const html = render(`<script src="<%= url %>"></script>`, {
      url: "https://evil.example/x.js",
      [VIEW_NONCE_LOCAL]: "N0nce",
    });
    expect(html).toBe(`<script src="https://evil.example/x.js"></script>`);
  });

  it("l'auteur qui tient l'URL pour sûre la signe lui-même", () => {
    const html = render(
      `<script nonce="<%= cspNonce %>" src="<%= url %>"></script>`,
      { url: "/app/x.js", [VIEW_NONCE_LOCAL]: "N0nce" },
    );
    expect(html).toBe(`<script nonce="N0nce" src="/app/x.js"></script>`);
  });
});
