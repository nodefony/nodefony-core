// ─────────────────────────────────────────────────────────────────────────────
// Garde de DÉCOR d'un banc de débit Nodefony — préchargée (`node --import`)
// dans le serveur mesuré. À la PREMIÈRE requête, elle refuse (code 3) si un
// hook du chemin de requête a un écouteur : un seul suffit à faire passer
// chaque requête par `fireAsync` (une Promise, une microtâche), coût qu'une
// application sans ce hook ne paie pas — et que le banc imputerait au
// framework. Vécu deux fois sur #508, les deux fois posé par le module test
// (`onRequestScope`, puis `beforeResolve`) ; la seconde n'a été vue qu'au
// chronométrage in situ, parce que rien ne la cherchait.
//
// Contrôle à la première requête, pas au boot : les modules posent leurs
// écouteurs pendant le démarrage, et à cet instant tout est en place.
// ─────────────────────────────────────────────────────────────────────────────
import diagnostics from "node:diagnostics_channel";

/** Hooks tirés sur CHAQUE requête HTTP, par émetteur. */
const HOT = {
  kernel: ["onRequestScope"],
  httpKernel: ["onServerRequest", "onCreateContext", "beforeResolve"],
};

const channel = diagnostics.channel("http.server.request.start");
const check = async () => {
  // Chargé ICI (déjà en mémoire à la première requête) : la garde ne change
  // pas l'ordre de chargement du serveur mesuré.
  const { Nodefony } = await import("nodefony");
  const kernel = Nodefony.getKernel();
  const emitters = { kernel, httpKernel: kernel?.get?.("HttpKernel") };
  const found = [];
  for (const [name, hooks] of Object.entries(HOT)) {
    for (const hook of hooks) {
      const n = emitters[name]?.listenerCount(hook) ?? 0;
      if (n > 0) found.push(`${name}.${hook} (${n})`);
    }
  }
  if (found.length > 0) {
    process.stderr.write(
      `decor-probe: REFUS — hook du chemin de requête écouté : ${found.join(", ")}. ` +
        "Qui le pose sous NF_BENCH_ROUTE ? (module test : le couper sous ce drapeau)\n",
    );
    process.exit(3);
  }
  process.stderr.write("decor-probe: ok\n");
};
// Abonné SYNCHRONE : un canal de diagnostic n'attend pas une promesse.
const onFirstRequest = () => {
  channel.unsubscribe(onFirstRequest);
  check().catch((/** @type {unknown} */ e) => {
    process.stderr.write(
      `decor-probe: REFUS — garde en échec : ${String(e)}\n`,
    );
    process.exit(3);
  });
};
channel.subscribe(onFirstRequest);
