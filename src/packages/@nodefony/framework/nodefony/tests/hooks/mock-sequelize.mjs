/**
 * ESM loader hook — stubs @nodefony/sequelize and @nodefony/mongoose for unit tests.
 *
 * WHY: @nodefony/http's SessionsService imports these packages. Their config files
 * call Nodefony.getKernel().path at module load time — which throws when no kernel
 * is running (unit test context). These stubs prevent the crash.
 */

const STUBS = {
  "@nodefony/sequelize": `
export class SessionStorage {}
export class Connector {}
export class Entity {}
export default { SessionStorage, Connector, Entity };
`,
  "@nodefony/mongoose": `
export class SessionStorage {}
export class Connector {}
export default { SessionStorage, Connector };
`,
};

export async function load(url, context, nextLoad) {
  for (const [pkg, source] of Object.entries(STUBS)) {
    if (url.includes(pkg)) {
      return { format: "module", source, shortCircuit: true };
    }
  }
  return nextLoad(url, context);
}
