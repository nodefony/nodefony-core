/**
 * **Les variables d'infra que la forge pose doivent être celles que les gates
 * attendent.**
 *
 * `vitest.gates.ts` se déclare « source unique du monorepo » — mais un workflow
 * YAML ne peut pas l'importer : il RETAPE les noms à la main, sous un commentaire
 * qui affirme les tenir de lui. Deux implémentations d'une même règle, donc une
 * divergence en silence.
 *
 * Vécu, et c'est la raison de ce fichier : le renommage `NF_` a porté
 * `REDIS_URL` → `NF_REDIS_URL` dans `REDIS_GATE`, pas dans `orm.yml`. Les bancs
 * Redis ont continué de tourner — 141 tests passés, 11 bancs de backplane RÉELS,
 * aucun skip — pendant que le rapporteur annonçait « Redis non exercé » et
 * faisait échouer deux jobs. Un instrument qui contredit ses propres preuves ;
 * deux jours sans que personne ne le lise.
 *
 * Ce que ce test affirme : pour chaque variable qu'une gate exige, aucun
 * workflow ne doit poser une AUTRE forme du même nom (préfixée ou non) sans
 * poser la forme attendue. Il ne vérifie pas les VALEURS — le compose en décide,
 * et un port qui change n'est pas une divergence de contrat.
 */
import { describe, it } from "vitest";
import { assert } from "chai";
import { readdirSync, readFileSync, existsSync } from "node:fs";
import path from "node:path";
import {
  PG_GATE,
  MYSQL_GATE,
  REDIS_GATE,
  MONGO_GATE,
  LOKI_GATE,
  OPENSEARCH_GATE,
  gateEnv,
  type EnvGate,
} from "../../../../vitest.gates";

const REPO_ROOT = path.resolve(import.meta.dirname, "../../../..");
const WORKFLOWS = path.join(REPO_ROOT, ".github", "workflows");

/** Les cibles d'infra que la forge peut avoir à lever. */
const GATES: readonly EnvGate[] = [
  PG_GATE,
  MYSQL_GATE,
  REDIS_GATE,
  MONGO_GATE,
  LOKI_GATE,
  OPENSEARCH_GATE,
];

/**
 * Toutes les affectations `NOM: valeur` d'un workflow, sans les valeurs.
 *
 * Volontairement grossier : on cherche des NOMS de variables, et une clé YAML en
 * début de ligne suffit à les trouver. Un analyseur complet exigerait une
 * dépendance pour une question qui n'en demande pas.
 */
const varNames = (yaml: string): Set<string> => {
  const names = new Set<string>();
  for (const line of yaml.split("\n")) {
    const m = /^\s{2,}([A-Z][A-Z0-9_]*)\s*:/.exec(line);
    if (m) names.add(m[1] as string);
  }
  return names;
};

/**
 * Les autres façons d'écrire le même nom : sans le préfixe `NF_`, ou avec.
 *
 * C'est la seule forme de collision qui a mordu, et la seule qu'un renommage de
 * masse peut produire.
 */
const otherForms = (name: string): string[] =>
  name.startsWith("NF_") ? [name.slice(3)] : [`NF_${name}`];

const workflows = readdirSync(WORKFLOWS).filter((f) => f.endsWith(".yml"));

describe("Variables d'infra — la forge et `vitest.gates.ts` disent la même chose", () => {
  it("les workflows existent (sinon ce test ne prouve rien)", () => {
    assert.isAbove(workflows.length, 0, "aucun workflow lu");
  });

  for (const file of workflows) {
    const posed = varNames(readFileSync(path.join(WORKFLOWS, file), "utf8"));

    for (const gate of GATES) {
      for (const attendue of gateEnv(gate)) {
        const rivales = otherForms(attendue).filter((n) => posed.has(n));
        if (rivales.length === 0) continue;

        it(`${file} — ${gate.label} : \`${attendue}\``, () => {
          assert.isTrue(
            posed.has(attendue),
            `${file} pose ${rivales.join(", ")} mais pas ${attendue}, que ` +
              `${gate.label} exige. Le rapporteur de gates dira « non exercée » ` +
              `même si les bancs tournent. Aligner le workflow sur ` +
              `vitest.gates.ts, qui est la source unique.`,
          );
        });
      }
    }
  }
});

/**
 * **Une passe FILTRÉE ne peut pas tenir les preuves d'une suite entière.**
 *
 * Un `gateReporter` de paquet exige qu'un banc nommé ait PASSÉ. Quand un
 * workflow ne joue que deux fichiers de ce paquet, ces bancs-là ne tournent
 * pas : la passe échoue en annonçant « cible non exercée » alors qu'elle vient
 * de couper et relancer de vrais serveurs. L'échappatoire existe
 * (`NF_GATES_ALLOW`, qui NOMME l'absence dans le rapport) ; ce qui manquait,
 * c'est ce qui oblige à y penser.
 *
 * Vécu, deux fois dans la même heure : le step `drizzle`, puis son frère
 * `mongoose` — invisible tant que le premier échouait AVANT lui. Un rouge en
 * masquait un autre à l'intérieur du même job.
 */
const STEPS = /^\s*- name: (.+)$/;

describe("Passes filtrées — le gate du paquet ne peut pas être tenu", () => {
  for (const file of workflows) {
    const lignes = readFileSync(path.join(WORKFLOWS, file), "utf8").split("\n");
    // Découpe en blocs de step : un bloc court jusqu'au `- name:` suivant.
    const blocs: string[][] = [];
    for (const ligne of lignes) {
      if (STEPS.test(ligne)) blocs.push([]);
      if (blocs.length > 0) (blocs[blocs.length - 1] as string[]).push(ligne);
    }

    for (const bloc of blocs) {
      const texte = bloc.join("\n");
      const paquet =
        /working-directory:\s*src\/packages\/@nodefony\/([\w-]+)/.exec(
          texte,
        )?.[1];
      const filtree = /vitest run\s+\S*\.test\.ts/.test(texte);
      if (!paquet || !filtree) continue;

      // Le paquet impose-t-il des preuves ? (un `gateReporter` dans sa config)
      const configs = ["vitest.config.ts", "vitest.integration.config.ts"]
        .map((c) => path.join(REPO_ROOT, "src/packages/@nodefony", paquet, c))
        .filter((p) => existsSync(p));
      const garde = configs.some((p) =>
        readFileSync(p, "utf8").includes("gateReporter"),
      );
      if (!garde) continue;

      const nom = STEPS.exec(bloc[0] as string)?.[1] ?? "?";
      it(`${file} — « ${nom} » (@nodefony/${paquet})`, () => {
        assert.include(
          texte,
          "NF_GATES_ALLOW",
          `ce step ne joue que certains fichiers de @nodefony/${paquet}, dont ` +
            `le gateReporter attend les preuves de la suite ENTIÈRE. Sans ` +
            `NF_GATES_ALLOW, la passe échouera en réclamant des bancs qu'elle ` +
            `ne joue pas — énoncer l'absence, elle ne s'oublie pas.`,
        );
      });
    }
  }
});

/**
 * **Un workflop à liste blanche doit déclarer les actions LOCALES qu'il utilise.**
 *
 * `paths:` est une liste blanche : ce qui n'y figure pas ne réveille jamais le
 * workflow. Une action locale (`uses: ./.github/actions/X`) est du code comme un
 * autre — la casser doit rejouer ce qui s'en sert. Sans son chemin, l'action se
 * dégrade et le seul workflow qui l'exerce reste muet ; le rouge tombera plus
 * tard, sur un commit qui n'y est pour rien.
 *
 * Vécu : `e2e-autonomes.yml` boote son serveur par `./.github/actions/nodefony-server`
 * sans la déclarer, quand son frère `memory.yml` la déclarait — la convention
 * existait, elle n'avait simplement pas été appliquée aux deux.
 *
 * Ne concerne PAS les workflows en `paths-ignore` (`node.js.yml`, `scaffold.yml`) :
 * ils tournent sur tout sauf exclusion, donc rien ne peut leur échapper.
 */
describe("Workflows à liste blanche — les actions locales sont déclarées", () => {
  for (const file of workflows) {
    const contenu = readFileSync(path.join(WORKFLOWS, file), "utf8");
    // Liste blanche seulement : `paths-ignore` couvre tout par construction.
    if (!/^\s+paths:/m.test(contenu)) continue;

    // Un `paths:` par déclencheur (`push`, `pull_request`) : le chemin doit
    // figurer dans CHACUN. Déclaré dans `push` seul, il laisse les
    // requêtes de tirage sans couverture — et ce test passait, faute de
    // compter. Constaté en le débranchant : il n'a pas mordu.
    const blocsPaths = (contenu.match(/^\s+paths:/gm) ?? []).length;

    const actions = new Set(
      [...contenu.matchAll(/uses:\s*\.\/(\.github\/actions\/[\w-]+)/g)].map(
        (m) => m[1] as string,
      ),
    );
    for (const action of actions) {
      it(`${file} — déclare \`${action}\` dans chaque déclencheur`, () => {
        const declare = (
          contenu.match(
            new RegExp(
              `"${action.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/\\*\\*"`,
              "g",
            ),
          ) ?? []
        ).length;
        assert.strictEqual(
          declare,
          blocsPaths,
          `${file} utilise l'action locale ${action} et compte ${blocsPaths} ` +
            `bloc(s) \`paths:\`, mais ne la déclare que ${declare} fois. La ` +
            `modifier ne réveillera pas tous les déclencheurs — ajouter ` +
            `"${action}/**" à chacun.`,
        );
      });
    }
  }
});
