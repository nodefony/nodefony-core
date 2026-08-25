import { describe, it, expect, beforeAll } from "vitest";
import { readRuntimeState } from "nodefony";
import { inspect, routesParChemin, type RouteInspectee } from "./harness";

/**
 * ÉTAGE 3 — E2E : un serveur RÉEL, en mode production, interrogé en HTTP et WS.
 *
 * Le mode compte autant que le protocole. En développement, tout est chargé et
 * tout est bavard ; en production, un module `policy: "dev"` disparaît, les
 * traces se taisent, les comptes ne sont plus semés. Un défaut propre au mode
 * livré n'apparaît qu'ici — ou le jour du déploiement, quand plus personne ne
 * regarde.
 *
 * Le serveur n'est PAS démarré par ce fichier : `tests/e2e.setup.ts`, écrit par
 * le scaffold dans l'application, le fait une fois pour toute la suite. On
 * réutilise son décor plutôt que d'en monter un second — deux harnais qui
 * démarrent la même application se marchent dessus, et le second ne prouverait
 * rien de plus.
 */

let BASE = "http://127.0.0.1:5151";
let WS_BASE = "ws://127.0.0.1:5151";
let routes: RouteInspectee[] = [];

/** L'en-tête `Cookie` d'une session d'administration, ou `null` si l'app n'a pas de firewall. */
let cookieAdmin: string | null = null;

/**
 * Une ressource REST générée : son chemin de collection et son chemin d'item.
 *
 * Découverte par introspection, jamais écrite en dur — ces suites doivent
 * pouvoir juger n'importe quelle application témoin, pas seulement celle que le
 * banc compose aujourd'hui.
 */
let collection: string | null = null;

beforeAll(async () => {
  const port = readRuntimeState(process.cwd())?.ports[0] ?? 5151;
  BASE = `http://127.0.0.1:${port}`;
  WS_BASE = `ws://127.0.0.1:${port}`;

  routes = inspect<RouteInspectee[]>("routes");
  const parChemin = routesParChemin(routes.filter((r) => r.module === "app"));
  for (const [chemin, liste] of parChemin) {
    if (chemin.includes("{")) continue;
    const methodes = new Set(liste.flatMap((r) => r.methods));
    const item = parChemin.get(`${chemin}/{id}`);
    if (
      methodes.has("POST") &&
      methodes.has("GET") &&
      item !== undefined &&
      item.some((r) => r.methods.includes("DELETE"))
    ) {
      collection = chemin;
      break;
    }
  }

  try {
    const setup = (await import("../tests/e2e.setup")) as {
      connexionAdmin?: () => Promise<string>;
    };
    if (typeof setup.connexionAdmin === "function") {
      cookieAdmin = await setup.connexionAdmin();
    }
  } catch {
    // Pas de firewall dans cette application : les cas qui exigent une identité
    // se déclarent eux-mêmes non applicables plutôt que d'échouer sur le décor.
    cookieAdmin = null;
  }
}, 240_000);

describe("e2e — le serveur répond, et c'est bien LUI", () => {
  it("l'introspection a trouvé des routes (garde anti-suite creuse)", () => {
    expect(routes.length).toBeGreaterThan(10);
  });

  it("une ressource REST a été DÉCOUVERTE (garde anti-suite creuse)", () => {
    // Sans ce cas, toute la famille CRUD ci-dessous rend la main sur
    // `collection === null` et compte VERT en 0 ms : quinze cas passés, zéro
    // requête émise. C'est le faux vert le plus coûteux du dépôt, et il ne se
    // voit que dans la colonne des durées.
    expect(
      collection,
      "aucune collection REST (POST + GET + DELETE/{id}) dans les routes du module app",
    ).not.toBeNull();
  });

  it("une identité d'administration a été obtenue (garde anti-suite creuse)", () => {
    // Idem pour les cas qui exigent une session : sans cookie, « la suppression
    // exige une identité » ne prouve rien — il rend la main avant sa première
    // requête.
    expect(
      cookieAdmin,
      "connexion admin impossible — les cas d'autorisation ne mesureraient rien",
    ).not.toBeNull();
  });

  it("la sonde de vivacité `/livez` répond 200", async () => {
    const res = await fetch(`${BASE}/livez`);
    expect(res.status).toBe(200);
  });

  it("la sonde de disponibilité `/readyz` répond 200", async () => {
    // Celle que k8s interroge pour décider d'envoyer du trafic. Elle diffère de
    // `/livez` : un pod peut être VIVANT et pas encore PRÊT — et une
    // application qui confond les deux se fait retirer du service au premier
    // hoquet de sa base.
    const res = await fetch(`${BASE}/readyz`);
    expect(res.status).toBe(200);
  });

  it("une route inexistante rend 404, et AUCUNE trace d'exécution", async () => {
    // En production, un corps d'erreur qui porte une pile expose l'arborescence
    // du serveur et les noms internes. Le 404 est attendu ; ce qu'on regarde,
    // c'est ce qu'il RACONTE.
    const res = await fetch(`${BASE}/api/__route-qui-n-existe-pas__`);
    expect(res.status).toBe(404);
    const corps = await res.text();
    expect(corps).not.toMatch(/at\s+\w+\s+\(.*:\d+:\d+\)/);
    expect(corps).not.toMatch(/node_modules|node:internal/);
  });

  it("un corps JSON malformé est REFUSÉ, jamais une erreur serveur", async () => {
    if (collection === null) return;
    const res = await fetch(`${BASE}${collection}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(cookieAdmin !== null ? { cookie: cookieAdmin } : {}),
      },
      body: "{ ceci n'est pas du JSON",
    });
    // 400 (syntaxe), 401/403 (identité exigée d'abord), 422 (contrat) : toutes
    // sont des réponses correctes. 500 dit qu'une exception est remontée nue.
    expect(res.status).toBeLessThan(500);
  });
});

describe("e2e — le CRUD promis par une ressource générée", () => {
  /** L'enregistrement créé par le premier cas, réutilisé par les suivants. */
  let idCree: string | null = null;
  /** Le corps qui a servi à le créer. */
  let corpsCree: Record<string, unknown> | null = null;
  /** Le statut et l'en-tête `Location` de la création qui a abouti. */
  let statutCreation: number | null = null;
  let locationCreation: string | null = null;

  const entetes = (): Record<string, string> => ({
    "content-type": "application/json",
    ...(cookieAdmin !== null ? { cookie: cookieAdmin } : {}),
  });

  /**
   * Fabrique un corps acceptable en INTERROGEANT la ressource, par tâtonnement.
   *
   * On ne devine pas les champs : on poste un corps vide, on lit ceux que
   * l'application réclame, on les remplit, on recommence. Un test qui
   * inventerait des noms de champs serait rouge sur toute application autre que
   * celle du banc — et un test qui lirait un format d'erreur supposé rendrait
   * `null` en silence, ce qui a rendu toute cette famille CREUSE au premier run
   * (quinze cas verts, zéro requête).
   *
   * Le format est celui que l'application rend VRAIMENT, relevé sur un serveur
   * réel : `error.fields[] = { field, message, rule }`. Le type attendu se lit
   * dans le message (« expected string », « expected number »), faute de quoi
   * une valeur textuelle envoyée à une colonne numérique relance un 422 sans fin.
   */
  function valeurPour(champ: string, message: string): unknown {
    const marqueur =
      Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
    if (/expected number|expected int/i.test(message)) return 1;
    if (/expected boolean/i.test(message)) return true;
    if (/email/i.test(champ)) return `conf-${marqueur}@example.test`;
    return `conf-${marqueur}`;
  }

  async function corpsValide(): Promise<Record<string, unknown> | null> {
    if (collection === null) return null;
    const corps: Record<string, unknown> = {};
    // Cinq tours : chaque tour ne révèle que les champs refusés à ce stade —
    // une énumération peut n'apparaître qu'une fois les requis satisfaits.
    for (let tour = 0; tour < 5; tour += 1) {
      const res = await fetch(`${BASE}${collection}`, {
        method: "POST",
        headers: entetes(),
        body: JSON.stringify(corps),
      });
      if (res.status === 201) {
        statutCreation = res.status;
        locationCreation = res.headers.get("location");
        const cree = (await res.json().catch(() => null)) as {
          id?: string;
        } | null;
        if (cree !== null && typeof cree.id === "string") idCree = cree.id;
        return corps;
      }
      if (res.status !== 422 && res.status !== 400) return null;
      const detail = (await res.json().catch(() => null)) as {
        error?: { fields?: Array<{ field?: string; message?: string }> };
      } | null;
      const fautifs = detail?.error?.fields ?? [];
      if (fautifs.length === 0) return null;
      let progres = false;
      for (const f of fautifs) {
        if (typeof f.field !== "string") continue;
        corps[f.field] = valeurPour(f.field, f.message ?? "");
        progres = true;
      }
      if (!progres) return null;
    }
    return null;
  }

  it("un corps vide est REFUSÉ (422), la ressource ne se crée pas à moitié", async () => {
    if (collection === null) return;
    const res = await fetch(`${BASE}${collection}`, {
      method: "POST",
      headers: entetes(),
      body: "{}",
    });
    expect([400, 422]).toContain(res.status);
  });

  it("le contrat de la ressource a livré un corps valide (garde anti-suite creuse)", async () => {
    // La déduction du corps passe par un 422 dont on lit les champs manquants.
    // Si le format d'erreur change, elle rend `null` — et les six cas suivants
    // se taisent en vert. On l'énonce ici, une fois.
    if (collection === null) return;
    corpsCree = await corpsValide();
    expect(
      corpsCree,
      "impossible de déduire un corps valide du 422 — le format d'erreur a-t-il changé ?",
    ).not.toBeNull();
  });

  it("une création valide rend 201 et l'adresse de la ressource", () => {
    // Le verdict est celui de la création qui a ABOUTI pendant le tâtonnement.
    // Reposter le même corps ici créerait un doublon — ou buterait sur la
    // contrainte d'unicité d'un champ, et le cas accuserait la création d'un
    // défaut qui serait le sien.
    if (collection === null || corpsCree === null) return;
    expect(statutCreation).toBe(201);
    // `Location` n'est pas décoratif : c'est ce qui rend une API REST
    // navigable, et l'en-tête que tout client génère à partir du contrat.
    expect(locationCreation).toBeTruthy();
  });

  it("rejouer le MÊME corps est refusé si un champ est unique", async () => {
    // Un 409 est la bonne réponse ; un 201 l'est aussi quand aucun champ n'est
    // unique. Ce qu'on refuse, c'est le 500 — une contrainte de base qui
    // remonte nue jusqu'au client.
    if (collection === null || corpsCree === null) return;
    const res = await fetch(`${BASE}${collection}`, {
      method: "POST",
      headers: entetes(),
      body: JSON.stringify(corpsCree),
    });
    expect([201, 409, 422]).toContain(res.status);
  });

  it("la création a rendu un identifiant (garde anti-suite creuse)", () => {
    if (collection === null) return;
    expect(
      idCree,
      "aucun id rendu par la création — les cas suivants seraient muets",
    ).not.toBeNull();
  });

  it("la ressource créée se relit à son adresse", async () => {
    if (collection === null || idCree === null) return;
    const res = await fetch(`${BASE}${collection}/${idCree}`, {
      headers: entetes(),
    });
    expect(res.status).toBe(200);
  });

  it("la liste est PAGINÉE, et sa borne ne se laisse pas dicter", async () => {
    // Une limite acceptée telle quelle est un déni de service à une requête :
    // `?limit=1000000` fait charger toute la table en mémoire. La borne doit
    // être celle du serveur, pas celle du client.
    if (collection === null) return;
    const res = await fetch(`${BASE}${collection}?limit=1000000`, {
      headers: entetes(),
    });
    expect(res.status).toBeLessThan(500);
    const corps = (await res.json().catch(() => null)) as {
      data?: unknown[];
      items?: unknown[];
      limit?: number;
    } | null;
    if (corps === null) return;
    const lus = corps.data ?? corps.items;
    if (Array.isArray(lus)) expect(lus.length).toBeLessThanOrEqual(1000);
    if (typeof corps.limit === "number")
      expect(corps.limit).toBeLessThanOrEqual(1000);
  });

  it("une modification partielle (PATCH) est acceptée", async () => {
    if (collection === null || idCree === null || corpsCree === null) return;
    const [champ] = Object.keys(corpsCree);
    const res = await fetch(`${BASE}${collection}/${idCree}`, {
      method: "PATCH",
      headers: entetes(),
      body: JSON.stringify({ [champ]: `patch-${Date.now().toString(36)}` }),
    });
    expect([200, 204]).toContain(res.status);
  });

  it("la SUPPRESSION exige une identité — sans elle, la donnée survit", async () => {
    if (collection === null || idCree === null || cookieAdmin === null) return;
    const anonyme = await fetch(`${BASE}${collection}/${idCree}`, {
      method: "DELETE",
    });
    expect([401, 403]).toContain(anonyme.status);
    // Le refus ne suffit pas : ce qui compte est que la donnée soit TOUJOURS là.
    // Une garde qui refuse APRÈS avoir supprimé rendrait le même code.
    const survit = await fetch(`${BASE}${collection}/${idCree}`, {
      headers: entetes(),
    });
    expect(survit.status).toBe(200);
  });

  it("supprimée, la ressource rend 204 puis 404", async () => {
    if (collection === null || idCree === null) return;
    const suppr = await fetch(`${BASE}${collection}/${idCree}`, {
      method: "DELETE",
      headers: entetes(),
    });
    expect([200, 204]).toContain(suppr.status);
    const apres = await fetch(`${BASE}${collection}/${idCree}`, {
      headers: entetes(),
    });
    expect(apres.status).toBe(404);
  });
});

describe("e2e — ce que le navigateur reçoit", () => {
  it("le type de contenu n'est jamais laissé au reniflage", async () => {
    // `X-Content-Type-Options: nosniff` — sans lui, un navigateur peut décider
    // qu'un JSON est du HTML et l'exécuter.
    const res = await fetch(`${BASE}/livez`);
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
  });

  it("le cookie de session est inaccessible au script et lié au site", async () => {
    if (cookieAdmin === null) return;
    const res = await fetch(`${BASE}/nodefony/security/api/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        username: "admin",
        password: "e2e-admin-jetable",
      }),
    });
    const poses = res.headers.getSetCookie?.() ?? [];
    expect(poses.length).toBeGreaterThan(0);
    for (const c of poses) {
      expect(c.toLowerCase()).toContain("httponly");
      expect(c.toLowerCase()).toContain("samesite");
    }
  });
});

describe("e2e — HTTP et WebSocket, le même contexte", () => {
  it("un chemin déclaré en WEBSOCKET répond vraiment en WebSocket", async () => {
    // La co-citoyenneté est le différenciateur du framework : le MÊME
    // controller sert les deux protocoles. Le vérifier ici prouve que le
    // câblage généré la conserve — une route WS déclarée mais non montée est
    // invisible à toute suite HTTP.
    const ws = routes.find(
      (r) => r.methods.includes("WEBSOCKET") && !r.path.includes("{"),
    );
    if (ws === undefined) return;
    const socket = new WebSocket(`${WS_BASE}${ws.path}`);
    const ouvert = await new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => resolve(false), 10_000);
      socket.addEventListener("open", () => {
        clearTimeout(timer);
        resolve(true);
      });
      socket.addEventListener("error", () => {
        clearTimeout(timer);
        resolve(false);
      });
    });
    socket.close();
    expect(ouvert).toBe(true);
  }, 20_000);
});
