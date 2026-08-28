import assert from "node:assert/strict";
import {
  EXIT,
  MIGRATION_FORMAT_VERSION,
  buildReport,
  exitCodeOf,
  meaningOf,
  renderRefusal,
  renderStatus,
  styleFor,
  verdictOf,
  isAheadOnly,
  type MigrationVerdictName,
} from "../../nodefony/src/migrator/explain";
import type {
  IMigrationPlan,
  IMigrationVerdict,
  MigrationVerdictCode,
} from "../../nodefony/src/migrator/types";

/**
 * Ce que les migrations DISENT — à un humain et à une machine, depuis la même
 * source.
 *
 * Deux choses se jouent ici, et elles partent chez l'utilisateur :
 *
 * - **la grille des codes de sortie**, qui finit dans des passes d'intégration
 *   continue et des travaux de déploiement écrits par d'autres. La réaffecter
 *   plus tard casserait des contrôles qu'on ne voit pas ;
 * - **la forme de la charge utile** : cœur neutre, tout le spécifique du pilote
 *   sous `driver`. Si le dialecte vivait au premier niveau, chaque `jq`
 *   d'utilisateur le graverait, et un ORM sans dialecte n'aurait plus de place
 *   dans la structure.
 *
 * Et une règle d'usage, qui vaut autant : **aucune situation ne sort sans un
 * geste**. Un utilisateur — ou un agent — ne doit jamais lire un constat sans
 * savoir quoi taper ensuite.
 */

const TOUS_LES_VERDICTS: MigrationVerdictName[] = [
  "up-to-date",
  "pending",
  "drift",
  "failed",
  "adopt",
  "divergent",
];

const TOUS_LES_REFUS: MigrationVerdictCode[] = [
  "NF_MIGRATE_BASELINE_REQUIRED",
  "NF_MIGRATE_FAILED_MARKER",
  "NF_MIGRATE_HASH_MISMATCH",
  "NF_MIGRATE_OUT_OF_ORDER",
  "NF_MIGRATE_MISSING_FILE",
  "NF_MIGRATE_UNKNOWN_FORMAT",
  "NF_MIGRATE_LOCK_TIMEOUT",
];

/** Plan vide — chaque cas n'ajoute que ce qu'il veut éprouver. */
function plan(patch: Partial<IMigrationPlan> = {}): IMigrationPlan {
  return {
    connector: "default",
    dialect: "postgres",
    applied: [],
    pending: [],
    drifted: [],
    failed: [],
    missing: [],
    ignoredSources: [],
    baselineRequired: false,
    ...patch,
  };
}

function fichier(source: string, tag: string) {
  return {
    source,
    tag,
    idx: 0,
    hash: "sha256:x",
    statements: ["CREATE TABLE t (a int)"],
    path: `/m/${tag}.sql`,
  };
}

function applique(source: string, tag: string, success = true) {
  return {
    source,
    tag,
    hash: "sha256:x",
    runId: "r",
    startedAt: 1_700_000_000_000,
    finishedAt: success ? 1_700_000_001_000 : null,
    executionMs: success ? 1000 : null,
    success,
    error: success ? null : "colonne inconnue",
    appliedBy: "hôte",
  };
}

describe("migrations — la grille des codes de sortie est FIGÉE", () => {
  it("à jour → 0, action requise → 1, panne → 2", () => {
    assert.equal(EXIT.ok, 0);
    assert.equal(EXIT.actionRequired, 1);
    assert.equal(EXIT.error, 2);
  });

  it("tout ce qui demande un geste humain rend 1, jamais autre chose", () => {
    for (const v of ["pending", "drift", "failed", "adopt"] as const) {
      assert.equal(exitCodeOf(v), EXIT.actionRequired, v);
    }
    assert.equal(exitCodeOf("up-to-date"), EXIT.ok);
  });

  it("🔴 une base qui a divergé ne fait PAS tomber un déploiement par défaut", () => {
    // Superviser n'est pas bloquer. Une application qui écrit des migrations
    // libres a légitimement une base différente du schéma déclaré, en
    // permanence : rendre 1 par défaut rendrait le constat inutilisable, donc
    // mort — appris comme du bruit et ignoré.
    assert.equal(exitCodeOf("divergent", false), EXIT.ok);
    // Et il devient bloquant SI, et seulement si, on le demande.
    assert.equal(exitCodeOf("divergent", true), EXIT.actionRequired);
  });
});

describe("migrations — le verdict se lit dans l'ordre de gravité", () => {
  it("un échec passe avant tout le reste", () => {
    assert.equal(
      verdictOf(
        plan({
          failed: [applique("app", "0002_x", false)],
          drifted: [
            { source: "app", tag: "0001_y", expected: "a", actual: "b" },
          ],
          pending: [fichier("app", "0003_z")],
          baselineRequired: true,
        }),
      ),
      "failed",
    );
  });

  it("un fichier disparu se range avec les écarts (l'énumération est gelée)", () => {
    // Ajouter une septième valeur casserait tout consommateur exhaustif. Le
    // détail reste lisible dans `sources[].missing`.
    const r = buildReport(
      plan({ missing: [{ source: "app", tag: "0001_y" }] }),
      { ddl: "none" },
    );
    assert.equal(r.verdict, "drift");
    assert.deepEqual(r.sources[0]?.missing, ["0001_y"]);
  });

  it("adoption avant attente : appliquer d'abord serait refusé", () => {
    assert.equal(
      verdictOf(plan({ baselineRequired: true, pending: [fichier("f", "0")] })),
      "adopt",
    );
  });

  it("rien nulle part → à jour", () => {
    assert.equal(verdictOf(plan()), "up-to-date");
  });
});

describe("migrations — la forme de la charge utile est un contrat", () => {
  const report = buildReport(
    plan({
      applied: [applique("framework", "0000_init")],
      pending: [fichier("app", "0001_posts")],
    }),
    { ddl: "migrate" },
  );

  it("elle porte sa version au premier niveau", () => {
    assert.equal(report.formatVersion, MIGRATION_FORMAT_VERSION);
    assert.equal(report.formatVersion, 1);
  });

  it("🔴 le dialecte vit SOUS `driver`, jamais au premier niveau", () => {
    // C'est ce découpage, et lui seul, qui permettra à un second ORM de remplir
    // la même structure sans casser un `jq` déjà écrit.
    assert.equal(report.driver.dialect, "postgres");
    assert.ok(
      !Object.prototype.hasOwnProperty.call(report, "dialect"),
      "`dialect` ne doit pas remonter au premier niveau",
    );
    assert.equal(report.driver.kind, "sql");
    assert.equal(report.driver.ddl, "migrate");
  });

  it("le cœur neutre porte connecteur, verdict, code de sortie et sources", () => {
    assert.equal(report.connector, "default");
    assert.equal(report.verdict, "pending");
    assert.equal(report.exitCode, EXIT.actionRequired);
    const parSource = Object.fromEntries(
      report.sources.map((s) => [s.name, s]),
    );
    assert.equal(parSource.framework?.applied, 1);
    assert.equal(parSource.app?.pending, 1);
    assert.deepEqual(parSource.app?.pendingTags, ["0001_posts"]);
  });
});

describe("migrations — aucune situation ne sort sans un geste", () => {
  it("chaque verdict qui demande une action donne une commande à copier", () => {
    const cas: Record<MigrationVerdictName, IMigrationPlan> = {
      "up-to-date": plan(),
      pending: plan({ pending: [fichier("app", "0001_a")] }),
      drift: plan({
        drifted: [{ source: "app", tag: "0001_a", expected: "a", actual: "b" }],
      }),
      failed: plan({ failed: [applique("app", "0002_b", false)] }),
      adopt: plan({
        baselineRequired: true,
        pending: [fichier("f", "0000_i")],
      }),
      divergent: plan(),
    };
    for (const v of TOUS_LES_VERDICTS) {
      const r = buildReport(cas[v], {
        ddl: "none",
        divergent: v === "divergent",
      });
      assert.equal(r.verdict, v, `le cas « ${v} » ne produit pas son verdict`);
      assert.ok(r.summary.length > 20, `« ${v} » : le fait est trop court`);
      if (v === "up-to-date") {
        assert.equal(
          r.nextActions.length,
          0,
          "rien à faire quand tout va bien",
        );
      } else {
        assert.ok(
          r.nextActions.length > 0,
          `« ${v} » ne dit pas quoi taper ensuite`,
        );
        for (const a of r.nextActions) {
          assert.ok(a.command.length > 0);
          assert.ok(Array.isArray(a.args));
        }
      }
    }
  });

  it("chaque verdict qui demande une action explique AUSSI ce qu'il signifie", () => {
    // Le bloc du milieu — la cause — est celui qu'on omet d'habitude, et c'est
    // lui qui évite l'appel au collègue.
    for (const v of TOUS_LES_VERDICTS) {
      if (v === "up-to-date") {
        assert.equal(meaningOf(v), "");
      } else {
        assert.ok(meaningOf(v).length > 40, `« ${v} » n'explique rien`);
      }
    }
  });

  it("🔴 AUCUN refus de l'applicateur ne sort nu", () => {
    // Un refus est un contrat : le fait, la cause, la commande. Un code ajouté
    // sans sa phrase produirait un message amputé le jour de l'incident.
    for (const code of TOUS_LES_REFUS) {
      const verdict: IMigrationVerdict = {
        code,
        connector: "default",
        facts: {},
        nextActions: [{ command: "nodefony orm:migrate:status", args: [] }],
      };
      const rendu = renderRefusal(
        verdict,
        "Le fait constaté.",
        styleFor(false),
      );
      assert.ok(rendu.includes(code), `${code} : le code n'apparaît pas`);
      assert.ok(
        rendu.includes("Le fait constaté."),
        `${code} : le fait manque`,
      );
      assert.ok(
        rendu.includes("nodefony orm:migrate:status"),
        `${code} : la commande à copier manque`,
      );
      // La cause : ce qui reste une fois le fait et la commande retirés.
      const sansFait = rendu
        .replace("Le fait constaté.", "")
        .replace("nodefony orm:migrate:status", "")
        .replace(code, "");
      assert.ok(
        sansFait.trim().length > 80,
        `${code} : aucune explication de ce que ça veut dire`,
      );
    }
  });
});

describe("migrations — le rendu humain ne pollue jamais un flux", () => {
  it("hors terminal, aucun code de couleur n'est émis", () => {
    const r = buildReport(plan({ pending: [fichier("app", "0001_a")] }), {
      ddl: "auto",
    });
    const nu = renderStatus(r, styleFor(false));
    // eslint-disable-next-line no-control-regex
    assert.ok(!/\x1b\[/.test(nu), "des séquences ANSI ont fuité hors terminal");
    assert.ok(nu.includes("0001_a"));
    assert.ok(nu.includes("nodefony orm:migrate"));
  });

  it("en terminal, les couleurs sont là", () => {
    const r = buildReport(plan(), { ddl: "auto" });
    // eslint-disable-next-line no-control-regex
    assert.ok(/\x1b\[/.test(renderStatus(r, styleFor(true))));
  });

  it("un connecteur nommé apparaît dans les commandes proposées", () => {
    const r = buildReport(
      plan({ connector: "reporting", pending: [fichier("app", "0001_a")] }),
      { ddl: "none" },
    );
    assert.ok(
      r.nextActions.every((a) => a.command.includes("--connector reporting")),
      "la commande proposée oublie le connecteur visé",
    );
  });

  it("le connecteur par défaut ne traîne pas d'option inutile", () => {
    const r = buildReport(plan({ pending: [fichier("app", "0001_a")] }), {
      ddl: "none",
    });
    assert.equal(r.nextActions[0]?.command, "nodefony orm:migrate");
  });
});

/**
 * #108 — une base EN AVANCE sur le code ne doit pas retenir le trafic.
 *
 * La scène est celle d'une mise à jour progressive : le travail de migration a
 * appliqué `app/0006`, les anciens exemplaires servent encore avec une image
 * qui n'a pas ce fichier. Leur historique porte une entrée sans fichier local —
 * et rien d'autre ne cloche. Les retenir sortait TOUS les anciens exemplaires
 * du répartiteur de charge avant que le premier nouveau soit prêt.
 *
 * Le verdict reste `drift` (l'énumération est gelée, et le fait est juste) :
 * c'est ce que la sonde en DÉDUIT qui change.
 */
describe("isAheadOnly — l'historique en avance n'est pas une dérive (#108)", () => {
  const enAvance = { source: "app", tag: "0006_ajout" };

  it("historique en avance, rien d'autre → EN AVANCE", () => {
    assert.equal(isAheadOnly(plan({ missing: [enAvance] })), true);
  });

  it("le verdict, lui, reste `drift` — le fait est juste", () => {
    assert.equal(verdictOf(plan({ missing: [enAvance] })), "drift");
  });

  // ── Ce qui doit CONTINUER de retenir ─────────────────────────────────────

  it("une empreinte qui a changé n'est PAS une avance", () => {
    assert.equal(
      isAheadOnly(
        plan({
          missing: [enAvance],
          drifted: [
            {
              source: "app",
              tag: "0002_b",
              expected: "sha256:a",
              actual: "sha256:b",
            },
          ],
        }),
      ),
      false,
    );
  });

  it("une migration en attente n'est PAS une avance", () => {
    assert.equal(
      isAheadOnly(
        plan({ missing: [enAvance], pending: [fichier("app", "0007_c")] }),
      ),
      false,
    );
  });

  it("une migration en échec n'est PAS une avance", () => {
    assert.equal(
      isAheadOnly(
        plan({
          missing: [enAvance],
          failed: [applique("app", "0003_d", false)],
        }),
      ),
      false,
    );
  });

  it("une adoption requise n'est PAS une avance", () => {
    assert.equal(
      isAheadOnly(plan({ missing: [enAvance], baselineRequired: true })),
      false,
    );
  });

  it("un plan sain n'est pas « en avance » — il n'y a rien devant", () => {
    assert.equal(isAheadOnly(plan()), false);
  });
});
