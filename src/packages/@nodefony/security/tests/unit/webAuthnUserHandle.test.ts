import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { Container } from "nodefony";
import type { Module } from "nodefony";
import {
  WebAuthnService,
  userHandleBytes,
} from "../../nodefony/service/webAuthn";
import { MemoryWebAuthnCredentialStore } from "../../nodefony/src/webauthn/MemoryWebAuthnCredentialStore";

/**
 * Le `userHandle` d'une passkey ne porte AUCUNE donnée personnelle (#589).
 *
 * WebAuthn L3 (§4, « User Handle ») : « an opaque byte sequence with a maximum
 * size of 64 bytes […] It MUST NOT contain personally identifying
 * information ». Le handle est stocké DANS l'authenticator et peut en sortir ;
 * il valait l'identifiant de connexion, souvent un email.
 *
 * La lib `@simplewebauthn/server` est doublée : on lit ce que le service lui
 * PASSE, pas sa cryptographie.
 */

const seen: Array<{ userID: Uint8Array; userName: string }> = [];

vi.mock("@simplewebauthn/server", () => ({
  generateRegistrationOptions: (opts: {
    userID: Uint8Array;
    userName: string;
  }) => {
    seen.push({ userID: opts.userID, userName: opts.userName });
    return Promise.resolve({ challenge: "chal", rp: { id: "localhost" } });
  },
}));

function buildService(): WebAuthnService {
  const container = new Container();
  const handlers: Record<string, () => void> = {};
  container.set("kernel", {
    container,
    environment: "development",
    infra: {},
    once(ev: string, cb: () => void) {
      handlers[ev] = cb;
    },
    registerStoreResolution() {
      /* introspection Studio — hors sujet ici */
    },
  });
  container.set("webAuthnCredentialStore", new MemoryWebAuthnCredentialStore());
  const module = {
    container,
    notificationsCenter: false,
    options: { passkeys: { enabled: true } },
  } as unknown as Module;
  const svc = new WebAuthnService(module);
  handlers.onBoot?.();
  return svc;
}

const EMAIL = "alice@example.com";
const UUID = "d6a28d1d-607c-4c76-9ac0-9f35a899f358";

describe("WebAuthn — userHandle sans donnée personnelle (WebAuthn L3 §4)", () => {
  beforeEach(() => {
    seen.length = 0;
  });

  it("🔴 le handle est l'UUID du compte, JAMAIS l'identifiant de connexion", async () => {
    await buildService().generateRegistrationOptions({
      id: EMAIL,
      name: EMAIL,
      handle: UUID,
    });
    const handle = Buffer.from(seen[0]!.userID).toString("utf8");
    assert.equal(handle, UUID);
    assert.ok(
      !handle.includes(EMAIL),
      "l'email ne doit pas entrer dans le handle",
    );
    // Le NOM affiché par l'OS reste l'identifiant : c'est lui que la personne reconnaît.
    assert.equal(seen[0]!.userName, EMAIL);
  });

  it("🔴 sans handle fourni : condensat SHA-256 de l'id, jamais l'id en clair", async () => {
    await buildService().generateRegistrationOptions({
      id: EMAIL,
      name: EMAIL,
    });
    const bytes = Buffer.from(seen[0]!.userID);
    assert.ok(!bytes.toString("utf8").includes(EMAIL));
    assert.deepEqual(bytes, createHash("sha256").update(EMAIL).digest());
  });

  it("borne de 64 octets : un handle trop long retombe sur le condensat (32 octets)", () => {
    const bytes = userHandleBytes({
      id: EMAIL,
      name: EMAIL,
      handle: "x".repeat(65),
    });
    assert.equal(bytes.length, 32);
    assert.ok(
      userHandleBytes({ id: EMAIL, name: EMAIL, handle: "x".repeat(64) })
        .length === 64,
    );
  });

  it("stable : le même compte rend le même handle (une passkey découvrable par compte)", () => {
    // La spec veut le même handle pour toutes les passkeys d'un compte : sans
    // cela, un authenticator en garderait plusieurs au lieu de remplacer.
    const a = userHandleBytes({ id: EMAIL, name: EMAIL });
    const b = userHandleBytes({ id: EMAIL, name: EMAIL });
    assert.deepEqual(Buffer.from(a), Buffer.from(b));
  });
});
