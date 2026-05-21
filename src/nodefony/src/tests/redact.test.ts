import { expect } from "chai";
import "mocha";
import { redactSecrets } from "../index";

describe("redactSecrets — masquage défense-en-profondeur", () => {
  it("masque une valeur JSON sensible (password)", () => {
    const out = redactSecrets('{"identifier":"bob","password":"S3cr3t$2b$10"}');
    expect(out).to.contain('"password":"***"');
    expect(out).to.not.contain("S3cr3t");
    // les champs non sensibles restent intacts
    expect(out).to.contain('"identifier":"bob"');
  });

  it("masque token / api_key / secret en JSON", () => {
    const out = redactSecrets(
      '{"token":"abc","api_key":"k-123","client_secret":"cs-9"}',
    );
    expect(out).to.not.contain("abc");
    expect(out).to.not.contain("k-123");
    expect(out).to.not.contain("cs-9");
  });

  it("masque les paires clé=valeur en texte (token=, password=)", () => {
    const out = redactSecrets("login password=hunter2 token=deadbeef other=ok");
    expect(out).to.contain("password=***");
    expect(out).to.contain("token=***");
    expect(out).to.not.contain("hunter2");
    expect(out).to.not.contain("deadbeef");
    expect(out).to.contain("other=ok");
  });

  it("masque le schéma Bearer ET le JWT qui suit (régression du leak)", () => {
    const out = redactSecrets(
      "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.payload.sig",
    );
    expect(out).to.not.contain("eyJhbGci");
    expect(out).to.not.contain("payload.sig");
  });

  it("masque Basic <base64>", () => {
    const out = redactSecrets("auth Basic dXNlcjpwYXNzd29yZA==");
    expect(out).to.not.contain("dXNlcjpwYXNzd29yZA");
    expect(out).to.contain("Basic ***");
  });

  it("masque set-cookie / session_id", () => {
    const out = redactSecrets("set-cookie: session_id=deadbeefcafe; path=/");
    expect(out).to.not.contain("deadbeefcafe");
    expect(out).to.contain("path=/"); // structure préservée
  });

  it("laisse passer une ligne sans secret", () => {
    const line = "12:51 INFO server-http : GET /api/users 200 12ms";
    expect(redactSecrets(line)).to.equal(line);
  });

  it("est idempotent (re-rédiger ne change rien)", () => {
    const once = redactSecrets('{"password":"x"}');
    expect(redactSecrets(once)).to.equal(once);
  });

  it("gère une chaîne vide", () => {
    expect(redactSecrets("")).to.equal("");
  });
});
