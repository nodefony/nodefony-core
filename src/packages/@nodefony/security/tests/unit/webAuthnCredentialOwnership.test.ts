import assert from "node:assert/strict";
import { Container } from "nodefony";
import type { Module } from "nodefony";
import { WebAuthnService } from "../../nodefony/service/webAuthn";
import { MemoryWebAuthnCredentialStore } from "../../nodefony/src/webauthn/MemoryWebAuthnCredentialStore";
import type { IWebAuthnCredential } from "../../nodefony/contracts/IWebAuthnCredential";

/**
 * Anti-IDOR de la gestion self-service des passkeys (P6.17 — suite WebAuthn J9).
 * `removeUserCredential`/`listUserCredentials` sont scopés à l'identité du
 * demandeur (résolue serveur via `authFlow.me`) : **un utilisateur ne peut PAS
 * supprimer ni voir la passkey d'un autre — y compris celle d'un admin**. Côté
 * HTTP, un refus se traduit par un 404 indiscernable (anti-énumération).
 */

function makeKernel(container: Container): { boot: () => void } {
  const cbs: Array<() => void> = [];
  container.set("kernel", {
    container,
    once(ev: string, cb: () => void) {
      if (ev === "onBoot") cbs.push(cb);
    },
    registerStoreResolution() {},
  });
  return { boot: () => cbs.forEach((c) => c()) };
}

function makeModule(
  container: Container,
  options: Record<string, unknown>,
): Module {
  return {
    container,
    notificationsCenter: false,
    options,
  } as unknown as Module;
}

function cred(id: string, userId: string): IWebAuthnCredential {
  return {
    id,
    userId,
    publicKey: "pub",
    signCount: 0,
    transports: ["internal"],
    backupEligible: false,
    backupState: false,
    uvInitialized: true,
    createdAt: 1_700_000_000_000,
    lastUsedAt: null,
  };
}

function setup(): {
  svc: WebAuthnService;
  store: MemoryWebAuthnCredentialStore;
} {
  const container = new Container();
  const { boot } = makeKernel(container);
  const store = new MemoryWebAuthnCredentialStore();
  container.set("webAuthnCredentialStore", store);
  const svc = new WebAuthnService(
    makeModule(container, { passkeys: { enabled: true } }),
  );
  boot();
  return { svc, store };
}

describe("WebAuthnService — anti-IDOR passkeys self-service", () => {
  it("le propriétaire supprime sa propre passkey", async () => {
    const { svc, store } = setup();
    await store.save(cred("cred-admin", "admin"));
    assert.equal(await svc.removeUserCredential("admin", "cred-admin"), true);
    assert.equal(await store.findById("cred-admin"), null);
  });

  it("un autre utilisateur ne peut PAS supprimer la passkey d'un admin", async () => {
    const { svc, store } = setup();
    await store.save(cred("cred-admin", "admin"));
    await store.save(cred("cred-user", "user"));
    // « user » tente de supprimer la passkey de « admin » → refusé.
    assert.equal(await svc.removeUserCredential("user", "cred-admin"), false);
    // La passkey de l'admin est INTACTE (aucun effet de bord).
    assert.notEqual(await store.findById("cred-admin"), null);
    // « user » ne touche que la sienne.
    assert.equal(await svc.removeUserCredential("user", "cred-user"), true);
  });

  it("credential inexistant → false (anti-énumération)", async () => {
    const { svc } = setup();
    assert.equal(await svc.removeUserCredential("user", "ghost"), false);
  });

  it("listUserCredentials est scopé au propriétaire", async () => {
    const { svc, store } = setup();
    await store.save(cred("c1", "admin"));
    await store.save(cred("c2", "admin"));
    await store.save(cred("c3", "user"));
    assert.equal((await svc.listUserCredentials("admin")).length, 2);
    assert.equal((await svc.listUserCredentials("user")).length, 1);
    assert.equal((await svc.listUserCredentials("ghost")).length, 0);
  });
});
