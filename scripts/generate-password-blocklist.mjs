#!/usr/bin/env node
/**
 * Fige la liste des mots de passe les plus courants en artefact VERSIONNÉ.
 *
 * Pourquoi un artefact, et pas un téléchargement au build : un build qui dépend
 * du réseau est un build qui casse — chez nous comme chez l'utilisateur. La
 * source est donc lue une fois, ici, et son empreinte est inscrite dans le
 * fichier produit ; regénérer et comparer suffit à prouver qu'il n'a pas dérivé.
 *
 * Pourquoi des hashs tronqués, et pas les chaînes : 10 000 chaînes dans un `Set`
 * pèsent ~600 Ko de tas PERMANENT, pour une vérification qui n'arrive qu'à la
 * création ou au changement d'un mot de passe. On garde les 4 premiers octets du
 * SHA-1, triés dans un `Uint32Array` (40 Ko, recherche binaire, zéro allocation
 * de chaîne). La collision vaut ~2,3 × 10⁻⁶ par test et REFUSE un mot de passe :
 * l'erreur tombe du bon côté.
 *
 * Usage :
 *   node scripts/generate-password-blocklist.mjs <fichier-source> [...autres]
 *
 * Le corpus attendu est SecLists (licence MIT, attribution portée dans
 * l'artefact), fichier
 * `Passwords/Common-Credentials/xato-net-10-million-passwords-10000.txt`.
 */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

/** Les 4 premiers octets du SHA-1, en entier non signé. */
export function truncatedHash(plain) {
  const digest = createHash("sha1").update(plain, "utf8").digest();
  return digest.readUInt32BE(0);
}

/** Une entrée retenue : non vide, sans blanc de bord. */
function normalize(line) {
  return line.replace(/\r$/, "");
}

// Importable sans rien produire : un test confronte la troncature écrite ici à
// celle du paquet (`truncatedPasswordHash`). Deux copies d'un même hachage
// divergeraient en silence — la liste deviendrait muette, et le contrôle
// passerait pour vert.
const lanceDirectement =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href;
if (!lanceDirectement) {
  // Rien d'autre à faire : le module n'expose que `truncatedHash`.
} else {
  main();
}

function main() {
  const sources = process.argv.slice(2);
  if (sources.length === 0) {
    console.error(
      "usage : node scripts/generate-password-blocklist.mjs <fichier-source> [...]",
    );
    process.exit(2);
  }

  const seen = new Set();
  const provenance = [];
  for (const source of sources) {
    const raw = readFileSync(source);
    const lines = raw.toString("utf8").split("\n").map(normalize);
    let kept = 0;
    for (const line of lines) {
      if (line.length === 0) continue;
      seen.add(truncatedHash(line));
      kept += 1;
    }
    provenance.push({
      file: path.basename(source),
      entries: kept,
      sha256: createHash("sha256").update(raw).digest("hex"),
    });
  }

  const sorted = Uint32Array.from([...seen].sort((a, b) => a - b));
  const bytes = Buffer.alloc(sorted.length * 4);
  for (const [index, value] of sorted.entries()) {
    bytes.writeUInt32BE(value, index * 4);
  }
  const base64 = bytes.toString("base64");

  const target = path.resolve(
    "src/packages/@nodefony/user/nodefony/src/password/commonPasswordHashes.ts",
  );
  const lignesSource = provenance
    .map(
      (p) =>
        ` * - \`${p.file}\` — ${p.entries} entrées, SHA-256 \`${p.sha256.slice(0, 32)}…\``,
    )
    .join("\n");

  const chunks = base64.match(/.{1,76}/g) ?? [];
  const literal = chunks.map((c) => `  "${c}"`).join(" +\n");

  writeFileSync(
    target,
    `/**
 * Empreintes des mots de passe les plus courants — **fichier GÉNÉRÉ, ne pas éditer**.
 *
 * Regénérer :
 * \`node scripts/generate-password-blocklist.mjs <fichier-source>\`
 *
 * Contenu : les 4 premiers octets du SHA-1 de chaque mot de passe, triés, en
 * base64 d'un \`Uint32Array\` gros-boutien. Le clair n'est PAS embarqué — ni
 * lisible, ni reconstructible depuis ce fichier.
 *
 * Sources :
${lignesSource}
 *
 * Corpus : SecLists (\`danielmiessler/SecLists\`), **licence MIT** — attribution
 * portée ici, telle que la licence l'exige. Le corpus lui-même n'est pas
 * redistribué : seules ces empreintes le sont.
 */

/** ${sorted.length} empreintes triées (${bytes.length} octets décodés). */
export const COMMON_PASSWORD_HASHES_BASE64 =
${literal};

/** Nombre d'empreintes — sert de contrôle au décodage. */
export const COMMON_PASSWORD_HASH_COUNT = ${sorted.length};
`,
    "utf8",
  );

  console.log(
    `✅ ${target}\n   ${sorted.length} empreintes · ${bytes.length} octets décodés · ${base64.length} caractères base64`,
  );
}
