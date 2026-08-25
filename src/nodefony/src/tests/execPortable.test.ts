import { describe, it } from "vitest";
import { expect } from "chai";
import path from "node:path";
import { besoinDeShell } from "../cli/execPortable";

/**
 * SPEC — « ce qui empêche Node de lancer la chose n'est pas OÙ elle est, c'est ce
 * qu'elle EST ».
 *
 * Ces cas s'éprouvent depuis n'importe quel système parce que la plateforme et la
 * grammaire de chemins sont INJECTÉES. Une fonction qui lirait `process.platform`
 * ne serait vérifiable que sur la plateforme qu'elle décrit — c'est-à-dire jamais,
 * sur les postes de ce projet, ce qui est précisément comment le défaut a vécu.
 */
describe("besoinDeShell — la règle du shell Windows", () => {
  const win = (cmd: string): boolean => besoinDeShell(cmd, "win32", path.win32);
  const posix = (cmd: string): boolean =>
    besoinDeShell(cmd, "linux", path.posix);

  it("hors Windows, JAMAIS de shell — il rouvre l'interprétation des métacaractères", () => {
    for (const cmd of ["npm", "npx", "/usr/local/bin/oxlint", "node"]) {
      expect(posix(cmd), cmd).to.equal(false);
    }
  });

  it("sous Windows, une commande cherchée dans le PATH exige le shell", () => {
    // `npm` s'y résout en `npm.cmd`, que Node refuse depuis CVE-2024-27980 — en
    // annonçant « ENOENT », qui se lit « npm n'est pas installé ».
    for (const cmd of ["npm", "npx", "yarn", "prettier"]) {
      expect(win(cmd), cmd).to.equal(true);
    }
  });

  it("sous Windows, un chemin ABSOLU vers un script batch l'exige AUSSI", () => {
    // Le cas que la première version manquait : « absolu donc exécutable réel »
    // est une inférence, et elle est fausse.
    expect(win("D:\\app\\node_modules\\.bin\\oxlint.cmd")).to.equal(true);
    expect(win("D:\\app\\node_modules\\.bin\\vite.BAT")).to.equal(true);
  });

  it("sous Windows, un vrai exécutable absolu n'a PAS besoin du shell", () => {
    expect(win("C:\\Program Files\\nodejs\\node.exe")).to.equal(false);
  });

  it("l'extension se lit en FIN de nom, pas n'importe où", () => {
    // `…\cmd.js` porte « cmd » sans être un script batch : le confondre ferait
    // passer par le shell un argument qui n'a rien demandé.
    expect(win("D:\\app\\bin\\cmd.js")).to.equal(false);
  });
});
