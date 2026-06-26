import assert from "node:assert/strict";
import { MemoryTotpSecretStore } from "../../nodefony/src/totp/MemoryTotpSecretStore";
import {
  deriveTotpKey,
  decryptSecret,
} from "../../nodefony/src/totp/totpCipher";
import { totpCode, base32Decode } from "../../nodefony/src/totp/totpCrypto";
import {
  beginTotpEnrollment,
  confirmTotpEnrollment,
  verifyTotpLogin,
  disableTotp,
  totpStatus,
  type ITotpDeps,
} from "../../nodefony/src/totp/totpOperations";

/**
 * Logique métier TOTP **pure** (store injecté, horloge fixe) — enrôlement,
 * confirmation, login (anti-rejeu + codes de récupération), statut. Aucun kernel
 * ni serveur : c'est l'équivalent du « helper de verdict neutre » de l'idempotence,
 * réutilisé tel quel par `TotpService` (coquille) et le futur banc e2e.
 */

const T0 = 1_700_000_000_000;

function makeDeps(overrides: Partial<ITotpDeps> = {}): ITotpDeps {
  return {
    store: new MemoryTotpSecretStore(),
    key: deriveTotpKey("clé-de-test-totp-operations-0123456789"),
    now: () => T0,
    issuer: "Nodefony",
    algorithm: "SHA1",
    digits: 6,
    period: 30,
    window: 1,
    recoveryCodesCount: 10,
    ...overrides,
  };
}

/** Code TOTP attendu pour un secret base32 à un instant donné (côté « app authenticator »). */
function codeFor(
  secretBase32: string,
  deps: ITotpDeps,
  atMs = deps.now(),
): string {
  return totpCode(base32Decode(secretBase32), {
    epochMs: atMs,
    step: deps.period,
    digits: deps.digits,
    algorithm: deps.algorithm,
  });
}

describe("totpOperations — enrôlement", () => {
  it("beginTotpEnrollment crée un secret pending + URI otpauth, secret chiffré au repos", async () => {
    const deps = makeDeps();
    const enroll = await beginTotpEnrollment(deps, "alice", "alice@ex.com");
    assert.match(enroll.secretBase32, /^[A-Z2-7]+$/);
    assert.match(
      enroll.otpauthUri,
      /^otpauth:\/\/totp\/Nodefony:alice%40ex\.com\?/,
    );
    const stored = await deps.store.findByUser("alice");
    assert.equal(stored?.confirmedAt, null); // pending
    assert.equal(stored?.recoveryCodes.length, 0); // pas encore de codes
    assert.notEqual(stored?.secretEnc, enroll.secretBase32); // chiffré ≠ clair
  });

  it("le secret stocké est le chiffré du secret affiché (jamais en clair)", async () => {
    const deps = makeDeps();
    const enroll = await beginTotpEnrollment(deps, "alice", "a");
    const stored = await deps.store.findByUser("alice");
    const plain = decryptSecret(stored!.secretEnc, deps.key);
    assert.deepEqual(plain, base32Decode(enroll.secretBase32));
  });

  it("re-enrôlement écrase le pending (nouveau secret)", async () => {
    const deps = makeDeps();
    const e1 = await beginTotpEnrollment(deps, "alice", "a");
    const e2 = await beginTotpEnrollment(deps, "alice", "a");
    assert.notEqual(e1.secretBase32, e2.secretBase32);
  });

  it("confirmTotpEnrollment : code valide → active + N codes de récup clairs (hachés au repos)", async () => {
    const deps = makeDeps();
    const enroll = await beginTotpEnrollment(deps, "alice", "a");
    const act = await confirmTotpEnrollment(
      deps,
      "alice",
      codeFor(enroll.secretBase32, deps),
    );
    assert.equal(act.recoveryCodes.length, 10);
    for (const c of act.recoveryCodes)
      assert.match(c, /^[A-Z0-9]{5}-[A-Z0-9]{5}$/);
    const stored = await deps.store.findByUser("alice");
    assert.notEqual(stored?.confirmedAt, null); // confirmé
    assert.equal(stored?.recoveryCodes.length, 10); // hachés
    assert.notEqual(stored?.recoveryCodes[0], act.recoveryCodes[0]); // hash ≠ clair
  });

  it("confirmTotpEnrollment : code invalide → throw, reste pending", async () => {
    const deps = makeDeps();
    await beginTotpEnrollment(deps, "alice", "a");
    await assert.rejects(() => confirmTotpEnrollment(deps, "alice", "000000"));
    assert.equal((await deps.store.findByUser("alice"))?.confirmedAt, null);
  });

  it("confirmTotpEnrollment : sans enrôlement → throw", async () => {
    const deps = makeDeps();
    await assert.rejects(() => confirmTotpEnrollment(deps, "ghost", "123456"));
  });

  it("confirmTotpEnrollment : déjà confirmé → throw (pas de régénération de codes)", async () => {
    const deps = makeDeps();
    const enroll = await beginTotpEnrollment(deps, "alice", "a");
    await confirmTotpEnrollment(
      deps,
      "alice",
      codeFor(enroll.secretBase32, deps),
    );
    await assert.rejects(() =>
      confirmTotpEnrollment(deps, "alice", codeFor(enroll.secretBase32, deps)),
    );
  });
});

describe("totpOperations — vérification login", () => {
  async function enrolled(deps: ITotpDeps, userId = "alice") {
    const enroll = await beginTotpEnrollment(deps, userId, userId);
    const recovery = (
      await confirmTotpEnrollment(
        deps,
        userId,
        codeFor(enroll.secretBase32, deps),
      )
    ).recoveryCodes;
    return { enroll, recovery };
  }

  it("code TOTP valide (pas suivant) → ok method=totp", async () => {
    const deps = makeDeps();
    const { enroll } = await enrolled(deps);
    // La confirmation a consommé le step courant (anti-rejeu) → se connecter au pas suivant.
    const clk = makeDeps({
      store: deps.store,
      key: deps.key,
      now: () => T0 + 30_000,
    });
    const res = await verifyTotpLogin(
      clk,
      "alice",
      codeFor(enroll.secretBase32, clk),
    );
    assert.equal(res.ok, true);
    assert.equal(res.method, "totp");
  });

  it("anti-rejeu : le même code ne passe pas deux fois", async () => {
    const deps = makeDeps();
    const { enroll } = await enrolled(deps);
    const clk = makeDeps({
      store: deps.store,
      key: deps.key,
      now: () => T0 + 30_000,
    });
    const code = codeFor(enroll.secretBase32, clk);
    assert.equal((await verifyTotpLogin(clk, "alice", code)).ok, true);
    assert.equal((await verifyTotpLogin(clk, "alice", code)).ok, false); // rejeu refusé
  });

  it("code faux → ok=false", async () => {
    const deps = makeDeps();
    await enrolled(deps);
    assert.equal((await verifyTotpLogin(deps, "alice", "000000")).ok, false);
  });

  it("pending (non activé) → ok=false même avec un code TOTP correct", async () => {
    const deps = makeDeps();
    await beginTotpEnrollment(deps, "alice", "a");
    const plain = decryptSecret(
      (await deps.store.findByUser("alice"))!.secretEnc,
      deps.key,
    );
    const code = totpCode(plain, {
      epochMs: deps.now(),
      step: deps.period,
      digits: deps.digits,
    });
    assert.equal((await verifyTotpLogin(deps, "alice", code)).ok, false);
  });

  it("utilisateur inconnu → ok=false", async () => {
    const deps = makeDeps();
    assert.equal((await verifyTotpLogin(deps, "ghost", "123456")).ok, false);
  });

  it("code de récupération valide → ok method=recovery, consommé (usage unique)", async () => {
    const deps = makeDeps();
    const { recovery } = await enrolled(deps);
    const r0 = recovery[0] as string;
    const first = await verifyTotpLogin(deps, "alice", r0);
    assert.equal(first.ok, true);
    assert.equal(first.method, "recovery");
    assert.equal((await verifyTotpLogin(deps, "alice", r0)).ok, false); // déjà consommé
    assert.equal((await totpStatus(deps, "alice")).recoveryCodesRemaining, 9);
  });
});

describe("totpOperations — statut / désactivation", () => {
  it("totpStatus : absent / pending / activé", async () => {
    const deps = makeDeps();
    assert.deepEqual(await totpStatus(deps, "ghost"), {
      enabled: false,
      pending: false,
      recoveryCodesRemaining: 0,
    });
    const enroll = await beginTotpEnrollment(deps, "alice", "a");
    const pending = await totpStatus(deps, "alice");
    assert.equal(pending.pending, true);
    assert.equal(pending.enabled, false);
    await confirmTotpEnrollment(
      deps,
      "alice",
      codeFor(enroll.secretBase32, deps),
    );
    const enabled = await totpStatus(deps, "alice");
    assert.equal(enabled.enabled, true);
    assert.equal(enabled.pending, false);
    assert.equal(enabled.recoveryCodesRemaining, 10);
  });

  it("disableTotp retire le secret", async () => {
    const deps = makeDeps();
    const enroll = await beginTotpEnrollment(deps, "alice", "a");
    await confirmTotpEnrollment(
      deps,
      "alice",
      codeFor(enroll.secretBase32, deps),
    );
    await disableTotp(deps, "alice");
    assert.equal(await deps.store.findByUser("alice"), null);
    assert.equal((await totpStatus(deps, "alice")).enabled, false);
  });
});
