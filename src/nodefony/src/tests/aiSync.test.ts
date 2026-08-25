import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { expect as chaiExpect } from "chai";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  rmSync,
  statSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  planSync,
  renderPointer,
  SKILLS_DIR,
  type IDiscoveredSkill,
} from "../cli/aiSyncReport";

void chaiExpect;

describe("ai:sync — la composition PURE", () => {
  const skill = (over: Partial<IDiscoveredSkill> = {}): IDiscoveredSkill => ({
    name: "add-crud",
    packageName: "@nodefony/devkit",
    summary: "Crée une ressource complète.",
    source: "node_modules/@nodefony/devkit/skills/add-crud/SKILL.md",
    ...over,
  });

  it("pose un skill absent", () => {
    const plan = planSync([skill()], {});
    expect(plan.skills).toHaveLength(1);
    expect(plan.skills[0]?.action).toBe("pose");
    expect(plan.skills[0]?.target).toBe(`${SKILLS_DIR}/add-crud/SKILL.md`);
  });

  it("ne réécrit PAS un pointeur identique — sinon chaque passage salit l'arbre git", () => {
    const s = skill();
    const plan = planSync([s], { "add-crud": renderPointer(s) });
    expect(plan.skills[0]?.action).toBe("inchange");
  });

  it("remplace un pointeur dont le contenu a changé", () => {
    const plan = planSync([skill()], { "add-crud": "ancien contenu" });
    expect(plan.skills[0]?.action).toBe("remplace");
  });

  it("NOMME les orphelins sans les supprimer", () => {
    const plan = planSync([skill()], {
      "add-crud": "x",
      "skill-maison": "écrit à la main par l'utilisateur",
    });
    expect(plan.orphelins).toEqual(["skill-maison"]);
    expect(plan.skills.map((s) => s.name)).not.toContain("skill-maison");
  });

  it("trie par nom — deux exécutions se comparent", () => {
    const plan = planSync(
      [skill({ name: "protect-route" }), skill({ name: "add-crud" })],
      {},
    );
    expect(plan.skills.map((s) => s.name)).toEqual([
      "add-crud",
      "protect-route",
    ]);
  });

  it("le pointeur DÉSIGNE la source, il ne la copie pas", () => {
    const s = skill();
    const out = renderPointer(s);
    expect(out).toContain(s.source);
    expect(out).toContain("pointeur");
    // Le frontmatter reste conforme : `name` identique au dossier.
    expect(out.startsWith(`---\nname: ${s.name}\n`)).toBe(true);
  });

  it("vise le dossier INTEROPÉRABLE, pas celui d'un client", () => {
    expect(SKILLS_DIR).toBe(".agents/skills");
  });
});

describe("ai:sync — la découverte sur disque", () => {
  let root = "";

  const poseSkill = (dir: string, name: string, frontmatter: string): void => {
    const d = path.join(dir, "skills", name);
    mkdirSync(d, { recursive: true });
    writeFileSync(
      path.join(d, "SKILL.md"),
      `---\n${frontmatter}\n---\n\ncorps\n`,
    );
  };

  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), "nf-aisync-"));
    writeFileSync(
      path.join(root, "nodefony.config.ts"),
      "export default {};\n",
    );
    writeFileSync(path.join(root, "package.json"), '{"name":"app"}\n');
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("découvre les skills de TOUT paquet @nodefony, pas seulement devkit", async () => {
    const { discoverSkills } = await import("../cli/aiSync");
    poseSkill(
      path.join(root, "node_modules", "@nodefony", "devkit"),
      "add-crud",
      "name: add-crud\ndescription: Crée une ressource. Et plus encore.",
    );
    poseSkill(
      path.join(root, "node_modules", "@nodefony", "autre"),
      "faire-un-truc",
      "name: faire-un-truc\ndescription: Fait un truc.",
    );
    const found = await Promise.resolve(discoverSkills(root));
    expect(found.map((s) => s.name).sort()).toEqual([
      "add-crud",
      "faire-un-truc",
    ]);
    expect(found.find((s) => s.name === "add-crud")?.summary).toBe(
      "Crée une ressource.",
    );
  });

  it("🔴 n'offre PAS de pointeur vers un paquet que ce dépôt PRODUIT", async () => {
    // Vécu : `ai:sync` lancé dans le dépôt du framework y a posé cinq
    // pointeurs vers `node_modules/@nodefony/devkit` — un lien vers un
    // workspace de l'arbre. Le pointeur dit « le contenu vit ailleurs, ne
    // l'édite pas ici » alors que la source est là, versionnée et éditable ; et
    // le doublon (quelques lignes de renvoi) entre en concurrence avec le vrai
    // skill dans tout ce qui indexe `.claude/skills/`.
    const { discoverSkills } = await import("../cli/aiSync");
    writeFileSync(
      path.join(root, "package.json"),
      '{"name":"le-framework","workspaces":["src/packages/@nodefony/*"]}\n',
    );
    const atelier = path.join(root, "src", "packages", "@nodefony", "devkit");
    mkdirSync(atelier, { recursive: true });
    writeFileSync(
      path.join(atelier, "package.json"),
      '{"name":"@nodefony/devkit"}\n',
    );
    // Le paquet est aussi présent sous node_modules — comme le fait npm pour un
    // espace de travail (un lien).
    poseSkill(
      path.join(root, "node_modules", "@nodefony", "devkit"),
      "browser",
      "name: browser\ndescription: Regarde l'écran.",
    );
    // Un paquet TIERS, lui, reste servi : la garde vise la propriété, pas le
    // scope.
    poseSkill(
      path.join(root, "node_modules", "@nodefony", "autre"),
      "faire-un-truc",
      "name: faire-un-truc\ndescription: Fait un truc.",
    );
    const found = discoverSkills(root);
    expect(found.map((s) => s.name)).toEqual(["faire-un-truc"]);
  });

  it("une APPLICATION liée au checkout garde ses pointeurs", async () => {
    // Le contre-exemple qui borne la garde : `create app --link` pointe aussi
    // vers un checkout, mais l'application CONSOMME le framework sans le
    // produire — ses espaces de travail ne le déclarent pas. Sans ce cas, la
    // garde priverait de pointeurs tout projet lié.
    const { discoverSkills } = await import("../cli/aiSync");
    writeFileSync(
      path.join(root, "package.json"),
      '{"name":"mon-app","workspaces":["modules/*"]}\n',
    );
    poseSkill(
      path.join(root, "node_modules", "@nodefony", "devkit"),
      "browser",
      "name: browser\ndescription: Regarde l'écran.",
    );
    expect(discoverSkills(root).map((s) => s.name)).toEqual(["browser"]);
  });

  it("découvre AUSSI les modules locaux de l'application", async () => {
    const { discoverSkills } = await import("../cli/aiSync");
    poseSkill(
      path.join(root, "modules", "blog"),
      "publier-un-article",
      "name: publier-un-article\ndescription: Publie.",
    );
    const found = discoverSkills(root);
    expect(found).toHaveLength(1);
    expect(found[0]?.packageName).toBe("blog");
  });

  it("ÉCARTE un skill dont le nom ne correspond pas à son dossier", async () => {
    const { discoverSkills } = await import("../cli/aiSync");
    poseSkill(
      path.join(root, "node_modules", "@nodefony", "devkit"),
      "add-crud",
      "name: autre-nom\ndescription: Non conforme.",
    );
    // La spécification l'exige, et les clients l'écarteraient : poser un
    // pointeur vers un skill que personne n'activera serait pire que rien.
    expect(discoverSkills(root)).toHaveLength(0);
  });

  it("lit une description en bloc replié (>) comme une description en ligne", async () => {
    const { readSkillHeader } = await import("../cli/aiSync");
    const replie = readSkillHeader(
      "---\nname: x\ndescription: >\n  Première phrase ici. Seconde phrase.\n---\n",
    );
    expect(replie?.summary).toBe("Première phrase ici.");
    const enLigne = readSkillHeader(
      "---\nname: x\ndescription: Première phrase ici. Seconde.\n---\n",
    );
    expect(enLigne?.summary).toBe("Première phrase ici.");
  });

  it("écrit les pointeurs, puis ne touche plus à rien au second passage", async () => {
    const { runAiSyncCommand } = await import("../cli/aiSync");
    poseSkill(
      path.join(root, "node_modules", "@nodefony", "devkit"),
      "add-crud",
      "name: add-crud\ndescription: Crée une ressource.",
    );
    const cible = path.join(root, ".agents", "skills", "add-crud", "SKILL.md");

    expect(
      runAiSyncCommand(["node", "nodefony", "ai:sync", "--cwd", root]),
    ).toBe(0);
    const premier = readFileSync(cible, "utf8");
    expect(premier).toContain("@nodefony/devkit");

    // IDEMPOTENCE au sens FORT : le second passage ne doit pas seulement rendre
    // le même contenu, il ne doit pas TOUCHER au fichier. Comparer le contenu
    // laisserait passer une réécriture à l'identique — invisible dans un diff,
    // mais qui change l'horodatage, réveille les observateurs de fichiers et
    // fait apparaître le fichier comme modifié pour les outils qui suivent le
    // mtime. La date de modification est la seule preuve du non-geste.
    const avant = statSync(cible).mtimeMs;
    expect(
      runAiSyncCommand(["node", "nodefony", "ai:sync", "--cwd", root]),
    ).toBe(0);
    expect(readFileSync(cible, "utf8")).toBe(premier);
    expect(statSync(cible).mtimeMs).toBe(avant);
  });

  it("--dry-run n'écrit RIEN", async () => {
    const { runAiSyncCommand } = await import("../cli/aiSync");
    poseSkill(
      path.join(root, "node_modules", "@nodefony", "devkit"),
      "add-crud",
      "name: add-crud\ndescription: Crée une ressource.",
    );
    runAiSyncCommand([
      "node",
      "nodefony",
      "ai:sync",
      "--dry-run",
      "--cwd",
      root,
    ]);
    expect(() =>
      readFileSync(
        path.join(root, ".agents", "skills", "add-crud", "SKILL.md"),
      ),
    ).toThrow();
  });

  it("🔴 pose AUSSI le miroir Claude Code — même contenu, même idempotence", async () => {
    // Mesuré (claude-code 2.1.238 headless) : cinq pointeurs dans
    // `.agents/skills/`, ZÉRO skill chargé ; les mêmes fichiers sous
    // `.claude/skills/`, tous chargés. Un skill que le client dominant ne voit
    // jamais n'existe pas — le miroir est la moitié Claude Code du geste.
    const { runAiSyncCommand } = await import("../cli/aiSync");
    poseSkill(
      path.join(root, "node_modules", "@nodefony", "devkit"),
      "add-crud",
      "name: add-crud\ndescription: Crée une ressource.",
    );
    const canonique = path.join(
      root,
      ".agents",
      "skills",
      "add-crud",
      "SKILL.md",
    );
    const miroir = path.join(root, ".claude", "skills", "add-crud", "SKILL.md");

    expect(
      runAiSyncCommand(["node", "nodefony", "ai:sync", "--cwd", root]),
    ).toBe(0);
    expect(readFileSync(miroir, "utf8")).toBe(readFileSync(canonique, "utf8"));

    const avant = statSync(miroir).mtimeMs;
    runAiSyncCommand(["node", "nodefony", "ai:sync", "--cwd", root]);
    expect(statSync(miroir).mtimeMs).toBe(avant);
  });

  it("🔴 un miroir ABSENT est reposé même quand le canonique est inchangé", async () => {
    // Le cas réel : projet synchronisé AVANT que le miroir n'existe. Juger le
    // miroir sur `action` (qui ne parle que du canonique) le laisserait
    // manquant pour toujours.
    const { runAiSyncCommand } = await import("../cli/aiSync");
    poseSkill(
      path.join(root, "node_modules", "@nodefony", "devkit"),
      "add-crud",
      "name: add-crud\ndescription: Crée une ressource.",
    );
    const miroir = path.join(root, ".claude", "skills", "add-crud", "SKILL.md");
    runAiSyncCommand(["node", "nodefony", "ai:sync", "--cwd", root]);
    rmSync(path.join(root, ".claude"), { recursive: true, force: true });

    runAiSyncCommand(["node", "nodefony", "ai:sync", "--cwd", root]);
    expect(readFileSync(miroir, "utf8")).toContain("@nodefony/devkit");
  });

  it("un skill MAISON dans .claude/skills n'est ni touché ni compté orphelin", async () => {
    // Cette racine appartient d'abord à l'utilisateur : la synchronisation n'y
    // écrit que ce qu'elle livre.
    const { runAiSyncCommand, syncSkillPointers } =
      await import("../cli/aiSync");
    poseSkill(
      path.join(root, "node_modules", "@nodefony", "devkit"),
      "add-crud",
      "name: add-crud\ndescription: Crée une ressource.",
    );
    const maison = path.join(
      root,
      ".claude",
      "skills",
      "mon-skill",
      "SKILL.md",
    );
    mkdirSync(path.dirname(maison), { recursive: true });
    writeFileSync(maison, "---\nname: mon-skill\n---\nà moi\n");
    const avant = statSync(maison).mtimeMs;

    runAiSyncCommand(["node", "nodefony", "ai:sync", "--cwd", root]);
    expect(readFileSync(maison, "utf8")).toContain("à moi");
    expect(statSync(maison).mtimeMs).toBe(avant);
    expect(syncSkillPointers(root, true).orphelins).toEqual([]);
  });

  it("hors projet, refuse au lieu de deviner", async () => {
    const { runAiSyncCommand } = await import("../cli/aiSync");
    const vide = mkdtempSync(path.join(tmpdir(), "nf-hors-projet-"));
    try {
      expect(
        runAiSyncCommand(["node", "nodefony", "ai:sync", "--cwd", vide]),
      ).not.toBe(0);
    } finally {
      rmSync(vide, { recursive: true, force: true });
    }
  });
});

describe("ai:sync — on ne remplace QUE ce qu'on a soi-même posé", () => {
  let root = "";

  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), "nf-aisync-garde-"));
    writeFileSync(
      path.join(root, "nodefony.config.ts"),
      "export default {};\n",
    );
    writeFileSync(path.join(root, "package.json"), '{"name":"app"}\n');
    const d = path.join(
      root,
      "node_modules",
      "@nodefony",
      "devkit",
      "skills",
      "browser",
    );
    mkdirSync(d, { recursive: true });
    writeFileSync(
      path.join(d, "SKILL.md"),
      "---\nname: browser\ndescription: Regarde l'écran.\n---\n\ncorps\n",
    );
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("🔴 un SKILL.md ÉCRIT À LA MAIN n'est jamais écrasé par un pointeur", async () => {
    // Vécu, et coûteux : 385 lignes de skill remplacées par un renvoi de neuf
    // lignes, sans un mot — le fichier n'appartenait pas à cette commande.
    const { syncSkillPointers } = await import("../cli/aiSync");
    const miroir = path.join(root, ".claude", "skills", "browser", "SKILL.md");
    mkdirSync(path.dirname(miroir), { recursive: true });
    const mien =
      "---\nname: browser\ndescription: Le MIEN.\n---\n\n" +
      "des centaines de lignes que j'ai écrites\n";
    writeFileSync(miroir, mien, "utf8");

    const plan = syncSkillPointers(root);

    expect(readFileSync(miroir, "utf8")).toBe(mien);
    // Et le refus se DIT : préservé en silence, l'utilisateur croirait le
    // skill synchronisé.
    expect(plan.preserves).toEqual([".claude/skills/browser/SKILL.md"]);
  });

  it("un pointeur DÉJÀ posé, lui, se met bien à jour", async () => {
    // Le contre-exemple qui borne la garde : sans lui, « ne rien écraser »
    // serait trivialement vert et la commande cesserait de servir.
    const { syncSkillPointers } = await import("../cli/aiSync");
    const miroir = path.join(root, ".claude", "skills", "browser", "SKILL.md");
    mkdirSync(path.dirname(miroir), { recursive: true });
    writeFileSync(
      miroir,
      '---\nname: browser\nmetadata:\n  nodefony-source-package: "@nodefony/devkit"\n---\n\nvieux renvoi\n',
      "utf8",
    );

    const plan = syncSkillPointers(root);

    expect(readFileSync(miroir, "utf8")).toContain("nodefony ai:sync");
    expect(plan.preserves).toEqual([]);
  });
});
