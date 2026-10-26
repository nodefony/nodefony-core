/**
 * Sonde de PORTABILITÉ — injectée par `scripts/bench-portability.mjs` dans
 * l'application témoin, jouée une fois par moteur, jetée avec le décor.
 *
 * Elle ne JUGE rien : elle joue les mêmes requêtes, avec les mêmes valeurs, et
 * écrit ce qu'elle a reçu — statut, corps, `Location` — dans un instantané
 * NORMALISÉ (identifiants et horodatages remplacés par des jetons stables). Le
 * banc compare ensuite l'instantané de chaque moteur à celui de SQLite : la
 * portabilité, c'est l'égalité de ces fichiers.
 *
 * Chaque cas vise un écart connu entre moteurs — une valeur aux bords d'un
 * type, une comparaison de chaînes, une contrainte — parce qu'un CRUD sur des
 * valeurs sages passerait partout sans rien prouver.
 *
 * Aucun type ni import d'ORM ici : la sonde parle HTTP, au contrat de
 * ressource. Sinon elle prouverait l'adaptateur, pas la portabilité.
 */
import { writeFileSync } from "node:fs";
import { csrfHeaders, runningAppPort } from "nodefony/testing";
import { describe, it } from "vitest";
import { adminLogin } from "../tests/e2e.setup";

/** Un cas joué : ce que le moteur a rendu, normalisé. */
interface IProbeCase {
  label: string;
  status: number;
  location?: string;
  body?: unknown;
}

const cases: IProbeCase[] = [];

/**
 * Identifiants rencontrés → jeton stable, nommé par le CAS qui l'a créé.
 *
 * Un compteur d'apparition ne suffit pas : une création refusée sur un seul
 * moteur décalerait tous les jetons suivants, et chaque cas divergerait.
 */
const tokens = new Map<string, string>();

/** Pose le jeton d'un identifiant. */
function nameId(id: string | number, name: string): void {
  tokens.set(String(id).toLowerCase(), `<id:${name}>`);
}

/** Le jeton d'un identifiant connu. */
function tokenOf(id: string | number): string {
  return tokens.get(String(id).toLowerCase()) ?? String(id);
}

const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/u;

/** Horodatages posés par le serveur : leur VALEUR change d'un run à l'autre, leur FORME non. */
const SERVER_CLOCK = new Set(["createdAt", "updatedAt", "deletedAt"]);

/**
 * Le bloc `nodefony` d'une réponse d'erreur porte l'identifiant de requête —
 * aléatoire par construction, il ne dit rien du moteur.
 */
const REQUEST_META = "nodefony";

/**
 * Remplace identifiants et horodatages du serveur par des jetons — le reste
 * reste tel quel, à l'octet : c'est lui qu'on compare.
 *
 * Un horodatage qui n'a PAS la forme ISO reste en clair : la différence de
 * forme est précisément ce qu'on veut voir.
 */
function normalize(value: unknown, key?: string): unknown {
  if (Array.isArray(value)) return value.map((v) => normalize(v));
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      if (k === REQUEST_META) continue;
      out[k] = normalize(v, k);
    }
    return out;
  }
  if (key !== undefined && SERVER_CLOCK.has(key) && typeof value === "string") {
    return INSTANT.test(value) ? "<instant>" : value;
  }
  if (
    (typeof value === "string" || typeof value === "number") &&
    tokens.has(String(value).toLowerCase())
  ) {
    return tokenOf(value);
  }
  return value;
}

let BASE = "";
let AUTH: Record<string, string> = {};

/** Un champ d'objet JSON, sans conversion aveugle. */
function field(body: unknown, name: string): unknown {
  return body !== null && typeof body === "object" && name in body
    ? (body as Record<string, unknown>)[name]
    : undefined;
}

/**
 * Joue une requête et consigne le cas.
 *
 * @param label - nom du cas, unique : c'est la clé de comparaison.
 * @param method - verbe HTTP.
 * @param route - chemin, requête comprise.
 * @param payload - corps JSON, s'il y en a un.
 * @returns le corps décodé (avant normalisation), pour enchaîner.
 */
async function call(
  label: string,
  method: string,
  route: string,
  payload?: unknown,
): Promise<{ status: number; body: unknown }> {
  const res = await fetch(`${BASE}${route}`, {
    method,
    headers: { "content-type": "application/json", ...AUTH },
    ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
  });
  const text = await res.text();
  let body: unknown = text.length === 0 ? undefined : text;
  try {
    body = text.length === 0 ? undefined : JSON.parse(text);
  } catch {
    /* corps non JSON : gardé en texte */
  }
  // Un nouvel identifiant reçoit son jeton AVANT la normalisation du corps.
  const id = field(body, "id");
  if (
    res.status === 201 &&
    (typeof id === "string" || typeof id === "number")
  ) {
    nameId(id, label.split(" ")[0] ?? label);
  }
  const location = res.headers.get("location");
  const entry: IProbeCase = { label, status: res.status };
  if (location !== null) {
    entry.location = location.replace(/[^/]+$/u, (last) =>
      tokens.has(last.toLowerCase()) ? tokenOf(last) : last,
    );
  }
  // Un 5xx n'a pas de corps comparable : son texte est celui du moteur, et
  // le statut suffit à rendre le cas divergent.
  if (res.status < 500 && body !== undefined) {
    entry.body = normalize(body);
  }
  cases.push(entry);
  return { status: res.status, body };
}

/** L'identifiant d'une ligne créée — ou la raison pour laquelle on s'arrête. */
function idOf(
  label: string,
  result: { status: number; body: unknown },
): string {
  const id = field(result.body, "id");
  if (
    result.status !== 201 ||
    (typeof id !== "string" && typeof id !== "number")
  ) {
    throw new Error(
      `${label} : création refusée (statut ${result.status}) — la sonde ne peut pas continuer`,
    );
  }
  return String(id);
}

/** Une chaîne de `n` caractères, déterministe. */
const chars = (n: number, unit = "x"): string => unit.repeat(n).slice(0, n);

const LONG_TEXT = `${"é — 中文 😀 'simple' \"double\" \\ antislash\n\ttab ".repeat(120)}fin`;

describe("sonde de portabilité", () => {
  it("joue les mêmes requêtes et écrit l'instantané", async () => {
    BASE = `http://127.0.0.1:${runningAppPort()}`;
    AUTH = await csrfHeaders(BASE, await adminLogin());

    const me = await fetch(`${BASE}/nodefony/user/api/me`, { headers: AUTH });
    const meBody: unknown = await me.json();
    const ownerId = field(field(meBody, "user") ?? meBody, "id");
    if (typeof ownerId !== "string" && typeof ownerId !== "number") {
      throw new Error(
        `identifiant de l'administrateur introuvable dans /me (statut ${me.status})`,
      );
    }
    nameId(ownerId, "admin");

    // ── Author : chaque type, à ses bords ────────────────────────────────
    const alice = idOf(
      "author.alice",
      await call(
        "author.alice — tous les types, valeurs pleines",
        "POST",
        "/api/authors",
        {
          email: "alice@example.org",
          name: "Alice",
          bio: LONG_TEXT,
          active: false,
          rating: 1234.567890123456,
          born: "2024-02-29T23:59:59.999Z",
          token: "0B5E2C1A-9F3D-4E5B-8A7C-1D2E3F4A5B6C",
          profile: {
            zeta: 1,
            alpha: { list: [1, 2.5, null, "x", true], empty: {} },
            unicode: "😀 é 中文",
            big: 9007199254740991,
            small: -0.000001,
          },
          level: "senior",
          country: "FR",
          balance: "12.5",
          credits: 2147483647,
        },
      ),
    );
    await call("author.alice — relue", "GET", `/api/authors/${alice}`);

    const bob = idOf(
      "author.bob",
      await call(
        "author.bob — défauts et facultatifs absents",
        "POST",
        "/api/authors",
        {
          email: "bob@example.org",
          name: "Bob",
          country: "US",
          balance: "0",
        },
      ),
    );
    await call("author.bob — relu", "GET", `/api/authors/${bob}`);

    const carol = idOf(
      "author.carol",
      await call(
        "author.carol — négatifs et bornes basses",
        "POST",
        "/api/authors",
        {
          email: "carol@example.org",
          name: chars(80, "Zoé 😀 "),
          rating: -0.5,
          born: "1900-01-01T00:00:00.000Z",
          country: "DE",
          balance: "-9999999999.99",
          credits: -2147483648,
          profile: [],
        },
      ),
    );
    await call("author.carol — relue", "GET", `/api/authors/${carol}`);

    // ── Ce qui doit être refusé — et refusé PAREIL partout ───────────────
    await call("refus.name-81", "POST", "/api/authors", {
      email: "n81@example.org",
      name: chars(81),
      country: "FR",
      balance: "1",
    });
    await call("refus.country-3", "POST", "/api/authors", {
      email: "c3@example.org",
      name: "C",
      country: "FRA",
      balance: "1",
    });
    await call("refus.level-inconnu", "POST", "/api/authors", {
      email: "lv@example.org",
      name: "L",
      country: "FR",
      balance: "1",
      level: "boss",
    });
    await call("refus.email-doublon-exact", "POST", "/api/authors", {
      email: "alice@example.org",
      name: "A2",
      country: "FR",
      balance: "1",
    });
    await call("bord.balance-echelle-3", "POST", "/api/authors", {
      email: "scale@example.org",
      name: "S",
      country: "FR",
      balance: "1.235",
    });
    await call("bord.balance-13-chiffres", "POST", "/api/authors", {
      email: "prec@example.org",
      name: "P",
      country: "FR",
      balance: "12345678901.00",
    });
    await call("bord.credits-2^31", "POST", "/api/authors", {
      email: "big@example.org",
      name: "B",
      country: "FR",
      balance: "1",
      credits: 2147483648,
    });
    await call("bord.born-an-999", "POST", "/api/authors", {
      email: "y999@example.org",
      name: "Y",
      country: "FR",
      balance: "1",
      born: "0999-12-31T00:00:00.000Z",
    });
    await call("bord.bio-caractere-nul", "POST", "/api/authors", {
      email: "nul@example.org",
      name: "N",
      country: "FR",
      balance: "1",
      bio: "a\u0000b",
    });

    // ── Comparaisons de chaînes : là où les collations divergent ─────────
    await call("chaine.email-doublon-casse", "POST", "/api/authors", {
      email: "ALICE@example.org",
      name: "A3",
      country: "FR",
      balance: "1",
    });
    await call("chaine.email-doublon-espace-final", "POST", "/api/authors", {
      email: "bob@example.org ",
      name: "B2",
      country: "FR",
      balance: "1",
    });
    await call("chaine.email-doublon-accent", "POST", "/api/authors", {
      email: "zoé@example.org",
      name: "Z1",
      country: "FR",
      balance: "1",
    });
    await call("chaine.email-doublon-sans-accent", "POST", "/api/authors", {
      email: "zoe@example.org",
      name: "Z2",
      country: "FR",
      balance: "1",
    });
    await call(
      "chaine.id-en-majuscules",
      "GET",
      `/api/authors/${alice.toUpperCase()}`,
    );
    for (const name of ["alice", "Bob", "Émile", "zed"]) {
      await call(`chaine.tri-graine-${name}`, "POST", "/api/authors", {
        email: `tri-${name.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase()}@example.org`,
        name,
        country: "FR",
        balance: "1",
      });
    }
    await call(
      "chaine.tri-name-asc",
      "GET",
      "/api/authors?order=name:ASC&limit=100",
    );

    // ── Liste, filtres, tri ──────────────────────────────────────────────
    await call(
      "liste.authors-email-asc",
      "GET",
      "/api/authors?order=email:ASC&limit=100",
    );
    await call(
      "liste.authors-email-desc",
      "GET",
      "/api/authors?order=email:DESC&limit=100",
    );
    await call(
      "liste.filtre-active-false",
      "GET",
      "/api/authors?active=false&order=email:ASC",
    );
    await call(
      "liste.filtre-level-senior",
      "GET",
      "/api/authors?level=senior&order=email:ASC",
    );
    await call("liste.page-1", "GET", "/api/authors?order=email:ASC&limit=2");
    await call(
      "liste.tri-born-asc",
      "GET",
      "/api/authors?order=born:ASC&limit=100",
    );
    await call(
      "liste.tri-balance-asc",
      "GET",
      "/api/authors?order=balance:ASC&limit=100",
    );

    // ── PATCH : chaque type réécrit ──────────────────────────────────────
    await call("patch.bob", "PATCH", `/api/authors/${bob}`, {
      active: false,
      rating: 1e308,
      born: "2038-01-19T03:14:08.000Z",
      token: "ffffffff-ffff-4fff-bfff-ffffffffffff",
      profile: { replaced: true },
      level: "senior",
      balance: "9999999999.99",
      credits: 1,
      bio: "",
    });
    await call(
      "patch.bob — facultatifs remis à null",
      "PATCH",
      `/api/authors/${bob}`,
      {
        rating: null,
        born: null,
        token: null,
        profile: null,
        bio: null,
      },
    );
    await call("patch.bob — relu", "GET", `/api/authors/${bob}`);

    // ── Book : clé serial, casse snake, références ───────────────────────
    const book1 = idOf(
      "book.1",
      await call("book.1", "POST", "/api/books", {
        title: "Premier",
        isbn: "9780000000001",
        pages: 320,
        price: "19.9",
        author: alice,
      }),
    );
    const book2 = idOf(
      "book.2",
      await call("book.2 — suite du premier", "POST", "/api/books", {
        title: "Second",
        isbn: "9780000000002",
        author: alice,
        sequel: Number(book1),
      }),
    );
    await call(
      "book.2 — relu avec include",
      "GET",
      `/api/books/${book2}?include=author,sequel`,
    );
    await call("refus.book-isbn-auteur-doublon", "POST", "/api/books", {
      title: "Autre titre",
      isbn: "9780000000001",
      author: alice,
    });
    await call("refus.book-auteur-absent", "POST", "/api/books", {
      title: "Orphelin",
      isbn: "9780000000009",
      author: "01890000-0000-7000-8000-000000000000",
    });
    await call("refus.book-title-256", "POST", "/api/books", {
      title: chars(256),
      isbn: "9780000000010",
      author: alice,
    });
    await call(
      "liste.books-filtre-author",
      "GET",
      `/api/books?author=${alice}`,
    );
    await call(
      "liste.books-filtre-sequel",
      "GET",
      `/api/books?sequel=${book1}`,
    );
    await call("liste.books-title-asc", "GET", "/api/books?order=title:ASC");
    await call("patch.book-1", "PATCH", `/api/books/${book1}`, {
      pages: 321,
      price: null,
    });
    await call(
      "refus.delete-author-reference",
      "DELETE",
      `/api/authors/${alice}`,
    );

    // ── Review : référence vers le User du FRAMEWORK ─────────────────────
    const review = idOf(
      "review.1",
      await call("review.1", "POST", "/api/reviews", {
        owner: ownerId,
        book: Number(book1),
        stars: 5,
        comment: "😀",
      }),
    );
    await call(
      "review.1 — relue avec include",
      "GET",
      `/api/reviews/${review}?include=owner,book`,
    );

    // ── Suppressions : douce, puis dure ──────────────────────────────────
    await call("delete.book-2-douce", "DELETE", `/api/books/${book2}`);
    await call("delete.book-2-relu", "GET", `/api/books/${book2}`);
    await call(
      "liste.books-apres-suppression",
      "GET",
      "/api/books?order=title:ASC",
    );
    await call("delete.carol", "DELETE", `/api/authors/${carol}`);
    await call("delete.carol-relue", "GET", `/api/authors/${carol}`);
    await call("refus.id-mal-forme", "GET", "/api/authors/pas-un-uuid");
    await call("refus.book-id-mal-forme", "GET", "/api/books/abc");

    const out = process.env.NF_PORTABILITY_SNAPSHOT;
    if (!out)
      throw new Error(
        "NF_PORTABILITY_SNAPSHOT absent — la sonde est lancée hors du banc",
      );
    writeFileSync(out, `${JSON.stringify(cases, null, 2)}\n`);
  });
});
