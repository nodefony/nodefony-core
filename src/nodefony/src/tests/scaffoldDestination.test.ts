import assert from "node:assert/strict";
import path from "node:path";
import {
  isSafeSubPath,
  isInsideRoot,
  resolveScaffoldDestination,
  ScaffoldDestinationError,
  type IScaffoldRoot,
} from "../cli/scaffold/destination";

/**
 * Où une app créée depuis le web a le droit de naître.
 *
 * En ligne de commande, la destination est le `cwd` : l'utilisateur est chez lui. Sur le
 * web, elle arrive par le réseau — et un endpoint qui écrit au chemin qu'on lui donne
 * écrit aussi dans `/etc` ou `~/.ssh`. Ces tests sont donc une **surface d'attaque**, pas
 * un contrôle de saisie : ils tentent de SORTIR de l'espace autorisé.
 */
describe("destination d'une app créée depuis Studio", () => {
  const roots: IScaffoldRoot[] = [
    { id: "workspace", label: "Espace de travail", path: "/home/dev/projects" },
  ];

  describe("sous-chemin de navigation", () => {
    it("accepte la racine elle-même et des segments simples", () => {
      assert.equal(isSafeSubPath(""), true);
      assert.equal(isSafeSubPath("clients"), true);
      assert.equal(isSafeSubPath("clients/acme"), true);
      assert.equal(isSafeSubPath("v1.2_beta-3"), true);
    });

    it("REFUSE toute remontée, tout chemin absolu, tout octet nul", () => {
      assert.equal(isSafeSubPath(".."), false);
      assert.equal(isSafeSubPath("../.."), false);
      assert.equal(isSafeSubPath("clients/../../etc"), false);
      assert.equal(isSafeSubPath("/etc"), false);
      assert.equal(isSafeSubPath("."), false);
      assert.equal(isSafeSubPath("a\0b"), false);
      assert.equal(isSafeSubPath("a/../b"), false);
    });

    it("REFUSE les séparateurs déguisés et les caractères exotiques", () => {
      assert.equal(isSafeSubPath("a\\..\\b"), false);
      assert.equal(isSafeSubPath("a b"), false, "espace non autorisé");
      assert.equal(isSafeSubPath("a;rm -rf /"), false);
      assert.equal(isSafeSubPath("$(whoami)"), false);
    });
  });

  describe("appartenance à la racine", () => {
    it("un enfant est dedans, la racine elle-même ne l'est pas", () => {
      assert.equal(isInsideRoot("/home/dev", "/home/dev/app"), true);
      assert.equal(isInsideRoot("/home/dev", "/home/dev"), false);
    });

    it("le PIÈGE du préfixe : `/home/dev-secrets` n'est PAS dans `/home/dev`", () => {
      // Sans le séparateur final dans la comparaison, un simple `startsWith` laisserait
      // passer un dossier VOISIN dont le nom commence pareil.
      assert.equal(isInsideRoot("/home/dev", "/home/dev-secrets"), false);
      assert.equal(isInsideRoot("/home/dev", "/home/devil/app"), false);
    });

    it("une remontée est hors racine", () => {
      assert.equal(isInsideRoot("/home/dev", "/home/dev/../../etc"), false);
    });
  });

  describe("recomposition de la destination", () => {
    it("compose racine + sous-dossier + nom", () => {
      const dest = resolveScaffoldDestination(roots, "workspace", "clients", "acme");
      assert.equal(dest, path.resolve("/home/dev/projects/clients/acme"));
    });

    it("une racine inconnue est refusée (le client ne choisit pas un chemin)", () => {
      assert.throws(
        () => resolveScaffoldDestination(roots, "ailleurs", "", "app"),
        ScaffoldDestinationError,
      );
    });

    it("un nom d'app qui remonte est refusé", () => {
      // La tentative la plus évidente : faire passer la remontée par le NOM.
      assert.throws(
        () => resolveScaffoldDestination(roots, "workspace", "", "../../etc"),
        ScaffoldDestinationError,
      );
      assert.throws(
        () => resolveScaffoldDestination(roots, "workspace", "", ".."),
        ScaffoldDestinationError,
      );
    });

    it("un nom d'app absolu est refusé", () => {
      assert.throws(
        () => resolveScaffoldDestination(roots, "workspace", "", "/etc/cron.d"),
        ScaffoldDestinationError,
      );
    });

    it("un sous-dossier qui remonte est refusé", () => {
      assert.throws(
        () =>
          resolveScaffoldDestination(roots, "workspace", "../../..", "app"),
        ScaffoldDestinationError,
      );
    });

    it("un nom d'app hors convention est refusé (majuscules, espaces, points)", () => {
      for (const bad of ["MonApp", "mon app", "1app", "-app", "app.name", ""]) {
        assert.throws(
          () => resolveScaffoldDestination(roots, "workspace", "", bad),
          ScaffoldDestinationError,
          `"${bad}" aurait dû être refusé`,
        );
      }
    });
  });
});
