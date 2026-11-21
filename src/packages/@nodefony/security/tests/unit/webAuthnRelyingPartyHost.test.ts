import assert from "node:assert/strict";
import { Container } from "nodefony";
import type { Module } from "nodefony";
import { WebAuthnService } from "../../nodefony/service/webAuthn";
import { MemoryWebAuthnCredentialStore } from "../../nodefony/src/webauthn/MemoryWebAuthnCredentialStore";

/**
 * Le RP ID suit l'hôte de la requête — mais seulement un hôte VALIDÉ par
 * `trustedHosts` (#241).
 *
 * Avant : le RP ID était figé au boot (`passkeys.rpId`, sinon `kernel.domain`).
 * Une application servie sous deux domaines n'avait de passkeys que sur l'un ;
 * sur l'autre, le navigateur refusait la clé et l'application ne voyait qu'un
 * échec d'authentification.
 *
 * Le piège évité : dériver le RP ID du `Host` BRUT. Cet en-tête est écrit par
 * le client ; le suivre sans barrière laisserait n'importe qui obtenir un défi
 * pour le domaine de son choix. La barrière est celle du noyau HTTP
 * (`HttpKernel.isTrustedHostname`), interrogée même quand `domainCheck` est
 * coupé — son défaut.
 *
 * La lib est doublée : on lit le RP ID que le service lui PASSE.
 */

const seenRpId: string[] = [];
const seenOrigin: unknown[] = [];

vi.mock("@simplewebauthn/server", () => ({
  generateRegistrationOptions: (opts: { rpID: string }) => {
    seenRpId.push(opts.rpID);
    return Promise.resolve({ challenge: "chal", rp: { id: opts.rpID } });
  },
  generateAuthenticationOptions: (opts: { rpID: string }) => {
    seenRpId.push(opts.rpID);
    return Promise.resolve({ challenge: "chal", rpId: opts.rpID });
  },
  verifyAuthenticationResponse: (opts: {
    expectedRPID: string;
    expectedOrigin: unknown;
  }) => {
    seenRpId.push(opts.expectedRPID);
    seenOrigin.push(opts.expectedOrigin);
    return Promise.reject(new Error("doublure"));
  },
}));

/** Barrière d'hôtes doublée : la liste `trustedHosts` d'une app multi-domaine. */
function barrier(trusted: readonly string[]) {
  return {
    isTrustedHostname: (hostname: string) =>
      hostname === "app.example" || trusted.includes(hostname),
  };
}

function buildService(
  options: {
    passkeys?: Record<string, unknown>;
    trusted?: readonly string[] | null;
  } = {},
): WebAuthnService {
  const container = new Container();
  const handlers: Record<string, () => void> = {};
  container.set("kernel", {
    container,
    environment: "development",
    domain: "app.example",
    infra: {},
    once(ev: string, cb: () => void) {
      handlers[ev] = cb;
    },
    registerStoreResolution() {
      /* introspection Studio — hors sujet ici */
    },
  });
  if (options.trusted !== null) {
    container.set("HttpKernel", barrier(options.trusted ?? []));
  }
  const store = new MemoryWebAuthnCredentialStore();
  void store.save({
    id: "cred-1",
    userId: "alice",
    publicKey: "AA",
    signCount: 0,
    transports: [],
    backupEligible: false,
    backupState: false,
    uvInitialized: true,
    createdAt: 0,
    lastUsedAt: null,
  });
  container.set("webAuthnCredentialStore", store);
  const module = {
    container,
    notificationsCenter: false,
    options: { passkeys: { enabled: true, ...options.passkeys } },
  } as unknown as Module;
  const svc = new WebAuthnService(module);
  svc.log = (() => undefined) as WebAuthnService["log"];
  handlers.onBoot?.();
  return svc;
}

const USER = { id: "alice", name: "alice", handle: "h1" };

describe("WebAuthn — RP ID dérivé de l'hôte VALIDÉ (#241)", () => {
  beforeEach(() => {
    seenRpId.length = 0;
    seenOrigin.length = 0;
  });

  describe("un seul domaine : comportement inchangé", () => {
    it("sans hôte, le RP ID est celui du boot", async () => {
      await buildService().generateRegistrationOptions(USER);
      assert.equal(seenRpId[0], "app.example");
    });

    it("l'hôte égal au domaine de l'application garde ce RP ID", async () => {
      await buildService().generateAuthenticationOptions(
        undefined,
        "app.example",
      );
      assert.equal(seenRpId[0], "app.example");
    });

    it("un sous-domaine garde le RP ID parent — les passkeys enrôlées y restent valables", async () => {
      await buildService().generateAuthenticationOptions(
        undefined,
        "www.app.example",
      );
      assert.equal(seenRpId[0], "app.example");
    });

    it("une adresse IP garde le RP ID du boot (le navigateur refuse une IP)", async () => {
      await buildService().generateAuthenticationOptions(
        undefined,
        "127.0.0.1",
      );
      assert.equal(seenRpId[0], "app.example");
    });

    it("un `passkeys.rpId` écrit en config sert de base", async () => {
      const svc = buildService({ passkeys: { rpId: "example" } });
      await svc.generateAuthenticationOptions(undefined, "app.example");
      assert.equal(seenRpId[0], "example");
    });
  });

  describe("plusieurs domaines", () => {
    it("🔴 un hôte DÉCLARÉ dans trustedHosts obtient son propre RP ID", async () => {
      const svc = buildService({ trusted: ["other.example"] });
      await svc.generateRegistrationOptions(USER, "other.example");
      await svc.generateAuthenticationOptions(undefined, "other.example");
      assert.deepEqual(seenRpId, ["other.example", "other.example"]);
    });

    it("🔴 l'assertion est vérifiée contre le RP ID ET l'origine de cet hôte", async () => {
      const svc = buildService({ trusted: ["other.example"] });
      await assert.rejects(
        svc.verifyAuthentication(
          { id: "cred-1" } as Parameters<
            WebAuthnService["verifyAuthentication"]
          >[0],
          "chal",
          "https://other.example:8443",
          "other.example",
        ),
      );
      assert.equal(seenRpId[0], "other.example");
      assert.equal(seenOrigin[0], "https://other.example:8443");
    });

    it("un domaine international déclaré est rendu en punycode", async () => {
      const svc = buildService({ trusted: ["café.example"] });
      await svc.generateAuthenticationOptions(undefined, "café.example");
      assert.equal(seenRpId[0], "xn--caf-dma.example");
    });
  });

  describe("🔴 un Host étranger n'obtient AUCUN RP ID", () => {
    it("Host forgé hors trustedHosts → 421, la lib n'est jamais appelée", async () => {
      const svc = buildService({ trusted: ["other.example"] });
      await assert.rejects(
        svc.generateAuthenticationOptions(undefined, "evil.example"),
        (e: { code?: unknown }) => e.code === 421,
      );
      await assert.rejects(
        svc.generateRegistrationOptions(USER, "evil.example"),
        (e: { code?: unknown }) => e.code === 421,
      );
      assert.deepEqual(seenRpId, [], "aucun défi émis pour evil.example");
    });

    it("Host forgé à la vérification → 421, aucune vérification tentée", async () => {
      const svc = buildService({ trusted: ["other.example"] });
      await assert.rejects(
        svc.verifyAuthentication(
          { id: "cred-1" } as Parameters<
            WebAuthnService["verifyAuthentication"]
          >[0],
          "chal",
          "https://evil.example",
          "evil.example",
        ),
        (e: { code?: unknown }) => e.code === 421,
      );
      assert.deepEqual(seenRpId, []);
    });

    it("un suffixe trompeur (`evilapp.example`) n'est pas un sous-domaine", async () => {
      await assert.rejects(
        buildService().generateAuthenticationOptions(
          undefined,
          "evilapp.example",
        ),
        (e: { code?: unknown }) => e.code === 421,
      );
    });

    it("sans barrière joignable (pas de noyau HTTP) → refus, jamais l'hôte brut", async () => {
      await assert.rejects(
        buildService({ trusted: null }).generateAuthenticationOptions(
          undefined,
          "other.example",
        ),
        (e: { code?: unknown }) => e.code === 421,
      );
    });
  });
});
