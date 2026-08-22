import { describe, it, expect, vi } from "vitest";
import path from "node:path";
import {
  AGENT_TARGETS,
  agentsDemandes,
  agentsPresents,
  planAgentDeclaration,
  poseVariable,
  porteDejaLaCle,
  racineAgent,
  renderPlanShell,
  type IAgentTarget,
} from "../cli/agentTargets";
import { MCP_SERVER_KEY, MCP_TOKEN_ENV } from "../cli/aiMcpReport";
import { renderDeclarations } from "../cli/aiMcp";

/** La cible d'une clé, ou l'échec du test — plus lisible qu'un `!` partout. */
const cible = (cle: string): IAgentTarget => {
  const t = AGENT_TARGETS.find((c) => c.cle === cle);
  if (!t) throw new Error(`agent « ${cle} » absent de la table`);
  return t;
};

/**
 * Ce que cette suite prouve : qu'on pose une variable dans la configuration
 * d'un agent sans DÉTRUIRE ce qu'il y avait. Ces fichiers ne sont pas à nous —
 * ils portent les réglages de quelqu'un, et un écrasement se découvre le jour
 * où une permission a disparu.
 */
describe("agents — poser le jeton chez un agent, sans rien casser", () => {
  it("crée le bloc `env` d'un JSON qui n'en a pas, et garde le reste", () => {
    const avant = JSON.stringify({ permissions: { allow: ["Bash"] } });
    const apres = poseVariable("json-env", avant, "NF_MCP_TOKEN", "jeton-1");
    expect(apres).to.be.a("string");
    const doc = JSON.parse(apres as string) as {
      permissions?: { allow?: string[] };
      env?: Record<string, string>;
    };
    expect(doc.env?.NF_MCP_TOKEN).to.equal("jeton-1");
    // 🔴 Le reste du fichier SURVIT — c'est la configuration de quelqu'un.
    expect(doc.permissions?.allow).to.deep.equal(["Bash"]);
  });

  it("remplace une valeur existante — une rotation doit AVOIR lieu", () => {
    const avant = JSON.stringify({
      env: { NF_MCP_TOKEN: "vieux", AUTRE: "x" },
    });
    const doc = JSON.parse(
      poseVariable("json-env", avant, "NF_MCP_TOKEN", "neuf") as string,
    ) as { env: Record<string, string> };
    expect(doc.env.NF_MCP_TOKEN).to.equal("neuf");
    expect(doc.env.AUTRE).to.equal("x");
  });

  it("part d'un document vide quand le fichier n'existe pas", () => {
    const doc = JSON.parse(
      poseVariable("json-env", "", "NF_MCP_TOKEN", "jeton") as string,
    ) as { env: Record<string, string> };
    expect(doc.env.NF_MCP_TOKEN).to.equal("jeton");
  });

  it("🔴 refuse un JSON illisible plutôt que de l'écraser", () => {
    // Sens du test : réécrire un fichier corrompu par le nôtre effacerait des
    // réglages qu'on ne sait pas relire. On DIT, on ne remplace pas.
    const verdict = poseVariable("json-env", "{ pas du json", "K", "v");
    expect(verdict).to.be.instanceOf(Error);
  });

  it("dotenv : ajoute, puis remplace la ligne — jamais deux fois la même clé", () => {
    const un = poseVariable("dotenv", "AUTRE=1", "NF_MCP_TOKEN", "a") as string;
    expect(un).to.contain("AUTRE=1");
    expect(un).to.contain("NF_MCP_TOKEN=a");
    const deux = poseVariable("dotenv", un, "NF_MCP_TOKEN", "b") as string;
    expect(deux).to.contain("NF_MCP_TOKEN=b");
    expect(deux.match(/^NF_MCP_TOKEN=/gmu)).to.have.length(1);
  });
});

/**
 * Ce que cette suite prouve : qu'on ne se trompe pas d'agent en silence. Un nom
 * mal orthographié qui serait ignoré ferait croire à un agent servi qui ne l'est
 * pas — et le porteur chercherait la faute dans le jeton, comme la première fois.
 */
describe("agents --agent — choisir qui est servi", () => {
  it("sans option, ne décide rien : l'appelant proposera ce qu'il détecte", () => {
    expect(agentsDemandes(undefined)).to.equal(undefined);
  });

  it("« none » n'écrit nulle part, « all » vise tout le monde", () => {
    expect(agentsDemandes("none")).to.deep.equal([]);
    const tous = agentsDemandes("all");
    expect(Array.isArray(tous) && tous.length).to.be.greaterThan(1);
  });

  it("accepte une liste, séparée par virgules ou espaces, sans se soucier de la casse", () => {
    // Le retour est volontairement `readonly` : la table des agents est une
    // constante du module, pas un tableau que l'appelant pourrait remanier.
    const cles = (v: ReturnType<typeof agentsDemandes>): string[] =>
      Array.isArray(v) ? v.map((c) => c.cle) : [];
    expect(cles(agentsDemandes("Claude, CODEX"))).to.deep.equal([
      "claude",
      "codex",
    ]);
    expect(cles(agentsDemandes("vibe codex"))).to.deep.equal(["vibe", "codex"]);
  });

  it("🔴 REFUSE une clé inconnue en nommant celles qui existent", () => {
    const verdict = agentsDemandes("claude,cursor");
    expect(verdict).to.be.instanceOf(Error);
    // Le message doit servir à corriger, pas seulement à constater.
    expect((verdict as Error).message).to.contain("cursor");
    expect((verdict as Error).message).to.contain("claude");
  });
});

/**
 * Ce que cette suite prouve : que l'état de câblage se LIT là où il vit, au lieu
 * d'être mémorisé ailleurs. C'est ce qui rend la rotation muette — un agent qui
 * porte déjà la clé est mis à jour sans qu'on repose la question, et renouveler
 * un jeton cesse d'être un questionnaire.
 */
describe("agents — reconnaître un agent DÉJÀ câblé", () => {
  it("dotenv : voit la clé posée, ignore une clé voisine", () => {
    expect(porteDejaLaCle("dotenv", "NF_MCP_TOKEN=abc\n", "NF_MCP_TOKEN")).to.be
      .true;
    // « NF_MCP_TOKEN_OLD » ne doit pas passer pour la clé cherchée.
    expect(porteDejaLaCle("dotenv", "NF_MCP_TOKEN_OLD=abc\n", "NF_MCP_TOKEN"))
      .to.be.false;
    expect(porteDejaLaCle("dotenv", "AUTRE=1\n", "NF_MCP_TOKEN")).to.be.false;
  });

  it("json : voit la clé sous `env`, et pas ailleurs", () => {
    expect(
      porteDejaLaCle(
        "json-env",
        '{"env":{"NF_MCP_TOKEN":"abc"}}',
        "NF_MCP_TOKEN",
      ),
    ).to.be.true;
    // Une clé à la racine n'est pas une variable d'environnement.
    expect(porteDejaLaCle("json-env", '{"NF_MCP_TOKEN":"abc"}', "NF_MCP_TOKEN"))
      .to.be.false;
    expect(porteDejaLaCle("json-env", '{"env":{"AUTRE":"x"}}', "NF_MCP_TOKEN"))
      .to.be.false;
  });

  it("🔴 une valeur VIDE ne compte pas pour un câblage", () => {
    // Sens du test : la traiter comme câblée ferait passer la rotation en
    // silence sur un agent qui n'a jamais reçu de jeton — et le porteur
    // chercherait la faute ailleurs.
    expect(
      porteDejaLaCle("json-env", '{"env":{"NF_MCP_TOKEN":""}}', "NF_MCP_TOKEN"),
    ).to.be.false;
  });

  it("fichier absent ou illisible : jamais câblé", () => {
    expect(porteDejaLaCle("dotenv", "", "NF_MCP_TOKEN")).to.be.false;
    expect(porteDejaLaCle("json-env", "{ pas du json", "NF_MCP_TOKEN")).to.be
      .false;
  });
});

/**
 * Ce que cette suite prouve : que la porte se déclare CHEZ l'agent par la voie
 * qui est la sienne — et qu'on ne la déclare pas deux fois. Claude Code lit le
 * `.mcp.json` du projet ; lui repasser sa CLI poserait une seconde entrée, dans
 * une autre portée, que plus rien ne rafraîchirait ensuite.
 */
describe("ai:mcp --agent — déclarer la porte chez l'agent", () => {
  const ctx = {
    url: "http://localhost:5151/nodefony/mcp",
    tokenEnv: MCP_TOKEN_ENV,
  };

  it("Claude Code : rien à lancer, le fichier du projet PORTE déjà la déclaration", () => {
    const plan = planAgentDeclaration(cible("claude"), ctx);
    expect(plan.voie).to.equal("fichier-projet");
    // Rien à recopier : il n'y a pas de commande, et prétendre le contraire
    // enverrait créer un doublon.
    expect(renderPlanShell(plan)).to.equal("");
  });

  it("Gemini : sa CLI, en portée PROJET — il ignore .mcp.json (constaté)", () => {
    const plan = planAgentDeclaration(cible("gemini"), ctx);
    if (plan.voie !== "cli") throw new Error("Gemini doit passer par sa CLI");
    expect(plan.bin).to.equal("gemini");
    expect(plan.argv).to.contain(ctx.url);
    expect(plan.argv).to.contain("--scope");
    expect(plan.argv).to.contain("project");
  });

  it("🔴 AUCUN plan ne porte le jeton — seulement le NOM de sa variable", () => {
    // Sens du test : une valeur passée en argument est lisible par tout process
    // du poste (`ps`), et finirait dans l'historique du shell le jour où
    // quelqu'un recopie la commande de repli. Le contrat est donc : le secret
    // ne transite JAMAIS par la ligne de commande.
    const JETON = "eyJhbGciOi.FAUX-JETON-QUI-NE-DOIT-PAS-SORTIR.xxx";
    for (const agent of AGENT_TARGETS) {
      const plan = planAgentDeclaration(agent, ctx);
      const rendu = JSON.stringify(plan);
      expect(rendu, agent.cle).to.not.contain(JETON);
      if (plan.voie === "cli") {
        // La variable est nommée — sous sa forme littérale `${VAR}` (Gemini,
        // qui la résout à la lecture) ou par son nom nu (Vibe, Codex, qui
        // prennent le NOM). Dans les deux cas, jamais la valeur.
        expect(plan.argv.join(" "), agent.cle).to.contain(MCP_TOKEN_ENV);
      }
    }
  });

  it("🔴 la valeur de l'en-tête reste LITTÉRALE : ${VAR}, jamais développée", () => {
    // Sens du test : `spawn` n'ouvre pas de shell, donc rien ne développe la
    // variable — et c'est voulu. Développée ici, elle graverait le jeton dans
    // un fichier de PROJET, qu'un `git add -A` emporterait.
    const plan = planAgentDeclaration(cible("gemini"), ctx);
    if (plan.voie !== "cli") throw new Error("plan inattendu");
    const entete = plan.argv[plan.argv.indexOf("--header") + 1];
    expect(entete).to.equal(`Authorization: Bearer \${${MCP_TOKEN_ENV}}`);
  });

  it("le retrait vise le serveur par son NOM, pas par son URL", () => {
    // Une URL change (port, TLS) ; le nom sous lequel il est déclaré, non.
    // Retirer par l'URL laisserait une entrée morte après un changement de port.
    for (const agent of AGENT_TARGETS) {
      const plan = planAgentDeclaration(agent, ctx, true);
      if (plan.voie !== "cli") continue;
      expect(plan.argv, agent.cle).to.contain("remove");
      expect(plan.argv, agent.cle).to.contain(MCP_SERVER_KEY);
      expect(plan.argv.join(" "), agent.cle).to.not.contain(ctx.url);
    }
  });

  it("le repli s'affiche tel qu'on peut le recopier — quoté là où il faut", () => {
    // Sens du test : c'est la SORTIE quand la CLI manque. Une commande rendue
    // sans guillemets autour de « Authorization: Bearer ${…} » se casserait en
    // trois mots dans le terminal, et le porteur croirait à un bug de l'agent.
    const rendu = renderPlanShell(planAgentDeclaration(cible("gemini"), ctx));
    expect(rendu.startsWith("gemini mcp add")).to.be.true;
    expect(rendu).to.contain(`"Authorization: Bearer \${${MCP_TOKEN_ENV}}"`);
  });

  it("chaque agent de la table est COMPLET — une ligne à moitié écrite ne passe pas", () => {
    // Sens du test : ajouter un agent, c'est ajouter une ligne. Sans ce garde,
    // une ligne sans `bin` rendrait un plan « fichier-projet » silencieux, et
    // l'agent ne serait jamais déclaré sans que rien ne le dise.
    for (const agent of AGENT_TARGETS) {
      if (agent.declaration !== "cli") continue;
      expect(agent.bin, agent.cle).to.be.a("string");
      expect(agent.argvAjout, agent.cle).to.be.a("function");
      expect(agent.argvRetrait, agent.cle).to.be.a("function");
      expect(planAgentDeclaration(agent, ctx).voie, agent.cle).to.equal("cli");
    }
  });
});

/**
 * Ce que cette suite prouve : que l'endroit où vit la configuration d'un agent
 * se calcule sans rien lire de l'environnement RÉEL. C'est ce qui permet de
 * l'éprouver — y compris pour un poste qui n'est pas celui-ci.
 */
describe("agents — où vit la configuration d'un agent", () => {
  const projectRoot = path.join(path.sep, "projets", "app");
  const home = path.join(path.sep, "maison", "cci");

  it("portée projet : la racine du PROJET, jamais le dossier de l'utilisateur", () => {
    expect(
      racineAgent(cible("claude"), { projectRoot, home, env: {} }),
    ).to.equal(projectRoot);
  });

  it("portée utilisateur : le dossier maison + le marqueur de l'agent", () => {
    // Assertion COMPOSÉE, jamais littérale : sur Windows le séparateur diffère,
    // et une chaîne écrite à la main y échouerait pour la mauvaise raison.
    // ⚠️ `path.RESOLVE`, pas `join` : la fonction rend un chemin ABSOLU, et sous
    // Windows absolu veut dire porteur d'une lettre de lecteur
    // (`D:\maison\cci\.codex`). Un attendu composé au `join` depuis une racine
    // sans lecteur échoue là-bas — pour la mauvaise raison, puisque le code est
    // juste. L'assertion doit subir la MÊME normalisation que ce qu'elle juge.
    expect(
      racineAgent(cible("codex"), { projectRoot, home, env: {} }),
    ).to.equal(path.resolve(home, ".codex"));
  });

  it("🔴 la variable de l'agent l'emporte sur le dossier maison", () => {
    // Sens du test : `CODEX_HOME` déplace RÉELLEMENT sa configuration. L'ignorer
    // ferait poser le jeton dans un dossier que l'agent ne lit pas — et le
    // symptôme serait un 401, qui accuserait le jeton.
    const ailleurs = path.join(path.sep, "ailleurs", "codex");
    expect(
      racineAgent(cible("codex"), {
        projectRoot,
        home,
        env: { CODEX_HOME: ailleurs },
      }),
    ).to.equal(path.resolve(ailleurs));
  });
});

describe("agents — DÉTECTER un agent sans exiger qu'il soit déjà câblé", () => {
  const projectRoot = path.join(path.sep, "projets", "app");
  const home = path.join(path.sep, "maison", "cci");

  /** Prédicat d'existence sur une liste de chemins — aucun disque touché. */
  // ⚠️ Le code interroge le disque avec des chemins RÉSOLUS ; sous Windows
  // `path.resolve` y ajoute la lettre de lecteur. Le prédicat normalise donc
  // ses deux côtés, sinon la comparaison échoue sur la plateforme et non sur la
  // logique.
  const disque =
    (...presents: string[]) =>
    (chemin: string) =>
      presents.map((p) => path.resolve(p)).includes(path.resolve(chemin));

  it("🔴 un agent en portée PROJET est proposé sur la foi de son dossier UTILISATEUR", () => {
    // Le cercle que ce test ferme : Gemini écrit sa déclaration en portée
    // projet (`--scope project` CRÉE `.gemini/`). Exiger que `.gemini/` existe
    // déjà dans le projet pour le proposer revenait à ne proposer de
    // configurer que ce qui l'était déjà — un utilisateur de Gemini ne le
    // voyait jamais dans la liste et concluait qu'il n'était pas géré.
    const cles = agentsPresents({
      projectRoot,
      home,
      env: {},
      existe: disque(path.join(home, ".gemini")),
    }).map((c) => c.cle);
    expect(cles).to.include("gemini");
  });

  it("le dossier DANS le projet suffit aussi, seul", () => {
    const cles = agentsPresents({
      projectRoot,
      home,
      env: {},
      existe: disque(path.join(projectRoot, ".claude")),
    }).map((c) => c.cle);
    expect(cles).to.include("claude");
  });

  it("CONTRÔLE NÉGATIF — sans aucun marqueur, personne n'est proposé", () => {
    // Sans lui, « tout proposer » serait trivialement vert : la détection doit
    // encore distinguer un poste où l'agent sert d'un poste où il est absent.
    expect(
      agentsPresents({ projectRoot, home, env: {}, existe: () => false }),
    ).to.have.lengthOf(0);
  });
});

/**
 * Ce que cette suite prouve, et que rien d'autre ne prouvait : **où** la CLI de
 * l'agent est lancée, et ce qu'on conclut de ce qu'elle répond.
 *
 * Deux défauts constatés au DISQUE, tous deux muets côté code de sortie :
 *  - lancée depuis un sous-dossier, la CLI d'un agent en portée projet écrivait
 *    sa configuration LÀ — un second `.gemini/` que personne ne lira jamais ;
 *  - `gemini mcp remove` répond « not found », sort en **0**, et laisse
 *    l'entrée en place. Croire le code de sortie, c'était annoncer un retrait
 *    qui n'a pas eu lieu.
 */
describe("ai:mcp --agent — ce que l'exécution garantit", () => {
  it("🔴 la CLI de l'agent est lancée depuis la RACINE du projet", async () => {
    const appels: { bin: string; argv: string[]; cwd?: string }[] = [];
    vi.doMock("node:child_process", () => ({
      spawnSync: (bin: string, argv: string[], o: { cwd?: string }) => {
        appels.push({ bin, argv, cwd: o?.cwd });
        return { status: 0, stdout: "nodefony", stderr: "" };
      },
    }));
    vi.resetModules();
    const { declarerChezAgents } = await import("../cli/aiMcp");
    const racine = path.join(path.sep, "projets", "mon-app");
    await declarerChezAgents([cible("gemini")], {
      url: "http://localhost:5151/nodefony/mcp",
      retirer: false,
      projectRoot: racine,
    });
    expect(appels.length).toBeGreaterThan(0);
    for (const a of appels) expect(a.cwd).toBe(racine);
    vi.doUnmock("node:child_process");
    vi.resetModules();
  });

  it("🔴 un « ok » que le CONSTAT contredit n'est pas un succès", async () => {
    // La CLI sort en 0 et sa liste montre le serveur TOUJOURS là après un
    // retrait : le verdict doit être `sans-effet`, jamais `retire`.
    vi.doMock("node:child_process", () => ({
      spawnSync: () => ({
        status: 0,
        stdout: "Configured MCP servers:\n○ nodefony: http://... - Disabled",
        stderr: "",
      }),
    }));
    vi.resetModules();
    const { declarerChezAgents } = await import("../cli/aiMcp");
    const [r] = await declarerChezAgents([cible("gemini")], {
      url: "http://localhost:5151/nodefony/mcp",
      retirer: true,
      projectRoot: path.join(path.sep, "projets", "mon-app"),
    });
    expect(r?.etat).toBe("sans-effet");
    vi.doUnmock("node:child_process");
    vi.resetModules();
  });

  it("une CLI absente rend la commande à recopier, jamais un échec muet", async () => {
    vi.doMock("node:child_process", () => ({
      spawnSync: () => ({
        error: Object.assign(new Error("spawn ENOENT"), { code: "ENOENT" }),
        status: null,
      }),
    }));
    vi.resetModules();
    const { declarerChezAgents } = await import("../cli/aiMcp");
    const [r] = await declarerChezAgents([cible("codex")], {
      url: "http://localhost:5151/nodefony/mcp",
      retirer: false,
      projectRoot: path.join(path.sep, "projets", "mon-app"),
    });
    expect(r?.etat).toBe("cli-absente");
    expect(r?.commande).toContain("codex mcp add");
    vi.doUnmock("node:child_process");
    vi.resetModules();
  });

  it("🔴 aucun agent : la commande le DIT — coder seul est un choix", () => {
    // Sens du test : le silence serait ambigu (« rien fait » ou « ça a raté ? »).
    const rendu = renderDeclarations([], false);
    expect(rendu).toContain("tu codes seul");
    expect(rendu).toContain("--agent all");
  });
});
