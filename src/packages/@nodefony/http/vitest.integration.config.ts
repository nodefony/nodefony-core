import { defineConfig, configDefaults } from "vitest/config";
import { fileURLToPath } from "node:url";
import { gateReporter } from "../../../../vitest.gates";
import type { GateExpectation } from "../../../../vitest.gates";

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));

/**
 * Les cas qui ne peuvent s'écrire que contre un serveur de DÉVELOPPEMENT — ils
 * regardent une capacité d'observabilité que la production éteint pour ne rien
 * allouer (profil par frame, phases du pipeline, trace WS, 499 interne, stack
 * dans le corps d'erreur). Chacun porte un `skipIf(IS_PROD_TARGET)`.
 */
const DEV_ONLY_PROOFS: readonly string[] = [
  "error.stack is present in development",
  "radiographie PAR FRAME",
  "WS trace logging",
  "internal 499",
  "Context.phases",
  "phases post-action",
];

/**
 * Leurs CONTREPARTIES de production — ce que le mode livré doit tenir là où le
 * développement montre ses entrailles : rien ne fuit du corps d'erreur, et le
 * pont RPC répond quand même.
 */
const PROD_ONLY_PROOFS: readonly string[] = [
  "aucune entraille ne franchit la frontière",
  "le pont répond SANS radiographie",
];

/**
 * L'attente de la passe, décidée au MOMENT DU RAPPORT — le mode du serveur visé
 * n'est connu qu'après la sonde du `globalSetup`, donc bien après la lecture de
 * ce fichier.
 *
 * Pourquoi l'exiger : un `skipIf` est un silence, et un silence se retourne. Si
 * la sonde échoue, si un banc est renommé, si un `skipIf` part à l'envers, les
 * cas concernés cessent de tourner DANS LES DEUX MODES sans que rien ne tombe —
 * c'est très exactement la classe de défaut que le reste de cette configuration
 * existe pour rendre impossible. Chaque mode doit donc PROUVER les cas qui lui
 * sont propres.
 */
function modeExpectations(): GateExpectation[] {
  const prod =
    (process.env.NODEFONY_TEST_ENV ?? "development") === "production";
  return [
    {
      label: prod
        ? "cas propres à la PRODUCTION"
        : "cas propres au DÉVELOPPEMENT",
      proof: prod ? PROD_ONLY_PROOFS : DEV_ONLY_PROOFS,
    },
  ];
}

/**
 * Suite d'INTÉGRATION @nodefony/http (ex-`.mocharc.integration.json`).
 *
 * Tests serveur LIVE (127.0.0.1:5151/5152) : HTTP/HTTPS/HTTP2, routing, WS, décorateurs.
 * Prérequis : serveur dev UP (skill nodefony-start-server). Exclut la suite lourde
 * (`load/**` + `memory.test.ts`) → c'est la non-régression rapide.
 *
 * Séquentiel forcé (`fileParallelism:false` + `singleFork`) : tous les fichiers tapent
 * LE MÊME serveur — la parallélisation introduirait du bruit (sessions, ports, ordering).
 * Mocha tournait déjà en un seul process séquentiel : on préserve ce comportement.
 */
export default defineConfig({
  test: {
    globals: true,
    // Aucune cible d'INFRA n'est déclarée ici : cette suite parle à un serveur
    // local, pas à une base. Ce que le rapporteur exige, c'est que les cas
    // propres au MODE du serveur visé aient réellement tourné (cf
    // `modeExpectations`) — la contrepartie des `skipIf`/`runIf` semés dans la
    // suite. Il sert aussi l'autre usage, `NF_GATES_EXPECT`, par lequel une
    // PASSE (et non le paquet) exige qu'un cas précis ait tourné : c'est le
    // besoin d'une étape qui sélectionne par `-t`, où un motif qui ne mord plus
    // laisse vitest sortir 0 avec zéro cas exécuté.
    reporters: ["default", gateReporter(modeExpectations)],
    include: [
      "nodefony/tests/http/**/*.test.ts",
      "nodefony/tests/integration/**/*.test.ts",
      "nodefony/tests/routing/**/*.test.ts",
      "nodefony/tests/websockets/**/*.test.ts",
    ],
    exclude: [...configDefaults.exclude, "nodefony/tests/http/memory.test.ts"],
    setupFiles: [r("./nodefony/tests/vitest.setup.ts")],
    // Sonde le mode du serveur (route publique /livez) → NODEFONY_TEST_ENV, lu
    // par describe.skipIf(IS_PROD_TARGET) pour skipper les tests dev-only en prod.
    globalSetup: [r("./nodefony/tests/probeServerEnv.global.ts")],
    fileParallelism: false,
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
  resolve: {
    alias: {
      "@nodefony/mongoose": r("./nodefony/tests/stubs/mongoose.ts"),
    },
  },
});
