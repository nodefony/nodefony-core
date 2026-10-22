/// <reference types="node" />
import { describe, it, expect } from "vitest";
import { BootConfigurationError } from "nodefony";
import {
  fingerprintSessionTicket,
  SESSION_TICKET_LENGTH,
  SESSION_TICKET_MAX_PENDING,
  SESSION_TICKET_TTL_MS,
  SessionTicketStore,
} from "../nodefony/mcp/sessionTicket";
import {
  isSessionFlowView,
  isSessionServiceView,
  openTicketSession,
  TICKET_SESSION_REFUSED,
  defineTicketSessionGate,
  readTicketSessionVerdict,
  toTicketSessionUser,
  type ITicketSessionDeps,
} from "../nodefony/mcp/ticketSession";

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
  const deps = (tickets: SessionTicketStore | null): ITicketSessionDeps => ({
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

describe("SessionTicketStore — le ticket à usage unique", () => {
  it("contrôle positif : un ticket émis se rachète une fois, pour l'identité émise", () => {
    const store = new SessionTicketStore();
    const ticket = store.issue("alice");
    expect(store.redeem(ticket)).toBe("alice");
  });

  it("rejeu : un ticket racheté ne se rachète plus", () => {
    const store = new SessionTicketStore();
    const ticket = store.issue("alice");
    store.redeem(ticket);
    expect(store.redeem(ticket)).toBeNull();
  });

  it("expiration : passé le délai, le ticket est mort", () => {
    const c = clock();
    const store = new SessionTicketStore({ now: c.now });
    const ticket = store.issue("alice");
    c.advance(SESSION_TICKET_TTL_MS + 1);
    expect(store.redeem(ticket)).toBeNull();
  });

  it("à la limite exacte du délai, le ticket vit encore", () => {
    const c = clock();
    const store = new SessionTicketStore({ now: c.now });
    const ticket = store.issue("alice");
    c.advance(SESSION_TICKET_TTL_MS);
    expect(store.redeem(ticket)).toBe("alice");
  });

  it("forge : un ticket de bonne forme jamais émis est refusé", () => {
    const store = new SessionTicketStore();
    store.issue("alice");
    expect(store.redeem("A".repeat(SESSION_TICKET_LENGTH))).toBeNull();
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
    const store = new SessionTicketStore();
    store.issue("alice");
    expect(store.redeem(value)).toBeNull();
  });

  it("anti-DoS : une entrée malformée n'est jamais hachée (comptage)", () => {
    let hashed = 0;
    const store = new SessionTicketStore({
      fingerprint: (ticket) => {
        hashed += 1;
        return fingerprintSessionTicket(ticket);
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
    const store = new SessionTicketStore();
    const a = store.issue("alice");
    const b = store.issue("alice");
    expect(a).not.toBe(b);
    expect(a).toMatch(new RegExp(`^[A-Za-z0-9_-]{${SESSION_TICKET_LENGTH}}$`));
  });

  it("borné : au-delà du plafond de tickets en attente, l'émission est refusée", () => {
    const store = new SessionTicketStore();
    for (let i = 0; i < SESSION_TICKET_MAX_PENDING; i += 1)
      store.issue("alice");
    expect(() => store.issue("alice")).toThrow(/en attente/u);
  });

  it("les tickets expirés libèrent leur place sans minuterie", () => {
    const c = clock();
    const store = new SessionTicketStore({ now: c.now });
    for (let i = 0; i < SESSION_TICKET_MAX_PENDING; i += 1)
      store.issue("alice");
    c.advance(SESSION_TICKET_TTL_MS + 1);
    expect(() => store.issue("alice")).not.toThrow();
    expect(store.pending).toBe(1);
  });

  it("un identifiant vide ne s'émet pas", () => {
    expect(() => new SessionTicketStore().issue("")).toThrow();
  });
});

describe("openTicketSession — la route de connexion par ticket", () => {
  it("contrôle positif : ticket valide, appel local → session ouverte pour l'identité DU TICKET", async () => {
    const store = new SessionTicketStore();
    const ticket = store.issue("alice");
    const f = flow();
    const verdict = await openTicketSession(
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

  it("rejeu sur la route : la 2ᵉ présentation est refusée, aucune 2ᵉ session", async () => {
    const store = new SessionTicketStore();
    const ticket = store.issue("alice");
    const f = flow();
    await openTicketSession({ ticket, remoteAddress: LOCAL }, f.deps(store));
    const second = await openTicketSession(
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
      const store = new SessionTicketStore();
      const ticket = store.issue("alice");
      const f = flow();
      const verdict = await openTicketSession(
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
    const store = new SessionTicketStore({ now: c.now });
    const expired = store.issue("alice");
    c.advance(SESSION_TICKET_TTL_MS + 1);
    const forLocked = store.issue("alice");
    const verdicts = [
      await openTicketSession(
        { ticket: undefined, remoteAddress: LOCAL },
        flow().deps(store),
      ),
      await openTicketSession(
        { ticket: "Z".repeat(SESSION_TICKET_LENGTH), remoteAddress: LOCAL },
        flow().deps(store),
      ),
      await openTicketSession(
        { ticket: expired, remoteAddress: LOCAL },
        flow().deps(store),
      ),
      await openTicketSession(
        { ticket: forLocked, remoteAddress: "10.0.0.1" },
        flow().deps(store),
      ),
      await openTicketSession(
        { ticket: forLocked, remoteAddress: LOCAL },
        flow({ fail: true }).deps(store),
      ),
    ];
    for (const v of verdicts) {
      expect(v).toEqual({ status: 403, message: TICKET_SESSION_REFUSED });
    }
  });

  it("compte refusé : le message ne fuit ni l'identifiant ni la cause", async () => {
    const store = new SessionTicketStore();
    const ticket = store.issue("alice");
    const verdict = await openTicketSession(
      { ticket, remoteAddress: LOCAL },
      flow({ fail: true }).deps(store),
    );
    expect(JSON.stringify(verdict)).not.toMatch(/alice|verrouill/u);
  });

  it("sécurité absente : 503, et le ticket n'est pas consommé", async () => {
    const store = new SessionTicketStore();
    const ticket = store.issue("alice");
    const verdict = await openTicketSession(
      { ticket, remoteAddress: LOCAL },
      { tickets: store, establish: null, sessionRef: () => null },
    );
    expect(verdict.status).toBe(503);
    expect(store.redeem(ticket)).toBe("alice");
  });

  it("aucun magasin de tickets (jamais émis) : refus uniforme", async () => {
    const verdict = await openTicketSession(
      { ticket: "Z".repeat(SESSION_TICKET_LENGTH), remoteAddress: LOCAL },
      flow().deps(null),
    );
    expect(verdict).toEqual({ status: 403, message: TICKET_SESSION_REFUSED });
  });

  it("session non ouverte après l'authentification : 503, jamais un 200 sans cookie", async () => {
    const store = new SessionTicketStore();
    const ticket = store.issue("alice");
    const verdict = await openTicketSession(
      { ticket, remoteAddress: LOCAL },
      flow({ ref: null }).deps(store),
    );
    expect(verdict.status).toBe(503);
  });
});

describe("vues minimales des services résolus au conteneur", () => {
  it("un flux de session sans establishSessionFor n'est pas utilisable", () => {
    expect(isSessionFlowView({ establishSessionFor: async () => null })).toBe(
      true,
    );
    for (const v of [
      null,
      undefined,
      {},
      { establishSessionFor: "x" },
      "authFlow",
    ]) {
      expect(isSessionFlowView(v)).toBe(false);
    }
  });

  it("un service de sessions doit savoir dériver ET détruire par pseudonyme", () => {
    const ok = { sessionRef: () => "sess_x", destroyByRef: async () => true };
    expect(isSessionServiceView(ok)).toBe(true);
    expect(isSessionServiceView({ sessionRef: () => "sess_x" })).toBe(false);
    expect(isSessionServiceView(null)).toBe(false);
  });

  it("le compte rendu par le flux est lu sans confiance : rôles non chaîne écartés", () => {
    expect(
      toTicketSessionUser(
        { identifier: "alice", roles: ["ROLE_USER", 7, null] },
        "x",
      ),
    ).toEqual({ identifier: "alice", roles: ["ROLE_USER"] });
    expect(toTicketSessionUser(undefined, "alice")).toEqual({
      identifier: "alice",
    });
    expect(toTicketSessionUser({ identifier: 3 }, "alice")).toEqual({
      identifier: "alice",
      roles: [],
    });
  });
});

describe("localOnly — la boucle locale est le défaut, une porte distante l'écrit", () => {
  it("défaut : un appel distant est refusé AVANT le rachat, le ticket survit", async () => {
    const store = new SessionTicketStore();
    const ticket = store.issue("alice");
    const f = flow();
    const verdict = await openTicketSession(
      { ticket, remoteAddress: "203.0.113.7" },
      f.deps(store),
    );
    expect(verdict).toEqual({ status: 403, message: TICKET_SESSION_REFUSED });
    expect(store.pending).toBe(1);
    expect(f.opened).toEqual([]);
  });

  it("localOnly: false : l'appel distant passe, le ticket seul protège", async () => {
    const store = new SessionTicketStore();
    const ticket = store.issue("alice");
    const f = flow();
    const verdict = await openTicketSession(
      { ticket, remoteAddress: "203.0.113.7" },
      { ...f.deps(store), localOnly: false },
    );
    expect(verdict.status).toBe(200);
    const forged = await openTicketSession(
      {
        ticket: "x".repeat(SESSION_TICKET_LENGTH),
        remoteAddress: "203.0.113.7",
      },
      { ...f.deps(store), localOnly: false },
    );
    expect(forged.status).toBe(403);
  });
});

describe("defineTicketSessionGate — la porte, sans la route", () => {
  it("définition validée : locale par défaut, figée", () => {
    const gate = defineTicketSessionGate({ factor: "devkit" });
    expect(gate.settings).toEqual({ factor: "devkit", localOnly: true });
    expect(Object.isFrozen(gate.settings)).toBe(true);
  });

  it("🔴 facteur hors forme ou clé inconnue : refus au boot, jamais une porte approximative", () => {
    for (const bad of [
      { factor: "" },
      { factor: "Devkit Session" },
      { factor: "devkit", localonly: false },
    ]) {
      expect(() => defineTicketSessionGate(bad)).toThrow(
        BootConfigurationError,
      );
    }
  });

  it("aucun magasin avant le premier ticket ; l'émission l'alloue", () => {
    const gate = defineTicketSessionGate({ factor: "devkit" });
    expect(gate.pending).toBe(0);
    const ticket = gate.issue("alice");
    expect(ticket).toHaveLength(SESSION_TICKET_LENGTH);
    expect(gate.pending).toBe(1);
  });

  it("la fermeture détruit au nom du facteur ; sans service de sessions, rien", async () => {
    const gate = defineTicketSessionGate({ factor: "outil" });
    const destroyed: [string, string | null | undefined][] = [];
    const sessions = {
      sessionRef: (id: string) => id,
      destroyByRef: async (ref: string, actor?: string | null) => {
        destroyed.push([ref, actor]);
        return true;
      },
    };
    expect(await gate.close(sessions, "sess_1")).toBe(true);
    expect(destroyed).toEqual([["sess_1", "outil"]]);
    expect(await gate.close(undefined, "sess_1")).toBe(false);
  });
});

describe("readTicketSessionVerdict — le format lu par l'outil est celui que la route produit", () => {
  it("un verdict 200 se relit à l'identique ; un refus rend son message", async () => {
    const store = new SessionTicketStore();
    const ok = await openTicketSession(
      { ticket: store.issue("alice"), remoteAddress: LOCAL },
      flow().deps(store),
    );
    expect(readTicketSessionVerdict(JSON.stringify(ok))).toEqual({
      identifier: "alice",
      roles: ["ROLE_USER"],
      ref: "sess_abc",
    });
    const refused = await openTicketSession(
      { ticket: "forgé", remoteAddress: LOCAL },
      flow().deps(store),
    );
    expect(readTicketSessionVerdict(JSON.stringify(refused))).toEqual({
      message: TICKET_SESSION_REFUSED,
    });
  });

  it("sans confiance : illisible, non objet, rôles non chaîne", () => {
    expect(readTicketSessionVerdict(null)).toEqual({
      message: "réponse illisible",
    });
    expect(readTicketSessionVerdict("3")).toEqual({
      message: "réponse illisible",
    });
    expect(
      readTicketSessionVerdict(
        JSON.stringify({ identifier: "a", ref: "r", roles: ["R", 1] }),
      ),
    ).toEqual({ identifier: "a", ref: "r", roles: ["R"] });
    expect(readTicketSessionVerdict("{}")).toEqual({
      message: "réponse sans compte",
    });
  });
});
