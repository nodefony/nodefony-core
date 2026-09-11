import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { AUTH_LOGIN_PATH } from "../../nodefony/command/security-user-add";

/**
 * Ce que ce contrôle garde : les DEUX écritures du chemin de connexion disent
 * la même chose.
 *
 * La commande qui crée un compte dit ensuite comment s'en servir — sans quoi le
 * compte ne sert à rien et la route gardée reste intestable. Mais la route est
 * MONTÉE dans un autre paquet (`mountSessionAuthRoutes`, module framework), et
 * sa valeur n'y vit dans aucune constante exportée : la copie est inévitable,
 * la divergence silencieuse ne l'est pas. Chaque copie passerait ses propres
 * tests pendant que la commande enverrait sur un 404.
 *
 * Le contrôle lit le SOURCE du monteur plutôt que de l'importer : l'importer
 * exécuterait le module framework pour lire une chaîne, et le montage est de
 * toute façon conditionné à un service qu'aucun test unitaire ne pose.
 */
const monteur = (): string => {
  const repoRoot = path.resolve(import.meta.dirname, "../../../../..");
  return readFileSync(
    path.join(
      repoRoot,
      "packages",
      "@nodefony",
      "framework",
      "nodefony",
      "controller",
      "SessionAuthController.ts",
    ),
    "utf8",
  );
};

describe("le chemin de connexion dit par la commande est celui qui est monté", () => {
  it("le monteur est lisible, et pose bien une base data plane", () => {
    // Un contrôle dont la source est vide passerait sur n'importe quoi.
    const source = monteur();
    expect(source.length).toBeGreaterThan(500);
    expect(source).toContain("mountSessionAuthRoutes");
  });

  it("la base + `/login` du monteur composent exactement AUTH_LOGIN_PATH", () => {
    const source = monteur();
    const base = /const base = "([^"]+)"/u.exec(source)?.[1];
    expect(base, "base des routes d'auth non trouvée dans le monteur").to.be.a(
      "string",
    );
    // La table du monteur écrit `${base}/login` — on recompose la même chose,
    // plutôt que de littéraliser deux fois le résultat.
    expect(source).toContain("`${base}/login`");
    expect(`${base}/login`).to.equal(AUTH_LOGIN_PATH);
  });
});
