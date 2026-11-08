import assert from "node:assert/strict";
import { Container } from "nodefony";
import type { Module } from "nodefony";
import { WebAuthnService } from "../../nodefony/service/webAuthn";
import { MemoryWebAuthnCredentialStore } from "../../nodefony/src/webauthn/MemoryWebAuthnCredentialStore";

/**
 * Un domaine INTERNATIONAL (« café.example ») parle à la lib en punycode.
 *
 * Les navigateurs convertissent l'origine et le RP ID en ASCII (`xn--…`) avant
 * de les confier à l'authenticator ; `@simplewebauthn/server` 14.1 refuse
 * désormais un `expectedRPID` ou un `expectedOrigin` non ASCII. Sans
 * conversion, chaque cérémonie d'une application au domaine accentué échouait
 * en 401 uniforme, la cause avalée par le rattrapage du service.
 *
 * La lib est doublée : on lit ce que le service lui PASSE.
 */

const seenRpId: string[] = [];
const seenOrigin: unknown[] = [];

vi.mock("@simplewebauthn/server", () => ({
  generateRegistrationOptions: (opts: { rpID: string }) => {
    seenRpId.push(opts.rpID);
    return Promise.resolve({ challenge: "chal", rp: { id: opts.rpID } });
  },
  verifyRegistrationResponse: (opts: {
    expectedRPID: string;
    expectedOrigin: unknown;
  }) => {
    seenRpId.push(opts.expectedRPID);
    seenOrigin.push(opts.expectedOrigin);
    return Promise.reject(new Error("doublure"));
  },
}));

const logs: Array<{ msg: string; level: string }> = [];

function buildService(passkeys: Record<string, unknown>): WebAuthnService {
  const container = new Container();
  const handlers: Record<string, () => void> = {};
  container.set("kernel", {
    container,
    environment: "development",
    domain: "café.example",
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
    options: { passkeys: { enabled: true, ...passkeys } },
  } as unknown as Module;
  const svc = new WebAuthnService(module);
  svc.log = ((msg: unknown, level?: string) => {
    logs.push({ msg: String(msg), level: level ?? "INFO" });
  }) as WebAuthnService["log"];
  handlers.onBoot?.();
  return svc;
}

const USER = { id: "u1", name: "alice", handle: "h1" };

describe("WebAuthn — un domaine international parle en punycode à la lib", () => {
  beforeEach(() => {
    seenRpId.length = 0;
    seenOrigin.length = 0;
    logs.length = 0;
  });

  it("🔴 le RP ID dérivé du domaine de l'application est rendu en ASCII", async () => {
    await buildService({}).generateRegistrationOptions(USER);
    assert.equal(seenRpId[0], "xn--caf-dma.example");
  });

  it("🔴 rpId et origines écrits en Unicode dans la config sont convertis", async () => {
    const svc = buildService({
      rpId: "café.example",
      origins: ["https://café.example", "https://app.café.example:8443"],
    });
    await assert.rejects(
      svc.verifyRegistration(
        {} as Parameters<WebAuthnService["verifyRegistration"]>[0],
        "chal",
        "u1",
      ),
    );
    assert.equal(seenRpId[0], "xn--caf-dma.example");
    assert.deepEqual(seenOrigin[0], [
      "https://xn--caf-dma.example",
      "https://app.xn--caf-dma.example:8443",
    ]);
  });

  it("une origine malformée est écartée ET nommée au démarrage — le reste sert", async () => {
    const svc = buildService({
      origins: ["pas une origine", "https://café.example"],
    });
    await assert.rejects(
      svc.verifyRegistration(
        {} as Parameters<WebAuthnService["verifyRegistration"]>[0],
        "chal",
        "u1",
      ),
    );
    assert.deepEqual(seenOrigin[0], ["https://xn--caf-dma.example"]);
    assert.ok(
      logs.some(
        (l) => l.level === "ERROR" && l.msg.includes("pas une origine"),
      ),
      "l'origine écartée doit être nommée en ERROR",
    );
  });
});
