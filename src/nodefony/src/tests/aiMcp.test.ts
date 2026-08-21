import { describe, it, expect } from "vitest";
import {
  buildMcpUrl,
  planMcpConfig,
  renderMcpPlan,
  MCP_SERVER_KEY,
  type IMcpConfigDocument,
} from "../cli/aiMcpReport";
import { parseAiMcpArgv, planTokenChaining } from "../cli/aiMcp";

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
    expect(plan.document.mcpServers[MCP_SERVER_KEY]).toEqual({
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
    expect(Object.keys(plan.document.mcpServers).sort()).toEqual([
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
    const entree = plan.document.mcpServers[MCP_SERVER_KEY];
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
      plan.document.mcpServers[MCP_SERVER_KEY].headers?.Authorization,
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
    expect(plan.document.mcpServers[MCP_SERVER_KEY].headers).toBeUndefined();
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
