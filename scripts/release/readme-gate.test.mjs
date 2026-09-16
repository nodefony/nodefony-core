/**
 * La confrontation des README publiés, éprouvée SANS npm ni réseau.
 *
 * Le cœur du contrôle est une fonction pure, et c'est délibéré : ce qu'on garde
 * ici n'est pas une panne du registre, c'est une page npm qui ment. Chaque cas
 * ci-dessous est un défaut RÉEL — l'un de ceux que la passe manuelle de la
 * veille de l'alpha (`4d942323`) a corrigés à la main sur les quinze paquets,
 * plus le reste connu qu'elle avait laissé.
 *
 * Chaque famille est vue ROUGE ici, puis vue VERTE sur sa correction : un
 * contrôle qu'on n'a jamais regardé échouer ne garde rien.
 */
import { describe, expect, it } from "vitest";

import {
  confronterReadme,
  surfaceExportee,
  AJOUTES_DOFFICE,
} from "./readme-gate.mjs";

/** Le décor minimal : un paquet dont on connaît la surface et le tarball. */
const DECOR = {
  paquet: "@nodefony/exemple",
  fichier: "src/packages/@nodefony/exemple/README.md",
  racinePaquet: "/dev/null/exemple",
  fichiersTarball: new Set([
    ...AJOUTES_DOFFICE,
    "dist/index.js",
    "docs/index.md",
  ]),
  publiables: new Set(["nodefony", "create-nodefony", "@nodefony/exemple"]),
  surfaces: new Map([
    [
      "nodefony",
      { noms: new Set(["Kernel", "Service"]), defaut: false, aveugle: null },
    ],
    [
      "@nodefony/exemple",
      { noms: new Set(["Exemple"]), defaut: true, aveugle: null },
    ],
    [
      "create-nodefony",
      { noms: new Set(), defaut: false, aveugle: "aucun index.ts trouvé" },
    ],
  ]),
  exigeCanal: true,
};

const lire = (contenu, sur = {}) =>
  confronterReadme({ ...DECOR, ...sur, contenu });

const familles = (vu) => vu.ecarts.map((e) => e.famille);

describe("commandes d'installation", () => {
  it("refuse le nom d'un WORKSPACE que le registre ne sert pas", () => {
    // Le défaut du paquet principal : sa page disait « npm install
    // @nodefony/core », qui rend E404 — le paquet se nomme `nodefony`.
    const vu = lire("```bash\nnpm install @nodefony/core\n```");
    expect(familles(vu)).toEqual(["PAQUET-FANTOME"]);
    expect(vu.ecarts[0].detail).toContain("@nodefony/core");
    expect(vu.ecarts[0].ligne).toBe(2);
  });

  it("refuse une commande sans dist-tag tant que « latest » sert la lignée 7", () => {
    const vu = lire("```bash\nnpm install nodefony\n```");
    expect(familles(vu)).toEqual(["COMMANDE-SANS-CANAL"]);
  });

  it("accepte la MÊME commande dès que « latest » sert la 10", () => {
    // La règle se désarme d'elle-même : sans cela, elle deviendrait fausse le
    // jour de la bascule et il faudrait penser à la retirer.
    const vu = lire("```bash\nnpm install nodefony\n```", {
      exigeCanal: false,
    });
    expect(vu.ecarts).toEqual([]);
  });

  it("accepte une commande qui nomme son canal", () => {
    expect(lire("```bash\nnpm install nodefony@alpha\n```").ecarts).toEqual([]);
  });

  it("laisse la PROSE citer une commande sans canal", () => {
    // La prose dit délibérément que `npm install nodefony` sert encore la 7 ;
    // y voir un écart serait crier sur la phrase qui prévient du piège.
    expect(
      lire("Aujourd'hui, `npm install nodefony` sert la 7.0.2.").ecarts,
    ).toEqual([]);
  });

  it("résout « npm create nodefony » vers le paquet create-nodefony", () => {
    expect(lire("```bash\nnpm create nodefony@alpha\n```").ecarts).toEqual([]);
  });

  it("refuse un bloc à copier qui vise un workspace du monorepo", () => {
    // Reste connu de la passe manuelle : la page de `@nodefony/user` donnait
    // « npm run build --workspace=… » en guise d'installation.
    const vu = lire(
      "```bash\nnpm run build --workspace=src/packages/@nodefony/user\n```",
    );
    expect(familles(vu)).toEqual(["COMMANDE-DE-DEPOT"]);
  });
});

describe("liens relatifs", () => {
  const tarball = (contenu, fichiersTarball) =>
    lire(contenu, { fichiersTarball, racinePaquet: process.cwd() });

  it("refuse une cible qui n'existe nulle part", () => {
    const vu = tarball(
      "Voir [le guide](./docs/inexistant-xyz.md).",
      DECOR.fichiersTarball,
    );
    expect(familles(vu)).toEqual(["LIEN-MORT"]);
  });

  it("refuse une cible qui existe au dépôt mais PAS dans le tarball", () => {
    // Le cas vicieux, et le plus fréquent des quatorze corrigés : le lien est
    // vert quand on relit le dépôt, mort sur npmjs.com. `CLAUDE.md` était l'un
    // d'eux — il existe, il n'a jamais voyagé.
    const vu = tarball(
      "Les consignes vivent dans [CLAUDE.md](./CLAUDE.md).",
      new Set(["README.md"]),
    );
    expect(familles(vu)).toEqual(["LIEN-HORS-TARBALL"]);
    expect(vu.ecarts[0].detail).toContain("CLAUDE.md");
  });

  it("accepte un DOSSIER dès qu'un fichier du tarball vit dessous", () => {
    const vu = confronterReadme({
      ...DECOR,
      racinePaquet: process.cwd(),
      contenu: "Voir [la doc](./scripts).",
      fichiersTarball: new Set(["scripts/release/readme-gate.mjs"]),
    });
    expect(vu.ecarts).toEqual([]);
  });

  it("ignore les URL absolues, les ancres et les liens dans un bloc de code", () => {
    const vu = lire(
      "[npm](https://npmjs.com) · [haut](#titre) · [mail](mailto:x@y.z)\n\n```md\n[mort](./nulle-part.md)\n```",
    );
    expect(vu.ecarts).toEqual([]);
  });
});

describe("symboles importés", () => {
  it("refuse un symbole que l'index du paquet n'exporte pas", () => {
    // Le défaut n°4 : un import documenté vers un symbole jamais réexporté —
    // le « Usage minimal » de la page échouait à sa première ligne.
    const vu = lire('```ts\nimport { Kernel, Absent } from "nodefony";\n```');
    expect(familles(vu)).toEqual(["SYMBOLE-ABSENT"]);
    expect(vu.ecarts[0].detail).toContain("Absent");
  });

  it("accepte une liste multiligne, un alias et un import de type", () => {
    const vu = lire(
      '```ts\nimport {\n  Kernel,\n  Service as S,\n  type Kernel as K,\n} from "nodefony";\n```',
    );
    expect(vu.ecarts).toEqual([]);
  });

  it("refuse un import par DÉFAUT depuis un paquet qui n'en a pas", () => {
    // Constaté deux fois sur la page du cœur, qui n'exporte que du nommé.
    const vu = lire('```ts\nimport nodefony from "nodefony";\n```');
    expect(familles(vu)).toEqual(["IMPORT-DEFAUT"]);
  });

  it("accepte l'import par défaut d'un paquet qui en expose un", () => {
    expect(
      lire('```ts\nimport Exemple from "@nodefony/exemple";\n```').ecarts,
    ).toEqual([]);
  });

  it("ne juge pas un SOUS-CHEMIN, dont l'index est ailleurs", () => {
    // Juger `nodefony/client` sur la surface de `nodefony` ferait rougir un
    // symbole parfaitement exporté — un faux positif est pire qu'un trou connu.
    expect(
      lire('```ts\nimport { RealtimeClient } from "nodefony/client";\n```')
        .ecarts,
    ).toEqual([]);
  });

  it("ignore un import cité en PROSE, hors de tout bloc de code", () => {
    expect(
      lire('On écrit import { Absent } from "nodefony"; en tête.').ecarts,
    ).toEqual([]);
  });

  it("ANNONCE la surface qu'il n'a pas su lire, au lieu de la déclarer juste", () => {
    const vu = lire('```ts\nimport { Quoi } from "create-nodefony";\n```');
    expect(vu.ecarts).toEqual([]);
    expect(vu.nonVerifies).toEqual(["create-nodefony — aucun index.ts trouvé"]);
  });
});

describe("surfaceExportee — ce que l'index laisse atteindre", () => {
  it("lit la surface réelle du cœur", () => {
    const surface = surfaceExportee("src/nodefony");
    expect(surface.aveugle).toBeNull();
    expect(surface.noms.has("Kernel")).toBe(true);
    // Le cœur n'exporte QUE du nommé — c'est ce que sa page affirme.
    expect(surface.defaut).toBe(false);
    // `entities` vit dans `@nodefony/orm-core` : la page du cœur le documentait
    // pourtant parmi ses imports nommés.
    expect(surface.noms.has("entities")).toBe(false);
  });

  it("voit l'export par défaut d'un module", () => {
    expect(surfaceExportee("src/packages/@nodefony/security").defaut).toBe(
      true,
    );
  });
});
