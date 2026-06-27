import assert from "node:assert/strict";
import {
  validateProfilePatch,
  projectProfile,
  mergeProfileIntoMetadata,
  profileFromClaims,
} from "../../nodefony/src/userProfile";

/**
 * Logique pure du profil utilisateur (claims OIDC dans `metadata.profile`). Trois
 * garanties : validation (rejet du mal-formé), projection par allowlist (aucune
 * autre clé de `metadata` ne fuit dans le DTO), fusion non destructive (les autres
 * clés de `metadata` sont préservées, les champs vidés retirés).
 */

describe("validateProfilePatch", () => {
  it("normalise (trim) un patch valide", () => {
    const r = validateProfilePatch({
      givenName: "  Chris  ",
      familyName: "Camensuli",
      email: "chris@example.com",
      locale: "fr-FR",
      picture: "https://cdn.example.com/a.png",
    });
    assert.ok(r.ok);
    assert.deepEqual(r.value, {
      givenName: "Chris",
      familyName: "Camensuli",
      email: "chris@example.com",
      locale: "fr-FR",
      picture: "https://cdn.example.com/a.png",
    });
  });

  it("ALLOWLIST : ignore les clés inconnues (anti-injection metadata)", () => {
    const r = validateProfilePatch({
      givenName: "Jean",
      isAdmin: true, // tentative d'injection d'une clé metadata arbitraire
      role: "ROLE_NODEFONY_ADMIN",
      password: "x",
    });
    assert.ok(r.ok);
    assert.deepEqual(r.value, { givenName: "Jean" });
  });

  it("chaîne vide ou null = effacement du champ", () => {
    const r = validateProfilePatch({ givenName: "  ", displayName: null });
    assert.ok(r.ok);
    assert.deepEqual(r.value, { givenName: "", displayName: "" });
  });

  it("rejette une valeur non-string", () => {
    const r = validateProfilePatch({ givenName: 42 });
    assert.ok(!r.ok);
    assert.match(r.error, /givenName/);
  });

  it("rejette un email mal formé", () => {
    const r = validateProfilePatch({ email: "not-an-email" });
    assert.ok(!r.ok);
    assert.match(r.error, /email/);
  });

  it("rejette une locale non BCP 47", () => {
    const r = validateProfilePatch({ locale: "français!" });
    assert.ok(!r.ok);
    assert.match(r.error, /locale/);
  });

  it("rejette une URL d'avatar non http(s)", () => {
    const r = validateProfilePatch({ picture: "javascript:alert(1)" });
    assert.ok(!r.ok);
    assert.match(r.error, /picture/);
  });

  it("accepte un avatar data URL raster (webp/png/jpeg)", () => {
    const webp = "data:image/webp;base64,UklGRhoAAABXRUJQ";
    const r = validateProfilePatch({ picture: webp });
    assert.ok(r.ok);
    assert.equal(r.value.picture, webp);
  });

  it("accepte toujours une URL http(s)", () => {
    const r = validateProfilePatch({
      picture: "https://cdn.example.com/a.png",
    });
    assert.ok(r.ok);
  });

  it("REJETTE un data URL SVG (XSS embarqué)", () => {
    const r = validateProfilePatch({
      picture: "data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=",
    });
    assert.ok(!r.ok);
    assert.match(r.error, /svg|png\/jpeg\/webp/i);
  });

  it("rejette un data URL malformé (base64 impur)", () => {
    const r = validateProfilePatch({
      picture: "data:image/png;base64,<script>",
    });
    assert.ok(!r.ok);
  });

  it("rejette un avatar data URL trop lourd (> 128KB)", () => {
    const huge = "data:image/webp;base64," + "A".repeat(130 * 1024);
    const r = validateProfilePatch({ picture: huge });
    assert.ok(!r.ok);
    assert.match(r.error, /too large/);
  });

  it("rejette un champ trop long", () => {
    const r = validateProfilePatch({ givenName: "a".repeat(101) });
    assert.ok(!r.ok);
    assert.match(r.error, /too long/);
  });

  it("rejette un input non-objet", () => {
    assert.ok(!validateProfilePatch("x").ok);
    assert.ok(!validateProfilePatch(null).ok);
    assert.ok(!validateProfilePatch(["a"]).ok);
  });
});

describe("projectProfile", () => {
  it("extrait UNIQUEMENT les claims connus (allowlist)", () => {
    const profile = projectProfile({
      profile: {
        givenName: "Chris",
        familyName: "Camensuli",
        secretToken: "should-not-leak", // clé hors allowlist
      },
      apiKey: "also-secret", // autre clé metadata
    });
    assert.deepEqual(profile, {
      givenName: "Chris",
      familyName: "Camensuli",
    });
  });

  it("ignore les valeurs non-string et vides", () => {
    const profile = projectProfile({
      profile: { givenName: "", familyName: 7, email: "a@b.co" },
    });
    assert.deepEqual(profile, { email: "a@b.co" });
  });

  it("metadata sans profile / nulle → objet vide", () => {
    assert.deepEqual(projectProfile({}), {});
    assert.deepEqual(projectProfile(null), {});
    assert.deepEqual(projectProfile({ profile: "x" }), {});
  });
});

describe("mergeProfileIntoMetadata", () => {
  it("préserve les autres clés de metadata", () => {
    const meta = mergeProfileIntoMetadata(
      { theme: "dark", profile: { givenName: "Chris" } },
      { familyName: "Camensuli" },
    );
    assert.equal(meta.theme, "dark");
    assert.deepEqual(meta.profile, {
      givenName: "Chris",
      familyName: "Camensuli",
    });
  });

  it("retire les champs vidés (pas de clé fantôme)", () => {
    const meta = mergeProfileIntoMetadata(
      { profile: { givenName: "Chris", displayName: "Chris C" } },
      { displayName: "" },
    );
    assert.deepEqual(meta.profile, { givenName: "Chris" });
  });

  it("part d'une metadata absente sans planter", () => {
    const meta = mergeProfileIntoMetadata(undefined, { givenName: "Jean" });
    assert.deepEqual(meta, { profile: { givenName: "Jean" } });
  });
});

describe("profileFromClaims (pré-remplissage OAuth)", () => {
  it("mappe les claims OIDC standard (Google-like)", () => {
    const p = profileFromClaims({
      given_name: "Chris",
      family_name: "Camensuli",
      name: "Chris Camensuli",
      email: "chris@example.com",
      picture: "https://lh3.googleusercontent.com/a/x",
      locale: "fr",
    });
    assert.deepEqual(p, {
      givenName: "Chris",
      familyName: "Camensuli",
      displayName: "Chris Camensuli",
      email: "chris@example.com",
      picture: "https://lh3.googleusercontent.com/a/x",
      locale: "fr",
    });
  });

  it("mappe avatar_url (GitHub) vers picture, name vers displayName", () => {
    const p = profileFromClaims({
      name: "Octocat",
      avatar_url: "https://avatars.githubusercontent.com/u/1",
    });
    assert.equal(p.picture, "https://avatars.githubusercontent.com/u/1");
    assert.equal(p.displayName, "Octocat");
  });

  it("ignore un claim invalide SANS jeter les autres (best-effort)", () => {
    const p = profileFromClaims({
      given_name: "Chris",
      picture: "javascript:alert(1)", // invalide → ignoré
    });
    assert.equal(p.givenName, "Chris");
    assert.ok(!("picture" in p));
  });

  it("claims vides / non-string → profil vide", () => {
    assert.deepEqual(profileFromClaims({}), {});
    assert.deepEqual(profileFromClaims({ given_name: 42, email: null }), {});
  });
});
