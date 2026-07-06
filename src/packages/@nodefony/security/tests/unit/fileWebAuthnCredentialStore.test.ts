import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FileWebAuthnCredentialStore } from "../../nodefony/src/webauthn/FileWebAuthnCredentialStore";
import { getWebAuthnStoreFactory } from "../../nodefony/src/webauthn/webAuthnCredentialStoreRegistry";
import type { IWebAuthnStoreFactoryContext } from "../../nodefony/src/webauthn/webAuthnCredentialStoreRegistry";
import type { IWebAuthnCredential } from "../../nodefony/contracts/IWebAuthnCredential";

/**
 * Store fichier WebAuthn (J9) — vérifie la PERSISTANCE par-dessus la logique
 * mémoire (déjà couverte par `webAuthnCredentialStore.test.ts`) : un état écrit
 * puis flushé est relu à l'identique par une NOUVELLE instance (= survie au
 * redémarrage serveur), et le boot est robuste (fichier absent/corrompu).
 */

const makeCred = (
  o: Partial<IWebAuthnCredential> = {},
): IWebAuthnCredential => ({
  id: "cred-1",
  userId: "alice",
  publicKey: "cHVibGljLWtleQ",
  signCount: 0,
  transports: ["internal"],
  backupEligible: true,
  backupState: true,
  uvInitialized: true,
  createdAt: 1,
  lastUsedAt: null,
  ...o,
});

describe("FileWebAuthnCredentialStore — persistance", () => {
  let dir: string;
  let file: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "nf-webauthn-"));
    file = join(dir, "creds.json");
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("save + flushNow → une NOUVELLE instance relit le credential (survie restart)", async () => {
    const a = new FileWebAuthnCredentialStore(file);
    await a.save(makeCred({ id: "k1" }));
    await a.flushNow();
    assert.ok(existsSync(file), "le fichier doit être écrit");

    const b = new FileWebAuthnCredentialStore(file); // relit au boot
    assert.equal((await b.findById("k1"))?.id, "k1");
    assert.equal((await b.findByUser("alice")).length, 1);
  });

  it("update (compteur anti-clone) persiste pour la prochaine instance", async () => {
    const a = new FileWebAuthnCredentialStore(file);
    await a.save(makeCred({ id: "k1", signCount: 0 }));
    await a.update("k1", {
      signCount: 9,
      backupState: false,
      uvInitialized: true,
      lastUsedAt: 5,
    });
    await a.flushNow();

    const b = new FileWebAuthnCredentialStore(file);
    assert.equal((await b.findById("k1"))?.signCount, 9);
    assert.equal((await b.findById("k1"))?.backupState, false);
  });

  it("delete persiste (la prochaine instance ne le voit plus)", async () => {
    const a = new FileWebAuthnCredentialStore(file);
    await a.save(makeCred({ id: "k1" }));
    await a.flushNow();
    await a.delete("k1");
    await a.flushNow();

    const b = new FileWebAuthnCredentialStore(file);
    assert.equal(await b.findById("k1"), null);
  });

  it("fichier corrompu au boot → état vide, AUCUN throw, puis réécrit sain", async () => {
    writeFileSync(file, "{ ceci n'est pas du JSON valide");
    const a = new FileWebAuthnCredentialStore(file); // ne doit pas throw
    assert.deepEqual(await a.findByUser("alice"), []);

    await a.save(makeCred({ id: "k1" }));
    await a.flushNow();
    const b = new FileWebAuthnCredentialStore(file);
    assert.equal((await b.findById("k1"))?.id, "k1"); // fichier sain
  });

  it("fichier absent au boot → état vide (pas de crash)", async () => {
    const a = new FileWebAuthnCredentialStore(join(dir, "absent.json"));
    assert.deepEqual(await a.findByUser("bob"), []);
  });

  it("location expose le chemin physique (introspection Studio)", () => {
    const a = new FileWebAuthnCredentialStore(file);
    assert.equal(a.location, file);
  });
});

describe("webAuthnCredentialStoreRegistry — fabrique « file » (résilience boot)", () => {
  const factory = () => getWebAuthnStoreFactory("file")!;

  it("SANS kernel (fabrique appelée hors boot) → repli var/webauthn, JAMAIS de throw", () => {
    // Nodefony.getKernel() est null hors boot → la fabrique NE DOIT PAS crasher
    // (sinon le boot du framework casse) : repli `<cwd>/var/webauthn/credentials.json`.
    const ctx = {
      config: { passkeys: {} },
    } as unknown as IWebAuthnStoreFactoryContext;
    const store = factory()(ctx) as FileWebAuthnCredentialStore;
    assert.ok(
      store.location.endsWith(join("var", "webauthn", "credentials.json")),
    );
  });

  it("passkeys.storePath explicite → respecté (jamais écrasé par le défaut)", () => {
    const custom = join(tmpdir(), "nf-custom-passkeys.json");
    const ctx = {
      config: { passkeys: { storePath: custom } },
    } as unknown as IWebAuthnStoreFactoryContext;
    assert.equal(
      (factory()(ctx) as FileWebAuthnCredentialStore).location,
      custom,
    );
  });
});
