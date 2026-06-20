import assert from "node:assert/strict";
import { Cors, type ICorsOptions } from "../../nodefony/service/cors";

/**
 * Matrice d'ATTAQUE (red-team) CORS — dérivée de la MENACE (OWASP CORS / Fetch
 * Standard), pas de l'implémentation. Complète `cors.test.ts` (matrice
 * fonctionnelle) par le vecteur adverse central :
 *
 *   Allowlist bypass — un attaquant présente une origine qui « ressemble » à une
 *   origine de confiance. Une validation laxiste (sous-chaîne, regex, suffixe de
 *   domaine, scheme ignoré) reflète l'origine attaquante → fuite cross-origin
 *   avec credentials. Le match EXACT (Set sur la chaîne d'origine complète, scheme
 *   + host + port) doit renvoyer `null` (aucun en-tête → le navigateur bloque).
 *
 * Une origine refusée ⇒ AUCUN en-tête `Access-Control-*` (preflight ET requête
 * réelle) : zéro information divulguée, réponse non partageable.
 */

const SELF = "https://app.example.com";

const base: ICorsOptions = {
  enabled: true,
  origins: [SELF],
  credentials: true, // pire cas : si un bypass passait, il fuiterait AVEC credentials
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Authorization", "Content-Type"],
  exposedHeaders: [],
  maxAgeS: 600,
};
const make = (o: Partial<ICorsOptions> = {}): Cors =>
  new Cors({ ...base, ...o });

describe("CORS red-team — allowlist bypass (origine refusée ⇒ aucun en-tête)", () => {
  const c = make();

  // Chaque libellé = ce qu'un comparateur NAÏF accepterait à tort.
  const spoofs: Array<[string, string]> = [
    [
      "suffixe (includes) — app.example.com.evil.com",
      "https://app.example.com.evil.com",
    ],
    ["préfixe — evilapp.example.com", "https://evilapp.example.com"],
    ["tiret-préfixe — evil-app.example.com", "https://evil-app.example.com"],
    [
      "sous-domaine (endsWith) — x.app.example.com",
      "https://x.app.example.com",
    ],
    ["scheme downgrade — http://app.example.com", "http://app.example.com"],
    ["port ajouté — app.example.com:8443", "https://app.example.com:8443"],
    ["casse divergente — APP.EXAMPLE.COM", "https://APP.EXAMPLE.COM"],
    ["trailing slash — app.example.com/", "https://app.example.com/"],
    ["userinfo — app.example.com@evil.com", "https://app.example.com@evil.com"],
  ];

  for (const [label, origin] of spoofs) {
    it(`${label} → preflight ET requête réelle = null`, () => {
      assert.equal(c.preflightHeaders(origin), null, "preflight doit refuser");
      assert.equal(
        c.actualHeaders(origin),
        null,
        "requête réelle doit refuser",
      );
    });
  }

  // Contrôle POSITIF : sans lui, « tout refuser » serait trivialement vert.
  it("contrôle : origine EXACTE → reflétée (non null) + credentials", () => {
    const h = c.actualHeaders(SELF);
    assert.ok(h);
    assert.equal(h["Access-Control-Allow-Origin"], SELF);
    assert.equal(h["Access-Control-Allow-Credentials"], "true");
  });
});

describe("CORS red-team — Origin 'null' / vide jamais de confiance (contexte opaque)", () => {
  // OWASP : « Origin: null » est envoyé par les iframes sandbox, redirections, data:.
  // Le whitelister = ouvrir à tout contexte opaque → ne JAMAIS reconnaître "null"
  // ni "" (même en l'absence d'entrée correspondante : fail-closed).
  it("origine 'null' (chaîne) → aucun en-tête", () => {
    const c = make();
    assert.equal(c.preflightHeaders("null"), null);
    assert.equal(c.actualHeaders("null"), null);
  });

  it("origine vide → aucun en-tête", () => {
    const c = make();
    assert.equal(c.actualHeaders(""), null);
  });

  it("même avec wildcard, 'null' reçoit '*' (pas de reflet de 'null' avec credentials)", () => {
    // Wildcard SANS credentials (config légale) : "*" est renvoyé (le navigateur
    // n'enverra pas de credentials sous "*"). On vérifie qu'on ne reflète JAMAIS
    // littéralement "null" comme origine de confiance.
    const wc = make({ origins: ["*"], credentials: false });
    assert.equal(
      wc.actualHeaders("null")?.["Access-Control-Allow-Origin"],
      "*",
    );
  });
});
