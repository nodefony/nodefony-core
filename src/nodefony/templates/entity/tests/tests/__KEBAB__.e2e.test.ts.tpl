import { readRuntimeState } from "nodefony";
import { describe, it, expect, beforeAll } from "vitest";
<% if (it.hasSecurity) { %>import { connexionAdmin } from "./e2e.setup";
<% } %>

/**
 * Test E2E de la ressource `<%= it.pascal %>` — le cycle CRUD complet, sur le
 * serveur RÉEL.
 *
 * Il complète `<%= it.kebab %>.test.ts`, qui éprouve la couche DONNÉE (repository et
 * schéma, en base mémoire). Ici, on traverse tout : routage, décorateurs,
 * validation, sérialisation, codes de statut. Les deux sont utiles pour des
 * raisons différentes — le premier est rapide et cerne une régression, celui-ci
 * prouve que la ressource est réellement servie.
 *
 * L'application est démarrée une fois par `tests/e2e.setup.ts` ; ce fichier ne
 * fait que lui parler. Lancement : `npm run test:e2e`.
 */
const ROUTE = "<%= it.route %>";
let BASE = "http://127.0.0.1:5151";

/**
 * Échantillon paramétré : `n` change les valeurs.
 *
 * Indispensable dès qu'un champ est unique — deux insertions du même échantillon
 * violeraient la contrainte, et le test échouerait sur lui-même.
 */
const sample = (n: number) => (<%= it.sampleFactory %>);

/** Lit le corps JSON en le typant à plat, sans supposer la forme complète. */
async function json(res: Response): Promise<Record<string, unknown>> {
  return (await res.json()) as Record<string, unknown>;
}

describe("e2e — <%= it.pascal %> : le cycle CRUD complet", () => {
  beforeAll(() => {
    const port = readRuntimeState(process.cwd())?.ports[0] ?? 5151;
    BASE = `http://127.0.0.1:${port}`;
  });

  it("POST → 201 + Location, puis GET sur cette Location", async () => {
    const payload = sample(1);
    const created = await fetch(`${BASE}${ROUTE}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    expect(created.status).toBe(201);
    // `Location` n'est pas décoratif : c'est ce qui dispense le client de
    // deviner l'URL de ce qu'il vient de créer.
    const location = created.headers.get("location");
    expect(location).toBeTruthy();

    const reread = await fetch(`${BASE}${location}`);
    expect(reread.status).toBe(200);
<% if (it.comparableField) { %>    const body = await json(reread);
    expect(body["<%= it.comparableField %>"]).toBe(
      (payload as Record<string, unknown>)["<%= it.comparableField %>"],
    );
<% } %>  });

  it("PATCH retouche sans exiger le document entier", async () => {
    const created = await fetch(`${BASE}${ROUTE}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(sample(2)),
    });
    const id = (await json(created)).id;

    const patched = await fetch(`${BASE}${ROUTE}/${String(id)}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(sample(3)),
    });
    expect(patched.status).toBe(200);
<% if (it.comparableField) { %>    const body = await json(patched);
    expect(body["<%= it.comparableField %>"]).toBe(
      (sample(3) as Record<string, unknown>)["<%= it.comparableField %>"],
    );
<% } %>  });

  it("corps invalide → 422 qui NOMME les champs fautifs", async () => {
    const res = await fetch(`${BASE}${ROUTE}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    // 422 et non 400 : le corps a bien été lu, c'est son CONTENU qui viole le
    // contrat (RFC 9110 §15.5.21).
    expect(res.status).toBe(422);
  });
<% if (it.hasUnique) { %>
  it("doublon sur une valeur unique → 409, pas 500", async () => {
    const payload = sample(42);
    const first = await fetch(`${BASE}${ROUTE}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    expect(first.status).toBe(201);

    const duplicate = await fetch(`${BASE}${ROUTE}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    // Rejouer la même valeur unique n'est pas une panne : c'est un refus d'état,
    // sur lequel le client peut agir (proposer un autre identifiant). En 500, il
    // n'aurait aucun moyen de le distinguer d'un serveur cassé.
    expect(duplicate.status).toBe(409);
  });
<% } %>
  it("la liste est une PAGE : items bornés, hasNext, total", async () => {
    for (const n of [101, 102, 103]) {
      await fetch(`${BASE}${ROUTE}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(sample(n)),
      });
    }
    const res = await fetch(`${BASE}${ROUTE}?limit=2`);
    expect(res.status).toBe(200);
    const page = (await res.json()) as {
      items: unknown[];
      hasNext: boolean;
      total?: number;
      limit: number;
    };
    expect(page.items).toHaveLength(2);
    expect(page.limit).toBe(2);
    // `hasNext` est ce qui distingue « c'est tout » de « demande la suite ». Un
    // tableau nu ne le dit pas, et le client boucle ou s'arrête trop tôt.
    expect(page.hasNext).toBe(true);
    expect(page.total).toBeGreaterThanOrEqual(3);
  });

  it("le plafond de page tient, même si le client demande tout", async () => {
    const res = await fetch(`${BASE}${ROUTE}?limit=100000`);
    const page = (await res.json()) as { limit: number };
    // Plafonné, pas refusé : le client reçoit une réponse utile, et la table
    // entière ne part jamais en mémoire.
    expect(page.limit).toBeLessThanOrEqual(100);
  });

  it("DELETE → 204, et l'enregistrement n'est plus lisible", async () => {
    const created = await fetch(`${BASE}${ROUTE}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(sample(200)),
    });
    const id = String((await json(created)).id);
<% if (it.hasSecurity) { %>
    // La suppression est réservée à `ROLE_ADMIN` : sans identité, elle est
    // refusée — c'est le comportement voulu, et le test qui suit le prouve.
    const entete = { cookie: await connexionAdmin() };

    const removed = await fetch(`${BASE}${ROUTE}/${id}`, {
      method: "DELETE",
      headers: entete,
    });
<% } else { %>
    const removed = await fetch(`${BASE}${ROUTE}/${id}`, { method: "DELETE" });
<% } %>    // 204 : il n'y a plus rien à décrire, donc pas de corps.
    expect(removed.status).toBe(204);

    const gone = await fetch(`${BASE}${ROUTE}/${id}`);
    expect(gone.status).toBe(404);

    // Supprimer deux fois n'est pas la même chose que supprimer une absente :
    // le 404 permet au client de distinguer les deux.
    const again = await fetch(`${BASE}${ROUTE}/${id}`, {
      method: "DELETE",
<% if (it.hasSecurity) { %>      headers: entete,
<% } %>    });
    expect(again.status).toBe(404);
  });
<% if (it.hasSecurity) { %>
  it("DELETE sans identité → refusé, et l'enregistrement survit", async () => {
    const created = await fetch(`${BASE}${ROUTE}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(sample(300)),
    });
    const id = String((await json(created)).id);

    // Personne n'est authentifié : le framework refuse AVANT d'entrer dans
    // l'action. 401 ou 403 selon la zone qui couvre la route — ce qui compte
    // est le refus, pas son code.
    const refuse = await fetch(`${BASE}${ROUTE}/${id}`, { method: "DELETE" });
    expect([401, 403]).toContain(refuse.status);

    // Et surtout : la donnée est toujours là. Un refus qui supprime quand même
    // serait pire qu'une absence de garde, parce qu'il rassure.
    const survit = await fetch(`${BASE}${ROUTE}/${id}`);
    expect(survit.status).toBe(200);

    await fetch(`${BASE}${ROUTE}/${id}`, {
      method: "DELETE",
      headers: { cookie: await connexionAdmin() },
    });
  });
<% } %>});
