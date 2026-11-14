/**
 * Écritures de fichiers de `setup.sh` — en Node, comme tout l'outillage du dépôt.
 *
 *   node lib/bench-files.mjs controller <controller.md> <ChatController.ts>
 *   node lib/bench-files.mjs config <nodefony.config.ts> <app> <namespace>
 */
import { readFileSync, writeFileSync } from "node:fs";

const [command, ...args] = process.argv.slice(2);

/** Recopie le bloc `ts` de la référence : la source unique du controller du banc. */
function controller(doc, target) {
  const block = /```ts\n([\s\S]*?)```/.exec(readFileSync(doc, "utf8"));
  if (block?.[1] === undefined) {
    console.error("controller introuvable dans references/controller.md");
    process.exit(1);
  }
  writeFileSync(target, block[1]);
}

/** Pose redis PUIS realtime avant le module applicatif, une seule fois. */
function config(file, app, namespace) {
  const source = readFileSync(file, "utf8");
  if (source.includes("@nodefony/realtime")) {
    console.log(`    config de ${app} déjà en place`);
    return;
  }
  const anchor = `  use("@${app}/chat", {}),`;
  if (!source.includes(anchor)) {
    console.error(
      `ancre introuvable dans ${file} — le scaffold a-t-il changé ?`,
    );
    process.exit(1);
  }
  const block =
    "  // Banc multi-pods : bus partagé par toutes les applications du banc.\n" +
    '  use("@nodefony/redis", {}),\n' +
    '  use("@nodefony/realtime", {\n' +
    "    backplane: {\n" +
    '      driver: "redis",\n' +
    "      // Cloison FORCÉE identique partout : on retire la séparation par nom\n" +
    "      // d'application pour ne tester que l'authenticité des messages.\n" +
    `      namespace: "${namespace}",\n` +
    "    },\n" +
    "  }),\n";
  writeFileSync(file, source.replace(anchor, block + anchor));
  console.log(`    config de ${app} écrite`);
}

if (command === "controller" && args.length === 2) controller(args[0], args[1]);
else if (command === "config" && args.length === 3)
  config(args[0], args[1], args[2]);
else {
  console.error("usage : bench-files.mjs controller|config …");
  process.exit(2);
}
