import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { Container, Event } from "nodefony";
import type { Module } from "nodefony";
import type { ContextType } from "@nodefony/http";
import { Firewall } from "../../nodefony/service/firewall";
import {
  responseKindOf,
  SecurityHeaders,
} from "../../nodefony/service/securityHeaders";
import { securityConfigSchema } from "../../nodefony/config/config";
import {
  parseCsp,
  withFrameAncestors,
  withoutDirective,
} from "../../nodefony/src/csp";

/**
 * ADR-0024 §C11 — la politique suit le type de la réponse : document (HTML,
 * XHTML, SVG) → politique complète avec nonce et `Permissions-Policy` ;
 * JavaScript → complète SANS nonce ; reste → `default-src 'none'` figée, plus
 * l'encadrement de la politique complète.
 */

const UIR = "upgrade-insecure-requests";
const DEFAULT_CSP = securityConfigSchema.parse({}).headers.csp;
const has = (csp: string, name: string): boolean =>
  parseCsp(csp).some(([n]) => n === name);
const CSP = "Content-Security-Policy";

const make = (csp: string, cspNonces = true): SecurityHeaders =>
  new SecurityHeaders({
    enabled: true,
    csp,
    cspNonces,
    referrerPolicy: "no-referrer",
    permissionsPolicy: "camera=()",
  });

describe("responseKindOf — famille d'une réponse d'après son type", () => {
  const cases: Array<[string | null | undefined, string]> = [
    ["text/html", "document"],
    ["text/html; charset=utf-8", "document"],
    ["Application/XHTML+XML", "document"],
    ["image/svg+xml", "document"],
    // Tout type XML est rendu comme un document (WHATWG MIME Sniffing §4.6,
    // « XML MIME type ») : un formulaire injecté n'y relèverait d'aucun
    // `form-action` sous la politique courte.
    ["text/xml", "document"],
    ["application/xml; charset=utf-8", "document"],
    ["application/atom+xml", "document"],
    ["text/javascript", "script"],
    ["application/javascript; charset=utf-8", "script"],
    ["text/x-javascript", "script"],
    ["application/json", "other"],
    ["text/css", "other"],
    ["image/png", "other"],
    ["text/event-stream", "other"],
    ["application/octet-stream", "other"],
    [null, "other"],
    // Type inconnu de l'appelant : la politique la plus complète, jamais moins.
    [undefined, "document"],
  ];
  for (const [type, kind] of cases) {
    it(`${String(type)} → ${kind}`, () => {
      assert.equal(responseKindOf(type), kind);
    });
  }
});

describe("SecurityHeaders — tables des ressources (non-documents)", () => {
  it("reste : politique courte figée, l'encadrement de la politique complète", () => {
    // Composition du pare-feu avec le défaut `frameOptions: DENY`.
    const sh = make(withFrameAncestors(DEFAULT_CSP, "DENY"));
    assert.equal(
      sh.headersForResource("other", false)[CSP],
      "default-src 'none'; frame-ancestors 'none'",
    );
  });

  it("reste : l'encadrement suit la politique (SAMEORIGIN, origine de l'app)", () => {
    assert.equal(
      make(withFrameAncestors(DEFAULT_CSP, "SAMEORIGIN")).headersForResource(
        "other",
        true,
      )[CSP],
      "default-src 'none'; frame-ancestors 'self'",
    );
    assert.equal(
      make(
        "default-src 'self'; frame-ancestors https://partner.example",
      ).headersForResource("other", true)[CSP],
      "default-src 'none'; frame-ancestors https://partner.example",
    );
  });

  it("reste : sans frame-ancestors dans la politique, rien n'est inventé", () => {
    assert.equal(
      make("default-src 'self'").headersForResource("other", true)[CSP],
      "default-src 'none'",
    );
  });

  it("reste : même table en TLS et en clair, sans Permissions-Policy", () => {
    const sh = make(DEFAULT_CSP);
    const t = sh.headersForResource("other", true);
    assert.equal(t, sh.headersForResource("other", false));
    assert.equal(t["Permissions-Policy"], undefined);
    assert.equal(t["Referrer-Policy"], "no-referrer");
    assert.ok(Object.isFrozen(t));
  });

  it("script : la politique complète SANS nonce, 'strict-dynamic' gardé", () => {
    const sh = make(
      "default-src 'self'; script-src 'nonce-{{nonce}}' 'strict-dynamic' 'self'",
    );
    assert.equal(
      sh.headersForResource("script", true)[CSP],
      "default-src 'self'; script-src 'strict-dynamic' 'self'",
    );
    assert.equal(
      sh.headersForResource("script", true)["Permissions-Policy"],
      undefined,
    );
  });

  it("script : upgrade-insecure-requests en TLS seulement (ADR-0024 §C6)", () => {
    const sh = make(DEFAULT_CSP);
    assert.ok(has(sh.headersForResource("script", true)[CSP] ?? "", UIR));
    assert.ok(!has(sh.headersForResource("script", false)[CSP] ?? "", UIR));
  });

  it("politique coupée par l'application (csp vide) : aucune CSP nulle part", () => {
    const sh = make("");
    assert.equal(sh.headersForResource("other", true)[CSP], undefined);
    assert.equal(sh.headersForResource("script", true)[CSP], undefined);
  });

  it("chaque en-tête part là où le navigateur le lit", () => {
    const sh = new SecurityHeaders({
      enabled: true,
      csp: DEFAULT_CSP,
      cspNonces: true,
      referrerPolicy: "no-referrer",
      coop: "same-origin",
      coep: "require-corp",
      corp: "same-origin",
      originAgentCluster: true,
      permissionsPolicy: "camera=()",
    });
    const names = (t: Readonly<Record<string, string>>): string[] =>
      Object.keys(t)
        .filter((n) => n !== CSP)
        .sort();
    assert.deepEqual(names(sh.headersForResource("other", true)), [
      "Cross-Origin-Resource-Policy",
      "Referrer-Policy",
    ]);
    assert.deepEqual(names(sh.headersForResource("script", true)), [
      "Cross-Origin-Embedder-Policy",
      "Cross-Origin-Resource-Policy",
      "Referrer-Policy",
    ]);
    assert.deepEqual(names(sh.headersFor(true)), [
      "Cross-Origin-Embedder-Policy",
      "Cross-Origin-Opener-Policy",
      "Cross-Origin-Resource-Policy",
      "Origin-Agent-Cluster",
      "Permissions-Policy",
      "Referrer-Policy",
    ]);
  });

  it("document : Permissions-Policy gardée", () => {
    assert.equal(
      make(DEFAULT_CSP).headersFor(true)["Permissions-Policy"],
      "camera=()",
    );
  });
});

/** Pare-feu réel sur la config par défaut. */
const firewall = (): Firewall => {
  const container = new Container();
  const kernel = new EventEmitter();
  container.set("kernel", kernel);
  const fw = new Firewall({
    container,
    notificationsCenter: new Event(),
    options: {},
  } as unknown as Module);
  kernel.emit("onBoot");
  return fw;
};

/** Pose les en-têtes d'une réponse de type `type` ; compte les lectures du nonce. */
const apply = (
  fw: Firewall,
  type: string | null | undefined,
  cspDirectives: Record<string, readonly string[]> | null = null,
  servedAsFile = false,
) => {
  const headers: Record<string, string> = {};
  let nonceReads = 0;
  const ctx = {
    scheme: "https",
    get cspNonce() {
      nonceReads++;
      return "N0nce==";
    },
    cspDirectives,
    response: {
      setHeader: (name: string, value: string) => {
        headers[name] = value;
      },
    },
  };
  fw.applySecurityHeaders(ctx as unknown as ContextType, type, servedAsFile);
  return { headers, nonceReads };
};

describe("pare-feu — la politique suit le type de la réponse (ADR-0024 §C11)", () => {
  it("HTML : politique complète, nonce tiré", () => {
    const { headers, nonceReads } = apply(
      firewall(),
      "text/html; charset=utf-8",
    );
    assert.match(headers[CSP] ?? "", /'nonce-N0nce=='/);
    assert.equal(nonceReads, 1);
  });

  it("JSON : politique courte, AUCUN nonce tiré", () => {
    const { headers, nonceReads } = apply(firewall(), "application/json");
    assert.match(headers[CSP] ?? "", /^default-src 'none'/);
    assert.equal(nonceReads, 0);
  });

  it("JavaScript : politique complète sans nonce, aucun nonce tiré", () => {
    const { headers, nonceReads } = apply(firewall(), "text/javascript");
    assert.doesNotMatch(headers[CSP] ?? "", /nonce/);
    assert.match(headers[CSP] ?? "", /script-src/);
    assert.equal(nonceReads, 0);
  });

  it("sans contenu (null) : politique courte", () => {
    assert.match(
      apply(firewall(), null).headers[CSP] ?? "",
      /^default-src 'none'/,
    );
  });

  it("type omis : politique complète (comportement d'avant)", () => {
    assert.match(
      apply(firewall(), undefined).headers[CSP] ?? "",
      /'nonce-N0nce=='/,
    );
  });

  it("route @Csp servant du JSON : SA politique, jamais réduite", () => {
    const extra = Object.freeze({
      "frame-ancestors": ["https://partner.example"],
    });
    const csp = apply(firewall(), "application/pdf", extra).headers[CSP] ?? "";
    assert.match(csp, /frame-ancestors[^;]*https:\/\/partner\.example/);
    assert.match(csp, /script-src/);
  });

  it("la politique courte reste celle de l'app quand elle retire upgrade-insecure-requests", () => {
    // Garde-fou de composition : la courte ne dépend pas de la directive.
    const sh = make(withoutDirective(DEFAULT_CSP, UIR));
    assert.equal(
      sh.headersForResource("other", true)[CSP],
      "default-src 'none'",
    );
  });
});

/**
 * ADR-0024 §C1 — `script-src 'nonce-…' 'strict-dynamic' 'self'`. Sous
 * `'strict-dynamic'`, un navigateur CSP3 ignore `'self'` : sans nonce ni hash
 * dans la directive, plus AUCUN `<script>` d'une page ne s'exécute. Partout où
 * le framework retire le nonce d'une politique de DOCUMENT, `'strict-dynamic'`
 * part avec lui ; un document servi tel quel (fichier statique, relais) ne
 * peut pas porter de nonce et reçoit cette politique-là.
 */
describe("C1 — 'strict-dynamic' jamais orphelin sur un document (ADR-0024 §C1)", () => {
  const SD =
    "default-src 'self'; script-src 'nonce-{{nonce}}' 'strict-dynamic' 'self'";
  const sourcesOf = (csp: string, name: string): string[] =>
    parseCsp(csp).find(([n]) => n === name)?.[1] ?? [];

  it("défaut : nonce et 'strict-dynamic', 'self' en repli CSP2", () => {
    assert.deepEqual(sourcesOf(DEFAULT_CSP, "script-src"), [
      "'nonce-{{nonce}}'",
      "'strict-dynamic'",
      "'self'",
    ]);
  });

  it("document servi tel quel : ni nonce ni 'strict-dynamic', 'self' décide", () => {
    const table = make(SD).headersForServedFile(true);
    assert.equal(table[CSP], "default-src 'self'; script-src 'self'");
    // C'est un document : tous ses en-têtes restent.
    assert.equal(table["Permissions-Policy"], "camera=()");
  });

  it("document servi tel quel : upgrade-insecure-requests en TLS seulement", () => {
    const sh = make(`${SD}; ${UIR}`);
    assert.ok(has(sh.headersForServedFile(true)[CSP] ?? "", UIR));
    assert.ok(!has(sh.headersForServedFile(false)[CSP] ?? "", UIR));
  });

  it("cspNonces: false — 'strict-dynamic' part avec le nonce", () => {
    assert.equal(
      make(SD, false).headersFor(true)[CSP],
      "default-src 'self'; script-src 'self'",
    );
  });

  it("route @Csp sans nonce actif : 'strict-dynamic' part aussi", () => {
    const extra = Object.freeze({ "img-src": ["https://cdn.example"] });
    const csp = make(SD, false).cspForExtra("", extra, true);
    assert.deepEqual(sourcesOf(csp, "script-src"), ["'self'"]);
  });

  it("un hash reste dans la directive : 'strict-dynamic' gardé", () => {
    assert.equal(
      make(
        "script-src 'nonce-{{nonce}}' 'strict-dynamic' 'sha256-abc='",
        false,
      ).headersFor(true)[CSP],
      "script-src 'strict-dynamic' 'sha256-abc='",
    );
  });

  it("politique écrite SANS marqueur de nonce : jamais retouchée", () => {
    const own = "script-src 'strict-dynamic' 'self'";
    assert.equal(make(own).headersFor(true)[CSP], own);
    assert.equal(make(own).headersForServedFile(true)[CSP], own);
  });

  it("pare-feu : HTML servi tel quel → table sans nonce, aucun nonce tiré", () => {
    const { headers, nonceReads } = apply(firewall(), "text/html", null, true);
    assert.doesNotMatch(headers[CSP] ?? "", /nonce|strict-dynamic/);
    assert.match(headers[CSP] ?? "", /script-src 'self'/);
    assert.equal(nonceReads, 0);
  });

  it("pare-feu : type inconnu servi tel quel (index d'un dossier) → même table", () => {
    const { headers, nonceReads } = apply(firewall(), undefined, null, true);
    assert.doesNotMatch(headers[CSP] ?? "", /nonce|strict-dynamic/);
    assert.equal(nonceReads, 0);
  });

  it("pare-feu : JSON servi tel quel → politique courte, le drapeau ne vise que les documents", () => {
    const served = apply(firewall(), "application/json", null, true).headers;
    const routed = apply(firewall(), "application/json").headers;
    assert.deepEqual(served, routed);
  });
});

/**
 * ADR-0024 §C2 — `style-src 'self' 'unsafe-inline' 'nonce-…'` et
 * `style-src-attr 'unsafe-inline'`. En présence d'un nonce, un navigateur CSP2+
 * IGNORE `'unsafe-inline'` : un `<style>` injecté sans nonce est bloqué. Là où
 * le framework retire le nonce (fichier servi tel quel, `cspNonces: false`),
 * `'unsafe-inline'` reprend la main : la page garde ses styles, sans geste
 * possible pour elle (C0) et sans point d'injection côté serveur.
 */
describe("C2 — styles : nonce, repli 'unsafe-inline' là où le nonce est retiré (ADR-0024 §C2)", () => {
  const sourcesOf = (csp: string, name: string): string[] =>
    parseCsp(csp).find(([n]) => n === name)?.[1] ?? [];

  it("défaut : nonce de styles, 'unsafe-inline' en repli, attributs `style=` tolérés", () => {
    assert.deepEqual(sourcesOf(DEFAULT_CSP, "style-src"), [
      "'self'",
      "'unsafe-inline'",
      "'nonce-{{nonce}}'",
    ]);
    assert.deepEqual(sourcesOf(DEFAULT_CSP, "style-src-attr"), [
      "'unsafe-inline'",
    ]);
  });

  it("document rendu : le MÊME nonce signe scripts et styles", () => {
    const csp = make(DEFAULT_CSP).cspFor("N0nce", true);
    assert.deepEqual(sourcesOf(csp, "style-src"), [
      "'self'",
      "'unsafe-inline'",
      "'nonce-N0nce'",
    ]);
    assert.ok(sourcesOf(csp, "script-src").includes("'nonce-N0nce'"));
    assert.doesNotMatch(csp, /\{\{nonce\}\}/);
  });

  it("document servi tel quel : nonce retiré, 'unsafe-inline' décide", () => {
    const csp = make(DEFAULT_CSP).headersForServedFile(true)[CSP] ?? "";
    assert.deepEqual(sourcesOf(csp, "style-src"), [
      "'self'",
      "'unsafe-inline'",
    ]);
    assert.doesNotMatch(csp, /nonce/);
  });

  it("cspNonces: false — styles en 'unsafe-inline', comme avant C2", () => {
    const csp = make(DEFAULT_CSP, false).headersFor(true)[CSP] ?? "";
    assert.deepEqual(sourcesOf(csp, "style-src"), [
      "'self'",
      "'unsafe-inline'",
    ]);
  });
});
