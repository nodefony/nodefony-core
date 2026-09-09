/**
 * **Un contrôle qui lit le manifeste doit voir SES FRAGMENTS.**
 *
 * Quatre instruments du produit lisent le TEXTE de `nodefony.config.ts` à
 * l'expression régulière — le rapport de surface de `doctor` (un rapport de
 * SÉCURITÉ), le contrôle de câblage, et le générateur, qui y lit `connectors`
 * et y ancre `roleHierarchy`. Chacun supposait que tout tenait dans ce seul
 * fichier. Le jour où un bloc est extrait vers `nodefony/config/`, ils
 * deviennent aveugles **sans un mot** : zéro constat au lieu d'un manquement,
 * ce qui se lit « tout va bien ».
 *
 * Le décor est une arborescence EN MÉMOIRE : ces contrôles doivent répondre
 * sur une application qui ne démarre pas, donc rien ne s'évalue — un décor qui
 * booterait ne prouverait pas le bon chemin de code.
 */
import { describe, it } from "vitest";
import { assert } from "chai";
import path from "node:path";
import {
  readManifestSources,
  type IManifestReader,
} from "../kernel/checks/sourceText";

/** Arborescence en mémoire — les clés sont des chemins natifs. */
function lecteur(files: Record<string, string>): IManifestReader {
  const dirs = new Set<string>();
  for (const f of Object.keys(files)) {
    let d = path.dirname(f);
    while (d && d !== path.dirname(d)) {
      dirs.add(d);
      d = path.dirname(d);
    }
  }
  return {
    exists: (f) => f in files || dirs.has(f),
    read: (f) => {
      if (!(f in files)) throw new Error(`ENOENT ${f}`);
      return files[f];
    },
    listDir: (d) =>
      Object.keys(files)
        .filter((f) => path.dirname(f) === d)
        .map((f) => ({ name: path.basename(f), isDirectory: false })),
  };
}

const RACINE = path.join("/app");
const MANIFESTE = path.join(RACINE, "nodefony.config.ts");
const frag = (name: string) => path.join(RACINE, "nodefony", "config", name);

describe("readManifestSources — le manifeste ET ses fragments", () => {
  it("rend le manifeste seul quand rien n'est extrait — le cas de TOUTES les apps actuelles", () => {
    const sources = readManifestSources(
      RACINE,
      lecteur({ [MANIFESTE]: "export default {};" }),
    );
    assert.deepEqual(
      sources.map((s) => s.path),
      [MANIFESTE],
    );
  });

  it("voit un bloc DÉPLACÉ dans un fragment — la panne que ce module existe pour éviter", () => {
    // Le scénario exact : `areas` (le firewall) quitte le manifeste. Le
    // rapport de surface doit continuer à le trouver.
    const sources = readManifestSources(
      RACINE,
      lecteur({
        [MANIFESTE]:
          "export default { modules: [use('@nodefony/security', security(ctx))] };",
        [frag("security.ts")]:
          "export const security = () => ({ areas: { admin: {} } });",
      }),
    );
    const tout = sources.map((s) => s.source).join("\n");
    assert.match(tout, /\bareas\s*:\s*\{/u);
  });

  it("rend le manifeste EN PREMIER — c'est lui qu'un écrivain choisit par défaut", () => {
    const sources = readManifestSources(
      RACINE,
      lecteur({
        [frag("aaa.ts")]: "export const aaa = () => ({});",
        [MANIFESTE]: "export default {};",
      }),
    );
    assert.equal(sources[0].path, MANIFESTE);
  });

  it("trie les fragments par nom — deux machines doivent rendre le même rapport", () => {
    const sources = readManifestSources(
      RACINE,
      lecteur({
        [MANIFESTE]: "",
        [frag("zeta.ts")]: "",
        [frag("alpha.ts")]: "",
        [frag("milieu.ts")]: "",
      }),
    );
    assert.deepEqual(
      sources.slice(1).map((s) => path.basename(s.path)),
      ["alpha.ts", "milieu.ts", "zeta.ts"],
    );
  });

  it("ÉCARTE les noms réservés du chargement par convention", () => {
    // `config.ts` et `*.config.ts` sont les noms qu'un MODULE emploie pour être
    // chargé tout seul. Les accepter ici rendrait indécidable, à la lecture,
    // si un fichier est chargé par le framework ou parce que le manifeste
    // l'importe.
    const sources = readManifestSources(
      RACINE,
      lecteur({
        [MANIFESTE]: "",
        [frag("config.ts")]: "",
        [frag("cluster.config.ts")]: "",
        [frag("http.d.ts")]: "",
        [frag("notes.md")]: "",
        [frag("http.ts")]: "",
      }),
    );
    assert.deepEqual(
      sources.slice(1).map((s) => path.basename(s.path)),
      ["http.ts"],
    );
  });

  it("rend ce qu'il a quand un fragment est ILLISIBLE, au lieu de se taire", () => {
    // `doctor` tourne précisément quand l'application ne va pas bien : un
    // rapport amputé vaut mieux qu'un outil qui refuse de répondre.
    const base = lecteur({
      [MANIFESTE]: "export default {};",
      [frag("ok.ts")]: "export const ok = 1;",
      [frag("casse.ts")]: "",
    });
    const cassé: IManifestReader = {
      ...base,
      read: (f) => {
        if (path.basename(f) === "casse.ts") throw new Error("EACCES");
        return base.read(f);
      },
    };
    const sources = readManifestSources(RACINE, cassé);
    assert.deepEqual(
      sources.map((s) => path.basename(s.path)),
      ["nodefony.config.ts", "ok.ts"],
    );
  });

  it("rend un tableau VIDE quand il n'y a pas de manifeste du tout", () => {
    assert.deepEqual(readManifestSources(RACINE, lecteur({})), []);
  });
});
