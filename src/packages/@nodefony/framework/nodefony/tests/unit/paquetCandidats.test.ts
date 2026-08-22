import { describe, it, expect } from "vitest";
import { candidatsPaquetNodefony } from "../../src/KernelAdminApi.js";

/**
 * Ce que cette suite prouve : la porte de documentation résout une clé de
 * module vers un paquet du FRAMEWORK, et pas vers son homonyme du registre npm.
 *
 * Les deux défauts qu'elle gèle ont été constatés en appels MCP réels — et
 * aucun n'était visible depuis le système de fichiers : l'un tient à l'ORDRE
 * des candidats, l'autre au PÉRIMÈTRE de ce qu'on accepte de servir.
 */
describe("résolution d'un paquet Nodefony depuis une clé de module", () => {
  it("🔴 le SCOPE passe devant l'homonyme tiers", () => {
    // `node_modules/redis` — le client Redis npm — existe dans l'arbre d'une
    // application. Essayé en premier, il gagnait : sans dossier `docs/`, la
    // réponse sortait VIDE, et le cas exact que la correction visait était le
    // seul à rater.
    // Et l'homonyme tiers n'est pas seulement SECOND : il est écarté. Le
    // périmètre le veut, et c'est plus sûr — servir la documentation d'une
    // dépendance quelconque n'a jamais été le sujet.
    expect(candidatsPaquetNodefony("redis")).to.deep.equal(["@nodefony/redis"]);
  });

  it("🔴 une dépendance HORS du framework n'est jamais servie", () => {
    // `PACKAGE_NAME` borne la traversée de chemin, pas le périmètre — deux
    // gardes distinctes qu'on confond. Sans la seconde, la porte rendait les
    // pages de `chrome-launcher` : l'arbre de dépendances d'une application
    // exposé à qui interroge la porte.
    expect(candidatsPaquetNodefony("chrome-launcher")).to.deep.equal([
      "@nodefony/chrome-launcher",
    ]);
    expect(candidatsPaquetNodefony("express")).to.not.include("express");
  });

  it("le socle passe sous son nom npm ET sous son nom logique", () => {
    // Héritage du dépôt JS : le core se nomme `nodefony` sur npm quand le reste
    // de la pile porte le scope.
    expect(candidatsPaquetNodefony("nodefony")).to.include("nodefony");
    expect(candidatsPaquetNodefony("core")).to.deep.equal(["@nodefony/core"]);
  });

  it("une clé DÉJÀ scopée ne se double pas", () => {
    expect(candidatsPaquetNodefony("@nodefony/redis")).to.deep.equal([
      "@nodefony/redis",
    ]);
  });

  it("une traversée de chemin ne produit AUCUN candidat", () => {
    for (const hostile of [
      "../../etc",
      "@nodefony/../../etc",
      "a/b/c",
      "",
      "UPPER",
    ]) {
      expect(candidatsPaquetNodefony(hostile), hostile).to.deep.equal([]);
    }
  });
});
