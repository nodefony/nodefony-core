import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

/**
 * Ce que ce test prouve : chaque message que la référence binaire du skill
 * `nodefony-add-realtime-channel` recopie du code (§7) existe ENCORE dans le code.
 *
 * Un agent d'application cherche le texte exact d'une erreur pour savoir quoi
 * faire ; une référence qui cite un message renommé l'envoie chercher une cause
 * qui n'existe plus, sans que rien ne casse ici. Les deux copies — le message
 * dans le code, sa citation dans le skill — divergeraient en silence : ce test
 * les compare.
 */
const RACINE = path.join(import.meta.dirname, "..", "..", "..", "..", "..");
const REFERENCE = path.join(
  import.meta.dirname,
  "..",
  "skills",
  "nodefony-add-realtime-channel",
  "references",
  "binaire.md",
);
const SOURCES = [
  path.join(RACINE, "src", "nodefony", "src", "realtime"),
  path.join(RACINE, "src", "nodefony", "src", "client", "realtime"),
  path.join(
    RACINE,
    "src",
    "packages",
    "@nodefony",
    "realtime",
    "nodefony",
    "src",
  ),
];

function fichiersTs(dossier: string): string[] {
  return readdirSync(dossier, { recursive: true, encoding: "utf8" })
    .map((f) => path.join(dossier, f))
    .filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"))
    .filter((f) => !f.split(path.sep).includes("tests"));
}

/** Les messages de la colonne « Message » du tableau du §7, sans les backticks. */
function messagesCites(markdown: string): string[] {
  const section = markdown.split(/^## 7\. /mu)[1]?.split(/^## /mu)[0] ?? "";
  const messages: string[] = [];
  for (const ligne of section.split("\n")) {
    if (!ligne.startsWith("| ") || ligne.startsWith("| ---")) continue;
    const colonne = ligne.split(" | ")[1] ?? "";
    const cite = /^`(.+)`$/u.exec(colonne.trim());
    if (cite?.[1] !== undefined) messages.push(cite[1]);
  }
  return messages;
}

describe("skill nodefony-add-realtime-channel — références binaires", () => {
  // Le marqueur d'octets est interpolé depuis sa constante : on le relit tel que
  // l'utilisateur le voit.
  const code = SOURCES.flatMap(fichiersTs)
    .map((f) => readFileSync(f, "utf8"))
    .join("\n")
    .replaceAll("${BYTES_MARKER}", "$bytes");
  const messages = messagesCites(readFileSync(REFERENCE, "utf8"));

  it("le tableau des messages est lu (sinon le test ne prouverait rien)", () => {
    expect(messages.length).toBeGreaterThanOrEqual(10);
  });

  it("chaque message cité existe dans le code, morceau par morceau", () => {
    for (const message of messages) {
      // `<…>` marque une partie variable : chaque morceau fixe doit figurer tel quel.
      const morceaux = message
        .split(/<[^>]+>/u)
        .map((m) => m.trim())
        .filter((m) => m.length >= 6);
      expect(
        morceaux.length,
        `aucun morceau fixe dans ${message}`,
      ).toBeGreaterThan(0);
      for (const morceau of morceaux) {
        expect(
          code.includes(morceau),
          `« ${morceau} » introuvable dans le code`,
        ).toBe(true);
      }
    }
  });
});
