/**
 * Les routes VOISINES qu'une garde de rôle laisse ouvertes.
 *
 * `create controller --role` pose `@IsGranted` sur le controller créé : cela
 * ferme un FICHIER, jamais un ESPACE. Toute route servie sous le même préfixe
 * par un autre controller reste ouverte, et la suivante naîtra ouverte aussi.
 * Mesuré au banc de découvrabilité (tâche 17, 0/3) : la route sœur du décor,
 * jamais nommée à l'agent, répondait 200 à un anonyme.
 *
 * Les fonctions sont PURES — le texte leur est donné — parce qu'un lecteur de
 * sources qui exigerait un projet sur disque ne s'éprouverait qu'avec lui.
 */
import { describe, it } from "vitest";
import { assert } from "chai";
import {
  controllerPrefix,
  declaredRoutePaths,
  isUnderPrefix,
  openSiblingRoutes,
} from "../cli/scaffold/routePaths";

describe("les chemins de route déclarés dans une source", () => {
  it("lit les DEUX formes — décorateur de méthode et clé `path` d'un @route", () => {
    const source = [
      '@route({ path: "/api/account/notes" })',
      "export class NoteController {",
      '  @Get("/api/account/notes/{id}")',
      "  async one() {}",
      "}",
    ].join("\n");

    // L'ordre est celui du TEXTE : `@route` précède `@Get` dans la source.
    assert.deepEqual(declaredRoutePaths(source), [
      "/api/account/notes",
      "/api/account/notes/{id}",
    ]);
  });

  it("ne lit PAS un `path:` éloigné de tout @route — c'est la clé de react-router", () => {
    const source = [
      "const routes = [",
      '  { path: "/dashboard/:id", element: <Page /> },',
      "];",
    ].join("\n");

    assert.isEmpty(
      declaredRoutePaths(source),
      "accuser du code correct est le pire mode de défaillance",
    );
  });
});

describe("être SOUS un préfixe se juge sur les segments", () => {
  it("retient un vrai enfant", () => {
    assert.isTrue(isUnderPrefix("/api/account/notes", "/api/account"));
  });

  it("retient le préfixe lui-même", () => {
    assert.isTrue(isUnderPrefix("/api/account", "/api/account"));
  });

  it("REFUSE un voisin qui partage seulement des caractères", () => {
    assert.isFalse(
      isUnderPrefix("/api/accounts", "/api/account"),
      "une comparaison littérale signalerait une route qui n'a rien à voir",
    );
  });

  it("refuse un chemin plus court", () => {
    assert.isFalse(isUnderPrefix("/api", "/api/account"));
  });
});

describe("le préfixe d'un controller", () => {
  it("se lit dans @controller, pas dans ses actions", () => {
    const source = [
      '@controller("/api/account/notes")',
      "export class NoteController {",
      '  @route("notes-index", { path: "", method: "GET" })',
      "  async index() {}",
      "}",
    ].join("\n");

    assert.equal(controllerPrefix(source), "/api/account/notes");
  });

  it("rend null quand le fichier n'en déclare pas", () => {
    assert.isNull(controllerPrefix("export class Rien {}"));
  });
});

describe("openSiblingRoutes — ce que la garde ne couvre pas", () => {
  /** Un controller voisin, tel que le générateur l'écrit vraiment. */
  const controller = (prefixe: string): string =>
    `@controller("${prefixe}")\nexport class X {\n  @route("x", { path: "", method: "GET" })\n  async i() {}\n}`;

  it("NOMME le voisin resté ouvert sous le même préfixe", () => {
    const trouvees = openSiblingRoutes("/api/account", [
      {
        file: "AccountNoteController.ts",
        text: controller("/api/account/notes"),
      },
    ]);

    assert.lengthOf(trouvees, 1);
    assert.equal(trouvees[0]?.route, "/api/account/notes");
    assert.equal(trouvees[0]?.file, "AccountNoteController.ts");
  });

  it("reste MUET quand le controller est seul sous son préfixe", () => {
    assert.isEmpty(
      openSiblingRoutes("/api/account", [
        { file: "HelloController.ts", text: controller("/api/hello") },
      ]),
      "avertir à tort apprend à passer outre",
    );
  });

  it("ne se laisse pas prendre par un préfixe qui partage des CARACTÈRES", () => {
    assert.isEmpty(
      openSiblingRoutes("/api/account", [
        { file: "AccountsController.ts", text: controller("/api/accounts") },
      ]),
    );
  });

  it("ignore un fichier sans @controller", () => {
    assert.isEmpty(
      openSiblingRoutes("/api/account", [
        { file: "helpers.ts", text: "export const x = 1;" },
      ]),
    );
  });
});
