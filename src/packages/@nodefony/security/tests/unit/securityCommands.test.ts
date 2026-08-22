import { describe, it, expect, vi } from "vitest";
import { Cli } from "nodefony";
import SecurityUserList from "../../nodefony/command/security-user-list";
import SecurityToken, {
  ttlSeconds,
  poseVariable,
  agentsDemandes,
} from "../../nodefony/command/security-token";

/**
 * Ce que cette suite garde, et que rien d'autre ne garde : ces deux commandes
 * manipulent des SECRETS. L'une lit des comptes dont le repository voit le
 * hachage du mot de passe ; l'autre émet un jeton porteur. Une régression y est
 * silencieuse — la commande continue de « marcher », elle publie juste quelque
 * chose qu'elle ne devrait pas, ou rend un jeton que personne n'acceptera.
 */

/** Un utilisateur du repository — credential COMPRIS, comme en vrai. */
const utilisateurAvecCredential = {
  id: "11111111-2222-3333-4444-555555555555",
  identifier: "cci",
  roles: ["ROLE_USER"],
  // 🔴 Le repository est la frontière du credential : il VOIT le hachage.
  // C'est exactement ce qui ne doit jamais ressortir.
  password: "$argon2id$v=19$m=65536,t=3,p=4$SEL$HACHAGE-SECRET-A-NE-PAS-FUIR",
  metadata: { note: "interne" },
  socialProviders: [{ provider: "github", accessToken: "gho_JETON_SECRET" }],
  isActive: () => true,
  isLocked: () => false,
};

/** Capture tout ce qui part sur la sortie standard pendant l'appel. */
async function sortieDe(fn: () => Promise<unknown>): Promise<string> {
  let capture = "";
  const espion = vi
    .spyOn(process.stdout, "write")
    .mockImplementation((chunk: unknown) => {
      capture += String(chunk);
      return true;
    });
  const logConsole = vi.spyOn(console, "table").mockImplementation((d) => {
    capture += JSON.stringify(d);
  });
  try {
    await fn();
  } finally {
    espion.mockRestore();
    logConsole.mockRestore();
  }
  return capture;
}

function commandeAvecKernel<T>(
  Ctor: new (cli: never) => T,
  container: Record<string, unknown>,
  modules: Record<string, unknown> = {},
): T {
  const cli = new Cli("TEST") as never;
  const cmd = new Ctor(cli);
  (cmd as { kernel?: unknown }).kernel = {
    path: process.cwd(),
    environment: "development",
    modules,
    container: { get: (k: string) => container[k] },
  };
  return cmd;
}

describe("security:user:list — lister ne doit RIEN publier de secret", () => {
  it("🔴 le hachage du mot de passe ne sort JAMAIS", async () => {
    const cmd = commandeAvecKernel(SecurityUserList, {
      users: {
        listPage: async () => ({
          items: [utilisateurAvecCredential],
          hasNext: false,
        }),
      },
    });
    const sortie = await sortieDe(() => cmd.generate({}));

    // Ce qu'on veut voir.
    expect(sortie).toContain("cci");
    expect(sortie).toContain("ROLE_USER");

    // Ce qu'on ne veut JAMAIS voir. Un `console.table(user)` — le réflexe —
    // publierait les trois d'un coup.
    expect(sortie).not.toContain("HACHAGE-SECRET-A-NE-PAS-FUIR");
    expect(sortie).not.toContain("argon2");
    expect(sortie).not.toContain("gho_JETON_SECRET");
    expect(sortie).not.toContain("interne");
  });

  it("même en --json, la projection tient", async () => {
    // Le format machine est celui qu'on redirige vers un fichier ou un journal
    // de CI : c'est le PIRE endroit où laisser fuir un credential.
    const cmd = commandeAvecKernel(SecurityUserList, {
      users: {
        listPage: async () => ({
          items: [utilisateurAvecCredential],
          hasNext: false,
        }),
      },
    });
    const sortie = await sortieDe(() => cmd.generate({ json: true }));
    expect(JSON.parse(sortie).items[0].identifiant).toBe("cci");
    expect(sortie).not.toContain("HACHAGE-SECRET-A-NE-PAS-FUIR");
  });

  it("lit l'état par les MÉTHODES du contrat, pas par des colonnes devinées", async () => {
    // `u.enabled` compilait ailleurs et rendait `undefined` ici : un compte
    // désactivé se serait affiché « actif ». Le compilateur l'a attrapé une
    // fois ; ce test le garde.
    const desactive = {
      ...utilisateurAvecCredential,
      isActive: () => false,
      isLocked: () => true,
    };
    const cmd = commandeAvecKernel(SecurityUserList, {
      users: { listPage: async () => ({ items: [desactive], hasNext: false }) },
    });
    const sortie = await sortieDe(() => cmd.generate({ json: true }));
    const ligne = JSON.parse(sortie).items[0];
    expect(ligne.actif).toBe("non");
    expect(ligne.verrouillé).toBe("OUI");
  });
});

describe("security:token — un jeton mort-né doit s'ANNONCER", () => {
  const emetteur = {
    issueTokens: async () => ({
      access_token: "eyJ.FAUX.JETON",
      expires_in: 900,
    }),
  };
  const annuaire = {
    findByIdentifier: async () => utilisateurAvecCredential,
  };

  it("🔴 sans clé persistante, la commande PRÉVIENT que le jeton sera refusé", async () => {
    // Mesuré en réel : trois `kid` distincts pour la même application — un par
    // process, un de plus après redémarrage. Le jeton est valide et vérifiable
    // par personne. Sans cet avertissement, on le copie et on cherche l'erreur
    // ailleurs pendant une heure.
    const cmd = commandeAvecKernel(
      SecurityToken,
      { tokenService: emetteur, users: annuaire },
      { security: { options: { jwt: {} } } },
    );
    const sortie = await sortieDe(() => cmd.generate(undefined, {}));
    expect(sortie).toContain("ÉPHÉMÈRE");
    // L'avertissement arrive AVANT le jeton : on ne laisse pas copier une
    // valeur dont on sait déjà qu'elle sera rejetée.
    expect(sortie.indexOf("ÉPHÉMÈRE")).toBeLessThan(
      sortie.indexOf("eyJ.FAUX.JETON"),
    );
  });

  it("avec une source de clés déclarée, aucun avertissement", async () => {
    for (const keystore of [{ dir: "var/keys" }, { keySetJson: "{}" }]) {
      const cmd = commandeAvecKernel(
        SecurityToken,
        { tokenService: emetteur, users: annuaire },
        { security: { options: { jwt: { keystore } } } },
      );
      const sortie = await sortieDe(() => cmd.generate(undefined, {}));
      expect(sortie).not.toContain("ÉPHÉMÈRE");
      expect(sortie).toContain("eyJ.FAUX.JETON");
    }
  });
});

describe("security:secrets — on doit savoir QUOI et POURQUOI", () => {
  it("🔴 chaque secret généré est NOMMÉ et EXPLIQUÉ, même quand tout est en place", async () => {
    // Vécu : les trois clés câblées, la commande affichait trois « ✓ déjà
    // câblées » et rien d'autre. On ne savait ni ce qui avait été généré, ni à
    // quoi ça servait. Un secret qu'on ne comprend pas est un secret qu'on ne
    // fait jamais tourner — et qu'on recopie d'un environnement à l'autre.
    const source = await import("node:fs").then((fs) =>
      fs.readFileSync(
        new URL("../../nodefony/command/security-secrets.ts", import.meta.url),
        "utf8",
      ),
    );

    // Les trois clés générées + le keyset : chacune porte un rôle et une
    // conséquence. Le catalogue est la SOURCE de l'affichage — si une clé
    // s'ajoutait sans y entrer, elle resterait muette à l'écran.
    for (const clef of [
      "NF_TOTP_KEY",
      "NF_WEBHOOK_KEY",
      "NF_CSRF_SECRET",
      "jwt.keystore",
    ]) {
      const bloc = new RegExp(
        `"?${clef.replace(".", "\\.")}"?:\\s*\\{[^}]*protege:[^}]*sans:`,
        "u",
      );
      expect(bloc.test(source), `${clef} sans rôle ni conséquence`).toBe(true);
    }

    // Et l'affichage lit bien ce catalogue, plutôt qu'une liste recopiée.
    expect(source).toContain("Object.entries(ROLES)");
  });
});

/**
 * Ce que cette suite prouve : qu'une durée demandée en ligne de commande est
 * VÉRIFIÉE. Le défaut de configuration (15 min) convient à un jeton d'API qu'un
 * client rafraîchit ; il est impraticable pour l'en-tête statique d'un agent,
 * que rien ne renouvelle. Ouvrir cette porte sans borne ferait des jetons
 * éternels posés dans des fichiers — la borne EST la fonctionnalité.
 */
describe("security:token --ttl — une durée qui s'écrit, et qui se borne", () => {
  it("sans option, ne décide rien : la configuration garde la main", () => {
    expect(ttlSeconds(undefined)).toBe(undefined);
  });

  it("traduit des MINUTES en secondes", () => {
    expect(ttlSeconds("30")).toBe(1800);
    expect(ttlSeconds("43200")).toBe(30 * 24 * 3600);
  });

  it("🔴 refuse au-delà de 30 jours — un jeton dans un fichier est une clé", () => {
    const verdict = ttlSeconds("43201");
    expect(verdict).toBeInstanceOf(Error);
    expect((verdict as Error).message).toMatch(/borné/u);
  });

  it("refuse ce qui n'est pas une durée, plutôt que de deviner", () => {
    // `Number.parseInt("abc")` rend NaN ; sans garde, `NaN * 60` partirait
    // jusqu'à la signature et produirait un jeton dont l'expiration est
    // invalide — accepté ici, refusé partout ailleurs, sans explication.
    for (const nawak of ["abc", "0", "-5", ""]) {
      expect(ttlSeconds(nawak), nawak).toBeInstanceOf(Error);
    }
  });
});

/**
 * Ce que cette suite prouve : qu'on pose une variable dans la configuration
 * d'un agent sans DÉTRUIRE ce qu'il y avait. Ces fichiers ne sont pas à nous —
 * ils portent les réglages de quelqu'un, et un écrasement se découvre le jour
 * où une permission a disparu.
 */
describe("security:token — poser le jeton chez un agent, sans rien casser", () => {
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
describe("security:token --agent — choisir qui est servi", () => {
  it("sans option, ne décide rien : l'appelant proposera ce qu'il détecte", () => {
    expect(agentsDemandes(undefined)).to.equal(undefined);
  });

  it("« none » n'écrit nulle part, « all » vise tout le monde", () => {
    expect(agentsDemandes("none")).to.deep.equal([]);
    expect((agentsDemandes("all") as unknown[]).length).to.be.greaterThan(1);
  });

  it("accepte une liste, séparée par virgules ou espaces, sans se soucier de la casse", () => {
    const cles = (agentsDemandes("Claude, CODEX") as { cle: string }[]).map(
      (c) => c.cle,
    );
    expect(cles).to.deep.equal(["claude", "codex"]);
    expect(
      (agentsDemandes("vibe codex") as { cle: string }[]).map((c) => c.cle),
    ).to.deep.equal(["vibe", "codex"]);
  });

  it("🔴 REFUSE une clé inconnue en nommant celles qui existent", () => {
    const verdict = agentsDemandes("claude,cursor");
    expect(verdict).to.be.instanceOf(Error);
    // Le message doit servir à corriger, pas seulement à constater.
    expect((verdict as Error).message).to.contain("cursor");
    expect((verdict as Error).message).to.contain("claude");
  });
});
