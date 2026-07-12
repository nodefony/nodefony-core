/*
 *   Tests UNITAIRES du tableau des zones firewall du bilan de boot.
 *   Point critique verrouillé : `describe().zones[].pattern` = `RegExp.source`
 *   où V8 ÉCHAPPE les slashes (`^\/nodefony\/…`) — le classement app/framework
 *   et l'affichage doivent dé-échapper (bug vécu au premier boot réel : toutes
 *   les aires comptées « applicatives »).
 */

import assert from "node:assert";
import {
  cleanZonePattern,
  isFrameworkZone,
  renderZoneTable,
} from "../service/dev/BootReporter";

const strip = (s: string): string =>
  // eslint-disable-next-line no-control-regex
  s.replace(/\x1b\[[0-9;]*m/g, "");

describe("bilan de boot — tableau des zones firewall", () => {
  it("cleanZonePattern dé-échappe les slashes de RegExp.source", () => {
    assert.strictEqual(
      cleanZonePattern(new RegExp("^/nodefony/[^/]+/api(/|$)").source),
      "^/nodefony/[^/]+/api(/|$)",
    );
  });

  it("isFrameworkZone classe sur le pattern RÉEL (source échappée)", () => {
    const admin = {
      name: "nodefony-admin",
      pattern: new RegExp("^/nodefony/[^/]+/api(/|$)").source,
    };
    const main = { name: "main", pattern: new RegExp("^/api").source };
    assert.strictEqual(isFrameworkZone(admin), true);
    assert.strictEqual(isFrameworkZone(main), false);
  });

  it("renderZoneTable — colonne MODULE (qui déclare l'aire) + ACCÈS + pattern lisible", () => {
    const lines: string[] = [];
    renderZoneTable(
      lines,
      [
        {
          name: "main",
          pattern: "^\\/api",
          authenticators: ["session", "anonymous"],
        },
        {
          name: "nodefony-admin",
          pattern: "^\\/nodefony\\/[^/]+\\/api(\\/|$)",
          authenticators: ["session"],
        },
      ],
      "",
    );
    const text = lines.map(strip).join("\n");
    assert.match(text, /ZONE\s+MODULE\s+PATTERN\s+AUTH\s+ACCÈS/);
    assert.match(
      text,
      /main\s+app\s+\^\/api\s+session, anonymous\s+anonyme OK/,
    );
    assert.match(
      text,
      /nodefony-admin\s+framework\s+\^\/nodefony\/\[\^\/\]\+\/api\(\/\|\$\)\s+session\s+protégé/,
    );
    assert.ok(!text.includes("\\/"), "les patterns affichés sont dé-échappés");
  });

  it("renderZoneTable — security:false rendu « public »", () => {
    const lines: string[] = [];
    renderZoneTable(
      lines,
      [{ name: "open", pattern: "^\\/public", security: false }],
      "",
    );
    assert.match(strip(lines[2]!), /open\s+app\s+\^\/public\s+—\s+public/);
  });
});
