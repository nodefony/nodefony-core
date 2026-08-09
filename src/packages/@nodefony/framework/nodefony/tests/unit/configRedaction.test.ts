import { describe, it, expect } from "vitest";
import { safeConfig } from "../../src/KernelAdminApi";

/**
 * Ce que cette suite garde : la configuration d'une application traverse
 * PLUSIEURS portes — la console d'administration, `nodefony inspect config`, et
 * désormais le serveur MCP. La redaction ne vit qu'ici, dans le producteur, et
 * c'est ce qui fait qu'aucune porte ne révèle plus que les autres.
 *
 * Le défaut qui a motivé ces tests était réel et mesuré sur une application
 * générée : `security.totp.encryptionKey` et `security.webhooks.encryptionKey`
 * sortaient EN CLAIR, parce que le motif de redaction du data plane et celui
 * des journaux (`pathLooksSecret`) avaient divergé.
 */

/** Lit une clé du résultat, typé pour éviter les `any` dans les assertions. */
function champ(out: unknown, cle: string): unknown {
  return (out as Record<string, unknown>)[cle];
}

describe("safeConfig — ce qui doit être RÉDIGÉ", () => {
  it("🔴 `encryptionKey` — le cas qui fuyait", () => {
    const out = safeConfig({ encryptionKey: "B+rvSlBo1nEunwaBryX0qP45=" });
    expect(champ(out, "encryptionKey")).toBe("[redacted]");
  });

  it("rédige les familles connues de secrets", () => {
    const out = safeConfig({
      secret: "s3cr3t",
      password: "hunter2",
      passphrase: "ouvre-toi",
      clientSecret: "abc",
      privateKey: "-----BEGIN…",
      signingKey: "k",
      accessToken: "t",
      refreshToken: "r",
      keySetJson: "{}",
    });
    for (const cle of [
      "secret",
      "password",
      "passphrase",
      "clientSecret",
      "privateKey",
      "signingKey",
      "accessToken",
      "refreshToken",
      "keySetJson",
    ]) {
      expect(champ(out, cle), cle).toBe("[redacted]");
    }
  });

  it("rédige en profondeur, pas seulement à la racine", () => {
    const out = safeConfig({ totp: { encryptionKey: "zzz", digits: 6 } });
    const totp = champ(out, "totp") as Record<string, unknown>;
    expect(totp.encryptionKey).toBe("[redacted]");
    // Et ne touche pas ce qui l'entoure.
    expect(totp.digits).toBe(6);
  });
});

describe("safeConfig — ce qui ne DOIT PAS l'être", () => {
  it("🔴 `key` est l'identifiant de module de la console — jamais un secret", () => {
    // Le rédiger casserait l'écran de configuration, qui indexe ses entrées
    // dessus. Une règle qui rédige du non-secret finit par être retirée.
    expect(champ(safeConfig({ key: "app" }), "key")).toBe("app");
  });

  it("🔴 un OBJET n'est jamais un secret, même si sa clé en a l'air", () => {
    // `apiKeys` est un bloc de configuration entier (`enabled`, `prefix`…).
    const out = safeConfig({
      apiKeys: { enabled: true, prefix: "nf_", maxPerSubject: 5 },
    });
    const bloc = champ(out, "apiKeys") as Record<string, unknown>;
    expect(bloc.prefix).toBe("nf_");
    expect(bloc.maxPerSubject).toBe(5);
  });

  it("un MODE n'est pas une clé — `privateKeyMode` reste lisible", () => {
    expect(
      champ(safeConfig({ privateKeyMode: "file" }), "privateKeyMode"),
    ).toBe("file");
  });

  it("`residentKey` est une option WebAuthn, pas un secret", () => {
    expect(champ(safeConfig({ residentKey: "preferred" }), "residentKey")).toBe(
      "preferred",
    );
  });

  it("une valeur VIDE ou booléenne reste telle quelle", () => {
    const out = safeConfig({ secret: "", credentials: true });
    expect(champ(out, "secret")).toBe("");
    expect(champ(out, "credentials")).toBe(true);
  });

  it("les durées et compteurs voisins des secrets passent", () => {
    const out = safeConfig({
      tokenStore: { gcIntervalS: 60 },
      passkeys: { timeoutMs: 60000 },
    });
    expect(
      (champ(out, "tokenStore") as Record<string, unknown>).gcIntervalS,
    ).toBe(60);
    expect((champ(out, "passkeys") as Record<string, unknown>).timeoutMs).toBe(
      60000,
    );
  });
});
