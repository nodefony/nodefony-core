import { describe, it } from "vitest";
import { assert } from "chai";
import { packageManagerCommandLines } from "../cli/packageManager";
import { renderStartPanel, type IStartPanelInput } from "../cli/startPanel";

/** Une app `complete` fraîche, installée et construite, sans agent ni démo. */
const BASE: IStartPanelInput = {
  relDest: "mon-app",
  commands: packageManagerCommandLines("npm"),
  installed: true,
  built: true,
  infra: null,
  migrationPending: false,
  admin: { user: "admin", password: "abcd-ef23-ghjk" },
  addFrontend: null,
  agent: { kind: "to-wire" },
  demo: { installed: false, command: "npm create nodefony essai -- --demo" },
};

/** Les intitulés d'étape, dans l'ordre où le bloc les numérote. */
function stepLabels(out: string): string[] {
  return [...out.matchAll(/^ (\d+) {2}(\S.*?) {2,}/gmu)].map(
    (m) => `${m[1] ?? ""} ${m[2] ?? ""}`,
  );
}

describe("renderStartPanel — le bloc « Pour commencer » de create app", () => {
  it("démarrer, se connecter, brancher son agent, apprendre — numérotés dans cet ordre", () => {
    const out = renderStartPanel(BASE);
    assert.deepEqual(stepLabels(out), [
      "1 Démarrer",
      "2 Se connecter",
      "3 Ton agent IA",
      "4 Apprendre",
    ]);
    assert.include(out, "Pour commencer");
    assert.include(out, "cd mon-app");
    assert.include(out, "npm run dev");
    // Le mot de passe sur SA ligne, en tête d'étape — plus en commentaire.
    assert.match(out, /^ 2 {2}Se connecter +admin \/ abcd-ef23-ghjk /mu);
    assert.include(out, "provisionUsers.ts");
    assert.include(out, `${BASE.commands.exec("nodefony")} ai:mcp`);
  });

  it("la démo non prise se NOMME : la commande d'une app jetable qui la porte", () => {
    const out = renderStartPanel(BASE);
    assert.match(
      out,
      /^ 4 {2}Apprendre +npm create nodefony essai -- --demo$/mu,
    );
    const taken = renderStartPanel({ ...BASE, demo: { installed: true } });
    assert.include(taken, "/demo");
    assert.notInclude(taken, "--demo");
  });

  it("le bloc est fermé par son filet, sans bord droit, dans 80 colonnes", () => {
    const out = renderStartPanel(BASE);
    const lines = out.trimEnd().split("\n");
    assert.match(lines.at(-1) ?? "", /^─+$/u);
    assert.isAtMost((lines.at(-1) ?? "").length, 80);
    assert.isTrue(lines.every((line) => !line.endsWith("│")));
  });

  it("chaque ligne tient dans 80 colonnes, même le cas le plus chargé", () => {
    // Un bloc qui se replie au milieu d'une commande ne se copie plus.
    for (const manager of ["npm", "pnpm", "yarn", "bun"] as const) {
      const out = renderStartPanel({
        ...BASE,
        commands: packageManagerCommandLines(manager),
        installed: false,
        built: false,
        infra: "mariadb",
        migrationPending: true,
        addFrontend: ["react", "vue", "angular", "svelte"],
        agent: { kind: "token-missing" },
      });
      for (const line of out.split("\n")) {
        assert.isAtMost(line.length, 80, `${manager} : « ${line} »`);
      }
    }
  });

  it("app sur place, préset minimal : ni « cd », ni compte de développement", () => {
    const out = renderStartPanel({ ...BASE, relDest: ".", admin: null });
    assert.notMatch(out, /\bcd /u);
    assert.notInclude(out, "Se connecter");
    assert.deepEqual(stepLabels(out), [
      "1 Démarrer",
      "2 Ton agent IA",
      "3 Apprendre",
    ]);
  });

  it("ce qui reste à faire précède le démarrage, dans l'ordre qui marche", () => {
    const out = renderStartPanel({
      ...BASE,
      installed: false,
      built: false,
      infra: "postgres",
      migrationPending: true,
    });
    const order = [
      "npm install",
      "npm run build",
      "npm run infra:up",
      "orm:generate --name init",
      "orm:migrate",
      "npm run dev",
    ].map((step) => out.indexOf(step));
    assert.notInclude(order, -1);
    assert.deepEqual(
      [...order].sort((a, b) => a - b),
      order,
    );
  });

  it("l'agent : à câbler, câblé, ou jeton à poser — trois gestes distincts", () => {
    assert.include(
      renderStartPanel({ ...BASE, agent: { kind: "wired" } }),
      "NF_MCP_TOKEN",
    );
    const missing = renderStartPanel({
      ...BASE,
      agent: { kind: "token-missing" },
    });
    assert.include(missing, "security:mcp:token --write");
    assert.notInclude(missing, "ai:mcp");
  });

  it("une app sans page web se voit proposer le front livré", () => {
    const out = renderStartPanel({
      ...BASE,
      addFrontend: ["react", "vue"],
    });
    assert.include(stepLabels(out), "3 Une page web");
    assert.include(out, "create front --frontend <moteur>");
    assert.include(out, "moteur : react · vue");
  });
});
