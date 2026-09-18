/**
 * `nodefony image:check` — la RÈGLE, et le verdict qu'elle fait rendre.
 *
 * Ce qui est éprouvé ici est ce qu'une APPLICATION obtient : la commande est la
 * seule surface publique du contrôle, et c'est elle que la chaîne d'intégration
 * générée appelle. La lecture des couches d'un vrai `docker save` est éprouvée
 * ailleurs, sur des archives fabriquées octet par octet
 * (`scripts/release/image-gate.test.mjs`, qui importe ce même code) — deux
 * bancs, une implémentation.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  detectSuspectFiles,
  detectSuspectImageFiles,
  runImageCheckCommand,
} from "../cli/image";

describe("detectSuspectImageFiles — ce qui ne doit pas sortir dans une image", () => {
  it("refuse une clé privée, un trousseau JWT et un .env suffixé", () => {
    expect(
      detectSuspectImageFiles([
        "app/nodefony/config/certificates/server/privkey.pem",
        "app/var/keys/keyset.json",
        "app/.env.production",
        "app/dist/index.js",
      ]),
    ).toEqual([
      "app/nodefony/config/certificates/server/privkey.pem",
      "app/var/keys/keyset.json",
      "app/.env.production",
    ]);
  });

  it("tolère le .env NU de l'application — il est commité, sans secret", () => {
    expect(detectSuspectImageFiles(["app/.env", ".env"])).toEqual([]);
  });

  it("🔴 mais refuse un .env NICHÉ — `ai:mcp` y écrit le jeton porteur", () => {
    // C'est le secret le plus facile à publier d'une application Nodefony, et
    // une tolérance non bornée le laissait passer au nom d'un fichier homonyme
    // qui, lui, n'en porte aucun.
    expect(detectSuspectImageFiles(["app/.gemini/.env"])).toEqual([
      "app/.gemini/.env",
    ]);
  });

  it("tolère un .pem de dépendance — c'est une donnée de test, pas un secret", () => {
    expect(
      detectSuspectImageFiles([
        "app/node_modules/selfsigned/test/fixture.pem",
        "usr/local/lib/node_modules/npm/.npmrc",
      ]),
    ).toEqual([]);
  });

  it("tolère les magasins d'autorités du système, jamais etc/ssl/private", () => {
    expect(
      detectSuspectImageFiles(["etc/ssl/cert.pem", "etc/ssl/certs/ca.pem"]),
    ).toEqual([]);
    expect(detectSuspectImageFiles(["etc/ssl/private/server.key"])).toEqual([
      "etc/ssl/private/server.key",
    ]);
  });

  it("🔴 une .key sous etc/ssl/certs reste fatale — elle n'a rien à y faire", () => {
    expect(detectSuspectImageFiles(["etc/ssl/certs/server.key"])).toEqual([
      "etc/ssl/certs/server.key",
    ]);
  });

  it("vise des noms ENTIERS — `environment.md` et `keys.js` sont légitimes", () => {
    expect(detectSuspectFiles(["docs/environment.md", "src/keys.js"])).toEqual(
      [],
    );
  });
});

describe("runImageCheckCommand — le verdict rendu à l'appelant", () => {
  let dossier = "";
  let sortie = "";
  let erreur = "";
  const stdoutOrigine = process.stdout.write.bind(process.stdout);
  const stderrOrigine = process.stderr.write.bind(process.stderr);

  beforeEach(() => {
    dossier = fs.mkdtempSync(path.join(os.tmpdir(), "nf-image-check-test-"));
    sortie = "";
    erreur = "";
    process.stdout.write = (chunk: string): boolean => {
      sortie += chunk;
      return true;
    };
    process.stderr.write = (chunk: string): boolean => {
      erreur += chunk;
      return true;
    };
  });

  afterEach(() => {
    process.stdout.write = stdoutOrigine;
    process.stderr.write = stderrOrigine;
    fs.rmSync(dossier, { recursive: true, force: true });
  });

  /** Écrit un inventaire de chemins, un par ligne, et rend son chemin. */
  const inventaire = (lignes: string[]): string => {
    const fichier = path.join(dossier, "inventaire.txt");
    fs.writeFileSync(fichier, `${lignes.join("\n")}\n`, "utf8");
    return fichier;
  };

  it("REFUSE en nommant le fichier, code 1", async () => {
    const code = await runImageCheckCommand([
      "node",
      "nodefony",
      "image:check",
      "--files",
      inventaire(["app/dist/index.js", "app/nodefony/certs/privkey.pem"]),
    ]);
    expect(code).toBe(1);
    expect(erreur).toContain("REFUS");
    expect(erreur).toContain("privkey.pem");
    // Le remède nomme le geste qui FERME le trou, et dit pourquoi un `rm` dans
    // le Dockerfile ne le ferme pas.
    expect(erreur).toContain(".dockerignore");
  });

  it("ACCEPTE un inventaire sain, code 0", async () => {
    const code = await runImageCheckCommand([
      "node",
      "nodefony",
      "image:check",
      "--files",
      inventaire(["app/dist/index.js", "app/package.json"]),
    ]);
    expect(code).toBe(0);
    expect(sortie).toContain("rien de suspect");
    expect(erreur).toBe("");
  });

  it("🔴 ne pas POUVOIR regarder n'est pas un verdict favorable — code 69", async () => {
    const code = await runImageCheckCommand([
      "node",
      "nodefony",
      "image:check",
      "--files",
      path.join(dossier, "inventaire-qui-nexiste-pas.txt"),
    ]);
    expect(code).toBe(69);
    expect(erreur).toContain("CONTRÔLE AVEUGLE");
    expect(sortie).toBe("");
  });

  it("refuse un usage vide plutôt que de juger « rien », code 64", async () => {
    const code = await runImageCheckCommand([
      "node",
      "nodefony",
      "image:check",
    ]);
    expect(code).toBe(64);
  });
});

/**
 * 🔴 **La copie du dépôt et celle du produit ne doivent JAMAIS diverger.**
 *
 * La règle vit en DEUX exemplaires, et c'est assumé : `scripts/release/` n'est
 * pas publié, et la chaîne de publication ne doit dépendre d'aucun `dist` — un
 * import de construction ferait échouer `release:pack`, `release:smoke` et le
 * préflight dès qu'un build manque, c'est-à-dire risquer la publication entière
 * pour une économie de vingt lignes.
 *
 * Ce que la duplication coûte est donc payé ICI : deux implémentations sans test
 * de parité divergent en silence, chacune restant verte sur ses propres
 * assertions. Le corpus ci-dessous est DISCRIMINANT — il porte les trois
 * tolérances et leurs bornes, celles qu'une réécriture approximative raterait.
 */
describe("parité — la règle du dépôt et celle du produit rendent le MÊME verdict", () => {
  /** Chemins qui exercent chaque branche des deux implémentations. */
  const corpus = [
    "app/dist/index.js",
    "app/package.json",
    "app/nodefony/config/certificates/server/privkey.pem",
    "app/var/keys/keyset.json",
    "app/.env",
    ".env",
    "app/.env.local",
    "app/.env.production",
    "app/.gemini/.env",
    "app/.npmrc",
    "app/.netrc",
    "app/secrets.yaml",
    "app/secret.json",
    "root/.ssh/id_rsa",
    "root/.ssh/id_ed25519",
    "app/server.p12",
    "app/server.pfx",
    "app/store.keystore",
    "app/node_modules/selfsigned/test/fixture.pem",
    "usr/local/lib/node_modules/npm/.npmrc",
    "etc/ssl/cert.pem",
    "etc/ssl/certs/ca.pem",
    "etc/ssl1.1/certs/ca.pem",
    "etc/pki/tls/certs/ca-bundle.crt",
    "usr/share/ca-certificates/mozilla/x.crt",
    "etc/ssl/private/server.key",
    "etc/ssl/certs/server.key",
    "app/.git/config",
    "docs/environment.md",
    "src/keys.js",
  ];

  it("même sortie sur un corpus qui exerce chaque branche", async () => {
    // Import DYNAMIQUE : le script du dépôt vit hors de la racine de ce paquet,
    // et c'est précisément la frontière que ce test surveille.
    const depot = await import("../../../../scripts/release/release-core.mjs");
    expect(depot.detecterSuspectsImage(corpus)).toEqual(
      detectSuspectImageFiles(corpus),
    );
    expect(depot.detecterSuspects(corpus)).toEqual(detectSuspectFiles(corpus));
  });

  it("le corpus est DISCRIMINANT — il trie, il n'accepte pas tout", () => {
    const refuses = detectSuspectImageFiles(corpus);
    // Ni tout accepté (le test passerait sur une règle vide), ni tout refusé
    // (il passerait sur une règle qui dit oui à tout).
    expect(refuses.length).toBeGreaterThan(5);
    expect(refuses.length).toBeLessThan(corpus.length);
    // Et les trois tolérances mordent vraiment sur ce corpus.
    expect(refuses).not.toContain("app/.env");
    expect(refuses).not.toContain("etc/ssl/certs/ca.pem");
    expect(refuses).not.toContain(
      "app/node_modules/selfsigned/test/fixture.pem",
    );
    expect(refuses).toContain("etc/ssl/certs/server.key");
  });
});
