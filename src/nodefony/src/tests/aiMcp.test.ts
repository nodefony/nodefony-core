import { describe, it, expect } from "vitest";
import {
  AGENT_TARGETS,
  planAgentDeclaration,
  pointeursInstructions,
  MCP_TOKEN_ENV,
} from "../cli/agentTargets";
import {
  buildMcpUrl,
  planMcpConfig,
  renderMcpPlan,
  serversOf,
  MCP_SERVER_KEY,
  type IMcpConfigDocument,
} from "../cli/aiMcpReport";
import {
  parseAiMcpArgv,
  planTokenChaining,
  tokenState,
  renderTokenState,
  renderDeclarations,
  targetsToDeclare,
  agentTokenStates,
  chainedTokenNote,
  declareToAgents,
} from "../cli/aiMcp";
import { litVariable, poseVariable } from "../cli/agentTargets";
import { writeAgentPointers } from "../cli/scaffold/engine";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  rmSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * Ce que cette suite garde : `ai:mcp` écrit dans un fichier que le projet
 * possède déjà et qui peut porter d'autres serveurs. Le comportement qui compte
 * n'est donc pas « sait-elle écrire », mais « que DÉTRUIT-elle en écrivant ».
 */

describe("ai:mcp — l'URL", () => {
  it("colle l'origine et le chemin sans doubler la barre", () => {
    expect(buildMcpUrl("http://localhost:5151", "/nodefony/mcp")).toBe(
      "http://localhost:5151/nodefony/mcp",
    );
    expect(buildMcpUrl("http://localhost:5151/", "/nodefony/mcp")).toBe(
      "http://localhost:5151/nodefony/mcp",
    );
  });
});

describe("ai:mcp — le plan d'écriture", () => {
  const url = "http://localhost:5151/nodefony/mcp";

  it("pose l'entrée quand aucun fichier n'existe", () => {
    const plan = planMcpConfig(null, url);
    expect(plan.action).toBe("pose");
    expect(serversOf(plan.document)[MCP_SERVER_KEY]).toEqual({
      type: "http",
      url,
    });
  });

  it("🔴 PRÉSERVE les autres serveurs MCP du projet", () => {
    // Le test qui justifie la fonction : une commande de câblage qui emporte
    // les serveurs déclarés par ailleurs est une commande qu'on n'ose plus
    // lancer.
    const existing = {
      mcpServers: {
        github: { type: "http", url: "https://api.github.com/mcp" },
      },
    } as unknown as IMcpConfigDocument;
    const plan = planMcpConfig(existing, url);
    expect(Object.keys(serversOf(plan.document)).sort()).toEqual([
      "github",
      "nodefony",
    ]);
  });

  it("🔴 PRÉSERVE les clés étrangères du document", () => {
    const existing = {
      $schema: "https://example/mcp.json",
      mcpServers: {},
    } as unknown as IMcpConfigDocument;
    expect(planMcpConfig(existing, url).document.$schema).toBe(
      "https://example/mcp.json",
    );
  });

  it("est idempotente au sens FORT — rien à réécrire", () => {
    const existing = {
      mcpServers: { [MCP_SERVER_KEY]: { type: "http", url } },
    } as unknown as IMcpConfigDocument;
    expect(planMcpConfig(existing, url).action).toBe("inchange");
  });

  it("annonce le REMPLACEMENT et l'ancienne URL", () => {
    const existing = {
      mcpServers: {
        [MCP_SERVER_KEY]: { type: "http", url: "http://localhost:9999/x" },
      },
    } as unknown as IMcpConfigDocument;
    const plan = planMcpConfig(existing, url);
    expect(plan.action).toBe("remplace");
    expect(plan.previousUrl).toBe("http://localhost:9999/x");
  });
});

describe("ai:mcp — ce que le rendu DOIT dire", () => {
  it("nomme les deux conditions sans lesquelles rien ne répondra", () => {
    // Sans ces deux lignes, on annoncerait un succès suivi d'un outil
    // introuvable : l'app doit tourner, et l'agent ne relit pas sa config.
    const texte = renderMcpPlan(
      planMcpConfig(null, "http://localhost:5151/nodefony/mcp"),
      "/app/.mcp.json",
      false,
    );
    expect(texte).toMatch(/TOURNER/u);
    expect(texte).toMatch(/redémarre ton agent/u);
  });

  it("dit clairement qu'une simulation n'écrit rien", () => {
    const texte = renderMcpPlan(
      planMcpConfig(null, "http://x/y"),
      "/app/.mcp.json",
      true,
    );
    expect(texte).toMatch(/rien n'est écrit/u);
  });
});

describe("ai:mcp — la ligne de commande", () => {
  it("lit les options qu'elle annonce", () => {
    const parsed = parseAiMcpArgv([
      "node",
      "nodefony",
      "ai:mcp",
      "--url",
      "https://localhost:5152",
      "--dry-run",
      "--json",
    ]);
    expect("error" in parsed).toBe(false);
    if (!("error" in parsed)) {
      expect(parsed.url).toBe("https://localhost:5152");
      expect(parsed.dryRun).toBe(true);
      expect(parsed.json).toBe(true);
    }
  });

  it("sens négatif : une option inconnue est REFUSÉE, jamais avalée", () => {
    const parsed = parseAiMcpArgv(["node", "nodefony", "ai:mcp", "--force"]);
    expect("error" in parsed).toBe(true);
  });

  it("lit --agent et --remove — et « -a » reste --auth, pas --agent", () => {
    const parsed = parseAiMcpArgv([
      "node",
      "nodefony",
      "ai:mcp",
      "--agent",
      "gemini,codex",
      "--remove",
      "-a",
    ]);
    expect("error" in parsed).toBe(false);
    if (!("error" in parsed)) {
      expect(parsed.agent).toBe("gemini,codex");
      expect(parsed.remove).toBe(true);
      // 🔴 Deux options qui se ressemblent sur une lettre finissent par se
      // confondre — et celle-ci écrit chez un tiers. `-a` reste `--auth`.
      expect(parsed.auth).toBe(true);
    }
  });
});

/**
 * 🔴 Ce que `--dry-run` MONTRE doit être ce qui serait JOUÉ.
 *
 * Vécu sur ce diff même : l'URL était recomposée à trois endroits, et le rendu
 * du dry-run avait gardé l'ORIGINE nue (`http://localhost:5151`) là où
 * l'exécution visait la ROUTE (`…/nodefony/mcp`). L'option dont le seul rôle
 * est de dire ce qui va se passer annonçait donc autre chose — et on la croit
 * sur parole, c'est précisément pour ça qu'on la lance.
 */
describe("ai:mcp — la porte visée est UNE", () => {
  it("l'URL déclarée à l'agent est la ROUTE, jamais l'origine nue", () => {
    const url = buildMcpUrl("http://localhost:5151", "/nodefony/mcp");
    expect(url).toBe("http://localhost:5151/nodefony/mcp");
    const gemini = AGENT_TARGETS.find((c) => c.key === "gemini");
    if (!gemini) throw new Error("gemini absent de la table");
    const plan = planAgentDeclaration(gemini, {
      url,
      tokenEnv: MCP_TOKEN_ENV,
    });
    if (plan.channel !== "cli") throw new Error("plan inattendu");
    expect(plan.argv).toContain(url);
    // Le contrôle qui mord : l'origine SEULE ne doit pas être ce qu'on déclare.
    expect(plan.argv).not.toContain("http://localhost:5151");
  });
});

/**
 * Le MODE AUTHENTIFIÉ de la porte MCP.
 *
 * Il existait dans le serveur — la porte sert les outils publics sans jeton et
 * retient les outils réservés — mais AUCUNE commande ne le câblait : la recette
 * (obtenir un jeton, le poser en en-tête) ne vivait que dans un test
 * d'intégration. Une capacité qu'on n'atteint pas n'existe pas.
 */
describe("ai:mcp — le mode AUTHENTIFIÉ", () => {
  it("--auth / --no-auth se disent ; sans eux, AUCUNE décision", () => {
    // `null` et non `false` : « je n'ai rien demandé » n'est pas « je veux
    // l'anonyme ». C'est cette distinction qui empêche un rafraîchissement de
    // désarmer une porte authentifiée.
    const nu = parseAiMcpArgv(["node", "nodefony", "ai:mcp"]);
    expect("error" in nu ? "erreur" : nu.auth).toBe(null);
    const avec = parseAiMcpArgv(["node", "nodefony", "ai:mcp", "--auth"]);
    expect("error" in avec ? "erreur" : avec.auth).toBe(true);
    const sans = parseAiMcpArgv(["node", "nodefony", "ai:mcp", "--no-auth"]);
    expect("error" in sans ? "erreur" : sans.auth).toBe(false);
  });

  it("🔴 l'en-tête référence une VARIABLE, le jeton n'est jamais écrit au disque", () => {
    // `.mcp.json` est un fichier de PROJET, suivi par git : y graver un jeton
    // porteur reviendrait à publier un secret à chaque commit. Les clients MCP
    // développent `${VAR}` dans cette configuration — c'est donc la variable
    // qui est écrite, et le jeton reste dans l'environnement du poste.
    const plan = planMcpConfig(null, "http://localhost:5151/nodefony/mcp", {
      auth: true,
    });
    const entree = serversOf(plan.document)[MCP_SERVER_KEY];
    expect(entree.headers?.Authorization).toBe("Bearer ${NF_MCP_TOKEN}");
    const texte = JSON.stringify(plan.document);
    expect(texte).not.toMatch(/eyJ|Bearer [A-Za-z0-9._-]{20,}/u);
  });

  it("🔴 sans option, le mode en place est CONSERVÉ — jamais désarmé au passage", () => {
    // Constaté deux fois en une heure : relancer `ai:mcp` pour rafraîchir une
    // URL retirait l'en-tête posé la veille, et la porte redevenait anonyme.
    // Une commande de DÉCLARATION ne désarme pas ce qu'elle trouve.
    const existing: IMcpConfigDocument = {
      mcpServers: {
        [MCP_SERVER_KEY]: {
          type: "http",
          url: "http://localhost:5151/nodefony/mcp",
          headers: { Authorization: "Bearer ${NF_MCP_TOKEN}" },
        },
      },
    };
    const plan = planMcpConfig(existing, "http://localhost:5151/nodefony/mcp");
    expect(
      serversOf(plan.document)[MCP_SERVER_KEY].headers?.Authorization,
    ).toBe("Bearer ${NF_MCP_TOKEN}");
    expect(plan.action).toBe("inchange");
  });

  it("le retrait se DEMANDE (--no-auth), et il est ANNONCÉ", () => {
    const existing: IMcpConfigDocument = {
      mcpServers: {
        [MCP_SERVER_KEY]: {
          type: "http",
          url: "http://localhost:5151/nodefony/mcp",
          headers: { Authorization: "Bearer ${NF_MCP_TOKEN}" },
        },
      },
    };
    const plan = planMcpConfig(existing, "http://localhost:5151/nodefony/mcp", {
      auth: false,
    });
    // Repasser en anonyme est un choix qui doit PRENDRE : laisser l'en-tête
    // ferait échouer la connexion avec un jeton expiré, sans dire pourquoi.
    expect(serversOf(plan.document)[MCP_SERVER_KEY].headers).toBeUndefined();
    expect(plan.action).toBe("remplace");
  });

  it("le rendu dit où PRENDRE un jeton — par la voie normée, pas une route devinée", () => {
    const texte = renderMcpPlan(
      planMcpConfig(null, "http://localhost:5151/nodefony/mcp", { auth: true }),
      "/tmp/.mcp.json",
      false,
    );
    // RFC 9728 : c'est la porte elle-même qui publie ses serveurs
    // d'autorisation. Nommer ici la route d'un module produirait une phrase qui
    // ment le jour où ce module la déplace.
    expect(texte).toContain("/.well-known/oauth-protected-resource");
    expect(texte).toContain("NF_MCP_TOKEN");
  });
});

/**
 * L'ENCHAÎNEMENT de commandes — `ai:mcp` appelle `security:token`.
 *
 * Le `spawn` lui-même est de la plomberie Node ; ce qui peut être FAUX, c'est
 * la décision : quand enchaîner, et avec quoi. Trois choses ne suivent pas
 * toutes seules d'un process à l'autre — l'environnement, le répertoire, le
 * terminal — et chacune a déjà produit un échec quand elle manquait.
 */
describe("ai:mcp — l'enchaînement vers security:token", () => {
  const contexte = { projectRoot: "/projets/mon-app", isTTY: true };

  it("enchaîne quand l'en-tête est posé et qu'un terminal répond", () => {
    const plan = planTokenChaining(
      { auth: true, dryRun: false, json: false },
      contexte,
    );
    expect(plan?.argv).toEqual(["security:token", "--write"]);
  });

  it("🔴 la DURÉE demandée voyage jusqu'à l'émetteur", () => {
    // Sens du test : le jeton part dans un en-tête STATIQUE que rien ne
    // rafraîchit. Sans cette option, l'émetteur applique son défaut (15 min) et
    // l'utilisateur recommence au quart d'heure — en lisant chaque fois un 401
    // qui accuse le jeton alors qu'il a simplement vécu.
    const plan = planTokenChaining(
      { auth: true, dryRun: false, json: false },
      { ...contexte, ttlMinutes: 10080 },
    );
    expect(plan?.argv).toEqual(["security:token", "--write", "--ttl", "10080"]);
  });

  it("sans durée demandée, l'émetteur garde son défaut", () => {
    const plan = planTokenChaining(
      { auth: true, dryRun: false, json: false },
      contexte,
    );
    expect(plan?.argv).to.not.contain("--ttl");
  });

  it("🔴 NODE_ENV=development est POSÉ — la porte MCP est servie par un module de dev", () => {
    // Sans lui, l'enfant repart en production, où ce module n'existe pas :
    // l'émission échoue sur « audience non servie » — l'erreur exacte qu'on
    // veut épargner à l'utilisateur.
    const plan = planTokenChaining(
      { auth: true, dryRun: false, json: false },
      { ...contexte, env: { PATH: "/usr/bin", NODE_ENV: "production" } },
    );
    expect(plan?.env.NODE_ENV).toBe("development");
    // Et le reste de l'environnement est HÉRITÉ : un sous-process ne reçoit que
    // ce qu'on lui donne. Sans le report, il partirait sans PATH.
    expect(plan?.env.PATH).toBe("/usr/bin");
  });

  it("🔴 le répertoire est celui du PROJET, pas celui de l'appelant", () => {
    // Le jeton s'écrit dans le `.env.local` du projet. Lancée depuis un
    // sous-dossier, la commande écrirait sinon à côté — et l'application ne
    // lirait jamais la valeur.
    const plan = planTokenChaining(
      { auth: true, dryRun: false, json: false },
      contexte,
    );
    expect(plan?.cwd).toBe("/projets/mon-app");
  });

  it("n'enchaîne PAS quand rien ne le justifie", () => {
    const cas: Array<
      [string, Parameters<typeof planTokenChaining>[0], boolean]
    > = [
      [
        "mode anonyme — aucun jeton à obtenir",
        { auth: false, dryRun: false, json: false },
        true,
      ],
      [
        "aucune décision d'autorisation",
        { auth: null, dryRun: false, json: false },
        true,
      ],
      [
        "--dry-run ne produit RIEN",
        { auth: true, dryRun: true, json: false },
        true,
      ],
      [
        "--json part vers un script, une question le romprait",
        { auth: true, dryRun: false, json: true },
        true,
      ],
      [
        "hors terminal : l'enfant ne pourrait rien demander",
        { auth: true, dryRun: false, json: false },
        false,
      ],
    ];
    for (const [pourquoi, demande, isTTY] of cas) {
      expect(planTokenChaining(demande, { ...contexte, isTTY }), pourquoi).toBe(
        null,
      );
    }
  });
});

describe("ai:mcp — l'état d'un jeton se CONSTATE, il ne se devine pas", () => {
  /** Fabrique un JWT non signé : seule la charge utile nous intéresse ici. */
  const jeton = (charge: Record<string, unknown>): string =>
    `x.${Buffer.from(JSON.stringify(charge)).toString("base64url")}.y`;

  it("🔴 dit qu'un jeton est EXPIRÉ — c'est lui qui provoque les 401", () => {
    // Le jeton part dans un en-tête STATIQUE que rien ne rafraîchit. Expiré, il
    // rend un 401 qui accuse la configuration, l'audience ou le serveur —
    // jamais l'échéance. Une ligne de constat remplace une enquête.
    const etat = tokenState(jeton({ exp: 1000, scope: "admin:read" }), 4600);
    expect(etat?.remainingSeconds).to.equal(-3600);
    expect(renderTokenState(etat)).to.contain("EXPIRÉ");
    expect(renderTokenState(etat)).to.contain("401");
  });

  it("dit ce que le jeton AUTORISE — le rôle se voit avant de s'étonner", () => {
    const etat = tokenState(
      jeton({ exp: 100_000, scope: "admin:read admin:write" }),
      1_000,
    );
    expect(etat?.scopes).to.deep.equal(["admin:read", "admin:write"]);
    expect(renderTokenState(etat)).to.contain("admin:read admin:write");
  });

  it("rend la durée restante en jours quand elle se compte en jours", () => {
    const etat = tokenState(jeton({ exp: 7 * 24 * 3600, scope: "" }), 0);
    expect(renderTokenState(etat)).to.contain("7 jours");
  });

  it("ne PRÉTEND rien d'un contenu illisible", () => {
    // Se taire vaut mieux qu'affirmer : un jeton qu'on ne sait pas décrire
    // n'est pas un jeton absent.
    expect(tokenState("pas-un-jwt", 0)).to.equal(null);
    expect(tokenState("x.!!!.y", 0)).to.equal(null);
    expect(renderTokenState(null)).to.contain("aucun jeton");
  });

  it("🔴 ne divulgue JAMAIS le jeton lui-même", () => {
    const secret = jeton({ exp: 100_000, scope: "admin:read" });
    const rendu = renderTokenState(tokenState(secret, 0));
    expect(rendu).to.not.contain(secret);
    expect(rendu).to.not.contain(secret.split(".")[1]);
  });
});

describe("ai:mcp — lire une variable posée chez un agent", () => {
  it("lit les deux grammaires, et rend null quand elle manque", () => {
    expect(
      litVariable("dotenv", "NF_MCP_TOKEN=abc\n", "NF_MCP_TOKEN"),
    ).to.equal("abc");
    // Les guillemets sont une convention d'écriture, pas une part de la valeur.
    expect(
      litVariable("dotenv", 'NF_MCP_TOKEN="abc"\n', "NF_MCP_TOKEN"),
    ).to.equal("abc");
    expect(
      litVariable("json-env", '{"env":{"NF_MCP_TOKEN":"abc"}}', "NF_MCP_TOKEN"),
    ).to.equal("abc");
    expect(litVariable("json-env", "{}", "NF_MCP_TOKEN")).to.equal(null);
    expect(litVariable("dotenv", "AUTRE=1", "NF_MCP_TOKEN")).to.equal(null);
    expect(litVariable("json-env", "pas du json", "NF_MCP_TOKEN")).to.equal(
      null,
    );
  });
});

describe("ai:mcp — le RÔLE du jeton se choisit", () => {
  it("les scopes demandés atteignent la commande d'émission", () => {
    const plan = planTokenChaining(
      { auth: true, dryRun: false, json: false },
      { projectRoot: "/x", isTTY: true, scopes: "admin:read admin:write" },
    );
    expect(plan?.argv).to.deep.equal([
      "security:token",
      "--write",
      "--scope",
      "admin:read admin:write",
    ]);
  });

  it("sans choix, l'émetteur applique son défaut — la lecture seule", () => {
    const plan = planTokenChaining(
      { auth: true, dryRun: false, json: false },
      { projectRoot: "/x", isTTY: true },
    );
    expect(plan?.argv).to.deep.equal(["security:token", "--write"]);
  });
});

describe("ai:mcp — ce que l'écran dit des agents et de leurs jetons (#303)", () => {
  const parFichier = AGENT_TARGETS.find(
    (c) => c.declaration === "fichier-projet",
  )!;
  const parCli = AGENT_TARGETS.find((c) => c.declaration === "cli" && c.home)!;
  const PORTE = "http://localhost:5151/nodefony/mcp";
  const AUTRE = "http://localhost:5252/nodefony/mcp";
  /** Un JWT non signé : seule la charge utile compte ici. */
  const jeton = (charge: Record<string, unknown>): string =>
    `x.${Buffer.from(JSON.stringify(charge)).toString("base64url")}.y`;

  it("🔴 --agent none avec un agent servi par le fichier : il est NOMMÉ, jamais « aucun agent »", () => {
    // `create app` traduit « Claude Code » en `--agent none` (aucune CLI à
    // lancer) ; l'écran disait alors « tu codes seul » à qui venait de le choisir.
    const cibles = targetsToDeclare([], [parFichier, parCli]);
    expect(cibles.map((c) => c.key)).to.deep.equal([parFichier.key]);
    const rendu = renderDeclarations(
      [{ target: parFichier, state: "fichier-projet", command: "" }],
      false,
    );
    expect(rendu).to.contain(parFichier.name);
    expect(rendu).to.contain("servi par");
    expect(rendu).to.not.contain("tu codes seul");
  });

  it("un agent demandé garde sa place ; celui du fichier s'ajoute, sans doublon", () => {
    expect(
      targetsToDeclare([parCli], [parFichier, parCli]).map((c) => c.key),
    ).to.deep.equal([parCli.key, parFichier.key]);
    expect(
      targetsToDeclare([parFichier], [parFichier, parCli]).map((c) => c.key),
    ).to.deep.equal([parFichier.key]);
    // Rien de détecté, rien demandé : vraiment personne.
    expect(targetsToDeclare([], [])).to.deep.equal([]);
  });

  it("🔴 un jeton d'une AUTRE audience n'est jamais annoncé valide", () => {
    const etranger = tokenState(
      jeton({ exp: 100_000, scope: "admin:read", aud: AUTRE }),
      0,
    );
    expect(etranger?.audience).to.deep.equal([AUTRE]);
    const rendu = renderTokenState(etranger, PORTE);
    expect(rendu).to.contain("autre");
    expect(rendu).to.contain("5252");
    expect(rendu).to.not.contain("valide encore");
    // La bonne audience : l'échéance parle.
    expect(
      renderTokenState(
        tokenState(jeton({ exp: 100_000, scope: "admin:read", aud: PORTE }), 0),
        PORTE,
      ),
    ).to.contain("valide encore");
    // `aud` en tableau (RFC 7519 l'autorise), et sans `aud` : aucun verdict d'audience.
    expect(
      tokenState(jeton({ exp: 1, aud: ["a", "b"] }), 0)?.audience,
    ).to.deep.equal(["a", "b"]);
    expect(tokenState(jeton({ exp: 1 }), 0)?.audience).to.equal(null);
    expect(
      renderTokenState(tokenState(jeton({ exp: 100_000 }), 0), PORTE),
    ).to.contain("valide encore");
  });

  it("🔴 l'état du jeton se lit LÀ où la déclaration écrit : le projet avant le foyer", () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "nf-mcp-proj-"));
    const home = mkdtempSync(path.join(os.tmpdir(), "nf-mcp-home-"));
    try {
      const now = 1_000_000;
      // Au foyer : le jeton d'une AUTRE application, encore valide — c'est
      // exactement ce que l'écran annonçait « valide encore 22 jours ».
      const auFoyer = path.join(home, parCli.marker, parCli.file);
      mkdirSync(path.dirname(auFoyer), { recursive: true });
      writeFileSync(
        auFoyer,
        poseVariable(
          parCli.forme,
          "",
          MCP_TOKEN_ENV,
          jeton({ exp: now + 22 * 86_400, aud: AUTRE }),
        ) as string,
      );
      const ctx = { home, env: {}, expectedAudience: PORTE };
      // Sans déclaration dans le projet : le foyer parle, et il dit « autre audience ».
      expect(
        agentTokenStates([parCli], root, now, ctx).get(parCli.key),
      ).to.contain("autre");
      // Déclaré dans le projet : c'est CE jeton qui compte.
      const auProjet = path.join(root, parCli.marker, parCli.file);
      mkdirSync(path.dirname(auProjet), { recursive: true });
      writeFileSync(
        auProjet,
        poseVariable(
          parCli.forme,
          "",
          MCP_TOKEN_ENV,
          jeton({ exp: now + 10 * 86_400, aud: PORTE }),
        ) as string,
      );
      const etat = agentTokenStates([parCli], root, now, ctx).get(parCli.key);
      expect(etat).to.contain("10 jours");
      expect(etat).to.not.contain("autre");
    } finally {
      rmSync(root, { recursive: true, force: true });
      rmSync(home, { recursive: true, force: true });
    }
  });

  it("--no-token : la porte se câble, le jeton n'est pas enchaîné", () => {
    const parsed = parseAiMcpArgv([
      "node",
      "nodefony",
      "ai:mcp",
      "--auth",
      "--no-token",
    ]);
    expect("error" in parsed).toBe(false);
    if ("error" in parsed) return;
    expect(parsed.token).toBe(false);
    expect(
      planTokenChaining(
        { auth: true, dryRun: false, json: false, token: false },
        { projectRoot: "/p", isTTY: true },
      ),
    ).to.equal(null);
    // Le défaut reste l'enchaînement.
    const defaut = parseAiMcpArgv(["node", "nodefony", "ai:mcp", "--auth"]);
    expect("error" in defaut ? undefined : defaut.token).toBe(true);
  });

  it("🔴 l'échec de security:token se DIT, il ne se lit pas dans une stack", () => {
    expect(chainedTokenNote(0)).to.equal(null);
    const note = chainedTokenNote(70);
    expect(note).to.contain("NON posé");
    expect(note).to.contain("70");
    expect(note).to.contain("security:token --write");
    expect(chainedTokenNote(null)).to.contain("NON posé");
  });
});

describe("agents qui lisent LEUR propre fichier de projet", () => {
  const url = "http://localhost:5151/nodefony/mcp";
  const copilot = AGENT_TARGETS.find((t) => t.key === "copilot");
  const cursor = AGENT_TARGETS.find((t) => t.key === "cursor");

  it("les deux cibles existent et portent leur grammaire", () => {
    expect(copilot?.declaration).toBe("fichier-agent");
    expect(cursor?.declaration).toBe("fichier-agent");
    // ⚠️ Les racines DIFFÈRENT, et c'est tout l'objet du canal : un document
    // recopié de l'un à l'autre est accepté sans broncher, puis ignoré.
    expect(copilot?.mcpFile?.root).toBe("servers");
    expect(cursor?.mcpFile?.root).toBe("mcpServers");
    expect(copilot?.mcpFile?.file).toBe(".vscode/mcp.json");
    expect(cursor?.mcpFile?.file).toBe(".cursor/mcp.json");
  });

  it("🔴 le plan NOMME leur fichier, jamais .mcp.json", () => {
    if (!copilot) throw new Error("cible copilot absente");
    const plan = planAgentDeclaration(copilot, {
      url,
      tokenEnv: MCP_TOKEN_ENV,
    });
    expect(plan.channel).toBe("fichier-agent");
    // Annoncer `.mcp.json` à qui ne l'ouvre jamais est le défaut que ce canal
    // ferme : VS Code lit `.vscode/mcp.json`, et lui seul.
    if (plan.channel !== "fichier-agent") return;
    expect(plan.file).toBe(".vscode/mcp.json");
  });

  it("écrit sous la racine de VS Code, avec SA syntaxe de variable", () => {
    if (!copilot?.mcpFile) throw new Error("grammaire copilot absente");
    const plan = planMcpConfig(null, url, {
      auth: true,
      grammar: copilot.mcpFile,
    });
    expect(serversOf(plan.document, "servers")[MCP_SERVER_KEY]).toEqual({
      type: "http",
      url,
      headers: { Authorization: "Bearer ${env:NF_MCP_TOKEN}" },
    });
    // `mcpServers` ne doit PAS apparaître : une clé qu'aucun outil ne lit
    // vieillit sans que personne la relise.
    expect(plan.document.mcpServers).toBeUndefined();
  });

  it("écrit sous la racine de Cursor, avec SA syntaxe de variable", () => {
    if (!cursor?.mcpFile) throw new Error("grammaire cursor absente");
    const plan = planMcpConfig(null, url, {
      auth: true,
      grammar: cursor.mcpFile,
    });
    // Même racine que `.mcp.json`, mais PAS la même forme de variable : `${VAR}`
    // y serait pris à la lettre.
    expect(
      serversOf(plan.document)[MCP_SERVER_KEY].headers?.Authorization,
    ).toBe("Bearer ${env:NF_MCP_TOKEN}");
  });

  it("🔴 .mcp.json garde sa forme historique — la grammaire par défaut ne bouge pas", () => {
    const plan = planMcpConfig(null, url, { auth: true });
    expect(
      serversOf(plan.document)[MCP_SERVER_KEY].headers?.Authorization,
    ).toBe("Bearer ${NF_MCP_TOKEN}");
  });

  it("préserve les serveurs que le projet avait déjà déclarés chez l'agent", () => {
    if (!copilot?.mcpFile) throw new Error("grammaire copilot absente");
    const existing = {
      servers: { github: { type: "http", url: "https://exemple/mcp" } },
      inputs: [{ id: "jeton", type: "promptString" }],
    } as unknown as IMcpConfigDocument;
    const plan = planMcpConfig(existing, url, { grammar: copilot.mcpFile });
    expect(Object.keys(serversOf(plan.document, "servers")).sort()).toEqual([
      "github",
      "nodefony",
    ]);
    // Tout le reste du document survit — `inputs` porte les secrets de VS Code.
    expect(plan.document.inputs).toBeDefined();
  });

  it("est idempotent au sens FORT : une porte déjà juste ne se réécrit pas", () => {
    if (!cursor?.mcpFile) throw new Error("grammaire cursor absente");
    const premier = planMcpConfig(null, url, { grammar: cursor.mcpFile });
    const second = planMcpConfig(premier.document, url, {
      grammar: cursor.mcpFile,
    });
    expect(second.action).toBe("inchange");
  });

  it("🔴 Copilot reçoit un POINTEUR d'instructions, Cursor non", () => {
    // La seule porte d'instructions de VS Code qui ne dépende d'AUCUN réglage.
    expect(copilot?.instructions.file).toBe(".github/copilot-instructions.md");
    expect(copilot?.instructions.natif).toBe(false);
    // Cursor lit AGENTS.md nativement : lui poser un fichier serait du vide qui
    // divergerait.
    expect(cursor?.instructions.natif).toBe(true);
    const fichiers = pointeursInstructions(["copilot", "cursor"]).map(
      (p) => p.file,
    );
    expect(fichiers).toContain(".github/copilot-instructions.md");
    expect(fichiers).not.toContain("AGENTS.md");
  });

  it("écrit vraiment le fichier, dans le projet", async () => {
    if (!copilot) throw new Error("cible copilot absente");
    const racine = mkdtempSync(path.join(os.tmpdir(), "nf-agentfile-"));
    try {
      const [verdict] = await declareToAgents([copilot], {
        url,
        remove: false,
        projectRoot: racine,
        auth: true,
      });
      expect(verdict.state).toBe("fichier-agent");
      expect(verdict.inProject).toBe(true);
      const ecrit = JSON.parse(
        readFileSync(path.join(racine, ".vscode", "mcp.json"), "utf8"),
      ) as IMcpConfigDocument;
      expect(serversOf(ecrit, "servers")[MCP_SERVER_KEY]?.url).toBe(url);
    } finally {
      rmSync(racine, { recursive: true, force: true });
    }
  });

  it("🔴 un agent DÉTECTÉ mais non demandé n'est jamais ÉCRIT", () => {
    if (!copilot || !cursor) throw new Error("cibles absentes");
    const claude = AGENT_TARGETS.find((t) => t.key === "claude");
    if (!claude) throw new Error("cible claude absente");
    // Un `.vscode/` dans un projet est le dossier le plus banal qui soit.
    // L'entrée de `targetsToDeclare` vaut ÉCRITURE : y faire entrer un agent
    // sur la seule foi de sa présence poserait un fichier chez un outil que
    // personne n'a nommé. Seul `fichier-projet` y entre — il n'écrit rien.
    const declared = targetsToDeclare([], [copilot, cursor, claude]);
    expect(declared.map((t) => t.key)).toEqual(["claude"]);
  });

  it("🔴 pose le pointeur Copilot, qui vit dans un SOUS-DOSSIER", () => {
    const racine = mkdtempSync(path.join(os.tmpdir(), "nf-pointeur-"));
    try {
      // Tous les pointeurs vivaient à la racine jusqu'à celui-ci. `flag: "wx"`
      // lève ENOENT quand le dossier parent manque — et ENOENT n'est pas
      // EEXIST, donc n'est pas rattrapé : la création de l'application entière
      // échouait pour un fichier d'appoint.
      const poses = writeAgentPointers(racine, ["copilot"], "demo");
      expect(poses).toEqual([".github/copilot-instructions.md"]);
      const contenu = readFileSync(
        path.join(racine, ".github", "copilot-instructions.md"),
        "utf8",
      );
      expect(contenu).toContain("AGENTS.md");
      // Un POINTEUR, pas une copie : ce qu'on recopierait divergerait.
      expect(contenu.length).toBeLessThan(1200);
    } finally {
      rmSync(racine, { recursive: true, force: true });
    }
  });

  it("retirer ce qui n'a jamais été posé rend « sans-effet », pas « retiré »", async () => {
    if (!cursor) throw new Error("cible cursor absente");
    const racine = mkdtempSync(path.join(os.tmpdir(), "nf-agentfile-"));
    try {
      const [verdict] = await declareToAgents([cursor], {
        url,
        remove: true,
        projectRoot: racine,
      });
      // Annoncer un retrait qui n'a rien retiré est le défaut mesuré chez un
      // agent piloté par CLI : on ne le reproduit pas ici.
      expect(verdict.state).toBe("sans-effet");
    } finally {
      rmSync(racine, { recursive: true, force: true });
    }
  });
});
