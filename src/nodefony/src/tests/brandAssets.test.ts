/**
 * Le logo Nodefony : UNE source, des copies DÉCLARÉES, aucune autre.
 *
 * La source est `assets/nodefony-logo.png` du paquet `nodefony`. Il en existait
 * six copies identiques — trois data-URI (bandeau et favicon de Studio, vitrines
 * générées) et trois fichiers —, dont deux seulement étaient tenues d'accord.
 * Une copie qu'aucun contrôle ne relie à sa source garde l'ancienne image le
 * jour où le logo change, sans que personne le voie.
 *
 * Les copies qui restent sont imposées par une frontière, et nommées ici avec
 * leur raison : une adresse GitHub publiée dans des README déjà sur npm, un
 * fichier que Keycloak lit dans son thème, le `public/` de l'application de
 * développement du dépôt. Toute AUTRE occurrence — fichier identique ou
 * data-URI — fait tomber ce test.
 */
import { describe, it } from "vitest";
import { assert } from "chai";
import { execFileSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  BRAND_LOGO_PATH,
  brandAssetContent,
  pngToIco,
} from "../cli/scaffold/brandAssets";

const packageRoot = fileURLToPath(new URL("../../", import.meta.url));
const repoRoot = path.resolve(packageRoot, "..", "..");
const logo = readFileSync(path.join(packageRoot, BRAND_LOGO_PATH));
const ico = Buffer.from(pngToIco(logo));

/**
 * Copies autorisées, relatives à la racine du dépôt, et ce qui les impose.
 * `favicon` : l'enveloppe ICO du logo, pas le PNG lui-même.
 */
const DECLARED: { file: string; kind: "logo" | "favicon"; why: string }[] = [
  {
    file: path.join("docs", "assets", "nodefony-logo.png"),
    kind: "logo",
    why: "adresse GitHub des README déjà publiés sur npm",
  },
  {
    file: path.join("public", "nodefony-logo.png"),
    kind: "logo",
    why: "application de développement du dépôt (page d'accueil, vitrines)",
  },
  {
    file: path.join("public", "favicon.ico"),
    kind: "favicon",
    why: "application de développement du dépôt",
  },
  {
    file: path.join(
      "docker",
      "keycloak",
      "themes",
      "nodefony",
      "login",
      "resources",
      "img",
      "logo.png",
    ),
    kind: "logo",
    why: "fichier lu par Keycloak dans son thème (copie outillée par #520)",
  },
];

/** Fichiers suivis par git — la frontière de ce qui part dans le dépôt. */
function trackedFiles(): string[] {
  const out = execFileSync("git", ["ls-files", "-z"], {
    cwd: repoRoot,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  return out
    .split("\0")
    .filter((f) => f.length > 0)
    .map((f) => path.join(...f.split("/")));
}

describe("logo Nodefony — une source, des copies déclarées", () => {
  it("pngToIco enveloppe le PNG sans le transformer", () => {
    assert.deepEqual([...ico.subarray(0, 6)], [0, 0, 1, 0, 1, 0]);
    // Dimensions lues dans l'en-tête IHDR du PNG.
    assert.strictEqual(ico[6], logo.readUInt32BE(16));
    assert.strictEqual(ico[7], logo.readUInt32BE(20));
    assert.strictEqual(ico.readUInt32LE(14), logo.length);
    assert.strictEqual(ico.readUInt32LE(18), 22);
    assert.isTrue(ico.subarray(22).equals(logo), "le PNG doit suivre tel quel");
  });

  it("pngToIco refuse ce qui n'est pas un PNG, et une image trop grande", () => {
    assert.throws(() => pngToIco(Buffer.from("pas une image")), /pas un PNG/u);
    const big = Buffer.from(logo);
    big.writeUInt32BE(300, 16);
    assert.throws(() => pngToIco(big), /300×/u);
  });

  it("chaque copie déclarée est identique à la source", () => {
    for (const { file, kind, why } of DECLARED) {
      const expected = brandAssetContent(kind, logo).content;
      const actual = readFileSync(path.join(repoRoot, file));
      assert.isTrue(
        actual.equals(Buffer.from(expected)),
        `${file} diverge de ${BRAND_LOGO_PATH} (${why}) — la recopier depuis la source`,
      );
    }
  });

  it("aucune autre copie, ni fichier ni data-URI, n'existe dans le dépôt", () => {
    const source = path.join(
      path.relative(repoRoot, packageRoot),
      BRAND_LOGO_PATH,
    );
    const allowed = new Set([source, ...DECLARED.map((d) => d.file)]);
    // Le base64 du logo commence comme celui de toute image PNG : la signature
    // ne suffit pas. Un extrait pris au milieu ne désigne que CE logo.
    const b64 = logo.toString("base64");
    const needle = b64.slice(200, 280);
    const strays: string[] = [];
    let scanned = 0;
    for (const file of trackedFiles()) {
      if (allowed.has(file)) continue;
      const abs = path.join(repoRoot, file);
      let stat;
      try {
        stat = statSync(abs);
      } catch {
        continue; // supprimé de l'arbre, pas encore de l'index
      }
      // Un sous-module est suivi comme une entrée, mais c'est un dossier.
      if (!stat.isFile() || stat.size > 4 * 1024 * 1024) continue;
      const bytes = readFileSync(abs);
      scanned += 1;
      if (bytes.equals(logo) || bytes.equals(ico)) {
        strays.push(`${file} (copie du fichier)`);
      } else if (bytes.includes(needle)) {
        strays.push(`${file} (data-URI du logo)`);
      }
    }
    // Un balayage qui ne lit rien reste vert pour toujours.
    assert.isAbove(scanned, 1000, "balayage du dépôt inopérant");
    assert.deepEqual(
      strays,
      [],
      `copies NON déclarées du logo — les remplacer par la source ` +
        `(import de nodefony/assets/nodefony-logo.png, ou public/ d'une app), ` +
        `ou les déclarer dans DECLARED avec leur raison`,
    );
  });
});
