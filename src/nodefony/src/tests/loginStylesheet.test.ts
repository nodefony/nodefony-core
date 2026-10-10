/**
 * Les couleurs de la marque : UNE source, `assets/login.css` du paquet
 * `nodefony` (publiée sous `nodefony/login.css`), et des copies CONFRONTÉES.
 *
 * Quatre surfaces portent la même identité — la page de connexion du
 * framework, le thème Keycloak livré par `@nodefony/security`, la console
 * Studio et la barre de debug — et chacune vit derrière une frontière qui
 * interdit de lire la feuille à l'exécution : Keycloak ne sert que les
 * fichiers de SON thème, Studio passe par un thème Mantine en TypeScript, la
 * barre de debug s'isole dans son propre DOM. D'où des copies, et ce test qui
 * les tient d'accord : une copie qu'aucun contrôle ne relie à sa source garde
 * l'ancienne couleur le jour où la marque change, sans que personne le voie.
 *
 * Il exige aussi que le jeu CLAIR de la feuille, écrit deux fois (requête
 * média et `[data-theme="light"]`), le soit à l'identique.
 */
import { describe, it } from "vitest";
import { assert } from "chai";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = fileURLToPath(new URL("../../", import.meta.url));
const repoRoot = path.resolve(packageRoot, "..", "..");
const read = (...parts: string[]) =>
  readFileSync(path.join(repoRoot, ...parts), "utf8");

const SOURCE = path.join("src", "nodefony", "assets", "login.css");
const css = read(SOURCE);

/** Corps du premier bloc qui suit `opener` (sans accolades imbriquées). */
function block(text: string, opener: string): string {
  const at = text.indexOf(opener);
  assert.isAtLeast(at, 0, `bloc « ${opener} » introuvable`);
  const start = text.indexOf("{", at) + 1;
  return text.slice(start, text.indexOf("}", start));
}

/** Variables `--nf-login-*` d'un bloc, couleurs normalisées en minuscules. */
function loginVars(body: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of body.matchAll(/--nf-login-([a-z-]+):\s*([^;]+);/g)) {
    const [, key, value] = m;
    if (key !== undefined && value !== undefined)
      out[key] = value.trim().toLowerCase();
  }
  return out;
}

const dark = loginVars(block(css, ":root {"));

/** Teintes d'un `MantineColorsTuple` nommé de `theme.ts` de Studio. */
function studioTuple(name: string): string[] {
  const theme = read(
    "src",
    "packages",
    "@nodefony",
    "studio",
    "frontend",
    "src",
    "theme.ts",
  );
  const m = new RegExp(
    `const ${name}: MantineColorsTuple = \\[([^\\]]+)\\]`,
  ).exec(theme);
  assert.isNotNull(m, `teintes « ${name} » introuvables dans theme.ts`);
  return [...(m?.[1] ?? "").matchAll(/#[0-9a-f]{6}/gi)].map((x) =>
    x[0].toLowerCase(),
  );
}

describe("login.css — la source des couleurs de la marque", () => {
  it("porte le bleu, le vert et le cyan du LOGO, et rien d'autre", () => {
    const svg = read("src", "nodefony", "assets", "nodefony-logo.svg");
    const logo = [...svg.matchAll(/fill="(#[0-9a-f]{6})"/gi)]
      .map((m) => (m[1] ?? "").toLowerCase())
      .sort();
    assert.deepEqual(
      [dark["brand"], dark["brand-green"], dark["brand-cyan"]].sort(),
      logo,
    );
  });

  it("dessine les arcs de la jonction avec les couleurs du logo", () => {
    const arcs = decodeURIComponent(dark["arcs"] ?? "");
    const fills = [
      ...new Set(
        [...arcs.matchAll(/fill="(#[0-9a-f]{6})"/gi)].map((m) =>
          (m[1] ?? "").toLowerCase(),
        ),
      ),
    ].sort();
    assert.deepEqual(
      fills,
      [dark["brand"], dark["brand-green"], dark["brand-cyan"]].sort(),
    );
  });

  it("écrit le jeu clair deux fois À L'IDENTIQUE", () => {
    const media = block(css, ':root:not([data-theme="dark"])');
    const forced = block(css, ':root[data-theme="light"]');
    assert.deepEqual(loginVars(media), loginVars(forced));
    assert.isAbove(Object.keys(loginVars(forced)).length, 10);
  });
});

describe("les copies confrontées à login.css", () => {
  it("thème Keycloak : copie conforme à l'octet", () => {
    const copy = read(
      "src",
      "packages",
      "@nodefony",
      "security",
      "keycloak",
      "themes",
      "nodefony",
      "login",
      "resources",
      "css",
      "login.css",
    );
    assert.isTrue(
      copy === css,
      `copie Keycloak divergente — recopier ${SOURCE} dans le thème`,
    );
  });

  it("Studio : le bleu de marque et les surfaces sombres", () => {
    const blue = studioTuple("nodefonyBlue");
    assert.equal(blue[6], dark["brand"], "brand.6 = action principale");
    assert.equal(blue[7], dark["brand-hover"], "brand.7 = survol");
    const surfaces = studioTuple("nodefonyDark");
    const expected: [number, string][] = [
      [0, "text"],
      [2, "muted"],
      [4, "line"],
      [5, "raised"],
      [6, "surface"],
      [7, "bg"],
      [8, "hero-bg"],
    ];
    for (const [i, name] of expected) {
      assert.equal(surfaces[i], dark[name], `dark.${i} = --nf-login-${name}`);
    }
  });

  it("Studio : les liens prennent l'accent", () => {
    const theme = read(
      "src",
      "packages",
      "@nodefony",
      "studio",
      "frontend",
      "src",
      "theme.ts",
    );
    const anchor = /"--mantine-color-anchor":\s*"(#[0-9a-f]{6})"/i.exec(theme);
    assert.equal(anchor?.[1]?.toLowerCase(), dark["accent"]);
  });

  it("barre de debug : la marque, l'accent et les surfaces", () => {
    const bar = read(
      "src",
      "nodefony",
      "src",
      "client",
      "debugbar",
      "DebugBar.ts",
    );
    const v = (name: string) =>
      new RegExp(`--${name}:(#[0-9a-f]{6})`, "i").exec(bar)?.[1]?.toLowerCase();
    assert.equal(v("blue"), dark["brand"]);
    assert.equal(v("blue2"), dark["accent"]);
    assert.equal(v("ok"), dark["ok"]);
    assert.equal(v("warn"), dark["warn"]);
    assert.equal(v("line"), dark["line"]);
    assert.equal(v("card"), dark["surface"]);
    assert.equal(v("muted"), dark["muted"]);
    const background = /background: (#[0-9a-f]{6});\s*--blue:/i.exec(bar);
    assert.equal(background?.[1]?.toLowerCase(), dark["bg"]);
  });

  it("gabarits d'application : le bouton de la vitrine", () => {
    const showcase = read(
      "src",
      "nodefony",
      "templates",
      "app",
      "frontend",
      "shared",
      "frontend",
      "src",
      "showcase.css.tpl",
    );
    const button = /\.nf-card button \{[^}]*background: (#[0-9a-f]{6})/i.exec(
      showcase,
    );
    assert.equal(button?.[1]?.toLowerCase(), dark["brand"]);
  });
});
