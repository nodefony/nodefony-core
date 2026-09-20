/**
 * Unit — les rôles PROPOSÉS à l'attribution viennent du SERVEUR (#60).
 *
 * Deux copies des mêmes chaînes vivaient côte à côte : la hiérarchie déclarée
 * par `defineSecurityConfig({ roleHierarchy })` et une liste de noms écrite
 * dans le navigateur. Elles divergeaient sans une erreur — un rôle ajouté au
 * serveur n'était jamais proposé, et rien ne le disait.
 *
 * Ce banc tient les trois faits qui referment la dette : le helper rend bien
 * TOUS les rôles connus du serveur (y compris ceux qui n'héritent de rien),
 * un rôle renommé côté serveur est vu sans qu'aucun fichier du front change,
 * et la liste en dur ne peut pas revenir par distraction.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { describe, it } from "vitest";
import { expect } from "chai";
import { knownRoles } from "../../../frontend/src/routes/roles/rolesModel";

const FRONT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../frontend/src",
);
const lire = (rel: string): string =>
  readFileSync(path.join(FRONT, rel), "utf8");

/**
 * Le contrat tel que `Firewall.describeRoleHierarchy()` le rend sur la config
 * du dépôt : quatre rôles de tenant sous le rôle plateforme, tous couvrant
 * `ROLE_USER` — qui n'est donc JAMAIS une clé.
 */
const HIERARCHIE_SERVEUR: Record<string, string[]> = {
  ROLE_NODEFONY_ADMIN: [
    "ROLE_ADMIN",
    "ROLE_SECURITY_AUDITOR",
    "ROLE_DEV",
    "ROLE_SUPERVISOR",
  ],
  ROLE_ADMIN: ["ROLE_USER"],
  ROLE_SECURITY_AUDITOR: ["ROLE_USER"],
  ROLE_DEV: ["ROLE_USER"],
  ROLE_SUPERVISOR: ["ROLE_USER"],
};

describe("knownRoles — tous les rôles que le serveur fait connaître", () => {
  it("inclut un rôle qui n'est QUE valeur — le cas qui aurait régressé", () => {
    // `roles[]` du contrat serveur vaut `Object.keys(hierarchy)` : il ne porte
    // pas ROLE_USER. S'en contenter aurait retiré le rôle de base du sélecteur.
    expect(Object.keys(HIERARCHIE_SERVEUR)).to.not.include("ROLE_USER");
    expect(knownRoles(HIERARCHIE_SERVEUR)).to.include("ROLE_USER");
  });

  it("rend exactement les six rôles de la configuration du dépôt, triés", () => {
    expect(knownRoles(HIERARCHIE_SERVEUR)).to.deep.equal([
      "ROLE_ADMIN",
      "ROLE_DEV",
      "ROLE_NODEFONY_ADMIN",
      "ROLE_SECURITY_AUDITOR",
      "ROLE_SUPERVISOR",
      "ROLE_USER",
    ]);
  });

  it("hiérarchie vide → aucune suggestion, et surtout aucune liste de repli", () => {
    expect(knownRoles({})).to.deep.equal([]);
  });

  it("un rôle RENOMMÉ côté serveur est vu sans qu'un fichier du front change", () => {
    // Le critère de fin de #60, joué littéralement : seule la donnée du serveur
    // bouge entre les deux appels.
    // Un renommage côté serveur porte sur la clé ET sur les héritages qui la
    // citent — sinon le rôle survit comme valeur, ce que ce banc a montré.
    const renommee = JSON.parse(
      JSON.stringify(HIERARCHIE_SERVEUR).replaceAll(
        "ROLE_SUPERVISOR",
        "ROLE_EXPLOITANT",
      ),
    ) as Record<string, string[]>;

    const avant = knownRoles(HIERARCHIE_SERVEUR);
    const apres = knownRoles(renommee);
    expect(avant).to.include("ROLE_SUPERVISOR");
    expect(apres).to.include("ROLE_EXPLOITANT");
    expect(apres).to.not.include("ROLE_SUPERVISOR");
  });
});

describe("la liste de rôles ne peut pas revenir dans le navigateur", () => {
  it("`auth/roleNames.ts` n'exporte plus de liste d'attribution", () => {
    const src = lire("auth/roleNames.ts");
    expect(src).to.not.match(/export\s+const\s+STUDIO_ROLES/);
    // Toute autre liste de noms de rôles y serait la même dette sous un autre nom.
    expect(src).to.not.match(
      /export\s+const\s+\w+\s*:\s*readonly\s+string\[\]\s*=\s*\[\s*ROLE_/,
    );
  });

  it("l'écran Utilisateurs dérive ses suggestions du serveur", () => {
    const src = lire("routes/Users.tsx");
    expect(src).to.include("ROLES_ENDPOINT");
    // `knownRoles(...)` et non `data.roles` : c'est là que ROLE_USER se perdrait.
    expect(src).to.match(/knownRoles\(\s*roleHierarchy\.hierarchy\s*\)/);
    expect(src).to.not.match(/roleHierarchy\.roles/);
  });
});
