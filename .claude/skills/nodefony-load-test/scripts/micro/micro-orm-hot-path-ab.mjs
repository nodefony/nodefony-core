#!/usr/bin/env node
/**
 * A/B du chemin ORM qu'une requête authentifiée paie à CHAQUE fois, entre deux
 * arbres BÂTIS : lecture + écriture de la session, rechargement de l'utilisateur
 * par son id (uuid), recherche par identifiant.
 *
 * Pourquoi un A/B sur deux `dist` et pas un profil : le kit de colonnes portable
 * a fait passer les tables du framework (User, session) par des codecs exécutés
 * sur chaque valeur lue ou écrite. La question est « combien de ns de plus par
 * opération », pas « où part le CPU ».
 *
 * Méthode : un process par mesure (aucun JIT partagé), variantes ALTERNÉES
 * (A B A B…) pour que la dérive thermique porte également sur les deux, médiane
 * des rounds, verdict « DANS LE BRUIT » quand les séries se chevauchent.
 *
 * Usage :
 *   node micro-orm-hot-path-ab.mjs --a <racine-ref> --b <racine-courante> [--rounds 5] [--iter 20000]
 *   NF_BENCH_PG_URL=postgres://u:p@127.0.0.1:5432/db  → mesure sur PostgreSQL (base jetable)
 *
 * Une racine = un clone du dépôt dont `@nodefony/drizzle` est bâti. Référence :
 * `git worktree add --detach tmp/bench/base-<sha> <sha>` + `npm ci` + build.
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};

if (args.includes("--child")) {
  await child(opt("root"), Number(opt("iter", "20000")));
} else {
  parent();
}

function distOf(root, pkg, file = "index.js") {
  const p = path.join(root, "src/packages/@nodefony", pkg, "dist", file);
  if (!existsSync(p)) {
    console.error(`dist absent : ${p} — bâtir d'abord cette racine.`);
    process.exit(2);
  }
  return pathToFileURL(p).href;
}

async function child(root, iter) {
  const drizzle = await import(distOf(root, "drizzle"));
  const { default: SessionStorage } = await import(
    distOf(root, "drizzle", "nodefony/src/SessionStorage.js")
  );
  const pgUrl = process.env.NF_BENCH_PG_URL;
  const dialect = pgUrl ? "postgres" : "sqlite";
  drizzle.registerUserEntity("default", dialect);
  drizzle.registerSessionEntity("default", dialect);
  const orm = new drizzle.DrizzleOrm(
    "default",
    pgUrl ? { dialect, url: pgUrl } : { filename: ":memory:" },
  );
  await orm.connect();
  const users = drizzle.DrizzleUserRepository.from(orm);
  const sessions = new SessionStorage({
    options: { idleTimeoutS: 3600, absoluteTimeoutS: 0, store: "drizzle" },
    log: () => {},
  });
  const stamp = `${process.pid}-${Date.now()}`;
  const user = await users.create({
    identifier: `bench-${stamp}@nodefony.dev`,
    roles: ["ROLE_USER"],
    password: "$argon2id$v=19$m=65536,t=3,p=4$c2FsdHNhbHQ$aGFzaGhhc2hoYXNo",
  });
  const sid = `s-${stamp}`;
  const payload = {
    Attributes: { cart: [1, 2, 3], theme: "dark" },
    metaBag: { authAt: Date.now(), amr: ["pwd"] },
    flashBag: {},
    user: user.id,
  };
  await sessions.write(sid, payload);

  const ops = {
    "user.findOne(id)": () => users.findOne({ id: user.id }),
    "user.findByIdentifier": () => users.findByIdentifier(user.identifier),
    "session.read": () => sessions.read(sid),
    "session.write": () => sessions.write(sid, payload),
  };
  const result = {};
  for (const [name, fn] of Object.entries(ops)) {
    for (let i = 0; i < iter / 4; i++) await fn(); // chauffe JIT
    const t = process.hrtime.bigint();
    for (let i = 0; i < iter; i++) await fn();
    result[name] = Number(process.hrtime.bigint() - t) / iter;
  }
  // Contrôle de validité : le travail a EU LIEU (règle n°1).
  const back = await users.findOne({ id: user.id });
  if (back?.identifier !== user.identifier) {
    console.error("lecture User invalide");
    process.exit(3);
  }
  await users.deleteOne({ id: user.id });
  await orm.disconnect();
  process.stdout.write(JSON.stringify(result));
}

function parent() {
  const a = path.resolve(opt("a", ""));
  const b = path.resolve(opt("b", ""));
  const rounds = Number(opt("rounds", "5"));
  const iter = opt("iter", "20000");
  const runs = { a: [], b: [] };
  for (let r = 0; r < rounds; r++) {
    for (const [key, root] of [
      ["a", a],
      ["b", b],
    ]) {
      const out = spawnSync(
        process.execPath,
        [process.argv[1], "--child", "--root", root, "--iter", iter],
        { encoding: "utf8", env: process.env },
      );
      if (out.status !== 0) {
        console.error(`[${key}] échec (${out.status}) :\n${out.stderr}`);
        process.exit(1);
      }
      runs[key].push(JSON.parse(out.stdout));
      process.stderr.write(".");
    }
  }
  process.stderr.write("\n");
  const med = (v) => [...v].sort((x, y) => x - y)[Math.floor(v.length / 2)];
  const moteur = process.env.NF_BENCH_PG_URL ? "postgres" : "sqlite :memory:";
  console.log(
    `moteur ${moteur} · ${rounds} rounds alternés × ${iter} itérations`,
  );
  console.log(
    "opération              réf (ns)   courant (ns)   écart     verdict",
  );
  for (const name of Object.keys(runs.a[0])) {
    const va = runs.a.map((x) => x[name]);
    const vb = runs.b.map((x) => x[name]);
    const ma = med(va);
    const mb = med(vb);
    const separated =
      Math.max(...va) < Math.min(...vb) || Math.max(...vb) < Math.min(...va);
    const pct = ((mb - ma) / ma) * 100;
    console.log(
      `${name.padEnd(22)} ${ma.toFixed(0).padStart(8)}   ${mb.toFixed(0).padStart(12)}   ${(pct >= 0 ? "+" : "") + pct.toFixed(1).padStart(5)} %   ${separated ? "SÉPARÉ" : "DANS LE BRUIT"}`,
    );
  }
}
