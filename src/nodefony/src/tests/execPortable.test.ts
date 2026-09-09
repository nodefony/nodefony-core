import { describe, it } from "vitest";
import { expect } from "chai";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { needsShell, portableSpawn } from "../cli/execPortable";

/**
 * SPEC — « ce qui empêche Node de lancer la chose n'est pas OÙ elle est, c'est ce
 * qu'elle EST ».
 *
 * Ces cas s'éprouvent depuis n'importe quel système parce que la plateforme et la
 * grammaire de chemins sont INJECTÉES. Une fonction qui lirait `process.platform`
 * ne serait vérifiable que sur la plateforme qu'elle décrit — c'est-à-dire jamais,
 * sur les postes de ce projet, ce qui est précisément comment le défaut a vécu.
 */
describe("needsShell — la règle du shell Windows", () => {
  const win = (cmd: string): boolean => needsShell(cmd, "win32", path.win32);
  const posix = (cmd: string): boolean => needsShell(cmd, "linux", path.posix);

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

/**
 * SPEC — « des arguments ne se confient JAMAIS à un shell ».
 *
 * `shell: true` avec des arguments est la forme que Node déprécie (DEP0190) et
 * qu'il annonce à l'exécution — Nodefony relayant chaque avertissement avec sa
 * pile, `nodefony create app` imprimait une stack sous Windows. La branche
 * Windows se vérifie ici par injection ; le cas réel, en bas, tourne dans le
 * job de CHAQUE plateforme, et c'est là qu'il mord.
 */
describe("portableSpawn — lancer sans confier d'arguments à un shell", () => {
  const win = (cmd: string, args: string[]) =>
    portableSpawn(
      cmd,
      args,
      "win32",
      path.win32,
      "C:\\Windows\\system32\\cmd.exe",
    );

  it("hors Windows, la commande part telle quelle, arguments intacts", () => {
    const r = portableSpawn("npm", ["install"], "linux", path.posix);
    expect(r).to.deep.equal({
      file: "npm",
      args: ["install"],
      windowsVerbatimArguments: false,
    });
  });

  it("sous Windows, un script batch passe par cmd.exe — la ligne, pas l'option shell", () => {
    // Exactement ce que Node compose derrière `shell: true`, sans l'option.
    expect(win("npm", ["run", "build"])).to.deep.equal({
      file: "C:\\Windows\\system32\\cmd.exe",
      args: ["/d", "/s", "/c", '"npm run build"'],
      windowsVerbatimArguments: true,
    });
  });

  it("sous Windows, un vrai exécutable ne passe PAS par cmd.exe", () => {
    const r = win("C:\\Program Files\\nodejs\\node.exe", ["-v"]);
    expect(r.file).to.equal("C:\\Program Files\\nodejs\\node.exe");
    expect(r.windowsVerbatimArguments).to.equal(false);
  });

  it("un argument portant un blanc ou un métacaractère est quoté, pas concaténé", () => {
    const r = win("npm", [
      "run",
      "build",
      "--",
      "C:\\Users\\Jane Doe\\app",
      "a&b",
    ]);
    expect(r.args[3]).to.equal(
      '"npm run build -- "C:\\Users\\Jane Doe\\app" "a&b""',
    );
  });

  it("un argument sans forme sûre pour cmd.exe est REFUSÉ, jamais bricolé", () => {
    expect(() => win("npm", ['say "hi"'])).to.throw(
      /impossible à transmettre/u,
    );
    expect(() => win("npm", ["a\nb"])).to.throw(/impossible à transmettre/u);
  });

  it("un %VAR% est REFUSÉ : les guillemets n'arrêtent pas l'expansion de cmd.exe", () => {
    // `cmd.exe` remplace `%NOM%` par la valeur de la variable AU PARSING, y
    // compris entre guillemets — citer ne protège que des métacaractères, pas
    // de l'expansion. Un chemin `C:\build\%BUILD_ID%\app` partirait donc
    // transformé, ou vidé si la variable n'existe pas : l'argument reçu ne
    // serait pas celui qu'on a écrit. Et `%%` n'échappe rien hors d'un fichier
    // batch. Aucune forme sûre n'existe → on refuse, comme pour le guillemet.
    expect(() => win("npm", ["C:\\build\\%BUILD_ID%\\app"])).to.throw(
      /impossible à transmettre/u,
    );
    // Le pour-cent NU, lui, ne déclenche aucune expansion : rien à refuser.
    expect(win("npm", ["remise-20%"]).args[3]).to.equal('"npm "remise-20%""');
  });

  it("l'interpréteur vient de %ComSpec%, avec cmd.exe en repli", () => {
    // Vu ROUGE sur la forge Windows : `undefined` passé explicitement laisse
    // jouer le défaut (`process.env.ComSpec`), présent là-bas. Le repli se
    // prouve avec une valeur VIDE, qui vaut absente pour le produit.
    expect(portableSpawn("npm", [], "win32", path.win32, "").file).to.equal(
      "cmd.exe",
    );
  });

  it("CAS RÉEL — `npm --version` par la voie portable ne rend AUCUN avertissement", () => {
    // Tourne dans le job de chaque plateforme : sous Windows, c'est la branche
    // cmd.exe qui s'exécute ici. Un `shell: true` rendrait DEP0190 sur stderr.
    const cmd = portableSpawn("npm", ["--version"]);
    const r = spawnSync(cmd.file, cmd.args, {
      windowsVerbatimArguments: cmd.windowsVerbatimArguments,
      encoding: "utf8",
    });
    expect(r.status, r.stderr).to.equal(0);
    expect(r.stdout.trim()).to.match(/^\d+\.\d+\.\d+/u);
    expect(r.stderr).to.not.match(/DeprecationWarning|DEP0190/u);
  });
});
