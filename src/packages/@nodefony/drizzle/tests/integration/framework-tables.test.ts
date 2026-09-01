import assert from "node:assert/strict";
import { frameworkTables } from "../../nodefony/src/migrator/sources";
import type { SqlDialect } from "../../nodefony/interfaces/IDrizzleConfig";

/**
 * **Ce que le framework possède** — la liste dérivée de ses migrations livrées.
 *
 * Elle décide deux choses : ce que le générateur exclut de ce qu'il écrit, et ce
 * que l'adoption exclut de ce qu'elle lit. Une table qui y figure est donc une
 * table qu'une application **ne peut pas décrire elle-même** : son diff est
 * ignoré en silence, et sa migration n'est jamais produite.
 *
 * C'est pourquoi `User` n'en fait plus partie. L'identité est du DOMAINE — elle
 * appartient à l'application, qui doit pouvoir y ajouter ses champs et en porter
 * les migrations. L'infrastructure (sessions, jetons, journal d'audit,
 * idempotence, passkeys, webhooks) reste au framework : personne ne l'étend.
 *
 * Ce banc lit les migrations RÉELLEMENT livrées, sur les trois dialectes — pas
 * une liste écrite à la main, qui mentirait dès la première migration suivante.
 */
const DIALECTS: SqlDialect[] = ["sqlite", "postgres", "mysql"];

describe("les tables du framework, dérivées des migrations livrées", () => {
  for (const dialect of DIALECTS) {
    it(`${dialect} : l'utilisateur n'appartient plus au framework`, async () => {
      const tables = await frameworkTables(dialect);
      assert.ok(
        !tables.includes("User"),
        `« User » est encore créée par les migrations du framework (${dialect}) — ` +
          `une application ne peut alors pas décrire sa propre table : le générateur ` +
          `l'exclut de son diff, sans un mot.`,
      );
    });

    it(`${dialect} : l'infrastructure, elle, reste au framework`, async () => {
      const tables = await frameworkTables(dialect);
      // Ces tables-là, aucune application n'a de raison de les étendre — et si
      // elle en déclarait une du même nom, c'est la collision qu'il faut voir,
      // pas la table qui doit disparaître de cette liste.
      for (const table of [
        "session",
        "access_token",
        "denied_jti",
        "subject_revocation",
        "audit_event",
        "idempotency_key",
        "totp_secret",
        "webauthn_credential",
        "webhook_endpoint",
      ]) {
        assert.ok(
          tables.includes(table),
          `« ${table} » a disparu des migrations du framework (${dialect})`,
        );
      }
    });
  }
});
