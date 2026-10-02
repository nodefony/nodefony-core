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

/**
 * Red-team (#20, passe 2) : la liste des publications est la SEULE entrée
 * réseau de `doctor`, et ce qu'elle porte finit dans un TERMINAL. Un miroir
 * (`NF_NODE_DIST_URL`) compromis ou fantaisiste ne doit ni y écrire une
 * séquence de contrôle (titre, effacement, lien OSC 8 trompeur), ni faire
 * compter pour « sécurité » ce qui n'en a que l'apparence.
 */
describe("doctor — sécurité de Node, source hostile", () => {
  // C0, DEL et C1 : tout ce qu'un terminal peut interpréter comme une commande.
  const CONTROL = /[\u0000-\u001f\u007f-\u009f]/u;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "nf-node-sec-red-"));
  afterAll(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });
  const source = (name: string, body: string): string => {
    const file = path.join(tmp, name);
    fs.writeFileSync(file, body);
    return file;
  };

  it("une date porteuse de séquences d'échappement est écartée : rien n'atteint le terminal", async () => {
    const r = await loadNodeReleases(
      source(
        "esc-date.json",
        JSON.stringify([
          {
            version: "v24.99.0",
            date: "\u001b]0;pwned\u0007\u001b[2J",
            security: true,
          },
          { version: "v24.98.0", date: "2026-09-01", security: true },
        ]),
      ),
    );
    assert.isTrue(r.ok);
    const gap = assessNodeSecurity("v24.10.0", r.ok ? r.releases : []);
    assert.isNotNull(gap);
    assert.equal(
      gap?.latest.version,
      "v24.98.0",
      "l'entrée à date hostile ne doit pas devenir la cible",
    );
    assert.notMatch(nodeSecurityMessage(gap!), CONTROL);
  });

  it("une version entourée de retours chariot (réécriture de ligne) est écartée", async () => {
    const r = await loadNodeReleases(
      source(
        "cr-version.json",
        JSON.stringify([
          { version: "\rv24.99.0\n", date: "2026-09-02", security: true },
          { version: "v24.98.0", date: "2026-09-01", security: true },
        ]),
      ),
    );
    const gap = assessNodeSecurity("v24.10.0", r.ok ? r.releases : []);
    assert.equal(gap?.latest.version, "v24.98.0");
    assert.notMatch(nodeSecurityMessage(gap!), CONTROL);
  });

  it("un corps illisible ne recopie pas ses octets de contrôle dans la raison affichée", async () => {
    const r = await loadNodeReleases(
      source("esc-body.json", "\u001b]0;pwned\u0007 not json"),
    );
    assert.isFalse(r.ok);
    if (!r.ok) assert.notMatch(r.reason, CONTROL);
  });

  it("forme inconnue (objet) et liste sans aucune entrée lisible : une RAISON, pas un quitus", async () => {
    const obj = await loadNodeReleases(
      source("obj.json", JSON.stringify({ v: 1 })),
    );
    assert.isFalse(obj.ok);
    if (!obj.ok) assert.include(obj.reason, "forme inconnue");
    const junk = await loadNodeReleases(
      source(
        "junk.json",
        JSON.stringify([null, 3, "v24.1.0", { version: 24, date: "x" }]),
      ),
    );
    assert.isFalse(junk.ok);
    if (!junk.ok) assert.include(junk.reason, "aucune publication lisible");
  });

  it('`security: "true"` (chaîne) n\'est pas un correctif de sécurité', async () => {
    const r = await loadNodeReleases(
      source(
        "str-security.json",
        JSON.stringify([
          { version: "v24.11.0", date: "2026-02-01", security: "true" },
        ]),
      ),
    );
    assert.isTrue(r.ok);
    assert.isNull(assessNodeSecurity("v24.10.0", r.ok ? r.releases : []));
  });

  it("un miroir HTTP en erreur rend son statut, et un miroir sain est lu", async () => {
    const http = await import("node:http");
    const server = http.createServer((req, res) => {
      if (req.url === "/ok.json") {
        res.setHeader("content-type", "application/json");
        res.end(
          JSON.stringify([
            { version: "v24.11.0", date: "2026-02-01", security: true },
          ]),
        );
        return;
      }
      res.statusCode = 503;
      res.end();
    });
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const { port } = server.address() as import("node:net").AddressInfo;
    try {
      const down = await loadNodeReleases(
        `http://127.0.0.1:${port}/index.json`,
      );
      assert.isFalse(down.ok);
      if (!down.ok) assert.include(down.reason, "HTTP 503");
      const ok = await loadNodeReleases(`http://127.0.0.1:${port}/ok.json`);
      assert.isTrue(ok.ok, "contrôle positif : un miroir sain est lu");
      assert.isNotNull(
        assessNodeSecurity("v24.10.0", ok.ok ? ok.releases : []),
      );
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });
});
