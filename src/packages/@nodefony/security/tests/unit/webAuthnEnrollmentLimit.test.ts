import assert from "node:assert/strict";
import { Container } from "nodefony";
import type { Module } from "nodefony";
import { WebAuthnService } from "../../nodefony/service/webAuthn";
import { WebAuthnError } from "../../nodefony/errors/WebAuthnError";
import { MemoryWebAuthnCredentialStore } from "../../nodefony/src/webauthn/MemoryWebAuthnCredentialStore";
import type { IWebAuthnCredential } from "../../nodefony/contracts/IWebAuthnCredential";

/**
 * Plafond d'enrôlement des passkeys (`passkeys.maxPerUser`) — la borne qui rend
 * `findByUser` sûr.
 *
 * **Pourquoi ce banc existe** : `findByUser` est volontairement NON paginé
 * (`allowCredentials` doit être complet ou le login casse, cf le contrat). Ce
 * qui empêche cette liste de grossir sans fin n'est donc PAS une pagination,
 * c'est ce plafond. Sans lui, un compte enrôle en masse, puis n'importe quel
 * anonyme poste son identifiant sur `login/options` et force le serveur à lire
 * puis sérialiser N credentials — amplification asymétrique.
 *
 * La lib `@simplewebauthn/server` est doublée : on teste la POLITIQUE du
 * service (compter, refuser, libérer), pas la cryptographie de la lib.
 */

/** Réponses d'attestation successives — un id neuf par cérémonie. */
let credentialSeq = 0;

vi.mock("@simplewebauthn/server", () => ({
  generateRegistrationOptions: () =>
    Promise.resolve({ challenge: "chal", rp: { id: "localhost" } }),
  verifyRegistrationResponse: () =>
    Promise.resolve({
      verified: true,
      registrationInfo: {
        credential: {
          id: `cred-${++credentialSeq}`,
          publicKey: new Uint8Array([1, 2, 3]),
          counter: 0,
          transports: ["internal"],
        },
        credentialDeviceType: "singleDevice",
        credentialBackedUp: false,
        userVerified: true,
      },
    }),
  generateAuthenticationOptions: () => Promise.resolve({ challenge: "chal" }),
  verifyAuthenticationResponse: () => Promise.resolve({ verified: false }),
}));

/**
 * Store espion — même comportement que le builtin mémoire, mais il compte les
 * appels. Sert à prouver que le plafond passe par `countByUser` (natif) et ne
 * charge JAMAIS les credentials via `findByUser`.
 */
class SpyStore extends MemoryWebAuthnCredentialStore {
  findByUserCalls = 0;
  countByUserCalls = 0;

  findByUser(userId: string): Promise<IWebAuthnCredential[]> {
    this.findByUserCalls++;
    return super.findByUser(userId);
  }

  countByUser(userId: string): Promise<number> {
    this.countByUserCalls++;
    return super.countByUser(userId);
  }
}

function buildService(passkeys: Record<string, unknown>): {
  svc: WebAuthnService;
  store: SpyStore;
} {
  const container = new Container();
  const handlers: Record<string, () => void> = {};
  const store = new SpyStore();
  const kernel = {
    container,
    environment: "development",
    infra: {},
    once(ev: string, cb: () => void) {
      handlers[ev] = cb;
    },
    registerStoreResolution() {
      /* introspection Studio — hors sujet ici */
    },
  };
  container.set("kernel", kernel);
  // Store posé AVANT le boot → branche « adapter au container » (pas de registre).
  container.set("webAuthnCredentialStore", store);
  const module = {
    container,
    notificationsCenter: false,
    options: { passkeys },
  } as unknown as Module;
  const svc = new WebAuthnService(module);
  handlers.onBoot?.();
  return { svc, store };
}

/** Enrôle un passkey de plus (la cérémonie est doublée → toujours vérifiée). */
function enroll(
  svc: WebAuthnService,
  userId: string,
): Promise<IWebAuthnCredential> {
  return svc.verifyRegistration(
    {} as Parameters<WebAuthnService["verifyRegistration"]>[0],
    "chal",
    userId,
  );
}

describe("WebAuthn — plafond d'enrôlement (passkeys.maxPerUser)", () => {
  it("enrôle jusqu'au plafond, puis REFUSE en 409", async () => {
    const { svc } = buildService({ enabled: true, maxPerUser: 3 });
    for (let i = 0; i < 3; i++) {
      await enroll(svc, "alice");
    }
    assert.equal((await svc.listUserCredentials("alice")).length, 3);
    await assert.rejects(
      () => enroll(svc, "alice"),
      (e: unknown) => e instanceof WebAuthnError && e.code === 409,
    );
    // Le refus n'a rien persisté : le plafond est une borne, pas un compteur qui dérive.
    assert.equal((await svc.listUserCredentials("alice")).length, 3);
  });

  it("le refus TIENT au-delà du seuil (10 tentatives sur un plafond de 3)", async () => {
    // Un seuil sans test qui le DÉPASSE laisse la branche au-delà inexécutée :
    // ici on insiste bien après le plafond, la borne ne doit jamais céder.
    const { svc } = buildService({ enabled: true, maxPerUser: 3 });
    for (let i = 0; i < 3; i++) {
      await enroll(svc, "alice");
    }
    for (let i = 0; i < 10; i++) {
      await assert.rejects(
        () => enroll(svc, "alice"),
        (e: unknown) => e instanceof WebAuthnError && e.code === 409,
      );
    }
    assert.equal((await svc.listUserCredentials("alice")).length, 3);
  });

  it("le plafond est PAR UTILISATEUR — alice saturée n'empêche pas bob", async () => {
    const { svc } = buildService({ enabled: true, maxPerUser: 2 });
    await enroll(svc, "alice");
    await enroll(svc, "alice");
    await assert.rejects(
      () => enroll(svc, "alice"),
      (e: unknown) => e instanceof WebAuthnError && e.code === 409,
    );
    await enroll(svc, "bob");
    assert.equal((await svc.listUserCredentials("bob")).length, 1);
  });

  it("retirer un appareil LIBÈRE une place", async () => {
    const { svc } = buildService({ enabled: true, maxPerUser: 2 });
    const first = await enroll(svc, "alice");
    await enroll(svc, "alice");
    await assert.rejects(
      () => enroll(svc, "alice"),
      (e: unknown) => e instanceof WebAuthnError && e.code === 409,
    );
    await svc.removeCredential(first.id);
    const replacement = await enroll(svc, "alice");
    assert.equal((await svc.listUserCredentials("alice")).length, 2);
    assert.notEqual(replacement.id, first.id);
  });

  it("le plafond compte NATIVEMENT — jamais un findByUser().length", async () => {
    const { svc, store } = buildService({
      enabled: true,
      maxPerUser: 2,
    });
    await enroll(svc, "alice");
    await enroll(svc, "alice");
    await assert.rejects(
      () => enroll(svc, "alice"),
      (e: unknown) => e instanceof WebAuthnError && e.code === 409,
    );
    // 3 cérémonies d'enregistrement = 3 comptages, 0 chargement de credentials.
    assert.equal(store.countByUserCalls, 3);
    assert.equal(store.findByUserCalls, 0);
  });

  it("valeur par défaut = 20 (large pour un humain, borné pour un abuseur)", async () => {
    const { svc } = buildService({ enabled: true });
    for (let i = 0; i < 20; i++) {
      await enroll(svc, "alice");
    }
    await assert.rejects(
      () => enroll(svc, "alice"),
      (e: unknown) => e instanceof WebAuthnError && e.code === 409,
    );
  });
});
