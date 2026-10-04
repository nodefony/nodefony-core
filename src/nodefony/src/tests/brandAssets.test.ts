/**
 * Le logo Nodefony : UNE source vectorielle, des dérivés PROUVÉS, des copies
 * DÉCLARÉES, aucune autre.
 *
 * La source est `assets/nodefony-logo.svg` du paquet `nodefony`. Le PNG et le
 * favicon en sont rastérisés par `scripts/generate/brand-assets.mjs`, qui inscrit
 * l'empreinte SHA-256 de la source et de chaque dérivé dans
 * `assets/brand-assets.json`. Ce test ne rastérise pas lui-même — Chromium ne
 * rend pas le même PNG octet pour octet d'une version à l'autre, et un test
 * unitaire n'a pas de navigateur sur les trois plateformes : il exige que les
 * empreintes ENREGISTRÉES correspondent aux fichiers. Un SVG modifié sans
 * relancer le générateur, ou un PNG retouché à la main, y tombe.
 *
 * Il en existait
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
import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  BRAND_FAVICON_PATH,
  BRAND_LOGO_PATH,
  BRAND_MANIFEST_PATH,
  BRAND_SVG_PATH,
  brandAssetContent,
  pngToIco,
} from "../cli/scaffold/brandAssets";

const packageRoot = fileURLToPath(new URL("../../", import.meta.url));
const repoRoot = path.resolve(packageRoot, "..", "..");
const svg = readFileSync(path.join(packageRoot, BRAND_SVG_PATH));
const logo = readFileSync(path.join(packageRoot, BRAND_LOGO_PATH));
const ico = readFileSync(path.join(packageRoot, BRAND_FAVICON_PATH));
const sha256 = (bytes: Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");

/** Ce que le générateur a inscrit — la forme qu'en attend ce test. */
interface IBrandManifest {
  source: { file: string; sha256: string };
  derived: Record<string, { sha256: string; bytes: number }>;
  logoHeight: number;
  faviconSizes: number[];
}
const manifest = JSON.parse(
  readFileSync(path.join(packageRoot, BRAND_MANIFEST_PATH), "utf8"),
) as IBrandManifest;

/** Les couleurs de la marque, relevées sur l'original. */
const BRAND_COLORS = ["#0067ba", "#448438", "#00a0f2"];

/** Lit les entrées d'un ICO : dimensions et PNG embarqué de chacune. */
function icoEntries(file: Buffer): { size: number; png: Buffer }[] {
  const count = file.readUInt16LE(4);
  return Array.from({ length: count }, (_, i) => {
    const entry = 6 + 16 * i;
    const len = file.readUInt32LE(entry + 8);
    const at = file.readUInt32LE(entry + 12);
    return { size: file[entry] || 256, png: file.subarray(at, at + len) };
  });
}

/** Commande à relancer, rappelée dans chaque message d'échec. */
const REGENERATE = "node scripts/generate/brand-assets.mjs";

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

describe("logo Nodefony — une source SVG, des dérivés prouvés", () => {
  it("la source est un vectoriel pur, aux couleurs de la marque", () => {
    const text = svg.toString("utf8");
    assert.match(text, /^<svg [^>]*viewBox="0 0 [\d.]+ [\d.]+"/u);
    // Aucune image matricielle embarquée, aucun filtre : un SVG qui en porte
    // n'est vectoriel que de nom, et pixelise à l'agrandissement.
    assert.notMatch(text, /<image|<filter|data:image/u);
    const fills = [...text.matchAll(/fill="(#[0-9a-f]{6})"/gu)].map(
      (m) => m[1],
    );
    assert.deepEqual(fills, BRAND_COLORS);
  });

  it("le SVG source est celui dont les dérivés ont été tirés", () => {
    assert.strictEqual(manifest.source.file, path.basename(BRAND_SVG_PATH));
    assert.strictEqual(
      sha256(svg),
      manifest.source.sha256,
      `${BRAND_SVG_PATH} a changé sans régénération des dérivés — lancer ${REGENERATE}`,
    );
  });

  it("chaque dérivé est celui que le générateur a écrit", () => {
    const files = {
      [path.basename(BRAND_LOGO_PATH)]: logo,
      [path.basename(BRAND_FAVICON_PATH)]: ico,
    };
    assert.sameMembers(Object.keys(manifest.derived), Object.keys(files));
    for (const [name, bytes] of Object.entries(files)) {
      assert.strictEqual(
        sha256(bytes),
        manifest.derived[name]?.sha256,
        `assets/${name} ne correspond plus à la rastérisation enregistrée — ne pas le retoucher : modifier le SVG puis lancer ${REGENERATE}`,
      );
    }
  });

  it("le PNG a la hauteur promise, le favicon ses tailles carrées", () => {
    assert.strictEqual(logo.readUInt32BE(20), manifest.logoHeight);
    const entries = icoEntries(ico);
    assert.deepEqual(
      entries.map((e) => e.size),
      manifest.faviconSizes,
    );
    for (const { size, png } of entries) {
      assert.strictEqual(png.readUInt32BE(16), size, "image non carrée");
      assert.strictEqual(png.readUInt32BE(20), size, "image non carrée");
    }
  });
});

describe("logo Nodefony — copies déclarées, aucune autre", () => {
  it("pngToIco enveloppe chaque PNG sans le transformer", () => {
    const [a, b] = icoEntries(ico).map((e) => e.png);
    if (!a || !b) throw new Error("favicon de moins de deux images");
    const built = Buffer.from(pngToIco(a, b));
    assert.deepEqual([...built.subarray(0, 6)], [0, 0, 1, 0, 2, 0]);
    // Dimensions lues dans l'en-tête IHDR de chaque PNG.
    assert.strictEqual(built[6], a.readUInt32BE(16));
    assert.strictEqual(built[22], b.readUInt32BE(16));
    assert.strictEqual(built.readUInt32LE(18), 6 + 16 * 2);
    assert.strictEqual(built.readUInt32LE(34), 6 + 16 * 2 + a.length);
    assert.isTrue(
      built.subarray(38).equals(Buffer.concat([a, b])),
      "les PNG doivent suivre tels quels, dans l'ordre",
    );
  });

  it("pngToIco refuse ce qui n'est pas un PNG, une image trop grande, et rien", () => {
    assert.throws(() => pngToIco(Buffer.from("pas une image")), /pas un PNG/u);
    const big = Buffer.from(logo);
    big.writeUInt32BE(300, 16);
    assert.throws(() => pngToIco(big), /300×/u);
    assert.throws(() => pngToIco(), /aucune image/u);
  });

  it("chaque copie déclarée est identique à la source", () => {
    for (const { file, kind, why } of DECLARED) {
      const expected = brandAssetContent(kind, packageRoot).content;
      const actual = readFileSync(path.join(repoRoot, file));
      assert.isTrue(
        actual.equals(Buffer.from(expected)),
        `${file} diverge de ${BRAND_LOGO_PATH} (${why}) — la recopier depuis la source`,
      );
    }
  });

  it("aucune autre copie, ni fichier ni data-URI, n'existe dans le dépôt", () => {
    const inPackage = (rel: string) =>
      path.join(path.relative(repoRoot, packageRoot), rel);
    const allowed = new Set([
      inPackage(BRAND_SVG_PATH),
      inPackage(BRAND_LOGO_PATH),
      inPackage(BRAND_FAVICON_PATH),
      ...DECLARED.map((d) => d.file),
    ]);
    // Le base64 du logo commence comme celui de toute image PNG : la signature
    // ne suffit pas. Un extrait pris au milieu ne désigne que CE logo.
    const b64 = logo.toString("base64");
    const needle = b64.slice(200, 280);
    // Le tracé du SVG recopié en ligne (un composant qui inline le logo) :
    // un extrait des données d'un chemin ne désigne que CE dessin.
    const pathData = /\bd="([^"]+)"/u.exec(svg.toString("utf8"))?.[1] ?? "";
    assert.isAbove(pathData.length, 60, "tracé du SVG introuvable");
    const svgNeedle = pathData.slice(10, 60);
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
      if (bytes.equals(logo) || bytes.equals(ico) || bytes.equals(svg)) {
        strays.push(`${file} (copie du fichier)`);
      } else if (bytes.includes(needle)) {
        strays.push(`${file} (data-URI du logo)`);
      } else if (bytes.includes(svgNeedle)) {
        strays.push(`${file} (tracé du SVG recopié)`);
      }
    }
    // Un balayage qui ne lit rien reste vert pour toujours.
    assert.isAbove(scanned, 1000, "balayage du dépôt inopérant");
    assert.deepEqual(
      strays,
      [],
      `copies NON déclarées du logo — les remplacer par la source ` +
        `(import de nodefony/assets/nodefony-logo.svg ou .png, ou public/ d'une app), ` +
        `ou les déclarer dans DECLARED avec leur raison`,
    );
  });
});
