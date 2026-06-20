import assert from "node:assert/strict";
import {
  Csrf,
  type ICsrfOptions,
  type ICsrfRequest,
} from "../../nodefony/service/csrf";
import { CsrfError } from "../../nodefony/errors/CsrfError";
import { CsrfTokenManager } from "../../nodefony/src/csrfToken";

/**
 * Matrice d'ATTAQUE (red-team) CSRF — dérivée de la MENACE (OWASP CSRF Prevention
 * Cheat Sheet), pas de l'implémentation. Complète `csrf.test.ts` (matrice
 * fonctionnelle) par les vecteurs adverses canoniques :
 *
 *   1. Origin/Referer spoofing du repli — le piège #1 : un attaquant forge une
 *      origine qui « ressemble » à l'hôte cible. Une vérification naïve
 *      (`origin.includes(host)`, `endsWith`, regex) tombe ; le match d'hôte EXACT
 *      via parsing WHATWG URL doit toutes les bloquer (403).
 *   2. Limite documentée — le repli est HOST-only (OWASP « Verifying Origin ») :
 *      le scheme n'est pas comparé (l'hôte cible n'en porte pas). On le DOCUMENTE
 *      honnêtement (http même-hôte → autorisé) ; la défense primaire Fetch Metadata
 *      + HSTS couvre le downgrade.
 *   3. Token synchronizer malformé — double-submit signé HMAC : un token tronqué,
 *      vide, multi-points ou recomposé (splicing) ne doit JAMAIS valider.
 *
 * Hypothèses de parsing vérifiées sur le runtime (node URL) avant écriture :
 * `URL("https://app.example.com@evil.com").host === "evil.com"` (userinfo),
 * `URL("https://app.example.com.evil.com").host === "app.example.com.evil.com"`.
 */

const DEFAULTS: ICsrfOptions = {
  enabled: true,
  fetchMetadata: true,
  checkOrigin: true,
  strictSameSite: false,
};

const TARGET_HOST = "app.example.com";

const make = (
  o: ICsrfOptions = DEFAULTS,
  origins: readonly string[] = [],
): Csrf => new Csrf(o, origins);

// Requête state-changing SANS Fetch Metadata → force le chemin REPLI Origin/Referer
// (là où vit la comparaison d'hôte, surface du spoofing).
const fallbackReq = (p: Partial<ICsrfRequest> = {}): ICsrfRequest => ({
  method: "POST",
  secFetchSite: undefined,
  origin: undefined,
  referer: undefined,
  host: TARGET_HOST,
  ...p,
});

const blocked = (c: Csrf, r: ICsrfRequest) =>
  assert.throws(() => c.enforce(r), CsrfError);
const ok = (c: Csrf, r: ICsrfRequest) =>
  assert.doesNotThrow(() => c.enforce(r));

describe("CSRF red-team — Origin spoofing du repli (host EXACT, jamais sous-chaîne)", () => {
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
    [
      "userinfo confusion — app.example.com@evil.com",
      "https://app.example.com@evil.com",
    ],
    ["port différent — app.example.com:8443", "https://app.example.com:8443"],
  ];

  for (const [label, origin] of spoofs) {
    it(`Origin ${label} → BLOQUÉ (403)`, () => {
      blocked(c, fallbackReq({ origin }));
    });
  }

  it("même spoof via Referer (Origin absent) — userinfo → BLOQUÉ", () => {
    blocked(
      c,
      fallbackReq({ referer: "https://app.example.com@evil.com/form" }),
    );
  });

  it("même spoof via Referer — suffixe → BLOQUÉ", () => {
    blocked(
      c,
      fallbackReq({ referer: "https://app.example.com.evil.com/form" }),
    );
  });

  // Contrôles POSITIFS : sans eux, « tout bloquer » serait trivialement vert.
  it("contrôle : Origin EXACT (host cible) → autorisé", () => {
    ok(c, fallbackReq({ origin: `https://${TARGET_HOST}` }));
  });

  it("contrôle : port qui CORRESPOND (host:port cible) → autorisé", () => {
    ok(
      c,
      fallbackReq({
        origin: "https://app.example.com:5152",
        host: "app.example.com:5152",
      }),
    );
  });
});

describe("CSRF red-team — limite documentée : repli HOST-only (scheme non comparé)", () => {
  // OWASP « Verifying Origin » : le repli compare l'HÔTE, pas le scheme (l'hôte
  // cible n'en porte pas). Un Origin http vers un hôte cible identique PASSE le
  // repli — couvert en amont par Fetch Metadata (primaire) + HSTS (transport).
  // Test de DOCUMENTATION : s'il vire au rouge un jour, c'est que le repli a été
  // durci pour exiger le scheme (changement intentionnel à acter).
  it("Origin http:// même hôte → autorisé par le repli (limite host-only)", () => {
    ok(make(), fallbackReq({ origin: `http://${TARGET_HOST}` }));
  });
});

describe("CSRF red-team — robustesse parsing du repli (provenance illisible)", () => {
  // Passe 2 (white-box) : couvre le catch de `#originFromReferer`. Documente une
  // ASYMÉTRIE Origin/Referer assumée :
  //  - Origin PRÉSENT mais illisible → BLOQUÉ (fail-closed : une provenance posée
  //    qu'on ne sait pas valider est suspecte).
  //  - Referer illisible (Origin absent) → AUTORISÉ : le Referer est un fallback
  //    moins fiable (tronqué par Referrer-Policy) ; illisible ≡ absent ≡ « pas de
  //    provenance » = client non-navigateur, hors vecteur CSRF. NON exploitable
  //    par un navigateur victime (qui ne sérialise jamais un Referer illisible) ;
  //    une vraie attaque CSRF cross-site POSE toujours Origin (→ chemin bloquant).
  const c = make();
  it("Origin présent illisible → BLOQUÉ", () => {
    blocked(c, fallbackReq({ origin: "::::garbage" }));
  });
  it("Referer illisible (Origin absent) → autorisé (≡ absence de provenance)", () => {
    ok(c, fallbackReq({ referer: "::::garbage" }));
  });
});

describe("CSRF red-team — token synchronizer malformé (double-submit signé HMAC)", () => {
  const mgr = new CsrfTokenManager("redteam-secret-please-rotate-32bytes");

  // Tous ces tokens passent le double-submit (header === cookie) mais doivent
  // échouer la validation (forme/signature) → false. On exige `verify(x,x)===false`.
  const malformed: Array<[string, string]> = [
    ["chaîne vide", ""],
    ["séparateur seul '.'", "."],
    ["point en tête '.sig'", ".AAAAAAAAAAAAAAAAAAAA"],
    ["point en fin 'nonce.'", "bm9uY2U."],
    ["multi-points forgé 'a.b.c'", "a.b.c"],
    ["espace injecté dans le nonce", "non ce.AAAAAAAAAAAAAAAAAAAA"],
  ];

  for (const [label, tok] of malformed) {
    it(`${label} → rejeté`, () => {
      assert.equal(mgr.verify(tok, tok), false);
    });
  }

  it("chaîne vide en header OU en cookie (un seul) → rejeté", () => {
    const t = mgr.issue();
    assert.equal(mgr.verify("", t), false);
    assert.equal(mgr.verify(t, ""), false);
  });

  it("splicing : nonce d'un token + signature d'un AUTRE (deux vrais tokens) → rejeté", () => {
    const a = mgr.issue();
    const b = mgr.issue();
    const spliced = `${a.split(".")[0]}.${b.split(".")[1]}`;
    assert.equal(mgr.verify(spliced, spliced), false);
  });

  it("robustesse : longueurs différentes (header préfixe du cookie) → false sans throw", () => {
    const t = mgr.issue();
    assert.equal(mgr.verify(t.slice(0, -1), t), false);
  });

  it("contrôle : token légitime rejoué à l'identique → accepté", () => {
    const t = mgr.issue();
    assert.equal(mgr.verify(t, t), true);
  });
});
