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
import { installExpressFair } from "./fair-express.mjs";
// ⚖️ L'ORM et le pilote viennent de la PASSERELLE, jamais d'un spécificateur nu
// écrit ici : ce dossier a son propre `node_modules`, un `import "drizzle-orm"`
// y atteindrait une SECONDE instance de drizzle, distincte de celle dont vient
// le schéma. Le pourquoi et le coût mesuré sont dans `../repo-drizzle-sqlite.mjs`.
import {
  drizzle,
  eq,
  Database,
  Column,
  getTableColumns,
} from "../repo-drizzle-sqlite.mjs";
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

// ⚖️ GARDE D'ÉQUITÉ — UNE SEULE instance de drizzle dans ce process.
//
// Elle ne contrôle pas une version (la garde « installé == déclaré » de
// `bench.sh` le fait déjà) mais une IDENTITÉ : les colonnes du schéma sont-elles
// des instances de la classe `Column` que ce camp exécute ? Si non, deux copies
// de drizzle coexistent, `is()` perd son chemin rapide sur chacun des ~4 660
// tests de type d'une requête, et ce camp mesure une résolution de modules au
// lieu d'un ORM. C'est le défaut qui a fait publier +46 % en notre faveur (#402).
//
// Ce contrôle est DANS le camp, pas dans le lanceur : c'est ici que le
// spécificateur est écrit, donc ici que la faute se commet.
{
  const colonnes = Object.values(getTableColumns(llx_facture));
  const temoin = colonnes[0];
  if (!(temoin instanceof Column)) {
    console.error(
      "❌ ÉQUITÉ ROMPUE — deux instances de drizzle-orm dans ce process.\n" +
        `   Les colonnes du schéma (${temoin?.constructor?.name}) ne sont pas des\n` +
        "   instances de la classe Column que ce camp exécute. `is()` retombe alors\n" +
        "   sur la remontée de prototypes : ×7,6 sur ~4 660 appels par requête,\n" +
        "   soit ~0,5 ms/req imputés à tort au framework.\n" +
        "   → importer l'ORM depuis `../repo-drizzle-sqlite.mjs`, jamais par un\n" +
        "     spécificateur nu écrit dans `bench-frameworks/`.",
    );
    process.exit(2);
  }
}

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

const port = Number(process.env.PORT ?? 5167);
installExpressFair(app, port);

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

// ── Décomposition du budget — miroirs EXACTS des routes de `BenchOrmController`
// La seule façon de dire où passe un écart est de le mesurer étage par étage :
// `/read-lean` (SQL seul), `/read` (+ sérialisation des 20 lignes), `/read-write`
// (+ l'écriture). Sans ces trois points, on ne peut qu'attribuer un écart de tête.
app.get(BENCH_PATH.replace("/read-write", "/read"), (_req, res) => {
  const rows = lire.all();
  res.json({ n: rows.length, rows });
});

app.get(BENCH_PATH.replace("/read-write", "/read-lean"), (_req, res) => {
  const rows = lire.all();
  res.json({ n: rows.length });
});

for (const p of after)
  app.get(p, (req, res) => res.json({ id: req.params.id }));

app.listen(port, "127.0.0.1", () =>
  console.log(`express-fair-sqlite :${port} · base ${DB_FILE}`),
);
process.on("SIGINT", () => process.exit(0));
