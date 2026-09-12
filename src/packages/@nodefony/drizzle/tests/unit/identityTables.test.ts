import assert from "node:assert/strict";

import {
  IDENTITY_TABLES,
  identityTablesAmong,
  rowsWorthKeeping,
} from "../../nodefony/src/migrator/identityTables";
import { RESERVED_ENTITY_NAMES } from "../../../../../nodefony/src/cli/scaffold/reservedEntities";

/**
 * Banc de la garde qui empêche `orm:reset` d'effacer des comptes.
 *
 * Le cas qui compte est le dernier : la liste des tables d'identité est une
 * COPIE, rendue inévitable par la frontière de paquets, et une copie non
 * vérifiée n'est pas vérifiée. Si une table du framework est renommée, la garde
 * cesserait de mordre SANS que rien ne tombe — c'est exactement le faux vert
 * qu'on refuse ici.
 */
describe("identityTablesAmong — ce qui ne se reconstitue pas", () => {
  it("reconnaît les tables d'identité parmi celles de la base", () => {
    const trouvees = identityTablesAmong([
      "User",
      "audit_event",
      "webauthn_credential",
      "ma_table_metier",
    ]);
    assert.deepEqual(
      trouvees.map((t) => t.table),
      ["User", "webauthn_credential"],
    );
  });

  it("ignore la CASSE — sqlite garde `User`, d'autres moteurs replient", () => {
    // Une garde sensible à la casse serait inopérante sur la moitié des
    // dialectes, c'est-à-dire là où l'on croirait être protégé.
    const trouvees = identityTablesAmong(["user", "WEBAUTHN_CREDENTIAL"]);
    assert.deepEqual(
      trouvees.map((t) => t.table),
      ["user", "WEBAUTHN_CREDENTIAL"],
    );
  });

  it("rend le nom RÉEL de la table, pas celui de la liste", () => {
    // C'est ce nom qui sera affiché à l'utilisateur et cité dans un `COUNT(*)` :
    // rendre celui de la liste enverrait interroger une table qui n'existe pas.
    const [premiere] = identityTablesAmong(["user"]);
    assert.equal(premiere.table, "user");
  });

  it("ne retient RIEN de ce qui se reconstitue", () => {
    // Une trace d'audit, un cache d'idempotence, une session, un jeton : leur
    // perte est rattrapable — une session et un jeton se refont par un login.
    // Les faire entrer ici ferait crier la garde sur le cas normal.
    assert.deepEqual(
      identityTablesAmong([
        "audit_event",
        "idempotency_key",
        "session",
        "access_token",
        "denied_jti",
        "webhook_endpoint",
      ]),
      [],
    );
  });

  it("le compte SEMÉ par l'application ne compte pas comme une perte", () => {
    // C'est le cas normal d'une application fraîche : son semis repose l'admin
    // à chaque démarrage. Une garde qui se lève ici s'apprend à être contournée.
    const [user] = identityTablesAmong(["User"]);
    assert.equal(user.reseededRows, 1);
    assert.equal(
      rowsWorthKeeping(user, 1),
      false,
      "un seul compte : rien à perdre",
    );
    assert.equal(
      rowsWorthKeeping(user, 2),
      true,
      "deux comptes : du travail humain",
    );
    assert.equal(rowsWorthKeeping(user, 0), false);
  });

  it("une passkey compte DÈS la première — rien ne la repose", () => {
    const [passkey] = identityTablesAmong(["webauthn_credential"]);
    assert.equal(passkey.reseededRows, 0);
    assert.equal(rowsWorthKeeping(passkey, 1), true);
    assert.equal(rowsWorthKeeping(passkey, 0), false);
  });

  it("chaque table d'identité existe TOUJOURS dans la table du cœur", () => {
    const connues = new Set(
      RESERVED_ENTITY_NAMES.map((e) => e.name.toLowerCase()),
    );
    for (const entry of IDENTITY_TABLES) {
      assert.ok(
        connues.has(entry.name.toLowerCase()),
        `« ${entry.name} » n'est plus une entité du framework (cli/scaffold/` +
          `reservedEntities.ts) : soit elle a été renommée — et la garde de ` +
          `orm:reset ne mord plus —, soit elle a disparu et cette entrée doit ` +
          `partir. Ne pas « corriger » en retirant l'assertion.`,
      );
    }
  });

  it("chaque entrée dit ce que sa perte coûte (sinon le refus n'apprend rien)", () => {
    for (const entry of IDENTITY_TABLES) {
      assert.ok(
        entry.holds.length > 10,
        `« ${entry.name} » doit dire ce qui disparaît avec elle`,
      );
    }
  });
});
