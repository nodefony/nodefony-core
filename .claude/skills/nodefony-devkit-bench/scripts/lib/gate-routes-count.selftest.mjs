/**
 * Selftest du juge « le nombre de routes annoncé est le nombre RÉEL ».
 *
 * Un juge qui n'a jamais été vu rouge ne prouve rien — et celui-ci a une raison
 * de plus d'être éprouvé seul : il choisit sa SOURCE. Trois chemins mènent à
 * trois verdicts qui se ressemblent en surface (`0`, `1`, `5`) et qui n'ont pas
 * du tout le même sens :
 *
 *  - la porte de l'application EN MARCHE répond → c'est elle qui fait foi ;
 *  - personne n'écoute → repli sur un kernel froid, **annoncé comme tel** ;
 *  - ni l'un ni l'autre → on n'a RIEN mesuré, et cela ne s'impute pas à l'agent.
 *
 * Le décor est un serveur factice qui rend l'enveloppe JSON-RPC de la porte —
 * du JSON DANS du JSON, la forme précise que le juge doit savoir lire. Le
 * `count` y est CHOISI par le test : c'est ce qui rend la mesure discriminante,
 * là où frapper une vraie application ferait dépendre le verdict du nombre de
 * routes du jour.
 *
 * Usage : `node gate-routes-count.selftest.mjs`
 *
 * @module
 */
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const JUGE = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "gate-routes-count.mjs",
);

let echecs = 0;

/**
 * Un port libre, obtenu du système plutôt que deviné — deux selftests peuvent
 * tourner en même temps, et un port en dur les ferait se marcher dessus.
 *
 * @returns {Promise<number>}
 */
const portLibre = () =>
  new Promise((resolve) => {
    const s = net.createServer();
    s.listen(0, "127.0.0.1", () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });

/**
 * Le serveur factice : il rend ce que rend la porte MCP, et rien d'autre.
 *
 * @param {number} port - port d'écoute.
 * @param {number} count - le compte que la porte annoncera.
 * @returns {Promise<http.Server>}
 */
const porteFactice = (port, count) =>
  new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        // On vérifie AU PASSAGE que le juge demande bien le bon outil : un juge
        // qui interrogerait un autre sujet rendrait un chiffre juste par
        // accident, et le selftest le laisserait passer.
        let demande = {};
        try {
          demande = JSON.parse(body);
        } catch {
          /* le juge n'a pas envoyé de JSON — l'assertion ci-dessous le dira */
        }
        const bon =
          demande?.params?.name === "nodefony_inspect" &&
          demande?.params?.arguments?.subject === "routes";
        res.writeHead(200, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            jsonrpc: "2.0",
            id: 1,
            result: {
              content: [
                {
                  type: "text",
                  text: JSON.stringify({
                    count: bon ? count : -1,
                    note: "compte exact",
                    items: [],
                  }),
                },
              ],
            },
          }),
        );
      });
    });
    srv.listen(port, "127.0.0.1", () => resolve(srv));
  });

/**
 * Joue le juge dans un dossier jetable portant un `AUDIT.md` donné.
 *
 * 🔴 **Asynchrone, et ce n'est pas un détail de style.** La porte factice vit
 * dans CE process : un `spawnSync` bloquerait la boucle d'événements, le
 * serveur ne répondrait jamais, et le juge conclurait « porte injoignable »
 * après quinze secondes. Le selftest rendrait alors six rouges qui ne diraient
 * rien du juge — le décor se serait auto-étranglé.
 *
 * @param {{rapport: string|null, port: number, bin: string}} decor
 * @returns {Promise<{code: number, sortie: string}>}
 */
function jouer({ rapport, port, bin, runtime = true }) {
  const dir = mkdtempSync(path.join(os.tmpdir(), "gate-routes-"));
  if (rapport !== null) {
    writeFileSync(path.join(dir, "AUDIT.md"), rapport, "utf8");
  }
  // L'état qu'un serveur Nodefony publie quand il écoute. Sans lui, la garde de
  // cible refuse de croire le port — c'est tout son objet.
  if (runtime) {
    const cache = path.join(dir, "node_modules", ".cache", "nodefony");
    mkdirSync(cache, { recursive: true });
    writeFileSync(
      path.join(cache, "runtime.json"),
      JSON.stringify({ pid: process.pid, ports: [Number(port)] }),
      "utf8",
    );
  }
  return new Promise((resolve) => {
    const enfant = spawn(process.execPath, [JUGE, bin], {
      cwd: dir,
      env: { ...process.env, NF_PORT: String(port) },
    });
    let sortie = "";
    enfant.stdout.on("data", (c) => (sortie += c));
    enfant.stderr.on("data", (c) => (sortie += c));
    enfant.on("close", (code) => {
      rmSync(dir, { recursive: true, force: true });
      resolve({ code, sortie });
    });
  });
}

/**
 * @param {string} nom - ce qu'on éprouve.
 * @param {boolean} vrai - le fait constaté.
 * @param {string} [detail] - ce qu'on a vu, quand c'est faux.
 */
function verifier(nom, vrai, detail = "") {
  if (vrai) {
    process.stdout.write(`  ✓ ${nom}\n`);
    return;
  }
  echecs += 1;
  process.stdout.write(`  ✗ ${nom}${detail ? ` — ${detail}` : ""}\n`);
}

const BIN_MORT = "/nexistepas/nodefony";
const port = await portLibre();

// ─── La porte répond : c'est ELLE qui fait foi ────────────────────────────────
{
  const srv = await porteFactice(port, 512);
  const juste = await jouer({
    rapport: "L'application expose **512** routes.",
    port,
    bin: BIN_MORT,
  });
  verifier(
    "porte en marche + rapport juste → vert",
    juste.code === 0,
    `code ${juste.code} : ${juste.sortie.trim()}`,
  );
  verifier(
    "le vert NOMME sa source (l'application en marche)",
    /EN MARCHE/u.test(juste.sortie),
    juste.sortie.trim(),
  );
  // 🔴 Le cœur du correctif : le binaire donné est MORT. Si le juge rendait un
  // verdict quand même par le kernel froid, il retomberait dans le défaut qu'il
  // ferme — mesurer une autre application que celle interrogée.
  verifier(
    "un binaire mort n'empêche rien tant que la porte répond",
    !/froid/iu.test(juste.sortie),
    juste.sortie.trim(),
  );

  const faux = await jouer({
    rapport: "L'application expose **145** routes.",
    port,
    bin: BIN_MORT,
  });
  verifier(
    "porte en marche + rapport faux → ROUGE",
    faux.code === 1,
    `code ${faux.code} : ${faux.sortie.trim()}`,
  );
  verifier(
    "le rouge dit le compte attendu ET sa source",
    /512/u.test(faux.sortie) && /EN MARCHE/u.test(faux.sortie),
    faux.sortie.trim(),
  );

  // Un nombre ne vaut que borné : « 5120 » ne prouve pas « 512 ».
  const inclus = await jouer({
    rapport: "L'application expose 5120 routes.",
    port,
    bin: BIN_MORT,
  });
  verifier(
    "un compte SIMPLEMENT INCLUS dans un autre nombre ne passe pas",
    inclus.code === 1,
    `code ${inclus.code} : ${inclus.sortie.trim()}`,
  );

  const sansRapport = await jouer({ rapport: null, port, bin: BIN_MORT });
  verifier(
    "AUDIT.md absent → rouge, et la raison est nommée",
    sansRapport.code === 1 && /AUDIT\.md absent/u.test(sansRapport.sortie),
    `code ${sansRapport.code} : ${sansRapport.sortie.trim()}`,
  );

  await new Promise((r) => srv.close(r));
}

// ─── Quelqu'un répond, mais ce n'est PAS l'application sous test ─────────────
//
// 🔴 Le cas qui a mordu le banc en vrai : un run laissé vivant tient les mêmes
// ports et porte le même nom d'application. La porte répond, le chiffre est
// exact — et il décrit quelqu'un d'autre. Le juge doit REFUSER de s'en servir.
{
  const srv = await porteFactice(port, 999);
  const sansEtat = await jouer({
    rapport: "L'application expose 999 routes.",
    port,
    bin: BIN_MORT,
    runtime: false,
  });
  verifier(
    "porte qui répond SANS état de runtime → le chiffre n'est pas retenu",
    sansEtat.code === 5,
    `code ${sansEtat.code} : ${sansEtat.sortie.trim()}`,
  );
  verifier(
    "et le motif NOMME le doute sur la cible",
    /aucun état de runtime|n'a pas démarré/u.test(sansEtat.sortie),
    sansEtat.sortie.trim(),
  );
  await new Promise((r) => srv.close(r));
}

// ─── Personne n'écoute, mais un kernel répond : repli VERT, et ANNONCÉ ───────
//
// 🔴 Le cas qui porte tout le correctif. Le verdict est VERT, et il doit
// pourtant dire qu'il ne parle pas de l'application que l'agent a interrogée —
// un vert muet ici, c'est le gate d'avant, celui qui opposait deux kernels sans
// que personne ne puisse le lire dans son `evidence`.
{
  const faux = mkdtempSync(path.join(os.tmpdir(), "faux-bin-"));
  const bin = path.join(faux, "nodefony");
  writeFileSync(
    bin,
    'const n=Number(process.env.FAUX_COUNT??"9");' +
      "process.stdout.write(JSON.stringify(Array.from({length:n},(_,i)=>({name:'r'+i}))));\n",
    "utf8",
  );
  const avecRepli = await jouer({
    rapport: "Cette application expose 9 routes.",
    port,
    bin,
  });
  verifier(
    "porte muette + kernel qui répond → vert par REPLI",
    avecRepli.code === 0,
    `code ${avecRepli.code} : ${avecRepli.sortie.trim()}`,
  );
  verifier(
    "le vert par repli DIT que ce n'est pas l'app interrogée",
    /FROID/u.test(avecRepli.sortie) &&
      /pas l'application que l'agent a interrogée/u.test(avecRepli.sortie),
    avecRepli.sortie.trim(),
  );
  rmSync(faux, { recursive: true, force: true });
}

// ─── Ni porte ni kernel : on n'a RIEN mesuré ─────────────────────────────────
{
  const repli = await jouer({
    rapport: "peu importe",
    port,
    bin: BIN_MORT,
  });
  verifier(
    "ni porte ni kernel → code 5 (on n'a RIEN mesuré)",
    repli.code === 5,
    `code ${repli.code} : ${repli.sortie.trim()}`,
  );
  verifier(
    "le code 5 nomme LES DEUX échecs, pas un seul",
    /aucune application n'écoute/u.test(repli.sortie) &&
      /kernel froid/u.test(repli.sortie),
    repli.sortie.trim(),
  );
}

process.stdout.write(
  echecs === 0
    ? "\n━━ juge « nombre de routes » : tous les verdicts vus ✅\n"
    : `\n━━ ${echecs} échec(s) ❌\n`,
);
process.exit(echecs === 0 ? 0 : 1);
