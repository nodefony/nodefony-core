import { runningAppPort } from "nodefony/testing";
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

/**
 * L'identité rejouée par TOUTES les requêtes du cycle — sauf celles qui
 * mesurent un refus.
 *
 * Le CRUD généré répond à un anonyme tant que rien ne le protège. Mais dès que
 * l'application pose une zone de firewall sur l'espace où vit la ressource — ce
 * qu'une application réelle finit toujours par faire — un cycle anonyme casse
 * en 401, et le réflexe le moins coûteux devient d'ouvrir une exception pour
 * cette route. **Un test qui pousse à désarmer une garde est pire qu'un test
 * absent** : il transforme la protection en panne à réparer.
 *
 * Le cycle s'authentifie donc par défaut, et reste vert que l'espace soit
 * ouvert ou fermé. La seule requête volontairement anonyme est celle qui PROUVE
 * le refus — elle est commentée comme telle.
 */
let AUTH: Record<string, string> = {};

/** En-têtes d'une requête à corps JSON, identité comprise. */
const entetes = (): Record<string, string> => ({
  "content-type": "application/json",
  ...AUTH,
});

describe("e2e — <%= it.pascal %> : le cycle CRUD complet", () => {
  beforeAll(async () => {
    const port = runningAppPort();
    BASE = `http://127.0.0.1:${port}`;
<% if (it.hasSecurity) { %>    AUTH = { cookie: await connexionAdmin() };
<% } %>  });

  it("POST → 201 + Location, puis GET sur cette Location", async () => {
    const payload = sample(1);
    const created = await fetch(`${BASE}${ROUTE}`, {
      method: "POST",
      headers: entetes(),
      body: JSON.stringify(payload),
    });
    expect(created.status).toBe(201);
    // `Location` n'est pas décoratif : c'est ce qui dispense le client de
    // deviner l'URL de ce qu'il vient de créer.
    const location = created.headers.get("location");
    expect(location).toBeTruthy();

    const reread = await fetch(`${BASE}${location}`, { headers: AUTH });
    expect(reread.status).toBe(200);
<% if (it.comparableField) { %>    const body = await json(reread);
    expect(body["<%= it.comparableField %>"]).toBe(
      (payload as Record<string, unknown>)["<%= it.comparableField %>"],
    );
<% } %>  });

  it("PATCH retouche sans exiger le document entier", async () => {
    const created = await fetch(`${BASE}${ROUTE}`, {
      method: "POST",
      headers: entetes(),
      body: JSON.stringify(sample(2)),
    });
    const id = (await json(created)).id;

    const patched = await fetch(`${BASE}${ROUTE}/${String(id)}`, {
      method: "PATCH",
      headers: entetes(),
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
      headers: entetes(),
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
      headers: entetes(),
      body: JSON.stringify(payload),
    });
    expect(first.status).toBe(201);

    const duplicate = await fetch(`${BASE}${ROUTE}`, {
      method: "POST",
      headers: entetes(),
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
        headers: entetes(),
        body: JSON.stringify(sample(n)),
      });
    }
    const res = await fetch(`${BASE}${ROUTE}?limit=2`, { headers: AUTH });
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
    const res = await fetch(`${BASE}${ROUTE}?limit=100000`, {
      headers: AUTH,
    });
    const page = (await res.json()) as { limit: number };
    // Plafonné, pas refusé : le client reçoit une réponse utile, et la table
    // entière ne part jamais en mémoire.
    expect(page.limit).toBeLessThanOrEqual(100);
  });

  it("un tri sur un champ non déclaré est REFUSÉ, pas ignoré", async () => {
    // Le pire n'est pas le refus, c'est son absence : une page rendue dans un
    // ordre qui n'est pas celui demandé, avec un 200, ne se voit nulle part.
    const res = await fetch(`${BASE}${ROUTE}?order=champInexistant:ASC`, {
      headers: AUTH,
    });
    expect(res.status).toBe(400);
  });

  it("le tri ORDONNE : DESC est l'inverse EXACT d'ASC", async () => {
    // Refuser un champ inconnu ne prouve PAS que le tri trie — un `ORDER BY`
    // mort passe ce refus sans broncher. Ce sont deux tests, pas un.
    //
    // Et un test de tri est complaisant par défaut : lu sur un champ absent de
    // la réponse, il compare des `undefined`, qui forment une suite
    // parfaitement triée dans les deux sens. D'où trois affirmations.
    for (const n of [201, 202, 203]) {
      await fetch(`${BASE}${ROUTE}`, {
        method: "POST",
        headers: entetes(),
        body: JSON.stringify(sample(n)),
      });
    }
    const lire = async (dir: string): Promise<unknown[]> => {
      const res = await fetch(
        `${BASE}${ROUTE}?order=<%= it.sortProbe %>:${dir}&limit=100`,
        { headers: AUTH },
      );
      expect(res.status).toBe(200);
      const page = (await res.json()) as {
        items: Record<string, unknown>[];
        hasNext: boolean;
      };
      // ASC et DESC doivent porter sur le MÊME ensemble : au-delà d'une page,
      // l'un rend les plus petits et l'autre les plus grands, et les comparer
      // ne veut plus rien dire.
      expect(page.hasNext).toBe(false);
      return page.items.map((r) => r["<%= it.sortProbe %>"]);
    };
    const asc = await lire("ASC");
    const desc = await lire("DESC");
    // 1. le champ est PRÉSENT — sans quoi on ordonne des `undefined` ;
    expect(asc.every((v) => v !== undefined)).toBe(true);
    // 2. ses valeurs sont DISTINCTES — une colonne constante rend « trié » tout
    //    ordre, y compris celui que la base a choisi toute seule ;
    expect(new Set(asc).size).toBe(asc.length);
    // 3. l'ordre S'INVERSE — le seul point qu'un tri débranché ne simule pas.
    expect(desc).toEqual([...asc].reverse());
  });

  it("un paramètre que PERSONNE ne reconnaît est REFUSÉ", async () => {
    // La faute de frappe est le cas réel : sans ce refus, `?<%= it.filters.length ? it.filters[0].name.slice(0, -1) : "actf" %>=…` rend la
    // collection ENTIÈRE, et le client la lit comme le résultat de son filtre.
    const res = await fetch(`${BASE}${ROUTE}?<%= it.filters.length ? it.filters[0].name.slice(0, -1) : "actf" %>=x`, {
      headers: AUTH,
    });
    expect(res.status).toBe(400);
  });
<% if (it.malformedProbe) { %>
  it("une valeur mal formée pour un filtre déclaré est REFUSÉE", async () => {
    // `?<%= it.malformedProbe.name %>=<%= it.malformedProbe.value %>` : le filtre existe, sa valeur ne convient pas.
    // Le poser à « absent » rendrait une page non filtrée sous un 200.
    //
    // Toutes les natures ne peuvent pas refuser : un filtre `"string"` accepte
    // n'importe quelle chaîne. Ce test n'est donc émis que pour un booléen, un
    // entier ou une énumération — sinon il exigerait le refus d'une valeur
    // valide, et c'est le générateur qu'il mettrait en défaut.
    const res = await fetch(`${BASE}${ROUTE}?<%= it.malformedProbe.name %>=<%= it.malformedProbe.value %>`, {
      headers: AUTH,
    });
    expect(res.status).toBe(400);
  });
<% } %><% if (it.filterProbe) { %>
  it("le filtre FILTRE : la valeur exclue ne remonte pas", async () => {
    // Refuser une valeur mal formée ne prouve PAS qu'une valeur VALIDE réduit
    // l'ensemble — encore deux tests, pas un.
    //
    // Et il faut une ligne TÉMOIN, qui ne matche pas : tous les échantillons
    // portent la même valeur pour ce champ, donc sans elle « toutes les lignes
    // rendues portent la valeur demandée » resterait vrai avec le filtre
    // débranché. C'est le témoin qui fait le test, pas l'assertion.
    for (const [n, valeur] of [
      [401, <%= it.filterProbe.matchJson %>],
      [402, <%= it.filterProbe.otherJson %>],
    ] as const) {
      await fetch(`${BASE}${ROUTE}`, {
        method: "POST",
        headers: entetes(),
        body: JSON.stringify({ ...sample(n), <%= it.filterProbe.name %>: valeur }),
      });
    }
    const lire = async (url: string): Promise<unknown[]> => {
      const res = await fetch(url, { headers: AUTH });
      expect(res.status).toBe(200);
      const page = (await res.json()) as { items: Record<string, unknown>[] };
      return page.items.map((r) => r["<%= it.filterProbe.name %>"]);
    };
    // Le témoin est bien LÀ, et remonte quand on ne filtre pas — sinon
    // l'assertion suivante serait vraie pour une raison sans rapport.
    const tout = await lire(`${BASE}${ROUTE}?limit=100`);
    expect(tout).toContain(<%= it.filterProbe.otherJson %>);
    // Filtré, il disparaît — et il ne reste QUE la valeur demandée.
    const filtre = await lire(
      `${BASE}${ROUTE}?<%= it.filterProbe.name %>=<%= it.filterProbe.match %>&limit=100`,
    );
    expect(filtre.length).toBeGreaterThan(0);
    expect(filtre.every((v) => v === <%= it.filterProbe.matchJson %>)).toBe(true);
  });
<% } %><% if (it.relations.length) { %>
  it("une relation inconnue dans ?include= est REFUSÉE", async () => {
    // Charger l'enregistrement SANS la relation demandée, sous un 200, laisse
    // croire que la relation est vide alors que le nom était mal écrit.
    // `?include=` se lit sur la fiche, pas sur la liste : la liste, qui ne le
    // lit pas, le refuse comme paramètre inconnu — et c'est cohérent.
    const created = await fetch(`${BASE}${ROUTE}`, {
      method: "POST",
      headers: entetes(),
      body: JSON.stringify(sample(300)),
    });
    const id = String((await json(created)).id);
    const res = await fetch(
      `${BASE}${ROUTE}/${id}?include=relationQuiNexistePas`,
      { headers: AUTH },
    );
    expect(res.status).toBe(400);
  });
<% } %>
  it("DELETE → 204, et l'enregistrement n'est plus lisible", async () => {
    const created = await fetch(`${BASE}${ROUTE}`, {
      method: "POST",
      headers: entetes(),
      body: JSON.stringify(sample(200)),
    });
    const id = String((await json(created)).id);
    // La suppression est réservée à `ROLE_ADMIN` : sans identité, elle est
    // refusée — c'est le comportement voulu, et le test qui suit le prouve.
    // L'identité est celle du cycle (`AUTH`), pas une session ouverte à part :
    // deux sources d'identité dans un même fichier finissent par diverger.
    const removed = await fetch(`${BASE}${ROUTE}/${id}`, {
      method: "DELETE",
      headers: AUTH,
    });
    // 204 : il n'y a plus rien à décrire, donc pas de corps.
    expect(removed.status).toBe(204);

    const gone = await fetch(`${BASE}${ROUTE}/${id}`, { headers: AUTH });
    expect(gone.status).toBe(404);

    // Supprimer deux fois n'est pas la même chose que supprimer une absente :
    // le 404 permet au client de distinguer les deux.
    const again = await fetch(`${BASE}${ROUTE}/${id}`, {
      method: "DELETE",
      headers: AUTH,
    });
    expect(again.status).toBe(404);
  });
<% if (it.hasSecurity) { %>
  it("DELETE sans identité → refusé, et l'enregistrement survit", async () => {
    // Échantillon PROPRE à ce test : `300` sert déjà au test d'`?include=`.
    // Sur une entité qui porte une relation ET un champ unique, la seconde
    // insertion était refusée comme doublon, `id` valait « undefined », et
    // c'est une absence que ce test lisait — il accusait la garde qu'il mesure
    // au lieu de son décor.
    const created = await fetch(`${BASE}${ROUTE}`, {
      method: "POST",
      headers: entetes(),
      body: JSON.stringify(sample(301)),
    });
    const id = String((await json(created)).id);

    // Personne n'est authentifié : le framework refuse AVANT d'entrer dans
    // l'action. 401 ou 403 selon la zone qui couvre la route — ce qui compte
    // est le refus, pas son code.
    const refuse = await fetch(`${BASE}${ROUTE}/${id}`, { method: "DELETE" });
    expect([401, 403]).toContain(refuse.status);

    // Et surtout : la donnée est toujours là. Un refus qui supprime quand même
    // serait pire qu'une absence de garde, parce qu'il rassure.
    const survit = await fetch(`${BASE}${ROUTE}/${id}`, { headers: AUTH });
    expect(survit.status).toBe(200);

    await fetch(`${BASE}${ROUTE}/${id}`, {
      method: "DELETE",
      headers: AUTH,
    });
  });
<% } %>});
