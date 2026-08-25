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
import { readdirSync, readFileSync } from "node:fs";
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
