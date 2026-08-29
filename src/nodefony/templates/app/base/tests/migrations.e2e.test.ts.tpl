<% if (it.hasOrm) { %>import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { readRuntimeState } from "nodefony";
import { nodefonyBin, runningAppPort } from "nodefony/testing";
// Une application générée importe ses primitives de test EXPLICITEMENT : sa
// configuration Vitest ne pose pas `globals`, contrairement à celle du dépôt du
// framework. Un fichier écrit avec la convention du dépôt échoue ici sur un
// `beforeAll is not defined` — mesuré, pas déduit.
import { afterAll, beforeAll, describe, it } from "vitest";
import { URL_BASE_E2E } from "./e2e.setup";

const lancer = promisify(execFile);
const bin = nodefonyBin();

/**
 * Les migrations de CETTE application, éprouvées là où elles tourneront.
 *
 * ## Pourquoi cette suite existe
 *
 * Le framework éprouve ses migrations dans son propre dépôt, avec son décor,
 * ses variables et ses conteneurs. Mais l'endroit où elles tournent vraiment,
 * c'est ICI — une application installée, avec ses entités, sa configuration et
 * son environnement. Une chaîne de migration qui marche chez le framework et
 * casse chez vous revient au même que ne rien avoir livré.
 *
 * Ce qui est vérifié tient en une phrase : **le schéma est en place, la
 * commande le dit, et l'application sert**. Chacun de ces trois faits a déjà
 * été faux séparément pendant que les deux autres étaient vrais.
 *
 * ## Ce que ces cas vous donnent
 *
 * Le code de sortie de `orm:migrate:status` est votre **barrière de
 * déploiement** : `0` quand la base est à jour, `1` quand elle est en retard.
 * Un travail d'intégration continue s'arrête dessus, et cette suite prouve que
 * les deux valeurs arrivent — un code de sortie qui ne distinguerait rien
 * laisserait passer un déploiement sur une base non migrée.
 *
 * ## Comment l'étendre
 *
 * Ajoutez vos propres cas ici quand une migration porte une transformation de
 * données : c'est le seul endroit où vous pouvez vérifier que la donnée est
 * arrivée telle que vous l'attendiez, sur la base réelle.
 */

/** Résultat d'un appel à la ligne de commande. */
interface IRun {
  code: number;
  stdout: string;
  stderr: string;
}

/**
 * Lance une commande de l'application et rend ce que le PROCESSUS a produit.
 *
 * Le code de sortie se lit sur le processus, jamais sur une valeur de retour :
 * c'est exactement là qu'il se perd, et c'est lui qui part dans votre chaîne de
 * déploiement.
 *
 * @param args - arguments de la commande.
 * @param env - variables à ajouter à l'environnement.
 * @returns le code de sortie et les deux flux.
 */
async function cli(
  args: string[],
  env: NodeJS.ProcessEnv = {},
): Promise<IRun> {
  try {
    const { stdout, stderr } = await lancer(process.execPath, [bin, ...args], {
      env: {
        ...process.env,
        NODE_ENV: "production",
        // La base de la SUITE, jamais celle du développement. Sans cette
        // ligne, la commande inspecte une base que le décor n'a pas migrée et
        // rend « en retard » — un verdict juste, sur la mauvaise base.
        NF_DATABASE_URL: URL_BASE_E2E,
        ...env,
      },
      maxBuffer: 16 * 1024 * 1024,
    });
    return { code: 0, stdout, stderr };
  } catch (e) {
    const err = e as { code?: number; stdout?: string; stderr?: string };
    return {
      code: typeof err.code === "number" ? err.code : -1,
      stdout: err.stdout ?? "",
      stderr: err.stderr ?? "",
    };
  }
}

/**
 * Lit l'objet JSON d'une sortie standard.
 *
 * La sortie ENTIÈRE doit se parser : c'est ce que veut dire « flux pur ». Aller
 * chercher « la ligne qui ressemble à du JSON » reviendrait à accepter la
 * pollution que l'on prétend interdire, et votre `| jq` casserait quand même.
 *
 * @param stdout - sortie standard de la commande.
 * @returns l'objet rendu.
 */
function json(stdout: string): Record<string, unknown> {
  return JSON.parse(stdout.trim()) as Record<string, unknown>;
}

/** Base jetable, pour éprouver le cas « en retard » sans toucher à celle des tests. */
let jetable: { dir: string; url: string };

beforeAll(() => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "e2e-migrations-"));
  jetable = { dir, url: `sqlite:${path.join(dir, "vierge.db")}` };
});

afterAll(() => {
  rmSync(jetable.dir, { recursive: true, force: true });
});

describe("migrations — la base de cette application", () => {
  it("est à jour : `orm:migrate:status` rend 0 et le dit", async () => {
    // Le décor de la suite (`tests/e2e.setup.ts`) a appliqué les migrations
    // avant de démarrer, comme le ferait un orchestrateur avant de lancer vos
    // exemplaires. On vérifie ici que la commande le CONSTATE.
    const r = await cli(["orm:migrate:status", "--json"]);
    assert.equal(r.code, 0, r.stderr.slice(-800));

    const doc = json(r.stdout);
    assert.equal(doc.verdict, "up-to-date");
    assert.equal(
      doc.formatVersion,
      1,
      "la sortie machine doit annoncer sa version de format",
    );
  });

  it("le flux `--json` est PUR — un `| jq` ne casse sur aucune ligne", async () => {
    // Le journal du démarrage part sur la sortie d'erreur. S'il se déversait
    // sur la sortie standard, votre traitement casserait sur la première ligne
    // et vous conclueriez à une panne de la commande.
    const r = await cli(["orm:migrate:status", "--json"]);
    assert.doesNotThrow(() => json(r.stdout));
  });

  it("rejouer `orm:migrate` n'applique rien et reste à 0", async () => {
    // L'idempotence est ce qui rend la commande sûre dans un déploiement : elle
    // peut être lancée par plusieurs exemplaires, ou relancée après un incident.
    const r = await cli(["orm:migrate", "--json"]);
    assert.equal(r.code, 0, r.stderr.slice(-800));
    assert.equal(json(r.stdout).verdict, "up-to-date");
  });

  it("`--dry-run` n'écrit rien et laisse la base à jour", async () => {
    const essai = await cli(["orm:migrate", "--dry-run", "--json"]);
    assert.equal(essai.code, 0, essai.stderr.slice(-800));

    const apres = await cli(["orm:migrate:status", "--json"]);
    assert.equal(json(apres.stdout).verdict, "up-to-date");
  });

  it("🔴 sur une base VIERGE, le statut rend 1 — votre barrière de déploiement", async () => {
    // C'est le cas qui protège la production : une base en retard doit ARRÊTER
    // un déploiement. Un code de sortie qui ne distinguerait pas « à jour » de
    // « en retard » laisserait passer une mise en service sur un schéma absent.
    const enRetard = await cli(["orm:migrate:status", "--json"], {
      NF_DATABASE_URL: jetable.url,
    });
    assert.equal(
      enRetard.code,
      1,
      `une base vierge doit exiger une action :\n${enRetard.stdout}`,
    );
    assert.notEqual(json(enRetard.stdout).verdict, "up-to-date");

    // Puis la même base, migrée, redevient verte : le cycle complet, sur une
    // base que cette suite a créée elle-même.
    const migre = await cli(["orm:migrate", "--json"], {
      NF_DATABASE_URL: jetable.url,
    });
    assert.equal(migre.code, 0, migre.stderr.slice(-800));

    const apres = await cli(["orm:migrate:status", "--json"], {
      NF_DATABASE_URL: jetable.url,
    });
    assert.equal(apres.code, 0);
    assert.equal(json(apres.stdout).verdict, "up-to-date");
  });

  it("🔴 `orm:reset` est REFUSÉ hors développement, et dit quoi faire", async () => {
    // La commande qui vide une base ne doit jamais s'exécuter ailleurs qu'en
    // développement, et le refus doit être utilisable : une phrase, et un geste.
    const r = await cli(["orm:reset", "--yes", "--json"]);
    assert.notEqual(r.code, 0, "un effacement ne doit PAS réussir en production");

    const doc = json(r.stdout);
    const erreur = (doc.error ?? {}) as Record<string, unknown>;
    assert.ok(
      typeof erreur.code === "string" && erreur.code.length > 0,
      "un refus doit rester un verdict structuré, pas un crash",
    );
    const gestes = (erreur.nextActions ?? []) as { command?: string }[];
    assert.ok(
      gestes.some((g) => typeof g.command === "string" && g.command.length > 0),
      "un refus doit proposer au moins un geste",
    );
  });

  it("🔴 le schéma en place, l'application SERT vraiment", async () => {
    // Les trois faits qui vont ensemble : la base est migrée, la commande le
    // dit, et le serveur répond. Le dernier est celui qu'on oublie de vérifier —
    // une application peut très bien porter toutes ses tables et rendre 500 sur
    // chacune de ses routes.
    const port = runningAppPort();
    const res = await fetch(`http://127.0.0.1:${port}/`);
    assert.ok(
      res.status < 500,
      `l'application rend ${res.status} : le schéma est en place mais elle ne sert pas`,
    );
  });
});
<% } %>
