/**
 * Met en état le conteneur de service d'une cible d'infra — la porte de la forge.
 *
 * Sous GitHub Actions, les serveurs sont des `services:` que le compose ne crée
 * pas : ni script d'initialisation monté, ni nom `nodefony-<service>`. La forge
 * passe donc l'identifiant du conteneur, et ce script joue la MÊME mise en état
 * que `test:all` (`EnvGate.provision`, `scripts/test/vitest/gates.ts`).
 *
 * @usage tsx scripts/test/provision-gate.ts <service> [conteneur]
 */
import {
  MYSQL_COMMUNITY_GATE,
  TEST_ALL_GATES,
  type EnvGate,
} from "./vitest/gates.ts";
import { provisionGate } from "./lib/provision.ts";

const [service, container] = process.argv.slice(2);
const gates: readonly EnvGate[] = [...TEST_ALL_GATES, MYSQL_COMMUNITY_GATE];
const gate = gates.find((g) => g.service?.name === service);
if (!service || !gate) {
  const known = gates.flatMap((g) => (g.provision ? [g.service?.name] : []));
  console.error(
    `usage : tsx scripts/test/provision-gate.ts <service> [conteneur]\n` +
      `  services qui déclarent une mise en état : ${known.join(", ")}`,
  );
  process.exit(2);
}
if (!gate.provision) {
  console.error(`${gate.label} : aucune mise en état déclarée`);
  process.exit(2);
}
const res = provisionGate(gate, container);
if (!res.ok) {
  console.error(`${gate.label} : mise en état ÉCHOUÉE — ${res.error}`);
  process.exit(1);
}
console.log(`${gate.label} : ${res.what}`);
