/**
 * Sous-règle « Sécurité de Node » de `nodefony doctor`.
 *
 * Ce qu'elle garde : un Node qui satisfait `engines` mais porte des failles
 * déjà corrigées est NOMMÉ, avec la version qui corrige — et l'absence de
 * réseau ne fait JAMAIS échouer `doctor`, même en mode strict.
 */
import { describe, it, afterAll } from "vitest";
import { assert } from "chai";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  assessNodeSecurity,
  loadNodeReleases,
  nodeSecurityMessage,
  type INodeRelease,
} from "../kernel/checks/nodeSecurity";
import { preventedChecks, skippedChecks } from "../kernel/checks/report";
import { collectDoctorReport } from "../kernel/checks/runDoctor";

const releases: INodeRelease[] = [
  { version: "v26.10.0", date: "2026-09-20", security: true },
  { version: "v24.21.0", date: "2026-09-20", security: false },
  { version: "v24.20.0", date: "2026-08-10", security: true },
  { version: "v24.19.0", date: "2026-07-01", security: true },
  { version: "v24.18.1", date: "2026-06-01", security: false },
  { version: "v24.10.0", date: "2026-01-10", security: false },
];

describe("doctor — sécurité de Node (règle pure)", () => {
  it("un Node en retard d'une publication de sécurité est nommé, avec la version qui corrige", () => {
    const gap = assessNodeSecurity("v24.18.1", releases);
    assert.isNotNull(gap);
    assert.equal(gap?.securityReleases, 2);
    // La CIBLE est la plus récente de la série, pas la dernière de sécurité :
    // 24.21.0 contient les correctifs de 24.20.0, et l'on n'installe qu'une fois.
    assert.equal(gap?.latest.version, "v24.21.0");
    const message = nodeSecurityMessage(gap!);
    assert.include(message, "v24.18.1");
    assert.include(message, "24.21.0");
    assert.include(message, "2 publications de sécurité");
  });

  it("à jour de sa série : rien à dire, même si une AUTRE série a une publication de sécurité", () => {
    assert.isNull(assessNodeSecurity("v24.20.0", releases));
    assert.isNull(assessNodeSecurity("v24.21.0", releases));
    assert.isNull(assessNodeSecurity("v26.10.0", releases));
  });

  it("des publications postérieures SANS correctif de sécurité ne font rien dire", () => {
    const sansFaille: INodeRelease[] = [
      { version: "v24.12.0", date: "2026-02-01", security: false },
      { version: "v24.11.0", date: "2026-01-20", security: false },
    ];
    assert.isNull(assessNodeSecurity("v24.10.0", sansFaille));
  });

  it("une version illisible (nightly, préversion) ne fait rien dire", () => {
    assert.isNull(assessNodeSecurity("v27.0.0-nightly2026", releases));
  });
});

describe("doctor — sécurité de Node, sans réseau", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "nf-node-sec-"));
  afterAll(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("une source injoignable rend une RAISON, jamais une liste vide prise pour un quitus", async () => {
    const r = await loadNodeReleases(path.join(tmp, "absent.json"));
    assert.isFalse(r.ok);
    // Port réservé : la connexion est refusée tout de suite.
    const net = await loadNodeReleases("http://127.0.0.1:9/index.json");
    assert.isFalse(net.ok);
  });

  it("injoignable dans une application : NON CONTRÔLÉ, consultatif — le mode strict ne condamne pas", async () => {
    const app = path.join(tmp, "app");
    fs.mkdirSync(app);
    fs.writeFileSync(path.join(app, "nodefony.config.ts"), "export {};\n");
    fs.writeFileSync(
      path.join(app, "package.json"),
      JSON.stringify({ name: "app", version: "1.0.0" }),
    );
    const before = process.env["NF_NODE_DIST_URL"];
    process.env["NF_NODE_DIST_URL"] = path.join(tmp, "absent.json");
    try {
      const report = await collectDoctorReport(app);
      const state = report.execution.nodeSecurity;
      assert.isFalse(state.ran);
      assert.isTrue(state.advisory);
      const skipped = skippedChecks(report.execution);
      assert.include(
        skipped.map((s) => s.family),
        "nodeSecurity",
        "l'angle mort doit être DIT",
      );
      assert.notInclude(
        preventedChecks(skipped).map((s) => s.family),
        "nodeSecurity",
        "un poste sans réseau ne doit pas faire échouer doctor --strict",
      );
    } finally {
      process.env["NF_NODE_DIST_URL"] = before;
    }
  });
});
