#!/usr/bin/env node
/**
 * Le code que `nodefony create` PRODUIT est-il accepté par le formateur que ce
 * même code embarque ?
 *
 * Le trou qu'il ferme : les assertions du dépôt lisent des CHAÎNES dans des
 * fichiers rendus. Aucune ne voit qu'un gabarit rend un titre collé à son
 * paragraphe, une table mal alignée ou une ligne trop longue — et une
 * application fraîchement générée arrivait ainsi avec SEPT fichiers que son
 * propre `npm run format` réécrivait au premier passage.
 *
 * Pourquoi une VÉRIFICATION et pas une correction automatique : le rendu ne
 * remonte pas au gabarit. Deux variantes d'un même gabarit produisent des
 * largeurs de table différentes ; corriger le fichier rendu n'apprend rien à sa
 * source. Ce script dit donc QUEL fichier sort non conforme, dans QUELLE
 * variante, et laisse la correction au gabarit — la seule qui tienne.
 *
 * ⚠️ Le CLI s'exécute depuis `dist`. Un gabarit se lit au disque (une édition
 * est prise en compte immédiatement), mais toute modification du MOTEUR exige un
 * build avant que ce script en voie l'effet.
 *
 * Usage :
 *   node scripts/check-scaffold-format.mjs            # les variantes par défaut
 *   node scripts/check-scaffold-format.mjs --keep     # conserve les apps générées
 *   node scripts/check-scaffold-format.mjs --diff     # montre ce que prettier changerait
 */
import { mkdtempSync, rmSync, mkdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PRETTIER = path.join(ROOT, "node_modules", ".bin", "prettier");
const KEEP = process.argv.includes("--keep");
const SHOW_DIFF = process.argv.includes("--diff");

/**
 * Les DEUX extrêmes, et pas une matrice.
 *
 * Une variante ne peut faire varier le rendu que par ce qu'elle AJOUTE ou
 * RETIRE. `complete` + frontend allume tout ce qui est conditionnel, `minimal`
 * n'en allume rien : une non-conformité qui n'apparaîtrait que dans un cas
 * intermédiaire supposerait un contenu présent dans NI l'un NI l'autre, ce qui
 * n'existe pas. Générer les 40 combinaisons coûterait des minutes pour la même
 * information.
 */
const VARIANTS = [
  {
    name: "complete+react",
    app: "probe",
    answers: ["--preset", "complete", "--frontend", "react"],
  },
  {
    name: "minimal",
    app: "probe",
    answers: ["--preset", "minimal", "--frontend", "none"],
  },
  // Un nom LONG : troisième régime, et le seul qui exerce les lignes dont la
  // longueur dépend d'une valeur interpolée. `content="<nom> — application
  // Nodefony."` tient sur une ligne pour `probe` et doit être éclatée pour un
  // nom de vingt caractères — deux formes différentes du MÊME gabarit. Sans ce
  // cas, on livre un rendu conforme pour les noms courts seulement, et le
  // premier utilisateur au nom de projet ordinaire reçoit du non conforme.
  {
    name: "nom-long+react",
    app: "application-metier-facturation",
    answers: ["--preset", "complete", "--frontend", "react"],
  },
];

let failed = 0;
for (const variant of VARIANTS) {
  const dir = mkdtempSync(path.join(tmpdir(), "nf-scaffold-fmt-"));
  const dest = path.join(dir, "app");
  mkdirSync(dest, { recursive: true });

  const gen = spawnSync(
    process.execPath,
    [
      path.join(ROOT, "src", "nodefony", "bin", "nodefony"),
      "create",
      "app",
      variant.app,
      "--dir",
      dest,
      "--yes",
      ...variant.answers,
    ],
    { cwd: ROOT, encoding: "utf8" },
  );
  if (gen.status !== 0) {
    console.error(
      `✗ ${variant.name} — la génération a échoué (code ${gen.status})`,
    );
    console.error(
      (gen.stderr || gen.stdout || "").split("\n").slice(-12).join("\n"),
    );
    failed++;
    if (!KEEP) rmSync(dir, { recursive: true, force: true });
    continue;
  }

  const check = spawnSync(PRETTIER, ["--check", "."], {
    cwd: dest,
    encoding: "utf8",
  });
  const offenders = (check.stdout + check.stderr)
    .split("\n")
    .filter((l) => l.startsWith("[warn] ") && !l.includes("Code style issues"))
    .map((l) => l.slice("[warn] ".length).trim());

  if (offenders.length === 0) {
    console.log(
      `✓ ${variant.name} — le rendu est conforme au formateur qu'il embarque`,
    );
  } else {
    failed++;
    console.error(
      `✗ ${variant.name} — ${offenders.length} fichier(s) non conformes :`,
    );
    for (const f of offenders) {
      console.error(`    ${f}`);
      if (SHOW_DIFF) {
        const want = spawnSync(PRETTIER, [f], { cwd: dest, encoding: "utf8" });
        const got = readFileSync(path.join(dest, f), "utf8");
        const a = got.split("\n");
        const b = (want.stdout ?? "").split("\n");
        for (
          let i = 0, shown = 0;
          i < Math.max(a.length, b.length) && shown < 6;
          i++
        ) {
          if (a[i] !== b[i]) {
            console.error(
              `      L${i + 1} rendu : ${JSON.stringify((a[i] ?? "").slice(0, 80))}`,
            );
            console.error(
              `      L${i + 1} voulu : ${JSON.stringify((b[i] ?? "").slice(0, 80))}`,
            );
            shown++;
          }
        }
      }
    }
  }
  if (KEEP) console.log(`    (conservé : ${dest})`);
  else rmSync(dir, { recursive: true, force: true });
}

if (failed > 0) {
  console.error(
    `\n${failed} variante(s) en échec. La correction va dans le GABARIT ` +
      `(src/nodefony/templates/), jamais dans le fichier rendu.\n` +
      `Rappels : une table markdown à lignes conditionnelles ne peut pas être ` +
      `alignée juste — en faire une liste ; une modification du moteur exige un build.`,
  );
  process.exit(1);
}
console.log("\nToutes les variantes sortent conformes.");
