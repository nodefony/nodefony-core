/**
 * Écriture d'un secret sur disque — les trois règles, éprouvées.
 *
 * Ce fichier existe parce qu'un jeton s'écrivait au masque par défaut, donc
 * lisible par tout compte de la machine, sans qu'aucun test ni aucune alerte ne
 * le dise. Le mode d'un fichier ne se relit pas dans une revue de code : il se
 * constate.
 *
 * ⚠️ Les permissions POSIX ne sont pas universelles — NTFS les ignore. Les cas
 * qui les mesurent se sautent explicitement là où elles n'ont pas cours, plutôt
 * que d'affaiblir l'assertion : accepter « 0600 ou autre chose » reviendrait à
 * ne plus rien vérifier nulle part.
 */
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import { beforeEach, describe, expect, it } from "vitest";
import {
  ecrireSecret,
  ecrireSecretSync,
  lireSiPresent,
  lireSiPresentSync,
  messageNonRestreint,
  MODE_SECRET,
  modeNonRestreint,
} from "../../nodefony/src/token/secretFile";

const POSIX = process.platform !== "win32";
let dir: string;

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "nf-secret-"));
});

describe("lireSiPresent — l'absence n'est pas une erreur, tout le reste en est une", () => {
  it("rend null sur un fichier absent, sans lever", () => {
    expect(lireSiPresentSync(path.join(dir, "nexiste-pas"))).toBeNull();
  });

  it("rend le contenu d'un fichier présent", () => {
    const f = path.join(dir, "a");
    writeFileSync(f, "valeur");
    expect(lireSiPresentSync(f)).toBe("valeur");
  });

  it("🔴 PIÈGE : un RÉPERTOIRE n'est pas un fichier absent — l'erreur remonte", () => {
    // Confondre les deux ferait écraser un secret existant par un fichier neuf,
    // au motif qu'il « n'existait pas ». `existsSync` ne distingue rien de tel.
    expect(() => lireSiPresentSync(dir)).toThrow();
  });

  it("forme asynchrone : même contrat", async () => {
    await expect(lireSiPresent(path.join(dir, "absent"))).resolves.toBeNull();
  });
});

describe("ecrireSecret — 0600, atomique, et sur une cible existante", () => {
  it.skipIf(!POSIX)(
    "🔴 crée le fichier en 0600, pas au masque par défaut",
    () => {
      const f = path.join(dir, "jeton");
      ecrireSecretSync(f, "s3cr3t");
      expect(readFileSync(f, "utf8")).toBe("s3cr3t");
      expect(statSync(f).mode & 0o777).toBe(MODE_SECRET);
    },
  );

  it.skipIf(!POSIX)(
    "🔴 PIÈGE : ÉCRASER un fichier existant le restreint AUSSI",
    () => {
      // Un `rename` par-dessus une cible existante peut en conserver le mode :
      // le cas qui compte n'est pas le fichier neuf, c'est celui qu'on remplace.
      const f = path.join(dir, "deja-la");
      writeFileSync(f, "ancien", { mode: 0o644 });
      expect(statSync(f).mode & 0o777).toBe(0o644);
      ecrireSecretSync(f, "nouveau");
      expect(readFileSync(f, "utf8")).toBe("nouveau");
      expect(statSync(f).mode & 0o777).toBe(MODE_SECRET);
    },
  );

  it("crée les dossiers manquants", () => {
    const f = path.join(dir, "a", "b", "c", "jeton");
    ecrireSecretSync(f, "x");
    expect(readFileSync(f, "utf8")).toBe("x");
  });

  it("ne laisse AUCUN fichier temporaire derrière lui", () => {
    const f = path.join(dir, "jeton");
    ecrireSecretSync(f, "x");
    expect(readdirSync(dir).filter((n) => n.includes(".tmp"))).toEqual([]);
  });

  it("🔴 l'écriture ÉCHOUE : le temporaire, qui porte le SECRET, ne survit pas", () => {
    // Le cas n'est pas théorique. Sous Windows, remplacer une cible OUVERTE par
    // un autre process échoue — et la cible est typiquement un `.env` que
    // l'utilisateur a sous les yeux dans son éditeur au moment où il lance la
    // commande. Le temporaire resterait alors sur le disque, en clair, sans que
    // personne ne le nettoie.
    //
    // On provoque l'échec de façon PORTABLE : la cible est un répertoire non
    // vide, que `rename` ne peut pas remplacer, sur aucune plateforme.
    const cible = path.join(dir, "occupee");
    mkdirSync(cible);
    writeFileSync(path.join(cible, "dedans"), "x");

    expect(() => ecrireSecretSync(cible, "s3cr3t")).toThrow();
    const restes = readdirSync(dir).filter((n) => n.includes(".tmp"));
    expect(restes, `temporaire ORPHELIN portant le secret : ${restes}`).toEqual(
      [],
    );
  });

  it("🔴 forme asynchrone : même nettoyage à l'échec", async () => {
    const cible = path.join(dir, "occupee-async");
    mkdirSync(cible);
    writeFileSync(path.join(cible, "dedans"), "x");

    await expect(ecrireSecret(cible, "s3cr3t")).rejects.toThrow();
    expect(readdirSync(dir).filter((n) => n.includes(".tmp"))).toEqual([]);
  });

  it.skipIf(!POSIX)("forme asynchrone : même mode", async () => {
    const f = path.join(dir, "async");
    await ecrireSecret(f, "y");
    expect(statSync(f).mode & 0o777).toBe(MODE_SECRET);
  });
});

describe("modeNonRestreint — CONSTATER, jamais déduire de la plateforme", () => {
  it.skipIf(!POSIX)("rend undefined quand la restriction a pris", () => {
    const f = path.join(dir, "ok");
    ecrireSecretSync(f, "x");
    expect(modeNonRestreint(f)).toBeUndefined();
  });

  it.skipIf(POSIX)(
    "hors POSIX : rend le mode obtenu au lieu de prétendre que tout va bien",
    () => {
      // Là où les permissions n'ont pas cours, la fonction doit RENDRE un
      // nombre — c'est ce qui déclenche l'avertissement. Prétendre `undefined`
      // ferait passer pour restreint un fichier qui ne l'est pas.
      const f = path.join(dir, "ok");
      ecrireSecretSync(f, "x");
      expect(typeof modeNonRestreint(f)).toBe("number");
    },
  );

  it.skipIf(!POSIX)("🔴 rend le mode EFFECTIF quand il est trop ouvert", () => {
    const f = path.join(dir, "ouvert");
    writeFileSync(f, "x", { mode: 0o644 });
    expect(modeNonRestreint(f)).toBe(0o644);
  });

  it("rend null sur un fichier absent — pas un faux verdict rassurant", () => {
    expect(modeNonRestreint(path.join(dir, "absent"))).toBeNull();
  });

  it("le message NOMME la cause probable et le geste à faire", () => {
    const m = messageNonRestreint("/tmp/x", 0o644);
    expect(m).toMatch(/0644/);
    expect(m).toMatch(/attendu 0600/);
    expect(m).toMatch(/NTFS/); // dit POURQUOI ça peut arriver sans faute de l'utilisateur
    // Et le GESTE, qui n'est pas le même partout : `chmod` n'existe pas sous
    // Windows, où il faut passer par les ACL. Un message qui donne une commande
    // introuvable envoie chercher au mauvais endroit.
    expect(m).toMatch(POSIX ? /chmod 600/ : /icacls/);
  });
});
