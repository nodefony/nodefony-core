import { describe, it, expect, vi } from "vitest";
import { Cli } from "nodefony";
import SecurityUserList from "../../nodefony/command/security-user-list";
import SecurityToken from "../../nodefony/command/security-token";

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
