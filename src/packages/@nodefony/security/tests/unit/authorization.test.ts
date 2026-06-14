import assert from "node:assert/strict";
import { Container, Event } from "nodefony";
import type { Module, Severity, Pdu } from "nodefony";
import type { IUser } from "@nodefony/user";
import { Authorization } from "../../nodefony/service/authorization";
import { UserToken } from "../../nodefony/src/token/UserToken";
import { RoleHierarchyWalker } from "../../nodefony/src/RoleHierarchyWalker";
import { VoterVote } from "../../nodefony/contracts/IAccessVoter";
import type { IAccessVoter } from "../../nodefony/contracts/IAccessVoter";
import { registerVoterFactory } from "../../nodefony/src/voter/voterRegistry";

/**
 * Matrice de décision de l'`AuthorizationService` — stratégie affirmative + DENY
 * veto, défaut DENY (Zero Trust). Testée via le contrat PUBLIC (`decide`), avec
 * des voters de test enregistrés au registre (le chemin réel : registre → build
 * → decide), hors kernel (`#build` lazy à la 1ʳᵉ décision).
 *
 * Les voters ne supportent qu'un attribut précis (`supports(attr)===this.attr`)
 * → chaque scénario est ISOLÉ des autres malgré le registre partagé (un voter
 * de "t.veto" ne participe jamais à une décision sur "t.grant").
 */

const fakeUser = (identifier: string, roles: string[]): IUser => ({
  id: "00000000-0000-4000-8000-000000000009",
  identifier,
  roles,
  hasRole: (r: string) => roles.includes(r),
  isActive: () => true,
  isLocked: () => false,
});

const authedToken = (roles: string[], identifier = "alice") =>
  new UserToken("test", null).promote(fakeUser(identifier, roles));

/** Voter de test : ne supporte qu'un attribut, vote un verdict figé, compte ses votes. */
class StubVoter implements IAccessVoter {
  votes = 0;
  constructor(
    private readonly attr: string,
    private readonly verdict: VoterVote,
  ) {}
  supports(attribute: string): boolean {
    return attribute === this.attr;
  }
  vote(): Promise<VoterVote> {
    this.votes += 1;
    return Promise.resolve(this.verdict);
  }
}

// Instances partagées (court-circuit : besoin d'un handle pour compter les votes).
const shortDeny = new StubVoter("t.short", VoterVote.DENY);
const shortSpy = new StubVoter("t.short", VoterVote.GRANT);

// Enregistrement déterministe (ordre = ordre d'itération du jury au build).
registerVoterFactory(
  "test-grant",
  () => new StubVoter("t.grant", VoterVote.GRANT),
);
registerVoterFactory(
  "test-veto-grant",
  () => new StubVoter("t.veto", VoterVote.GRANT),
);
registerVoterFactory(
  "test-veto-deny",
  () => new StubVoter("t.veto", VoterVote.DENY),
);
registerVoterFactory(
  "test-abstain-1",
  () => new StubVoter("t.abstain", VoterVote.ABSTAIN),
);
registerVoterFactory(
  "test-abstain-2",
  () => new StubVoter("t.abstain", VoterVote.ABSTAIN),
);
registerVoterFactory(
  "test-mixed-grant",
  () => new StubVoter("t.mixed", VoterVote.GRANT),
);
registerVoterFactory(
  "test-mixed-abstain",
  () => new StubVoter("t.mixed", VoterVote.ABSTAIN),
);
registerVoterFactory("test-short-deny", () => shortDeny);
registerVoterFactory("test-short-spy", () => shortSpy);
registerVoterFactory("test-throw", () => ({
  supports: (a: string) => a === "t.throw",
  vote: () => Promise.reject(new Error("voter backing store down")),
}));

function makeService(container = new Container()): Authorization {
  return new Authorization({
    container,
    notificationsCenter: new Event(),
    options: {},
  } as unknown as Module);
}

describe("AuthorizationService — stratégie affirmative + DENY veto", () => {
  it("un GRANT seul accorde", async () => {
    assert.equal(await makeService().decide(authedToken([]), "t.grant"), true);
  });

  it("un DENY oppose son veto — un GRANT ne suffit plus", async () => {
    // jury "t.veto" = [GRANT, DENY] → DENY l'emporte malgré le GRANT.
    assert.equal(await makeService().decide(authedToken([]), "t.veto"), false);
  });

  it("tous ABSTAIN → refus (Zero Trust)", async () => {
    assert.equal(
      await makeService().decide(authedToken([]), "t.abstain"),
      false,
    );
  });

  it("aucun voter compétent → refus (deny-by-default)", async () => {
    assert.equal(
      await makeService().decide(authedToken([]), "t.aucun-voter"),
      false,
    );
  });

  it("un GRANT parmi des ABSTAIN accorde", async () => {
    assert.equal(await makeService().decide(authedToken([]), "t.mixed"), true);
  });

  it("un DENY court-circuite le jury (voters suivants non sollicités)", async () => {
    shortSpy.votes = 0;
    const granted = await makeService().decide(authedToken([]), "t.short");
    assert.equal(granted, false);
    assert.equal(shortSpy.votes, 0); // le DENY (itéré avant) a court-circuité
  });

  it("un voter qui throw → fail-closed (refus), jamais d'exception propagée", async () => {
    // Zero Trust : un lookup qui tombe ne doit ni accorder ni faire planter
    // la requête en 500 — `decide` RÉSOUT `false` (pas de reject).
    await assert.doesNotReject(
      makeService().decide(authedToken([]), "t.throw"),
    );
    assert.equal(await makeService().decide(authedToken([]), "t.throw"), false);
  });
});

describe("AuthorizationService — niveau A (RoleVoter built-in + hiérarchie)", () => {
  // ROLE_ADMIN hérite ROLE_USER : un admin satisfait une exigence ROLE_USER.
  const container = new Container();
  container.set(
    "roleHierarchy",
    new RoleHierarchyWalker({ ROLE_ADMIN: ["ROLE_USER"] }),
  );

  it("rôle direct accordé", async () => {
    assert.equal(
      await makeService(container).decide(
        authedToken(["ROLE_ADMIN"]),
        "ROLE_ADMIN",
      ),
      true,
    );
  });

  it("rôle hérité accordé (ROLE_ADMIN → ROLE_USER)", async () => {
    assert.equal(
      await makeService(container).decide(
        authedToken(["ROLE_ADMIN"]),
        "ROLE_USER",
      ),
      true,
    );
  });

  it("rôle absent refusé (RoleVoter ABSTAIN → default DENY)", async () => {
    assert.equal(
      await makeService(container).decide(
        authedToken(["ROLE_ADMIN"]),
        "ROLE_GUEST",
      ),
      false,
    );
  });
});

describe("AuthorizationService — audit", () => {
  it("tout refus est audité (WARNING) ; un accès accordé reste silencieux", async () => {
    const service = makeService();
    const warnings: string[] = [];
    service.log = ((pci: unknown, severity?: Severity): Pdu => {
      if (severity === "WARNING") warnings.push(String(pci));
      return undefined as unknown as Pdu;
    }) as typeof service.log;

    await service.decide(authedToken([]), "t.veto"); // refus → audit
    assert.equal(warnings.length, 1);
    assert.match(warnings[0]!, /access denied/);

    await service.decide(authedToken([]), "t.grant"); // accordé → silencieux
    assert.equal(warnings.length, 1);
  });
});
