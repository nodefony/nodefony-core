import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  DEFAULT_PASSWORD_POLICY,
  PasswordPolicy,
  truncatedPasswordHash,
} from "../../index";

/**
 * Banc de la politique de mot de passe.
 *
 * Les valeurs éprouvées ici sont DISCRIMINANTES : chaque refus attendu doit
 * tomber sur SA règle et pas sur une autre, sinon le test passerait au vert pour
 * la mauvaise raison. D'où les assertions sur le TEXTE de la règle, et pas
 * seulement sur le fait qu'un refus a eu lieu.
 */
describe("PasswordPolicy — règles algorithmiques, avant toute liste", () => {
  const politique = new PasswordPolicy();

  it("refuse plus court que la longueur minimale, et le dit", async () => {
    assert.equal(DEFAULT_PASSWORD_POLICY.minLength, 10);
    assert.match(
      (await politique.violation("abc")) ?? "",
      /trop court — 10 caractères/,
    );
  });

  it("la longueur est la PREMIÈRE règle — l'ordre des règles est observable", async () => {
    // `aaa` viole aussi la répétition. Si le motif l'emportait, c'est que les
    // règles coûteuses passent avant les gratuites — et la liste embarquée
    // serait alors consultée pour rien.
    assert.match((await politique.violation("aaa")) ?? "", /trop court/);
  });

  it("refuse un mot de passe égal à l'identifiant du compte", async () => {
    const verdict = await politique.violation("marie.dupont", {
      identifier: "marie.dupont",
    });
    assert.match(verdict ?? "", /identifiant du compte/);
  });

  it("refuse un mot de passe qui CONTIENT la partie locale d'un courriel", async () => {
    const verdict = await politique.violation("xmarieduXK7%", {
      identifier: "marieduX@exemple.fr",
    });
    assert.match(verdict ?? "", /identifiant du compte/);
  });

  it("un identifiant trop court ne déclenche pas la règle (sinon tout tomberait)", async () => {
    // `ab` apparaît dans une foule de mots de passe légitimes : une inclusion
    // de deux caractères n'est pas un indice, c'est du bruit.
    assert.equal(
      await politique.violation("Zb!trouvaille42", { identifier: "ab" }),
      null,
    );
  });

  it("refuse un motif répété de bout en bout", async () => {
    assert.match((await politique.violation("abababababab")) ?? "", /motif/);
    assert.match((await politique.violation("aaaaaaaaaaaa")) ?? "", /motif/);
  });

  it("une répétition qui n'en est plus une passe (le motif est borné à 4)", async () => {
    // `Zorglub` répété reste long et imprévisible : la règle ne doit pas mordre
    // sur la simple présence d'une répétition.
    assert.equal(await politique.violation("ZorglubZorglub"), null);
  });

  it("refuse une suite de touches — azerty ET qwerty, dans les deux sens", async () => {
    for (const candidat of [
      "azertyuiop",
      "qwertyuiop",
      "MonMotpoiu8",
      "0123456789",
      "Trouv9876!x",
    ]) {
      assert.match(
        (await politique.violation(candidat)) ?? "",
        /suite de touches|trop court|motif/,
        `attendu refusé : ${candidat}`,
      );
    }
  });

  it("accepte un mot de passe long et imprévisible", async () => {
    for (const candidat of [
      "Zb!trouvaille42",
      "cheval-lanterne-vinaigre",
      "Xk9#pLum!vert",
    ]) {
      assert.equal(
        await politique.violation(candidat),
        null,
        `attendu accepté : ${candidat}`,
      );
    }
  });
});

describe("PasswordPolicy — la liste de l'application", () => {
  it("refuse une valeur posée en configuration, quelle que soit la casse", async () => {
    const politique = new PasswordPolicy({ blocklist: ["MaSociete2026"] });
    assert.match(
      (await politique.violation("masociete2026")) ?? "",
      /liste interdite de cette application/,
    );
  });

  it("lit le fichier de valeurs interdites, une par ligne", async () => {
    const dossier = mkdtempSync(path.join(tmpdir(), "nf-pwd-"));
    const fichier = path.join(dossier, "interdits.txt");
    writeFileSync(fichier, "AcmeCorpInterne\nautreValeurLongue\n", "utf8");
    const politique = new PasswordPolicy({ blocklistFile: fichier });
    assert.match(
      (await politique.violation("acmecorpinterne")) ?? "",
      /liste interdite/,
    );
    assert.equal(await politique.violation("Zb!trouvaille42"), null);
  });

  it("un fichier introuvable ÉCHOUE franchement — jamais un contrôle muet", async () => {
    const politique = new PasswordPolicy({
      blocklistFile: path.join(tmpdir(), "nf-pwd-absent-12345.txt"),
    });
    await assert.rejects(() => politique.violation("Zb!trouvaille42"));
  });
});

describe("PasswordPolicy — les mots de passe les plus courants", () => {
  it("refuse un mot courant que les règles algorithmiques ne voient PAS", async () => {
    // `basketball` fait 10 caractères, ne répète aucun motif et ne contient
    // aucune suite de touches : seule la liste peut l'attraper. C'est ce qui
    // rend ce cas discriminant — il échoue si la liste n'est pas consultée.
    const politique = new PasswordPolicy();
    for (const candidat of ["basketball", "manchester", "password123"]) {
      assert.match(
        (await politique.violation(candidat)) ?? "",
        /les plus courants/,
        `attendu refusé par la liste : ${candidat}`,
      );
    }
  });

  it("le contrôle de liste se débranche explicitement, et alors le mot passe", async () => {
    const politique = new PasswordPolicy({ checkCommonPasswords: false });
    assert.equal(await politique.violation("basketball"), null);
  });

  it("`isBlocked` et `violation` rendent le MÊME verdict (une seule règle)", async () => {
    const politique = new PasswordPolicy();
    for (const candidat of ["abc", "basketball", "Zb!trouvaille42"]) {
      assert.equal(
        await politique.isBlocked(candidat),
        (await politique.violation(candidat)) !== null,
        candidat,
      );
    }
  });
});

describe("truncatedPasswordHash — la même troncature que le générateur", () => {
  it("concorde avec `scripts/generate-password-blocklist.mjs`", async () => {
    // Les deux copies sont inévitables (un script `.mjs` du dépôt ne peut pas
    // importer le `.ts` du paquet), donc elles se comparent. Sans ce test, une
    // divergence rendrait la liste MUETTE, et le contrôle passerait pour vert.
    // Le script tourne dans un SOUS-PROCESSUS, et c'est mieux qu'un import : on
    // éprouve le générateur tel qu'il s'exécute, pas une version retypée pour
    // l'occasion — et un `.mjs` du dépôt n'a, à raison, aucune déclaration.
    const { execFileSync } = await import("node:child_process");
    const { pathToFileURL } = await import("node:url");
    // `import()` prend une URL, pas un chemin : sous Windows, `D:\…` ferait lire
    // `d:` comme un protocole (axiome de portabilité du dépôt).
    const script = pathToFileURL(
      path.resolve(
        import.meta.dirname,
        "../../../../../../scripts/generate-password-blocklist.mjs",
      ),
    ).href;
    const candidats = ["password", "basketball", "Zb!trouvaille42", "é→漢"];
    const programme =
      `const m = await import(${JSON.stringify(script)});` +
      `process.stdout.write(JSON.stringify(` +
      `${JSON.stringify(candidats)}.map((p) => m.truncatedHash(p))));`;
    const rendu = execFileSync(
      process.execPath,
      ["--input-type=module", "-e", programme],
      {
        encoding: "utf8",
      },
    );
    const empreintes = JSON.parse(rendu) as number[];
    candidats.forEach((candidat, index) => {
      assert.equal(
        truncatedPasswordHash(candidat),
        empreintes[index],
        candidat,
      );
    });
  });
});

describe("le plancher de longueur n'a qu'UNE source", () => {
  it("l'écran de profil de la console annonce le MÊME minimum que la politique", async () => {
    // La copie est inévitable (la politique importe `node:fs`, elle ne traverse
    // pas vers le navigateur) — donc elle se vérifie. Un jumeau non vérifié
    // n'est pas vérifié : un écran qui annonce 8 là où le serveur refuse sous 10
    // fait respecter la consigne puis rend un 400.
    const { existsSync, readFileSync } = await import("node:fs");
    const miroir = path.resolve(
      import.meta.dirname,
      "../../../studio/frontend/src/routes/profile/profileModel.ts",
    );
    assert.ok(
      existsSync(miroir),
      `miroir introuvable : ${miroir} — si l'écran a déménagé, recaler ce test, ` +
        `ne pas le supprimer`,
    );
    const trouve = /MIN_PASSWORD_LENGTH = (\d+)/.exec(
      readFileSync(miroir, "utf8"),
    );
    assert.ok(
      trouve !== null,
      "MIN_PASSWORD_LENGTH introuvable dans le miroir",
    );
    assert.equal(
      Number(trouve[1]),
      DEFAULT_PASSWORD_POLICY.minLength,
      "l'écran de profil et la politique ne disent pas le même minimum",
    );
  });
});
