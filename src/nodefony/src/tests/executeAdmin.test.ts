import { expect } from "chai";
import nodefonyError from "../Error";
import {
  executeAdminEndpoint,
  normalizeAdminResult,
  type IAdminExecution,
  type IAdminGateVerdict,
} from "../kernel/adminPlane/executeAdmin";
import {
  callAdminEndpoint,
  type IAdminBrokerLike,
} from "../kernel/inspect/adminSubjects";
import {
  localOperatorCaller,
  rolesFromScopes,
  ADMIN_SCOPE_READ,
  type IAdminCaller,
} from "../kernel/adminPlane/adminCaller";
import { outlineMarkdown } from "../kernel/inspect/docOutline";
import { mcpCallerRoles } from "../mcp/caller";
import type {
  IAdminApi,
  IAdminEndpoint,
  IAdminRequest,
} from "../types/IAdminApi";

// Porte UNIQUE d'exécution du plan d'administration. Ce banc verrouille ce que
// la DUPLICATION coûtait : deux chemins vers le même handler (la route HTTP
// d'un côté, la commande `inspect` et le serveur MCP de l'autre), dont le
// second perdait l'autorisation, la normalisation des en-têtes, et surtout le
// CORPS que le producteur avait préparé pour expliquer son refus.

const ADMIN = "ROLE_NODEFONY_ADMIN";

/** Requête minimale — chaque test surcharge ce qui l'intéresse. */
const requete = (patch: Partial<IAdminRequest> = {}): IAdminRequest => ({
  params: {},
  query: {},
  body: null,
  user: null,
  roles: [ADMIN],
  ...patch,
});

describe("executeAdminEndpoint — RBAC (fail-closed)", () => {
  const endpoint: IAdminEndpoint = { path: "x", handler: async () => "secret" };

  it("rôle absent → 403, et le handler n'est JAMAIS appelé", async () => {
    let appele = false;
    const execution = await executeAdminEndpoint({
      endpoint: {
        path: "x",
        handler: async () => {
          appele = true;
          return "secret";
        },
      },
      request: requete({ roles: [] }),
      requiredRole: ADMIN,
      gate: null,
    });
    expect(execution.status).to.equal(403);
    expect(execution.body).to.deep.equal({
      error: "Forbidden",
      required: ADMIN,
    });
    expect(appele, "le handler ne doit pas s'exécuter").to.equal(false);
  });

  it("rôle porté → le handler répond", async () => {
    const execution = await executeAdminEndpoint({
      endpoint,
      request: requete(),
      requiredRole: ADMIN,
      gate: null,
    });
    expect(execution).to.deep.equal({ status: 200, body: "secret" });
  });

  it("rôle exigé vide (endpoint public) → accordé sans rôle", async () => {
    const execution = await executeAdminEndpoint({
      endpoint,
      request: requete({ roles: [] }),
      requiredRole: "",
      gate: null,
    });
    expect(execution.status).to.equal(200);
  });
});

describe("executeAdminEndpoint — normalisation", () => {
  it("donnée brute → 200", () => {
    expect(normalizeAdminResult({ a: 1 })).to.deep.equal({
      status: 200,
      body: { a: 1 },
    });
  });

  it("enveloppe {status, body} → statut et corps honorés", () => {
    expect(
      normalizeAdminResult({ status: 404, body: { error: "nope" } }),
    ).to.deep.equal({
      status: 404,
      headers: undefined,
      body: { error: "nope" },
    });
  });

  it("les en-têtes du producteur SURVIVENT (ce que la porte pauvre perdait)", () => {
    const n = normalizeAdminResult({
      headers: { "content-type": "text/csv" },
      body: "a,b",
    });
    expect(n.headers).to.deep.equal({ "content-type": "text/csv" });
    expect(n.status).to.equal(200);
  });

  it("un objet métier qui porte `body` SEUL n'est pas une enveloppe", () => {
    const n = normalizeAdminResult({ body: "corps du webhook", id: 7 });
    expect(n.status).to.equal(200);
    expect(n.body).to.deep.equal({ body: "corps du webhook", id: 7 });
  });
});

describe("executeAdminEndpoint — porte (idempotence)", () => {
  it("court-circuit → le handler n'est pas appelé, la réponse est celle de la porte", async () => {
    let appele = false;
    const execution = await executeAdminEndpoint({
      endpoint: {
        path: "x",
        handler: async () => {
          appele = true;
          return "exécuté";
        },
      },
      request: requete(),
      requiredRole: ADMIN,
      gate: () => ({
        shortCircuit: { status: 409, body: { error: "in flight" } },
      }),
    });
    expect(execution.status).to.equal(409);
    expect(appele).to.equal(false);
  });

  it("succès → `onSuccess` reçoit l'issue exacte (mémorisation d'un rejeu)", async () => {
    let memorise: IAdminExecution | null = null;
    const execution = await executeAdminEndpoint({
      endpoint: {
        path: "x",
        handler: async () => ({ status: 201, body: { id: 1 } }),
      },
      request: requete(),
      requiredRole: ADMIN,
      gate: () => ({ onSuccess: (resp) => void (memorise = resp) }),
    });
    expect(execution.status).to.equal(201);
    expect(memorise).to.deep.equal(execution);
  });

  it("panne → `onFailure` libère la clé, l'appel reste réessayable", async () => {
    let libere = false;
    const verdict: IAdminGateVerdict = {
      onFailure: () => void (libere = true),
    };
    const execution = await executeAdminEndpoint({
      endpoint: {
        path: "x",
        handler: async () => {
          throw new Error("boom");
        },
      },
      request: requete(),
      requiredRole: ADMIN,
      gate: () => verdict,
      onServerError: () => {},
    });
    expect(execution.status).to.equal(500);
    expect(libere).to.equal(true);
  });

  it("le RBAC passe AVANT la porte — un 403 ne consomme aucune clé", async () => {
    let porteEvaluee = false;
    await executeAdminEndpoint({
      endpoint: { path: "x", handler: async () => "secret" },
      request: requete({ roles: [] }),
      requiredRole: ADMIN,
      gate: () => {
        porteEvaluee = true;
        return {};
      },
    });
    expect(porteEvaluee).to.equal(false);
  });
});

describe("executeAdminEndpoint — erreurs", () => {
  it("erreur cliente 4xx d'un `nodefonyError` → restituée telle quelle, PAS journalisée", async () => {
    let journalise = false;
    const erreur = new nodefonyError("mode de pagination non supporté");
    erreur.code = 400;
    const execution = await executeAdminEndpoint({
      endpoint: {
        path: "x",
        handler: async () => {
          throw erreur;
        },
      },
      request: requete(),
      requiredRole: ADMIN,
      gate: null,
      onServerError: () => void (journalise = true),
    });
    expect(execution.status).to.equal(400);
    expect(execution.body).to.deep.equal({
      error: "mode de pagination non supporté",
    });
    expect(journalise, "une faute du client n'est pas une panne").to.equal(
      false,
    );
  });

  it("panne → 500 opaque, et l'erreur RÉELLE est notifiée à l'appelant", async () => {
    let recue: Error | null = null;
    const execution = await executeAdminEndpoint({
      endpoint: {
        path: "x",
        handler: async () => {
          throw new Error("connexion perdue");
        },
      },
      request: requete(),
      requiredRole: ADMIN,
      gate: null,
      onServerError: (e) => void (recue = e),
    });
    expect(execution.status).to.equal(500);
    expect(execution.body).to.deep.equal({
      error: "Internal admin handler error",
    });
    expect((recue as Error | null)?.message).to.equal("connexion perdue");
  });
});

// ── LE TROU QUE CETTE EXTRACTION FERME ───────────────────────────────────────
// Demander une SECTION absente d'une page PRÉSENTE. Le producteur joint le plan
// de la page à son refus ; l'ancienne porte ne gardait que le statut, et
// l'appelant en déduisait que la PAGE n'existait pas — l'inverse de la vérité.

const PAGE = [
  "# Firewall",
  "texte",
  "## Zones",
  "texte",
  "## Règles",
  "texte",
].join("\n");

/** Producteur minimal qui refuse comme le vrai : avec le plan de la page. */
const brokerDocs = (): IAdminBrokerLike => {
  const api: IAdminApi = {
    adminNamespace: "kernel",
    adminEndpoints: () => [
      {
        path: "module/{name}/docs/{slug}",
        handler: (request: IAdminRequest) => {
          const wanted =
            typeof request.query.section === "string"
              ? request.query.section
              : "";
          if (wanted === "") return { slug: "firewall", markdown: PAGE };
          if (wanted === "Zones") return { slug: "firewall", section: "Zones" };
          return {
            status: 404,
            body: {
              error: "Section not found",
              slug: "firewall",
              section: wanted,
              outline: outlineMarkdown(PAGE),
            },
          };
        },
      },
    ],
  } as unknown as IAdminApi;
  return { list: () => [api] };
};

describe("callAdminEndpoint — le refus du producteur voyage ENTIER", () => {
  it("section absente d'une page PRÉSENTE → le refus nomme la section ET les titres réels", async () => {
    const read = await callAdminEndpoint(
      brokerDocs(),
      {
        namespace: "kernel",
        path: "module/{name}/docs/{slug}",
        params: { name: "security", slug: "firewall" },
        query: { section: "Zonnes" },
        label: "security/firewall",
      },
      localOperatorCaller(),
    );

    expect(read.ok).to.equal(false);
    if (read.ok) return;
    expect(read.status).to.equal(404);

    // Le corps préparé par le producteur est là — c'est LUI qui dit la vérité :
    // la page existe, c'est la section qui n'existe pas.
    const body = read.body as {
      error: string;
      section: string;
      outline: { title: string }[];
    };
    expect(body.error).to.contain("Section");
    expect(body.section).to.equal("Zonnes");
    expect(body.outline.map((s) => s.title)).to.deep.equal([
      "Firewall",
      "Zones",
      "Règles",
    ]);
  });

  it("la lecture qui réussit est inchangée", async () => {
    const read = await callAdminEndpoint(
      brokerDocs(),
      {
        namespace: "kernel",
        path: "module/{name}/docs/{slug}",
        params: { name: "security", slug: "firewall" },
        query: { section: "Zones" },
      },
      localOperatorCaller(),
    );
    expect(read.ok).to.equal(true);
    if (!read.ok) return;
    expect(read.data).to.deep.equal({ slug: "firewall", section: "Zones" });
  });

  it("une PANNE reste distincte d'un refus (elle ne devient pas un 500 anonyme)", async () => {
    const api = {
      adminNamespace: "kernel",
      adminEndpoints: () => [
        {
          path: "boom",
          handler: () => {
            throw new Error("store injoignable");
          },
        },
      ],
    } as unknown as IAdminApi;
    const read = await callAdminEndpoint(
      { list: () => [api] },
      { namespace: "kernel", path: "boom" },
      localOperatorCaller(),
    );
    expect(read.ok).to.equal(false);
    if (read.ok) return;
    expect(read.reason).to.equal("handler-failed");
    expect(read.message).to.contain("store injoignable");
  });
});

// ── ÉTAPE 2 : l'identité se PRÉSENTE, elle ne se fabrique plus ───────────────
// Avant, `callAdminEndpoint` posait `roles:["ROLE_NODEFONY_ADMIN"]` en dur :
// tout porteur d'un jeton d'audience valide — même sans le moindre droit —
// obtenait la lecture d'administration complète. Le contrôle de rôle existait
// et s'appliquait à un sujet inventé.

describe("callAdminEndpoint — le contrôle de rôle mord sur l'appelant RÉEL", () => {
  const brokerSecret = (): IAdminBrokerLike => {
    const api = {
      adminNamespace: "kernel",
      adminEndpoints: () => [
        { path: "config", handler: () => ({ secret: "valeur runtime" }) },
      ],
    } as unknown as IAdminApi;
    return { list: () => [api] };
  };

  const lire = (caller: IAdminCaller) =>
    callAdminEndpoint(
      brokerSecret(),
      { namespace: "kernel", path: "config", label: "config" },
      caller,
    );

  it("jeton SANS scope d'administration → REFUSÉ (c'était le trou)", async () => {
    const read = await lire({
      user: null,
      roles: rolesFromScopes(["profile", "email"]),
      label: "le porteur « agent-42 »",
    });
    expect(read.ok).to.equal(false);
    if (read.ok) return;
    expect(read.reason).to.equal("forbidden");
    expect(read.status).to.equal(403);
    // Le refus DIT à qui il s'adresse et ce qui manque : sans cela, l'appelant
    // cherche une cible valide au lieu d'un jeton.
    expect(read.message).to.contain("agent-42");
    expect(read.message).to.contain("ne porte pas le rôle");
    expect(read.message).to.contain("ROLE_NODEFONY_ADMIN");
  });

  it("jeton AVEC `admin:read` → accordé", async () => {
    const read = await lire({
      user: null,
      roles: rolesFromScopes([ADMIN_SCOPE_READ]),
      label: "le porteur « agent-42 »",
    });
    expect(read.ok).to.equal(true);
    if (!read.ok) return;
    expect(read.data).to.deep.equal({ secret: "valeur runtime" });
  });

  it("opérateur local → accordé, et l'identité est ÉNONCÉE", async () => {
    const read = await lire(localOperatorCaller());
    expect(read.ok).to.equal(true);
    expect(localOperatorCaller().label).to.contain("opérateur");
  });

  it("un refus n'est PAS un « introuvable » — les deux raisons se distinguent", async () => {
    const refus = await lire({ user: null, roles: [], label: "un anonyme" });
    const absent = await callAdminEndpoint(
      brokerSecret(),
      { namespace: "kernel", path: "nexistepas" },
      localOperatorCaller(),
    );
    expect(refus.ok).to.equal(false);
    expect(absent.ok).to.equal(false);
    if (refus.ok || absent.ok) return;
    expect(refus.reason).to.equal("forbidden");
    expect(absent.reason).to.equal("endpoint-missing");
  });
});

describe("rolesFromScopes — l'audience prouve la cible, pas le pouvoir", () => {
  it("aucun scope d'administration → aucun rôle", () => {
    expect(rolesFromScopes([])).to.deep.equal([]);
    expect(rolesFromScopes(["openid", "profile"])).to.deep.equal([]);
  });

  it("`admin:read` ou `admin:write` → le rôle d'administrateur", () => {
    expect(rolesFromScopes([ADMIN_SCOPE_READ])).to.deep.equal([
      "ROLE_NODEFONY_ADMIN",
    ]);
    expect(rolesFromScopes(["admin:write"])).to.deep.equal([
      "ROLE_NODEFONY_ADMIN",
    ]);
  });
});

describe("mcpCallerRoles — une règle pour TOUTE porte MCP, présente ou future", () => {
  it("porte NON protégée → rôle d'opérateur (son périmètre EST sa protection)", () => {
    expect(
      mcpCallerRoles({ protected: false, authenticated: false, scopes: [] }),
    ).to.deep.equal(["ROLE_NODEFONY_ADMIN"]);
  });

  it("porte protégée + jeton vérifié → ce que ses SCOPES ouvrent", () => {
    expect(
      mcpCallerRoles({
        protected: true,
        authenticated: true,
        scopes: [ADMIN_SCOPE_READ],
      }),
    ).to.deep.equal(["ROLE_NODEFONY_ADMIN"]);
    expect(
      mcpCallerRoles({
        protected: true,
        authenticated: true,
        scopes: ["openid"],
      }),
    ).to.deep.equal([]);
  });

  it("porte protégée + anonyme toléré → RIEN (sinon la déclaration est vide de sens)", () => {
    expect(
      mcpCallerRoles({ protected: true, authenticated: false, scopes: [] }),
    ).to.deep.equal([]);
  });

  it("une porte plus stricte passe SES rôles d'opérateur, sans réécrire la règle", () => {
    expect(
      mcpCallerRoles(
        { protected: false, authenticated: false, scopes: [] },
        [],
      ),
    ).to.deep.equal([]);
  });
});
