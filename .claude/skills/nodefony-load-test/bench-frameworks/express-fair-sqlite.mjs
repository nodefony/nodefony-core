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
// Base, garde d'identité de drizzle, lecture préparée, écriture et règles de
// validation : UNE implémentation partagée avec `nest-fair-sqlite`.
import {
  DB_FILE,
  ORM_PATHS,
  readRows,
  readWrite,
  unprocessable,
  validateInvoice,
} from "./orm-sqlite-common.mjs";
import { dummyRoutes } from "./payload.mjs";

const app = express();

const port = Number(process.env.PORT ?? 5167);
installExpressFair(app, port);

const { before, after } = dummyRoutes();
for (const p of before)
  app.get(p, (req, res) => res.json({ id: req.params.id }));

app.get(ORM_PATHS.readWrite, (_req, res) => res.json(readWrite(100, 120)));

// Miroir de `BenchOrmController.readWriteBody` : même travail, valeurs écrites
// lues dans un JSON posté. `express.json()` sur CETTE route seulement — le
// parseur de Nodefony ne s'exerce, lui aussi, que sur une requête qui a un corps.
app.post(ORM_PATHS.readWriteBody, express.json(), (req, res) =>
  res.json(readWrite(req.body?.total_ht ?? 100, req.body?.total_ttc ?? 120)),
);

// Miroir de `BenchOrmController.readWriteValid` (#507) : le corps est VALIDÉ à
// la main — ce qu'une équipe Express écrit sans bibliothèque — et un corps
// invalide rend 422 sans toucher à la base.
app.post(ORM_PATHS.readWriteValid, express.json(), (req, res) => {
  const errors = validateInvoice(req.body);
  if (errors.length) return res.status(422).json(unprocessable(errors));
  res.json(readWrite(req.body.total_ht, req.body.total_ttc));
});

// ── Décomposition du budget — miroirs EXACTS des routes de `BenchOrmController`
// La seule façon de dire où passe un écart est de le mesurer étage par étage :
// `/read-lean` (SQL seul), `/read` (+ sérialisation des 20 lignes), `/read-write`
// (+ l'écriture). Sans ces trois points, on ne peut qu'attribuer un écart de tête.
app.get(ORM_PATHS.read, (_req, res) => {
  const rows = readRows();
  res.json({ n: rows.length, rows });
});

app.get(ORM_PATHS.readLean, (_req, res) => {
  res.json({ n: readRows().length });
});

for (const p of after)
  app.get(p, (req, res) => res.json({ id: req.params.id }));

app.listen(port, "127.0.0.1", () =>
  console.log(`express-fair-sqlite :${port} · base ${DB_FILE}`),
);
process.on("SIGINT", () => process.exit(0));
