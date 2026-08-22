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
import { outlineMarkdown } from "../kernel/inspect/docOutline";
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
    const read = await callAdminEndpoint(brokerDocs(), {
      namespace: "kernel",
      path: "module/{name}/docs/{slug}",
      params: { name: "security", slug: "firewall" },
      query: { section: "Zonnes" },
      label: "security/firewall",
    });

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
    const read = await callAdminEndpoint(brokerDocs(), {
      namespace: "kernel",
      path: "module/{name}/docs/{slug}",
      params: { name: "security", slug: "firewall" },
      query: { section: "Zones" },
    });
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
      {
        namespace: "kernel",
        path: "boom",
      },
    );
    expect(read.ok).to.equal(false);
    if (read.ok) return;
    expect(read.reason).to.equal("handler-failed");
    expect(read.message).to.contain("store injoignable");
  });
});
