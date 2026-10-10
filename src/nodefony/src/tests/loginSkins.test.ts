/**
 * Les habillages de la page de connexion : le catalogue du cœur
 * (`LOGIN_PAGE_SKINS`, `LOGIN_PAGE_SKIN_SPECS`) et les feuilles de
 * `assets/login/skins/` se tiennent d'accord.
 *
 * Une feuille sans entrée au catalogue n'est jamais servie ; une entrée sans
 * feuille rend une page sans habillage, sans un mot (404 sur la feuille). Une
 * variable mal orthographiée ne lève rien non plus : elle n'habille rien. Ce
 * banc rend ces trois fautes visibles.
 *
 * Il tient aussi le THÈME KEYCLOAK livré par `@nodefony/security` : Keycloak ne
 * sert que les fichiers de son thème, d'où une copie de chaque feuille et un
 * thème enfant `nodefony-<habillage>` par habillage. Une copie qu'aucun
 * contrôle ne relie à sa source garde l'ancienne couleur sans que personne
 * le voie.
 */
import { describe, it } from "vitest";
import { assert } from "chai";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  DEFAULT_LOGIN_PAGE_SKIN,
  LOGIN_PAGE_SKINS,
  LOGIN_PAGE_SKIN_SPECS,
  isLoginPageSkin,
  loginPageSkinFile,
} from "../runtime/authRoutes";

const assets = fileURLToPath(new URL("../../assets/", import.meta.url));
const skinsDir = path.join(assets, "login", "skins");
const base = readFileSync(path.join(assets, "login.css"), "utf8");

/** Corps du premier bloc qui suit `opener` (sans accolades imbriquées). */
function block(text: string, opener: string): string {
  const at = text.indexOf(opener);
  assert.isAtLeast(at, 0, `bloc « ${opener} » introuvable`);
  const start = text.indexOf("{", at) + 1;
  return text.slice(start, text.indexOf("}", start));
}

const declared = (css: string) =>
  new Set([...css.matchAll(/(--nf-login-[a-z0-9-]+)\s*:/g)].map((m) => m[1]));
const used = (css: string) =>
  new Set(
    [...css.matchAll(/var\(\s*(--nf-login-[a-z0-9-]+)/g)].map((m) => m[1]),
  );

const baseDeclared = declared(base);
const keycloakThemes = path.resolve(
  assets,
  "..",
  "..",
  "packages",
  "@nodefony",
  "security",
  "keycloak",
  "themes",
);
const skinned = LOGIN_PAGE_SKINS.filter((s) => s !== DEFAULT_LOGIN_PAGE_SKIN);
const read = (skin: string) =>
  readFileSync(path.join(skinsDir, `${skin}.css`), "utf8");

describe("habillages — catalogue et feuilles", () => {
  it("🔴 une feuille par habillage, aucune feuille hors catalogue", () => {
    const files = readdirSync(skinsDir)
      .filter((f) => f.endsWith(".css"))
      .sort();
    assert.deepEqual(files, skinned.map((s) => `${s}.css`).sort());
  });

  it("l'habillage par défaut n'a pas de feuille : login.css le porte seule", () => {
    assert.isNull(loginPageSkinFile(DEFAULT_LOGIN_PAGE_SKIN));
    for (const skin of skinned) {
      assert.equal(loginPageSkinFile(skin), `skins/${skin}.css`);
    }
  });

  it("isLoginPageSkin : liste fermée", () => {
    assert.isTrue(isLoginPageSkin("horizon"));
    for (const value of ["", "Horizon", "../login", "skins/horizon", 1, null]) {
      assert.isFalse(isLoginPageSkin(value), String(value));
    }
  });

  for (const skin of skinned) {
    describe(skin, () => {
      const css = read(skin);

      it("🔴 le jeu CLAIR est écrit deux fois à l'identique", () => {
        // Déclaration par déclaration, espaces réduits : le formateur indente
        // les deux copies différemment.
        const lines = (body: string) =>
          body
            .split(";")
            .map((d) => d.replace(/\s+/g, " ").trim())
            .filter(Boolean);
        assert.deepEqual(
          lines(block(css, ':root:not([data-theme="dark"]) {')),
          lines(block(css, ':root[data-theme="light"] {')),
        );
      });

      it("🔴 chaque variable lue existe ; chaque variable posée est connue de login.css ou lue ici", () => {
        const own = declared(css);
        const reads = used(css);
        for (const v of reads) {
          assert.isTrue(
            baseDeclared.has(v) || own.has(v),
            `${v} lue mais jamais définie`,
          );
        }
        for (const v of own) {
          assert.isTrue(
            baseDeclared.has(v) || reads.has(v),
            `${v} posée mais lue par personne (faute de frappe ?)`,
          );
        }
      });

      it("🔴 aucune image fournie : pas d'adresse de fichier, la photo vient de l'application", () => {
        for (const m of css.matchAll(/url\(\s*["']?([^"')]*)/g)) {
          assert.match(m[1] ?? "", /^data:/, `adresse de fichier : ${m[1]}`);
        }
      });

      it("fond décoré au catalogue ⇔ la feuille pose un fond de page", () => {
        assert.equal(
          LOGIN_PAGE_SKIN_SPECS[skin].backdrop,
          declared(css).has("--nf-login-backdrop"),
        );
      });
    });
  }

  describe("thème Keycloak", () => {
    it("🔴 chaque feuille d'habillage a sa copie À L'OCTET dans le thème `nodefony`", () => {
      const copies = path.join(
        keycloakThemes,
        "nodefony",
        "login",
        "resources",
        "css",
        "skins",
      );
      assert.deepEqual(
        readdirSync(copies).sort(),
        skinned.map((s) => `${s}.css`).sort(),
      );
      for (const skin of skinned) {
        assert.equal(
          readFileSync(path.join(copies, `${skin}.css`), "utf8"),
          read(skin),
          `copie Keycloak de ${skin}.css divergente`,
        );
      }
    });

    it("🔴 un thème enfant par habillage, avec la mise en page du catalogue, et aucun autre", () => {
      const children = readdirSync(keycloakThemes)
        .filter((d) => d.startsWith("nodefony-"))
        .sort();
      assert.deepEqual(children, skinned.map((s) => `nodefony-${s}`).sort());
      for (const skin of skinned) {
        const props = readFileSync(
          path.join(
            keycloakThemes,
            `nodefony-${skin}`,
            "login",
            "theme.properties",
          ),
          "utf8",
        );
        const value = (key: string) =>
          new RegExp(`^${key}=(.*)$`, "m").exec(props)?.[1]?.trim();
        assert.equal(value("parent"), "nodefony", skin);
        assert.equal(value("nfSkin"), skin);
        assert.equal(
          value("nfLayout"),
          LOGIN_PAGE_SKIN_SPECS[skin].layout,
          skin,
        );
        assert.match(
          value("styles") ?? "",
          new RegExp(` css/skins/${skin}\\.css$`),
        );
      }
    });
  });
});
