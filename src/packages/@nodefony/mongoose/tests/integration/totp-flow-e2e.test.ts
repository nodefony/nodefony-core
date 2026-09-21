import assert from "node:assert/strict";
import { entityRegistry, ormRegistry } from "@nodefony/orm-core";
// Le VRAI flux 2FA (ops pures du service) branché sur le store mongoose : prouve
// que l'adapter tient l'enrôlement → confirmation → login anti-rejeu → codes de
// récupération → désactivation, PAS seulement le CRUD isolé. Composition testable
// hébergée côté mongoose (security ne peut pas importer l'ORM — sens du graphe).
// Jumeau strict de `drizzle/tests/integration/totp-flow-e2e.test.ts` : c'est la
// comparabilité des deux bancs qui fait la parité, pas la ressemblance des stores.
import {
  beginTotpEnrollment,
  confirmTotpEnrollment,
  verifyTotpLogin,
  disableTotp,
  totpStatus,
  totpCode,
  base32Decode,
  deriveTotpKey,
  type ITotpDeps,
} from "@nodefony/security";
import { mongoTestUri } from "../helpers/mongoTestUri";
import { MongooseOrm } from "../../nodefony/src/orm-core/index";
import { MongooseTotpSecretStore } from "../../nodefony/src/MongooseTotpSecretStore";
import {
  registerTotpSecretEntity,
  TOTP_SECRET_ENTITY,
} from "../../nodefony/entity/totpSecretEntity";

const ORM = "totp_flow_test";
const URI = mongoTestUri(ORM);
const T0 = 1_700_000_000_000;

/** Code TOTP attendu pour un secret base32 à un instant (côté app authenticator). */
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

describe.skipIf(!URI)(
  "Mongoose — flux 2FA COMPLET sur MongooseTotpSecretStore (ops réelles du service)",
  () => {
    let orm: MongooseOrm;
    let store: MongooseTotpSecretStore;
    const key = deriveTotpKey("clé-de-test-totp-e2e-mongoose-0123456789");

    /** deps du service, store = mongoose ; horloge fixe surchargeable. */
    function deps(now: number = T0): ITotpDeps {
      return {
        store,
        key,
        now: () => now,
        issuer: "Nodefony",
        algorithm: "SHA1",
        digits: 6,
        period: 30,
        window: 1,
        recoveryCodesCount: 10,
      };
    }

    beforeAll(async () => {
      registerTotpSecretEntity(ORM);
      orm = new MongooseOrm(ORM, URI!);
      await orm.connect();
      // Base RÉELLE : la collection survit au run précédent (≠ sqlite `:memory:`
      // du jumeau drizzle, jeté à chaque process).
      await orm.getRepository(TOTP_SECRET_ENTITY).delete({});
      store = MongooseTotpSecretStore.from(orm);
    });

    afterAll(async () => {
      await orm?.disconnect();
      entityRegistry.unregister(TOTP_SECRET_ENTITY, ORM);
      ormRegistry.unregister(ORM);
    });

    it("enrôlement → confirmation active le 2FA (secret chiffré persisté en base)", async () => {
      const d = deps();
      const enroll = await beginTotpEnrollment(d, "alice", "alice@ex.com");
      assert.match(enroll.secretBase32, /^[A-Z2-7]+$/);
      // Pending persisté sur mongo.
      assert.equal((await totpStatus(d, "alice")).pending, true);

      const act = await confirmTotpEnrollment(
        d,
        "alice",
        codeFor(enroll.secretBase32, d),
      );
      assert.equal(act.recoveryCodes.length, 10);
      const st = await totpStatus(d, "alice");
      assert.equal(st.enabled, true);
      assert.equal(st.recoveryCodesRemaining, 10);
    });

    it("login TOTP valide au pas suivant → ok (le step de confirmation lu depuis la base)", async () => {
      const d = deps();
      const enroll = await beginTotpEnrollment(d, "bob", "bob");
      await confirmTotpEnrollment(d, "bob", codeFor(enroll.secretBase32, d));
      // La confirmation a consommé le step courant → se connecter au pas suivant.
      const next = deps(T0 + 30_000);
      const res = await verifyTotpLogin(
        next,
        "bob",
        codeFor(enroll.secretBase32, next),
      );
      assert.equal(res.ok, true);
      assert.equal(res.method, "totp");
    });

    it("ANTI-REJEU : le même code refusé 2× (lastUsedStep round-trip mongoose)", async () => {
      // LE test qui compte : l'anti-rejeu dépend du fait que `update({lastUsedStep})`
      // soit écrit PUIS relu par `findByUser` via l'adapter mongoose. Un round-trip
      // cassé (patch partiel qui n'écrit pas, champ mal mappé sur `_id` au lieu de
      // `userId`) laisserait passer le rejeu — sans qu'aucun CRUD isolé ne le voie.
      const d = deps();
      const enroll = await beginTotpEnrollment(d, "carol", "carol");
      await confirmTotpEnrollment(d, "carol", codeFor(enroll.secretBase32, d));
      const clk = deps(T0 + 30_000);
      const code = codeFor(enroll.secretBase32, clk);
      assert.equal((await verifyTotpLogin(clk, "carol", code)).ok, true);
      assert.equal((await verifyTotpLogin(clk, "carol", code)).ok, false); // rejeu REFUSÉ
    });

    it("code de récupération : usage unique, consommation persistée en base", async () => {
      const d = deps();
      const enroll = await beginTotpEnrollment(d, "dave", "dave");
      const { recoveryCodes } = await confirmTotpEnrollment(
        d,
        "dave",
        codeFor(enroll.secretBase32, d),
      );
      const r0 = recoveryCodes[0]!;
      assert.equal((await verifyTotpLogin(d, "dave", r0)).method, "recovery");
      assert.equal((await verifyTotpLogin(d, "dave", r0)).ok, false); // déjà consommé
      // Le retrait du code haché a bien été persisté (10 → 9).
      assert.equal((await totpStatus(d, "dave")).recoveryCodesRemaining, 9);
    });

    it("code faux / utilisateur inconnu → ok=false (jamais d'exception)", async () => {
      const d = deps();
      const enroll = await beginTotpEnrollment(d, "erin", "erin");
      await confirmTotpEnrollment(d, "erin", codeFor(enroll.secretBase32, d));
      assert.equal((await verifyTotpLogin(d, "erin", "000000")).ok, false);
      assert.equal((await verifyTotpLogin(d, "ghost", "123456")).ok, false);
    });

    it("survie « redémarrage » : 2FA confirmé lu par un NOUVEAU store sur le même ORM", async () => {
      const d = deps();
      const enroll = await beginTotpEnrollment(d, "frank", "frank");
      await confirmTotpEnrollment(d, "frank", codeFor(enroll.secretBase32, d));

      // Nouvelle instance de store (≈ après reboot) sur l'ORM connecté : le 2FA doit
      // rester actif ET le login fonctionner (le secret chiffré a survécu en base).
      const store2 = MongooseTotpSecretStore.from(orm);
      const d2: ITotpDeps = { ...deps(T0 + 60_000), store: store2 };
      assert.equal((await totpStatus(d2, "frank")).enabled, true);
      const res = await verifyTotpLogin(
        d2,
        "frank",
        codeFor(enroll.secretBase32, d2),
      );
      assert.equal(res.ok, true);
    });

    it("désactivation retire le secret (login 2FA ensuite inopérant)", async () => {
      const d = deps();
      const enroll = await beginTotpEnrollment(d, "gwen", "gwen");
      await confirmTotpEnrollment(d, "gwen", codeFor(enroll.secretBase32, d));
      await disableTotp(d, "gwen");
      assert.equal((await totpStatus(d, "gwen")).enabled, false);
      const later = deps(T0 + 30_000);
      assert.equal(
        (
          await verifyTotpLogin(
            later,
            "gwen",
            codeFor(enroll.secretBase32, later),
          )
        ).ok,
        false,
      );
    });

    it("ré-enrôlement après désactivation : le 2FA repart en ATTENTE", async () => {
      // Propre à une base durable : chez le jumeau drizzle la base est jetée à
      // chaque process, donc ce chemin n'y est jamais exercé. Un `save` qui
      // n'écraserait pas `confirmedAt` laisserait ici un 2FA actif avec un
      // secret que l'utilisateur n'a jamais confirmé.
      const d = deps();
      const first = await beginTotpEnrollment(d, "hugo", "hugo");
      await confirmTotpEnrollment(d, "hugo", codeFor(first.secretBase32, d));
      await disableTotp(d, "hugo");

      const again = deps(T0 + 90_000);
      const second = await beginTotpEnrollment(again, "hugo", "hugo");
      const st = await totpStatus(again, "hugo");
      assert.equal(st.enabled, false);
      assert.equal(st.pending, true);
      // Et l'ANCIEN secret ne vaut plus rien.
      assert.equal(
        (
          await verifyTotpLogin(
            again,
            "hugo",
            codeFor(first.secretBase32, again),
          )
        ).ok,
        false,
      );
      await confirmTotpEnrollment(
        again,
        "hugo",
        codeFor(second.secretBase32, again),
      );
      assert.equal((await totpStatus(again, "hugo")).enabled, true);
    });
  },
);
