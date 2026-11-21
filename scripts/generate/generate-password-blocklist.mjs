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
 * création ou au changement d'un mot de passe. On garde les 8 premiers octets du
 * SHA-1, en paires d'entiers 32 bits (poids fort, poids faible) triées dans un
 * `Uint32Array` (80 Ko, recherche binaire, zéro allocation de chaîne).
 *
 * Pourquoi 8 octets et pas 4 : à 32 bits, la collision valait ~2,3 × 10⁻⁶ par
 * test. On la croyait du bon côté parce qu'elle REFUSE — mais elle refusait un
 * mot de passe sain à un utilisateur, et le mot de passe admin qu'une
 * application générée tire au hasard (une sur ~430 000 ne semait pas son
 * compte). À 64 bits, elle tombe à ~5 × 10⁻¹⁶.
 *
 * Usage :
 *   node scripts/generate/generate-password-blocklist.mjs <fichier-source> [...autres]
 *
 * Le corpus attendu est SecLists (licence MIT, attribution portée dans
 * l'artefact), fichier
 * `Passwords/Common-Credentials/xato-net-10-million-passwords-10000.txt`.
 *
 * @usage node scripts/generate/generate-password-blocklist.mjs <fichier-source> [...autres]
 */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

/**
 * Les 8 premiers octets du SHA-1, en deux entiers non signés gros-boutiens
 * `[poidsFort, poidsFaible]` — copie de `commonPasswordHash` du paquet, que
 * `passwordPolicy.test.ts` confronte à celle-ci.
 */
export function commonHash(plain) {
  const digest = createHash("sha1").update(plain, "utf8").digest();
  return [digest.readUInt32BE(0), digest.readUInt32BE(4)];
}

/** Une entrée retenue : non vide, sans blanc de bord. */
function normalize(line) {
  return line.replace(/\r$/, "");
}

// Importable sans rien produire : un test confronte la troncature écrite ici à
// celle du paquet (`commonPasswordHash`). Deux copies d'un même hachage
// divergeraient en silence — la liste deviendrait muette, et le contrôle
// passerait pour vert.
const lanceDirectement =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href;
if (!lanceDirectement) {
  // Rien d'autre à faire : le module n'expose que `commonHash`.
} else {
  main();
}

function main() {
  const sources = process.argv.slice(2);
  if (sources.length === 0) {
    console.error(
      "usage : node scripts/generate/generate-password-blocklist.mjs <fichier-source> [...]",
    );
    process.exit(2);
  }

  // Clé = les 16 chiffres hexadécimaux de la paire : dédoublonne sans BigInt.
  const seen = new Map();
  const provenance = [];
  for (const source of sources) {
    const raw = readFileSync(source);
    const lines = raw.toString("utf8").split("\n").map(normalize);
    let kept = 0;
    for (const line of lines) {
      if (line.length === 0) continue;
      const [high, low] = commonHash(line);
      seen.set(
        high.toString(16).padStart(8, "0") + low.toString(16).padStart(8, "0"),
        [high, low],
      );
      kept += 1;
    }
    provenance.push({
      file: path.basename(source),
      entries: kept,
      sha256: createHash("sha256").update(raw).digest("hex"),
    });
  }

  const sorted = [...seen.values()].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const bytes = Buffer.alloc(sorted.length * 8);
  for (const [index, [high, low]] of sorted.entries()) {
    bytes.writeUInt32BE(high, index * 8);
    bytes.writeUInt32BE(low, index * 8 + 4);
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
  // Un tableau joint, pas une chaîne de `+` : 1 400 concaténations font un arbre
  // syntaxique de 1 400 niveaux, sur lequel prettier sature sa pile d'appels.
  const literal = chunks.map((c) => `  "${c}",`).join("\n");

  writeFileSync(
    target,
    `/**
 * Empreintes des mots de passe les plus courants — **fichier GÉNÉRÉ, ne pas éditer**.
 *
 * Regénérer :
 * \`node scripts/generate/generate-password-blocklist.mjs <fichier-source>\`
 *
 * Contenu : les 8 premiers octets du SHA-1 de chaque mot de passe, en paires
 * (poids fort, poids faible) triées, base64 d'un \`Uint32Array\` gros-boutien. Le clair n'est PAS embarqué — ni
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
export const COMMON_PASSWORD_HASHES_BASE64 = [
${literal}
].join("");

/** Nombre d'empreintes — sert de contrôle au décodage. */
export const COMMON_PASSWORD_HASH_COUNT = ${sorted.length};
`,
    "utf8",
  );

  console.log(
    `✅ ${target}\n   ${sorted.length} empreintes · ${bytes.length} octets décodés · ${base64.length} caractères base64`,
  );
}
