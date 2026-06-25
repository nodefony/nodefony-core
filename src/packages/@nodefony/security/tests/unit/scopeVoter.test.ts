import assert from "node:assert/strict";
import { Container, Event } from "nodefony";
import type { Module } from "nodefony";
import type { IUser } from "@nodefony/user";
import { ScopeVoter } from "../../nodefony/src/voter/ScopeVoter";
import { UserToken } from "../../nodefony/src/token/UserToken";
import { AnonymousToken } from "../../nodefony/src/token/AnonymousToken";
import { Authorization } from "../../nodefony/service/authorization";
import { VoterVote } from "../../nodefony/contracts/IAccessVoter";

/**
 * Axe SCOPE (P6.8) — le `ScopeVoter` applique les scopes `api:action` de
 * `@RequireScope`. Deux niveaux : le voter PUR (supports/vote) puis le chemin réel
 * via `Authorization.decide` (le built-in `scope` est enregistré au registre à
 * l'import du module → default-DENY de l'autz qui ferme la porte sur ABSTAIN).
 */

const fakeUser = (identifier: string, roles: string[] = []): IUser => ({
  id: "00000000-0000-4000-8000-00000000000a",
  identifier,
  roles,
  hasRole: (r: string) => roles.includes(r),
  isActive: () => true,
  isLocked: () => false,
});

/** Jeton MACHINE (clé API / JWT / OAuth) porteur de scopes — l'axe scopable. */
const scopableToken = (type: string, scopes: string[]) => {
  const t = new UserToken(type, null).promote(fakeUser("svc"));
  t.setAttribute("scopes", scopes);
  return t;
};

/** Jeton HUMAIN (session BFF / login) — non scopable, le scope est un no-op. */
const humanToken = (type: string) =>
  new UserToken(type, null).promote(fakeUser("alice", ["ROLE_USER"]));

describe("ScopeVoter — supports() (forme api:action seulement)", () => {
  const voter = new ScopeVoter();

  it("capte un scope api:action", () => {
    assert.equal(voter.supports("orders:read"), true);
    assert.equal(voter.supports("billing:write"), true);
  });

  it("ignore un rôle ROLE_* (même avec un ':') — c'est le RoleVoter", () => {
    assert.equal(voter.supports("ROLE_ADMIN"), false);
    assert.equal(voter.supports("ROLE_X:Y"), false);
  });

  it("ignore un attribut métier sans ':' (voter métier)", () => {
    assert.equal(voter.supports("doc.edit"), false);
    assert.equal(voter.supports("ownership"), false);
  });
});

describe("ScopeVoter — vote() (machine bridée, humain no-op)", () => {
  const voter = new ScopeVoter();

  it("jeton machine AVEC le scope → GRANT", async () => {
    const v = await voter.vote(
      scopableToken("apikey", ["orders:read", "orders:write"]),
      "orders:read",
    );
    assert.equal(v, VoterVote.GRANT);
  });

  it("jeton machine SANS le scope → ABSTAIN (≠ DENY)", async () => {
    const v = await voter.vote(
      scopableToken("apikey", ["billing:read"]),
      "orders:read",
    );
    assert.equal(v, VoterVote.ABSTAIN);
  });

  it("clé downscopée à [] → ABSTAIN sur tout scope (n'accède à rien de scopé)", async () => {
    const v = await voter.vote(scopableToken("apikey", []), "orders:read");
    assert.equal(v, VoterVote.ABSTAIN);
  });

  it("jwt / oauth2 sont scopables au même titre que la clé API", async () => {
    assert.equal(
      await voter.vote(scopableToken("jwt", ["orders:read"]), "orders:read"),
      VoterVote.GRANT,
    );
    assert.equal(
      await voter.vote(scopableToken("oauth2", []), "orders:read"),
      VoterVote.ABSTAIN,
    );
  });

  it("session / userpassword (humain) → GRANT (no-op, droits portés par les rôles)", async () => {
    assert.equal(
      await voter.vote(humanToken("session"), "orders:read"),
      VoterVote.GRANT,
    );
    assert.equal(
      await voter.vote(humanToken("userpassword"), "orders:read"),
      VoterVote.GRANT,
    );
  });

  it("anonymous → GRANT (no-op ; l'anonyme est bloqué en amont par le firewall)", async () => {
    assert.equal(
      await voter.vote(new AnonymousToken(), "orders:read"),
      VoterVote.GRANT,
    );
  });
});

function makeService(): Authorization {
  return new Authorization({
    container: new Container(),
    notificationsCenter: new Event(),
    options: {},
  } as unknown as Module);
}

describe("ScopeVoter — via Authorization.decide (chemin réel, built-in 'scope')", () => {
  it("clé API correctement scopée → accès accordé", async () => {
    const granted = await makeService().decide(
      scopableToken("apikey", ["orders:read"]),
      "orders:read",
    );
    assert.equal(granted, true);
  });

  it("clé API mal scopée → REFUS (ABSTAIN → default DENY) — le trou fermé", async () => {
    const granted = await makeService().decide(
      scopableToken("apikey", ["billing:read"]),
      "orders:read",
    );
    assert.equal(granted, false);
  });

  it("session humaine → accès accordé (le scope ne bride pas l'humain)", async () => {
    const granted = await makeService().decide(
      humanToken("session"),
      "orders:read",
    );
    assert.equal(granted, true);
  });
});
