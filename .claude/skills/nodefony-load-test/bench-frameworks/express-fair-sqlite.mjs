// Express 5 « ÉQUITABLE » + Drizzle **SQLite** — le duel à armes égales sur le cas
// APPLICATIF : une lecture ET une écriture par requête.
//
// Pourquoi ce camp existe à côté d'`express-fair-drizzle.mjs` (PostgreSQL) :
//
//  1. **Le conteneur n'est pas neutre.** Sur macOS, mesurer PostgreSQL derrière une
//     machine virtuelle mesure d'abord la virtualisation réseau — facteur 3,7 mesuré
//     sur ce dépôt entre « dans le conteneur » et « depuis l'hôte ». SQLite vit DANS
//     le processus : il n'y a plus de chemin virtualisé du tout, et le chiffre
//     redevient reproductible par un tiers.
//  2. **Une lecture seule ne ressemble à aucun logiciel.** Un vrai service lit un
//     état puis l'écrit. C'est sur ce profil que la part du framework dans le budget
//     d'une requête devient lisible : sur une route triviale il est 100 % du coût ;
//     dès qu'une base entre dans la boucle, il en devient une fraction.
//
// ⚖️ ÉQUITÉ — ce camp et la route Nodefony `/nodefony/test/bench-orm/read-write`
// doivent faire le MÊME travail, avec le MÊME outil :
//   · même pilote          : better-sqlite3 (version épinglée dans package.json)
//   · même ORM             : drizzle-orm, même version que le dépôt
//   · même SCHÉMA          : importé du `dist` du module test, jamais recopié ici
//   · mêmes intergiciels   : ceux d'express-fair.mjs (ALS + requestId, traceparent,
//                            CORS, helmet, CSRF Fetch-Metadata, matching de zones)
//   · même séquence        : 20 lignes lues, puis UN update de la ligne LUE —
//                            sans cette dépendance, un moteur pourrait
//                            paralléliser et l'on ne mesurerait plus une séquence
//                            applicative.
//   · même RÉSULTAT rendu  : l'update rend la ligne persistée (`RETURNING`) des
//                            deux côtés, comme le fait `updateOne` du repository.
//   · même ÉTAT de préparation : la LECTURE est préparée des deux côtés (cache de
//                            forme côté Nodefony, `.prepare()` ici) ; l'ÉCRITURE
//                            ne l'est d'AUCUN côté — `updateOne` construit sa
//                            requête à chaque appel, vérifié au source
//                            (`DrizzleRepository.ts`, la préparation ne couvre que
//                            le SELECT). Aligner l'un sans l'autre fabriquerait un
//                            écart qui n'appartient à aucun des deux frameworks.
//
// 🔴 UPDATE, JAMAIS INSERT — contrainte de PROTOCOLE avant d'être un choix de
// réalisme. À quelques milliers de requêtes par seconde, un insert ferait grossir
// la table d'un ordre de grandeur pendant la mesure : les derniers runs d'une série
// ne mesureraient plus la même base que les premiers, et deux séries ne se
// compareraient plus.
//
// ⚠️ BASE SÉPARÉE, MÊME SEED. Les deux camps écrivent : partager un fichier ferait
// subir à l'un les écritures de l'autre, et l'ordre de passage déciderait du
// résultat. Chacun sa copie, prise du même point de départ.
//
// ⚠️ Un pilote SQLite est SYNCHRONE : sa latence EST du blocage de boucle. Ce camp
// mesure donc un plafond de processus, pas une capacité d'attente concurrente.
// C'est un choix de DÉCOR DE MESURE, jamais une recommandation de production.
//
// Usage : NF_BENCH_SQLITE_DB=/chemin/bench-express.db PORT=5167 node express-fair-sqlite.mjs
import express from "express";
import helmet from "helmet";
import cors from "cors";
import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { eq } from "drizzle-orm";
import Database from "better-sqlite3";
import { dummyRoutes } from "./payload.mjs";

const DB_FILE = process.env.NF_BENCH_SQLITE_DB;
if (!DB_FILE) {
  console.error(
    "❌ NF_BENCH_SQLITE_DB manquant — ce banc REFUSE de créer une base vide :\n" +
      "   une table vide répond plus vite qu'une table peuplée, et le chiffre\n" +
      "   aurait l'air d'un résultat. Passer la copie seedée du banc.",
  );
  process.exit(2);
}

// Le schéma vient du module test COMPILÉ — même définition que celle que Nodefony
// exécute. Le recopier ici ferait diverger les deux camps au premier changement de
// colonne, sans que rien ne le signale.
const { llx_facture } = await import(
  new URL(
    "../../../../src/modules/test/dist/nodefony/entity/dolibarr/llx_facture.js",
    import.meta.url,
  ).href
);

const sqlite = new Database(DB_FILE);
const db = drizzle(sqlite);
const BENCH_READ_USER = 7;

const lire = db
  .select()
  .from(llx_facture)
  .where(eq(llx_facture.fk_user_author, BENCH_READ_USER))
  .limit(20)
  .prepare();

let writeSeq = 0;

const app = express();
app.set("env", "production");
app.disable("x-powered-by");

/* Même travail par requête qu'express-fair.mjs — voir ses commentaires. */
const als = new AsyncLocalStorage();
const TRACEPARENT = /^00-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})$/;
function parseTraceparent(h) {
  if (!h) return null;
  const m = TRACEPARENT.exec(h);
  return m ? { traceId: m[1], parentId: m[2], flags: m[3] } : null;
}
const AREAS = [
  { name: "studio", re: /^\/nodefony\/studio/, secure: true },
  { name: "admin-api", re: /^\/nodefony\/[a-z-]+\/api\//, secure: true },
  { name: "test-secure", re: /^\/nodefony\/test\/secure/, secure: true },
  { name: "documentation", re: /^\/nodefony\/documentation/, secure: false },
  { name: "public", re: /^\//, secure: false },
];
function matchArea(path) {
  for (const a of AREAS) if (a.re.test(path)) return a;
  return null;
}
const SAFE = new Set(["GET", "HEAD", "OPTIONS"]);
function csrfOk(req) {
  if (SAFE.has(req.method)) return true;
  const site = req.headers["sec-fetch-site"];
  if (site) return site === "same-origin" || site === "none";
  const origin = req.headers.origin;
  return !origin || origin === `http://127.0.0.1:${port}`;
}

app.use(helmet());
app.use(cors());
app.use((req, res, next) => {
  const store = {
    requestId: randomUUID(),
    traceparent: parseTraceparent(req.headers.traceparent),
    user: null,
  };
  als.run(store, () => {
    res.setHeader("X-Request-Id", store.requestId);
    const area = matchArea(req.path);
    if (area?.secure && !store.user) return res.status(401).end();
    if (!csrfOk(req)) return res.status(403).end();
    next();
  });
});

const BENCH_PATH = "/nodefony/test/bench-orm/read-write";
const { before, after } = dummyRoutes();
for (const p of before)
  app.get(p, (req, res) => res.json({ id: req.params.id }));

app.get(BENCH_PATH, (_req, res) => {
  const rows = lire.all();
  const seq = ++writeSeq;
  const cible = rows[0];
  // `.returning()` — PAS un détail d'API : le repository de Nodefony rend la
  // ligne persistée (`UPDATE … RETURNING`), et un banc où un camp rapporte la
  // ligne pendant que l'autre l'ignore ne compare plus le même travail. L'écart
  // irait alors contre le camp le plus complet, sans que rien ne le dise.
  const maj = cible?.rowid
    ? db
        .update(llx_facture)
        .set({ total_ht: 100 + (seq % 100), total_ttc: 120 + (seq % 100) })
        .where(eq(llx_facture.rowid, cible.rowid))
        .returning()
        .get()
    : null;
  res.json({ lus: rows.length, seq, maj: maj ? 1 : 0 });
});

for (const p of after)
  app.get(p, (req, res) => res.json({ id: req.params.id }));

const port = Number(process.env.PORT ?? 5167);
app.listen(port, "127.0.0.1", () =>
  console.log(`express-fair-sqlite :${port} · base ${DB_FILE}`),
);
process.on("SIGINT", () => process.exit(0));
