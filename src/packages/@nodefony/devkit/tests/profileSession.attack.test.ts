/// <reference types="node" />
import { describe, it, expect } from "vitest";
import {
  fingerprintTicket,
  PROFILE_TICKET_LENGTH,
  PROFILE_TICKET_MAX_PENDING,
  PROFILE_TICKET_TTL_MS,
  ProfileTicketStore,
} from "../nodefony/src/profileTicket";
import {
  isProfileSessionFlow,
  isProfileSessionStore,
  openProfileSession,
  PROFILE_SESSION_FACTOR,
  PROFILE_SESSION_REFUSED,
  toProfileSessionUser,
  type IProfileSessionDeps,
} from "../nodefony/src/profileSession";

// Matrice écrite AVANT la logique (passe 1, « threat-first ») : chaque cas dit
// ce que la route doit RÉSISTER, pas ce que le code fait.

const LOCAL = "::ffff:127.0.0.1";

/** Horloge pilotée : l'expiration se prouve sans attendre. */
function clock(start = 1_000_000): {
  now: () => number;
  advance: (ms: number) => void;
} {
  let t = start;
  return { now: () => t, advance: (ms) => (t += ms) };
}

/** Flux de session observable : compte et retient chaque ouverture. */
function flow(opts: { fail?: boolean; ref?: string | null } = {}) {
  const opened: string[] = [];
  const deps = (tickets: ProfileTicketStore | null): IProfileSessionDeps => ({
    tickets,
    establish: async (identifier) => {
      opened.push(identifier);
      if (opts.fail) throw new Error("compte verrouillé : alice");
      return { identifier, roles: ["ROLE_USER"] };
    },
    sessionRef: () => (opts.ref === undefined ? "sess_abc" : opts.ref),
  });
  return { opened, deps };
}

describe("ProfileTicketStore — le ticket à usage unique", () => {
  it("contrôle positif : un ticket émis se rachète une fois, pour l'identité émise", () => {
    const store = new ProfileTicketStore();
    const ticket = store.issue("alice");
    expect(store.redeem(ticket)).toBe("alice");
  });

  it("rejeu : un ticket racheté ne se rachète plus", () => {
    const store = new ProfileTicketStore();
    const ticket = store.issue("alice");
    store.redeem(ticket);
    expect(store.redeem(ticket)).toBeNull();
  });

  it("expiration : passé le délai, le ticket est mort", () => {
    const c = clock();
    const store = new ProfileTicketStore({ now: c.now });
    const ticket = store.issue("alice");
    c.advance(PROFILE_TICKET_TTL_MS + 1);
    expect(store.redeem(ticket)).toBeNull();
  });

  it("à la limite exacte du délai, le ticket vit encore", () => {
    const c = clock();
    const store = new ProfileTicketStore({ now: c.now });
    const ticket = store.issue("alice");
    c.advance(PROFILE_TICKET_TTL_MS);
    expect(store.redeem(ticket)).toBe("alice");
  });

  it("forge : un ticket de bonne forme jamais émis est refusé", () => {
    const store = new ProfileTicketStore();
    store.issue("alice");
    expect(store.redeem("A".repeat(PROFILE_TICKET_LENGTH))).toBeNull();
  });

  it.each([
    ["absent", undefined],
    ["vide", ""],
    ["nombre", 42],
    ["tableau", ["x"]],
    ["objet", { ticket: "x" }],
    ["trop long (1 Mo)", "x".repeat(1_000_000)],
    ["trop court", "abc"],
  ])("entrée hostile (%s) : refusée sans lever", (_label, value) => {
    const store = new ProfileTicketStore();
    store.issue("alice");
    expect(store.redeem(value)).toBeNull();
  });

  it("anti-DoS : une entrée malformée n'est jamais hachée (comptage)", () => {
    let hashed = 0;
    const store = new ProfileTicketStore({
      fingerprint: (ticket) => {
        hashed += 1;
        return fingerprintTicket(ticket);
      },
    });
    const ticket = store.issue("alice");
    hashed = 0;
    for (const hostile of ["x".repeat(1_000_000), "abc", "é".repeat(43), 42]) {
      expect(store.redeem(hostile)).toBeNull();
    }
    expect(hashed).toBe(0);
    expect(store.redeem(ticket)).toBe("alice");
    expect(hashed).toBe(1);
  });

  it("deux tickets ne se ressemblent pas, et ont 256 bits d'aléa en base64url", () => {
    const store = new ProfileTicketStore();
    const a = store.issue("alice");
    const b = store.issue("alice");
    expect(a).not.toBe(b);
    expect(a).toMatch(new RegExp(`^[A-Za-z0-9_-]{${PROFILE_TICKET_LENGTH}}$`));
  });

  it("borné : au-delà du plafond de tickets en attente, l'émission est refusée", () => {
    const store = new ProfileTicketStore();
    for (let i = 0; i < PROFILE_TICKET_MAX_PENDING; i += 1)
      store.issue("alice");
    expect(() => store.issue("alice")).toThrow(/en attente/u);
  });

  it("les tickets expirés libèrent leur place sans minuterie", () => {
    const c = clock();
    const store = new ProfileTicketStore({ now: c.now });
    for (let i = 0; i < PROFILE_TICKET_MAX_PENDING; i += 1)
      store.issue("alice");
    c.advance(PROFILE_TICKET_TTL_MS + 1);
    expect(() => store.issue("alice")).not.toThrow();
    expect(store.pending).toBe(1);
  });

  it("un identifiant vide ne s'émet pas", () => {
    expect(() => new ProfileTicketStore().issue("")).toThrow();
  });
});

describe("openProfileSession — la route de connexion du profilage", () => {
  it("contrôle positif : ticket valide, appel local → session ouverte pour l'identité DU TICKET", async () => {
    const store = new ProfileTicketStore();
    const ticket = store.issue("alice");
    const f = flow();
    const verdict = await openProfileSession(
      { ticket, remoteAddress: LOCAL },
      f.deps(store),
    );
    expect(verdict).toEqual({
      status: 200,
      identifier: "alice",
      roles: ["ROLE_USER"],
      ref: "sess_abc",
    });
    expect(f.opened).toEqual(["alice"]);
  });

  it("le facteur journalisé nomme le devkit, pas « federated »", () => {
    expect(PROFILE_SESSION_FACTOR).toBe("devkit");
  });

  it("rejeu sur la route : la 2ᵉ présentation est refusée, aucune 2ᵉ session", async () => {
    const store = new ProfileTicketStore();
    const ticket = store.issue("alice");
    const f = flow();
    await openProfileSession({ ticket, remoteAddress: LOCAL }, f.deps(store));
    const second = await openProfileSession(
      { ticket, remoteAddress: LOCAL },
      f.deps(store),
    );
    expect(second.status).toBe(403);
    expect(f.opened).toEqual(["alice"]);
  });

  it.each([
    ["réseau local", "192.168.1.20"],
    ["IPv4 encapsulée distante", "::ffff:10.0.0.5"],
    ["adresse absente", undefined],
  ])(
    "appel non local (%s) : refusé, et le ticket n'est PAS consommé",
    async (_label, remoteAddress) => {
      const store = new ProfileTicketStore();
      const ticket = store.issue("alice");
      const f = flow();
      const verdict = await openProfileSession(
        { ticket, remoteAddress },
        f.deps(store),
      );
      expect(verdict.status).toBe(403);
      expect(f.opened).toEqual([]);
      expect(store.redeem(ticket)).toBe("alice");
    },
  );

  it("message UNIFORME : absent, forgé, expiré, non local et compte refusé disent la même chose", async () => {
    const c = clock();
    const store = new ProfileTicketStore({ now: c.now });
    const expired = store.issue("alice");
    c.advance(PROFILE_TICKET_TTL_MS + 1);
    const forLocked = store.issue("alice");
    const verdicts = [
      await openProfileSession(
        { ticket: undefined, remoteAddress: LOCAL },
        flow().deps(store),
      ),
      await openProfileSession(
        { ticket: "Z".repeat(PROFILE_TICKET_LENGTH), remoteAddress: LOCAL },
        flow().deps(store),
      ),
      await openProfileSession(
        { ticket: expired, remoteAddress: LOCAL },
        flow().deps(store),
      ),
      await openProfileSession(
        { ticket: forLocked, remoteAddress: "10.0.0.1" },
        flow().deps(store),
      ),
      await openProfileSession(
        { ticket: forLocked, remoteAddress: LOCAL },
        flow({ fail: true }).deps(store),
      ),
    ];
    for (const v of verdicts) {
      expect(v).toEqual({ status: 403, message: PROFILE_SESSION_REFUSED });
    }
  });

  it("compte refusé : le message ne fuit ni l'identifiant ni la cause", async () => {
    const store = new ProfileTicketStore();
    const ticket = store.issue("alice");
    const verdict = await openProfileSession(
      { ticket, remoteAddress: LOCAL },
      flow({ fail: true }).deps(store),
    );
    expect(JSON.stringify(verdict)).not.toMatch(/alice|verrouill/u);
  });

  it("sécurité absente : 503, et le ticket n'est pas consommé", async () => {
    const store = new ProfileTicketStore();
    const ticket = store.issue("alice");
    const verdict = await openProfileSession(
      { ticket, remoteAddress: LOCAL },
      { tickets: store, establish: null, sessionRef: () => null },
    );
    expect(verdict.status).toBe(503);
    expect(store.redeem(ticket)).toBe("alice");
  });

  it("aucun magasin de tickets (jamais émis) : refus uniforme", async () => {
    const verdict = await openProfileSession(
      { ticket: "Z".repeat(PROFILE_TICKET_LENGTH), remoteAddress: LOCAL },
      flow().deps(null),
    );
    expect(verdict).toEqual({ status: 403, message: PROFILE_SESSION_REFUSED });
  });

  it("session non ouverte après l'authentification : 503, jamais un 200 sans cookie", async () => {
    const store = new ProfileTicketStore();
    const ticket = store.issue("alice");
    const verdict = await openProfileSession(
      { ticket, remoteAddress: LOCAL },
      flow({ ref: null }).deps(store),
    );
    expect(verdict.status).toBe(503);
  });
});

describe("vues minimales des services résolus au conteneur", () => {
  it("un flux de session sans establishSessionFor n'est pas utilisable", () => {
    expect(
      isProfileSessionFlow({ establishSessionFor: async () => null }),
    ).toBe(true);
    for (const v of [
      null,
      undefined,
      {},
      { establishSessionFor: "x" },
      "authFlow",
    ]) {
      expect(isProfileSessionFlow(v)).toBe(false);
    }
  });

  it("un service de sessions doit savoir dériver ET détruire par pseudonyme", () => {
    const ok = { sessionRef: () => "sess_x", destroyByRef: async () => true };
    expect(isProfileSessionStore(ok)).toBe(true);
    expect(isProfileSessionStore({ sessionRef: () => "sess_x" })).toBe(false);
    expect(isProfileSessionStore(null)).toBe(false);
  });

  it("le compte rendu par le flux est lu sans confiance : rôles non chaîne écartés", () => {
    expect(
      toProfileSessionUser(
        { identifier: "alice", roles: ["ROLE_USER", 7, null] },
        "x",
      ),
    ).toEqual({ identifier: "alice", roles: ["ROLE_USER"] });
    expect(toProfileSessionUser(undefined, "alice")).toEqual({
      identifier: "alice",
    });
    expect(toProfileSessionUser({ identifier: 3 }, "alice")).toEqual({
      identifier: "alice",
      roles: [],
    });
  });
});
