<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  // La liaison Svelte de `nodefony/svelte` — le pendant exact des hooks React,
  // des composables Vue et des fonctions d'injection Angular. Aucune rune n'est
  // publiée par le framework : les valeurs se lisent `.current`, et le système
  // d'effets rend l'abonnement quand plus personne ne les lit. Aucune règle de
  // temps réel n'est écrite ici — elles vivent dans le socle `nodefony/client`.
  import {
    nodefony,
    nodefonyChannel,
    nodefonySnapshot,
    nodefonySse,
    nodefonyState,
  } from "nodefony/svelte";
  import {
    describeSocket,
    installErrorCapture,
    installRequestIdProvider,
    installSyslogUplink,
    Syslog,
    withRequestId,
    type SocketSnapshot,
  } from "nodefony/client";
  // Mise en page COMMUNE aux quatre vitrines — même fichier, même charte que la
  // page d'accueil du framework. Seule `--accent` change d'une vitrine à l'autre.
  import "./showcase.css";

  interface ApiData {
    ts: number;
    pid: number;
    env: string;
  }

  /** Un message du salon partagé : qui l'a écrit, depuis quelle vitrine. */
  interface Message {
    text: string;
    front: string;
    ts: number;
    pid: number;
  }

  /** Une ligne du journal du serveur, telle que le flux SSE la pousse. */
  interface LogLine {
    id: number;
    time: number;
    severity: string;
    msgid: string;
    text: string;
    requestId?: string | undefined;
    dropped?: number | undefined;
  }

  /**
   * Le flux SSE du journal du serveur — sous `/nodefony/<ns>/api/`, donc dans la
   * zone d'administration : une session de la console est exigée.
   */
  const JOURNAL = "/nodefony/test/api/syslog";

  /** Lit une ligne poussée par le serveur ; tout ce qui n'en a pas la forme est ignoré. */
  function lineOf(data: string): LogLine | null {
    let raw: unknown;
    try {
      raw = JSON.parse(data);
    } catch {
      return null;
    }
    if (typeof raw !== "object" || raw === null) return null;
    const r: Record<string, unknown> = { ...raw };
    if (typeof r.id !== "number" || typeof r.text !== "string") return null;
    return {
      id: r.id,
      time: typeof r.time === "number" ? r.time : Date.now(),
      severity: typeof r.severity === "string" ? r.severity : "INFO",
      msgid: typeof r.msgid === "string" ? r.msgid : "",
      text: r.text,
      requestId: typeof r.requestId === "string" ? r.requestId : undefined,
      dropped: typeof r.dropped === "number" ? r.dropped : undefined,
    };
  }

  /** L'état d'un flux, dit pour un humain — `readyState` et `error` du socle. */
  function fluxLabel(listening: boolean, readyState: number, error: boolean) {
    if (!listening) return { text: "écoute arrêtée", dot: "dot" };
    if (readyState === 1) return { text: "à l'écoute", dot: "dot dot--on" };
    if (readyState === 0)
      return {
        text: error ? "reconnexion automatique…" : "connexion…",
        dot: "dot dot--wait",
      };
    return { text: error ? "refusé par le serveur" : "fermé", dot: "dot" };
  }

  /** La couleur du framework de vue — le SEUL écart de style entre les quatre. */
  const ACCENT = "#ff3e00";

  /** Le nom de CETTE vitrine — il marque les messages qu'elle envoie au salon. */
  const FRONT = "Svelte";

  /**
   * Combien de rechargements À CHAUD depuis le dernier chargement complet.
   *
   * `import.meta.hot.data` est la mémoire que Vite fait survivre au remplacement
   * d'un module — et à lui seul. Le module étant ré-exécuté à chaque mise à jour,
   * il suffit de compter ses exécutions : un chargement complet repart de zéro,
   * une mise à jour à chaud incrémente. Aucun écouteur à poser, donc aucun à
   * retirer.
   *
   * Sans ce chiffre, la carte échouait EN SILENCE : si Vite tombait en
   * rechargement complet, le compteur de clics repartait à zéro et personne ne
   * pouvait dire si la démonstration avait marché ou raté.
   */
  /**
   * La barre de debug s'auto-injecte en développement et expose ce handle — c'est
   * la même poignée que la console d'administration emploie. On ne la remonte pas,
   * on la pilote : `DebugBarHandle` (cf `nodefony/debugbar`).
   */
  type Debugbar = { isVisible(): boolean; toggle(): void } | undefined;
  const debugbar = (): Debugbar =>
    (globalThis as { __NODEFONY_DEBUGBAR__?: Debugbar }).__NODEFONY_DEBUGBAR__;

  const hot = (import.meta as { hot?: { data: Record<string, unknown> } }).hot;
  if (hot) hot.data.majs = ((hot.data.majs as number) ?? 0) + 1;
  const MAJS_A_CHAUD = hot ? ((hot.data.majs as number) ?? 1) - 1 : 0;

  /** Les quatre vitrines, pour les comparer d'un clic. */
  const FRONTS = [
    { name: "React", href: "/react/app" },
    { name: "Vue", href: "/vue/app" },
    { name: "Angular", href: "/angular/app" },
    { name: "Svelte", href: "/svelte/app" },
  ];

  /** L'état de la connexion, dit en français — un écran ne parle pas machine. */
  const STATES: Record<string, string> = {
    connected: "connecté",
    connecting: "connexion…",
    reconnecting: "reconnexion automatique…",
    disconnected: "coupé",
    error: "erreur",
  };

  let count = $state(0);

  const cliquer = (): void => {
    count += 1;
    // Le clic voyage : les autres vitrines l'apprennent par le serveur.
    live.emit("live:say", { text: `clic n°${count}`, front: FRONT });
  };
  let data = $state<ApiData | null>(null);
  let error = $state<string | null>(null);
  let timer: ReturnType<typeof setInterval> | null = null;

  // La socket de la page — pour ce qu'on lui DIT (`emit`, `request`) et le
  // bouton de coupure. L'adresse est écrite dans `main.ts` : une page ne devine
  // jamais l'hôte auquel elle parle.
  const live = nodefony();
  // Les valeurs se lisent `.current` ; `$derived` les rend au reste du fichier
  // sous le nom qu'il employait déjà. Rien à libérer : l'abonnement est rendu
  // quand plus aucun effet ne lit la valeur.
  const liveStateStore = nodefonyState();
  const liveState = $derived(liveStateStore.current);
  let messages = $state<Message[]>([]);
  let text = $state("");
  let parHttp = $state<string | null>(null);
  let parSocket = $state<string | null>(null);
  const instantane = nodefonySnapshot();
  const vue = $derived(instantane.current);
  // Ce que le client sait de SA socket — les mêmes lignes que la console.
  const rows = $derived(vue ? describeSocket(vue) : []);

  // Le journal du serveur, par un flux SSE. La valeur est recréée quand
  // `listening` change : l'ancienne n'est plus lue, son flux se ferme — c'est
  // la libération paresseuse de la liaison, et le démontage fait de même.
  let listening = $state(true);
  let lines = $state<LogLine[]>([]);
  const flux = $derived(
    nodefonySse(listening ? JOURNAL : null, {
      events: ["log"],
      onEvent: (e) => {
        const line = lineOf(e.data);
        if (!line) return;
        // Une reprise rejoue la fin du tampon : on n'ajoute que le neuf.
        const last = lines.at(-1);
        if (last && line.id <= last.id) return;
        lines = [...lines, line].slice(-12);
      },
    }),
  );
  const streamStatus = $derived(
    fluxLabel(listening, flux.current.readyState, flux.current.error),
  );
  const refused = $derived(
    listening && flux.current.readyState === 2 && flux.current.error,
  );
  let barVisible = $state(debugbar()?.isVisible() ?? false);

  const toggleBar = (): void => {
    debugbar()?.toggle();
    barVisible = debugbar()?.isVisible() ?? false;
  };

  const send = (): void => {
    const said = text.trim();
    if (!said) return;
    // Une notification client → serveur : pas de réponse attendue, c'est le
    // serveur qui rediffuse à tous les abonnés du canal.
    live.emit("live:say", { text: said, front: FRONT });
    text = "";
  };

  /** La MÊME action, appelée par les deux portes, chronométrée des deux côtés. */
  const comparer = async (): Promise<void> => {
    const t0 = performance.now();
    const r = await fetch("/svelte/api/data");
    const json = (await r.json()) as { result?: unknown };
    parHttp = `${Math.round(performance.now() - t0)} ms\n${JSON.stringify(json.result ?? json, null, 2)}`;
    const t1 = performance.now();
    const parLaSocket = await live.request("/svelte/api/data");
    parSocket = `${Math.round(performance.now() - t1)} ms\n${JSON.stringify(parLaSocket, null, 2)}`;
  };

  /** La dernière trame, dite pour un humain — « — » tant qu'il n'y en a aucune. */
  const lastFrom = (v: SocketSnapshot | null): string =>
    v?.lastFrame.at
      ? `${v.lastFrame.method ?? "?"} à ${new Date(v.lastFrame.at).toLocaleTimeString()}`
      : "—";

  const duration = (v: string | null): string => v?.split("\n")[0] ?? "";
  const body = (v: string | null): string =>
    v?.split("\n").slice(1).join("\n") ?? "—";
  // Libérations des observateurs — rendues au démontage (le HMR remonte le composant).

  const toggle = (): void => {
    if (liveState === "connected") live.disconnect();
    else live.connect().catch(() => {}); // l'échec se lit dans l'état
  };

  const pollApi = async (): Promise<void> => {
    try {
      const r = await fetch("/svelte/api/data");
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      // Nodefony wraps payload : `{ result: {...} }` selon le HttpKernel.
      const json = (await r.json()) as { result?: ApiData } & ApiData;
      data = (json.result ?? json) as ApiData;
      error = null;
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }
  };

  // Le salon : la forme NON paresseuse de la liaison. Elle rend son teardown,
  // ce que `$effect` attend — l'abonnement est donc pris qu'on affiche ou non,
  // et rendu au démontage sans une ligne de `onDestroy`.
  $effect(() =>
    nodefonyChannel("live:salon", (m) => {
      messages = [...messages, m as Message].slice(-6);
    }),
  );

  // Les incidents de CETTE page remontent au serveur — trois appels. Le
  // nettoyage rendu par `$effect` les retire au démontage.
  const journal = new Syslog({ moduleName: "vitrine-svelte" });
  let said = $state<string | null>(null);
  $effect(() => {
    installRequestIdProvider();
    const stopCapture = installErrorCapture({ syslog: journal });
    const stopUplink = installSyslogUplink({ syslog: journal, publisher: live });
    return () => {
      stopUplink();
      stopCapture();
    };
  });

  /**
   * Provoque une erreur DANS le traitement d'une réponse — le chemin où le
   * `requestId` est réellement connu, et le seul qui prouve la corrélation.
   */
  async function triggerIncident(): Promise<void> {
    const response = await fetch(`/${FRONT.toLowerCase()}/api/data`);
    const requestId = response.headers.get("x-request-id") ?? undefined;
    withRequestId(requestId, () => {
      try {
        // Une faute ordinaire : on lit un champ que la réponse ne porte pas.
        const expected: { absent?: { value: string } } = {};
        // Faute VOULUE : la vitrine montre une TypeError remontée au journal ;
        // un `?.` la ferait disparaître.
        // oxlint-disable-next-line typescript/no-non-null-assertion
        said = expected.absent!.value;
      } catch (e) {
        journal.log(
          e instanceof Error ? e.message : String(e),
          3,
          "VITRINE",
          "clic sur « provoquer un incident »",
        );
        said = requestId
          ? `Incident journalisé et poussé au serveur, corrélé à la requête ${requestId.slice(0, 8)}…`
          : "Incident journalisé et poussé au serveur (aucun requestId sur cette réponse).";
      }
    });
  }

  onMount(() => {
    // Il ne reste ici que ce que la PAGE possède vraiment : son sondage HTTP.
    pollApi();
    timer = setInterval(pollApi, 1000);
  });

  onDestroy(() => {
    // Une seule chose à rendre : l'horloge du sondage. Les abonnements temps
    // réel sont rendus par le système d'effets, et la socket PARTAGÉE reste
    // ouverte — la couper trancherait les requêtes en vol des autres
    // consommateurs.
    if (timer) clearInterval(timer);
  });
</script>

<div style="--accent: {ACCENT}">
  <header class="topbar">
    <a class="brand" href="/">
      <img src="/nodefony-logo.png" alt="" draggable="false" />
      nodefony-core
    </a>
    <nav class="fronts" aria-label="Les quatre vitrines">
      {#each FRONTS as f (f.href)}
        <a href={f.href} aria-current={f.nom === "Svelte" ? "page" : undefined}>
          {f.nom}
        </a>
      {/each}
    </nav>
    <div class="outils">
      <span class="sonde-hote" tabindex="0">
        <span class="sonde">
          <span
            class="dot"
            class:dot--on={liveState === "connected"}
            class:dot--wait={liveState === "connecting" ||
              liveState === "reconnecting"}
          ></span>
          {STATES[liveState] ?? liveState}
          <b>{vue?.frames ?? 0}</b> trames
        </span>
        <div class="sonde-detail" role="status">
          <dl>
            <dt>Adresse</dt>
            <dd>{vue?.url ?? "—"}</dd>
            <dt>État</dt>
            <dd>{STATES[liveState] ?? liveState}</dd>
            <dt>Canaux</dt>
            <dd>{vue?.channels.join(", ") || "aucun"}</dd>
            <dt>Trames reçues</dt>
            <dd>{vue?.frames ?? 0}</dd>
            <dt>Dernière</dt>
            <dd>{lastFrom(vue)}</dd>
          </dl>
          <p class="rien">
            Tout cela vient du client lui-même : afficher ce panneau ne provoque
            aucune trame.
          </p>
        </div>
      </span>
      <button
        class="bascule"
        aria-pressed={barVisible}
        onclick={toggleBar}
      >
        Barre de debug
      </button>
    </div>
  </header>

  <main>
    <div class="hero">
      <svg class="logo" viewBox="0 0 107 128" xmlns="http://www.w3.org/2000/svg">
        <path
          d="M94.157 22.819c-10.4-14.885-30.94-19.297-45.792-9.835L22.282 29.608A29.92 29.92 0 0 0 8.764 49.65a31.5 31.5 0 0 0 3.108 20.231 30 30 0 0 0-4.477 11.183 31.9 31.9 0 0 0 5.448 24.116c10.402 14.887 30.942 19.297 45.791 9.835l26.083-16.624A29.92 29.92 0 0 0 98.235 78.35a31.53 31.53 0 0 0-3.105-20.232 30 30 0 0 0 4.474-11.182 31.88 31.88 0 0 0-5.447-24.116"
          fill="#ff3e00"
        />
        <path
          d="M45.817 106.582a20.72 20.72 0 0 1-22.237-8.243 19.17 19.17 0 0 1-3.277-14.503 18 18 0 0 1 .624-2.435l.49-1.498 1.337.981a33.6 33.6 0 0 0 10.203 5.098l.97.294-.09.968a5.85 5.85 0 0 0 1.052 3.878 6.24 6.24 0 0 0 6.695 2.485 5.8 5.8 0 0 0 1.603-.704L69.27 76.28a5.43 5.43 0 0 0 2.45-3.631 5.8 5.8 0 0 0-.987-4.371 6.24 6.24 0 0 0-6.698-2.487 5.7 5.7 0 0 0-1.6.704l-9.953 6.345a19 19 0 0 1-5.296 2.326 20.72 20.72 0 0 1-22.237-8.243 19.17 19.17 0 0 1-3.277-14.502 17.99 17.99 0 0 1 8.13-12.052l26.081-16.623a19 19 0 0 1 5.3-2.329 20.72 20.72 0 0 1 22.237 8.243 19.17 19.17 0 0 1 3.277 14.503 18 18 0 0 1-.624 2.435l-.49 1.498-1.337-.98a33.6 33.6 0 0 0-10.203-5.1l-.97-.294.09-.968a5.86 5.86 0 0 0-1.052-3.878 6.24 6.24 0 0 0-6.696-2.485 5.8 5.8 0 0 0-1.602.704L37.725 51.72a5.42 5.42 0 0 0-2.449 3.63 5.79 5.79 0 0 0 .986 4.372 6.24 6.24 0 0 0 6.698 2.486 5.8 5.8 0 0 0 1.602-.704l9.952-6.342a19 19 0 0 1 5.295-2.328 20.72 20.72 0 0 1 22.237 8.242 19.17 19.17 0 0 1 3.277 14.503 18 18 0 0 1-8.13 12.053l-26.081 16.622a19 19 0 0 1-5.3 2.328"
          fill="#fff"
        />
      </svg>
      <h1>Svelte 5</h1>
      <p class="sub">
        Le même écran, le même socle, quatre frameworks. Servi par
        <strong>@nodefony/frontend</strong> (Vite + HMR) et alimenté par une seule
        socket Nodefony.
      </p>
      <div class="badges">
        <span class="badge badge--accent">Svelte 5 — runes</span>
        <span class="badge">Vite dev server</span>
        {#if data}<span class="badge">env : {data.env}</span>{/if}
      </div>
      <nav class="sommaire" aria-label="Sur cette page">
        <a href="#temps-reel">Temps réel</a>
        <a href="#comparaison">Par comparaison</a>
        <a href="#journal">Journal SSE</a>
        <a href="#client">Le client</a>
        <a href="#observabilite">Observabilité</a>
      </nav>
    </div>

    <section id="temps-reel">
      <div class="sec-head">
        <p class="kicker">Temps réel</p>
        <h2>Ce que cette socket change</h2>
        <p>
          Une seule socket pour la page, ouverte par le framework. L'abonnement
          est compté par référence et rejoué à chaque reconnexion : rien de tout
          cela n'est écrit dans la page.
        </p>
      </div>

      <div class="bandeau">
        <p class="live-state">
          <span
            class="dot"
            class:dot--on={liveState === "connected"}
            class:dot--wait={liveState === "connecting" ||
              liveState === "reconnecting"}
          ></span>
          {STATES[liveState] ?? liveState}
        </p>
        <p class="live-meta">
          {#if vue?.lastFrame.at}
            dernière trame : {lastFrom(vue)}
          {:else}
            aucune trame — le serveur se tait tant qu'il n'a rien à dire
          {/if}
        </p>
        <button class="btn btn--ghost" onclick={toggle}>
          {liveState === "connected" ? "Couper la connexion" : "Rétablir"}
        </button>
      </div>

      <div class="grid">
        <div class="card">
          <h3>👥 Le serveur pousse à TOUS</h3>
          <p style="margin-bottom: 14px">
            Ouvrez cette page dans un second onglet — ou dans une autre vitrine
            — et écrivez : les deux affichent la même chose, en direct. Le
            message ne repasse jamais par une requête HTTP.
          </p>
          <div class="saisie">
            <input
              bind:value={text}
              onkeydown={(e) => e.key === "Enter" && send()}
              placeholder="Écrivez, puis Entrée…"
              aria-label="Message à diffuser"
            />
            <button class="counter" onclick={send}>Envoyer</button>
          </div>
          <ul class="salon">
            {#if messages.length === 0}
              <li class="vide">Rien encore — écrivez quelque chose.</li>
            {:else}
              {#each messages as m, i (`${m.ts}-${i}`)}
                <li>
                  <span class="qui">{m.front}</span>
                  <span>{m.text}</span>
                  <span class="quand"
                    >{new Date(m.ts).toLocaleTimeString()}</span
                  >
                </li>
              {/each}
            {/if}
          </ul>
        </div>

        <div class="card">
          <h3>🔀 Une action, deux transports</h3>
          <p style="margin-bottom: 14px">
            <code>GET /svelte/api/data</code> appelé par HTTP, puis par la
            socket. Même route, même session, même sécurité — une seule action
            de contrôleur derrière les deux portes.
          </p>
          <button class="counter" onclick={comparer}>
            Appeler par les deux
          </button>
          <div class="deux" style="margin-top: 14px">
            <div>
              <p class="voie">HTTP <em>{duration(parHttp)}</em></p>
              <pre class="out">{body(parHttp)}</pre>
            </div>
            <div>
              <p class="voie">Socket <em>{duration(parSocket)}</em></p>
              <pre class="out">{body(parSocket)}</pre>
            </div>
          </div>
        </div>
      </div>

      <div class="live" style="margin-top: 16px">
        <div>
          <p class="live-why">
            Ces <strong>trois lignes</strong> sont les mêmes dans les quatre
            vitrines. Seule la syntaxe du framework de vue change : la logique
            d'abonnement vit dans <strong>nodefony/client</strong>, jamais dans la
            page.
          </p>
          <p class="hint">
            Le même socle que React consomme à travers ses hooks — ici on
            l'appelle directement.
          </p>
        </div>
        <pre class="code"><code
            >configureNodefony(&#123; url: "/api/live/realtime" &#125;)  // main.ts

const liveState = $derived(nodefonyState().current)
$effect(() =&gt; nodefonyChannel("live:salon", (m) =&gt; …))</code
          ></pre>
      </div>
    </section>

    <section id="comparaison">
      <div class="sec-head">
        <p class="kicker">Par comparaison</p>
        <h2>Ce que la page fait quand elle DEMANDE</h2>
        <p>
          À gauche, une requête par seconde : c'est la page qui réclame. À
          droite, le rechargement à chaud, qui garde l'état du composant.
        </p>
      </div>
      <div class="grid">
        <div class="card">
          <h3>🔌 Requête HTTP</h3>
          <code class="route">GET /svelte/api/data — 1×/s</code>
          {#if error}
            <pre class="out out--err">{error}</pre>
          {:else if data}
            <pre class="out">{JSON.stringify(data, null, 2)}</pre>
          {:else}
            <p class="hint">chargement…</p>
          {/if}
        </div>

        <div class="card">
          <h3>♻️ Rechargement à chaud</h3>
          <button class="counter" onclick={cliquer}>
            {count} clic{count > 1 ? "s" : ""}
          </button>
          <p class="hint">
            {MAJS_A_CHAUD} rechargement{MAJS_A_CHAUD > 1 ? "s" : ""} à chaud depuis
            le dernier chargement complet — l'état ci-dessus y a survécu.
          </p>
          <p class="hint">
            Édite <code>frontend/src/App.svelte</code> : Vite recompile, le
            compteur ne repart PAS à zéro. S'il y retombe, c'est un rechargement
            complet, pas un rechargement à chaud.
          </p>
        </div>
      </div>
    </section>

    <section id="journal">
      <div class="sec-head">
        <p class="kicker">Flux SSE</p>
        <h2>Journal du serveur en direct</h2>
        <p>
          Le serveur parle, la page écoute — sur une réponse HTTP ordinaire qui
          ne se termine pas. Chaque ligne porte un identifiant : coupé puis
          rétabli, le flux reprend là où il s'était arrêté.
        </p>
      </div>

      <div class="bandeau">
        <p class="live-state">
          <span class={streamStatus.dot}></span>
          {streamStatus.text}
        </p>
        <p class="live-meta">
          {lines.length} ligne{lines.length > 1 ? "s" : ""} — les douze dernières
        </p>
        <button class="btn btn--ghost" onclick={() => (listening = !listening)}>
          {listening ? "Arrêter l'écoute" : "Écouter"}
        </button>
      </div>

      {#if refused}
        <p class="refus" role="status">
          Le serveur a refusé le flux : le journal d'exploitation est réservé à
          l'administration.
          <a href="/nodefony/login">Connectez-vous à la console</a> dans ce
          navigateur, puis revenez ici.
        </p>
      {/if}

      <ol class="journal">
        {#each lines as l (l.id)}
          <li>
            <time>{new Date(l.time).toLocaleTimeString()}</time>
            <span class="sev sev--{l.severity.toLowerCase()}">{l.severity}</span>
            <span class="msgid">{l.msgid}</span>
            <span class="txt"
              >{l.text}{l.dropped ? ` (+${l.dropped} perdues)` : ""}</span
            >
            {#if l.requestId}<code class="rid">{l.requestId.slice(0, 8)}</code
              >{/if}
          </li>
        {:else}
          <li class="vide">Rien encore — le serveur n'a rien dit.</li>
        {/each}
      </ol>

      <div class="grid" style="margin-top: 16px">
        <div class="card">
          <h3>📡 WebSocket ou SSE ?</h3>
          <table class="versus">
            <thead>
              <tr>
                <th scope="col">Critère</th>
                <th scope="col">WebSocket</th>
                <th scope="col">SSE</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <th scope="row">Sens</th>
                <td>les deux</td>
                <td>serveur → page</td>
              </tr>
              <tr>
                <th scope="row">Transport</th>
                <td>protocole à part</td>
                <td>réponse HTTP ordinaire</td>
              </tr>
              <tr>
                <th scope="row">Reprise</th>
                <td>rejoue les abonnements</td>
                <td>Last-Event-ID, rien de perdu</td>
              </tr>
              <tr>
                <th scope="row">Ici</th>
                <td>le salon, le pont d'API</td>
                <td>le journal du serveur</td>
              </tr>
            </tbody>
          </table>
        </div>
        <div class="card">
          <h3>🧩 Un appel, fermé tout seul</h3>
          <pre class="code"><code
              >const flux = nodefonySse(JOURNAL, &#123;
  events: ["log"],
  onEvent: (e) =&gt; …,
&#125;)</code
            ></pre>
          <p class="hint">
            Plus personne ne lit la valeur : le flux se ferme. Aucune requête ne
            reste ouverte derrière une page quittée. Les mêmes trois lignes en
            React, Vue et Angular.
          </p>
        </div>
      </div>
    </section>

    <section id="client">
      <div class="sec-head">
        <p class="kicker">Diagnostic</p>
        <h2>Le client vu de l'intérieur</h2>
        <p>
          Ce que la socket sait d'elle-même, sans rien demander au serveur. Le
          même tableau s'affiche dans la console du navigateur ; ici, chaque
          ligne dit ce qu'elle garantit.
        </p>
      </div>
      <div class="card">
        <dl class="fiche">
          {#each rows as r (r.label)}
            <div>
              <dt>{r.label}</dt>
              <dd>
                <span class="val">{r.value}</span>
                <span class="pourquoi">{r.hint}</span>
              </dd>
            </div>
          {/each}
        </dl>
        <p class="hint">
          Dans la console (F12) : le badge <code>◆ nodefony client</code>, son
          groupe replié, puis <code>nodefony.socket</code>,
          <code>nodefony.sockets()</code> et <code>nodefony.identity()</code>. En
          production, rien de tout cela n'est posé.
        </p>
      </div>
    </section>

    <section id="observabilite">
      <div class="sec-head">
        <p class="kicker">Observabilité</p>
        <h2>Ce qui casse ici se lit là-bas</h2>
        <p>
          Une erreur survenue dans ce navigateur rejoint le journal du serveur, à
          côté de la ligne de la requête qui l'a provoquée. Trois appels dans
          l'application, rien de plus.
        </p>
      </div>
      <div class="grid">
        <div class="card">
          <h3>💥 Provoquer un incident</h3>
          <p class="hint">
            Le clic lit un champ absent d'une réponse : une TypeError,
            journalisée avec le requestId de cette requête, puis poussée au
            serveur par la socket.
          </p>
          <button class="counter" onclick={() => void triggerIncident()}>
            Provoquer un incident
          </button>
          {#if said}<p class="hint" role="status">{said}</p>{/if}
          <p class="hint">
            La remontée exige une session : le canal n'accepte pas les
            connexions anonymes. Connectez-vous à la console d'administration
            dans ce navigateur, puis rechargez — l'entrée apparaît dans le
            journal en direct ci-dessus (VITRINE), avec le même requestId.
            Socket : {STATES[liveState] ?? liveState}.
          </p>
        </div>
        <div class="card">
          <h3>🧩 Trois appels</h3>
          <pre class="code"><code
              >installRequestIdProvider()
installErrorCapture(&#123; syslog &#125;)
installSyslogUplink(&#123; syslog, publisher: socket &#125;)</code
            ></pre>
          <p class="hint">
            Les erreurs que personne ne rattrape y passent aussi : la capture est
            posée pour toute la page, et retirée au démontage.
          </p>
        </div>
      </div>
    </section>

    <p class="foot">
      La même page en <a href="/react/app">React</a>,
      <a href="/vue/app">Vue</a>
      et <a href="/angular/app">Angular</a> — ou la
      <a href="/nodefony">console d'administration</a>.
    </p>
  </main>
</div>
