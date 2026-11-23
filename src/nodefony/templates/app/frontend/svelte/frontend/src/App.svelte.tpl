<script lang="ts">
  /**
   * Page d'accueil de <%= it.appName %> — c'est TA page.
   *
   * Ce que voit tout visiteur : la marque, le thème<% if (it.complete) { %>, la session<% } %>, puis le
   * nom de l'application. Rien de plus en production : ni mot de passe, ni
   * version, ni lien vers la console d'administration.
   *
   * En DÉVELOPPEMENT seulement : la présentation du framework, les liens utiles
   * et où personnaliser la page. Ce contenu vit dans `devHome.ts`, qui vaut
   * `null` dans le build de production — c'est là qu'est la garde, pas ici.
   */
  import { onMount } from "svelte";
<% if (it.complete) { %>  // La liaison Svelte de la connexion : l'état de session en rune, la page de
  // connexion servie par le framework (jamais un formulaire recopié ici).
  import { nodefonyLogin } from "nodefony/svelte";
  import { loginPagePath } from "nodefony/client";
<% } %>  import { NODEFONY_LOGO } from "./brand";
  import { DEV_HOME } from "./devHome";
  import {
    applyDarkTheme,
    findDebugBar,
    findDemo,
    readDarkTheme,
    startPointerLight,
    type IDebugBarHandle,
  } from "./homeEffects";
  import "./showcase.css";
  import "./accent.css";

  const dev = DEV_HOME;

  // Thème clair/sombre : suit le système, un clic l'impose, retenu par ce navigateur.
  const initialDark = readDarkTheme();
  let dark = $state(initialDark);
  applyDarkTheme(initialDark, false);
  function toggleTheme(): void {
    dark = !dark;
    applyDarkTheme(dark);
  }

  // UN bouton pour la barre de debug : la cacher ou la montrer.
  let bar = $state<IDebugBarHandle | null>(null);
  let barVisible = $state(true);
  function toggleBar(): void {
    if (bar === null) return;
    barVisible = !barVisible;
    bar.setVisible(barVisible);
  }

  // La démo est-elle chargée ? Le serveur le dit dans la page (développement).
  const demo = dev === null ? null : findDemo();
<% if (it.complete) { %>
  const login = nodefonyLogin();
  const flow = login.flow;
  const loginHref = loginPagePath(location.pathname + location.search);

  async function logout(): Promise<void> {
    // Session venue d'un fournisseur : suivre son adresse ferme AUSSI la sienne.
    const providerLogout = await flow.logout();
    if (providerLogout !== null) window.location.assign(providerLogout);
  }
<% } %>
  onMount(() => {
<% if (it.complete) { %>    // Reprend la session existante au montage (cookie de session, s'il y en a un).
    void flow.me();
<% } %>    const stopLight = startPointerLight(".nf-card");
    let frame = 0;
    if (dev !== null) {
      // La barre est injectée à côté de la page : sa poignée arrive après le rendu.
      frame = requestAnimationFrame(() => {
        bar = findDebugBar();
        if (bar !== null) barVisible = bar.isVisible();
      });
    }
    return () => {
      stopLight();
      cancelAnimationFrame(frame);
    };
  });
</script>

<header class="nf-topbar">
  <a class="nf-brand" href="/">
    <img src={NODEFONY_LOGO} alt="" width="30" height="30" />
    <span><%= it.appName %></span>
    {#if dev}<span class="nf-tag">développement</span>{/if}
  </a>
  {#if dev}
    <nav class="nf-topnav" aria-label="Liens de développement">
      {#if dev.console}
        <a href={dev.console.href}>{dev.console.label}</a>
        <span class="nf-topnav-sep" aria-hidden="true"></span>
      {/if}
      {#each dev.external as link (link.href)}
        <a class="nf-ext" href={link.href}>{link.label}</a>
      {/each}
    </nav>
  {/if}
  <div class="nf-topbar-tools">
    <div class="nf-tools" role="group" aria-label="Affichage">
      <button
        type="button"
        class="nf-tool"
        aria-pressed={dark}
        aria-label="Thème sombre"
        title="Thème sombre"
        onclick={toggleTheme}
      >
        {#if dark}
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            aria-hidden="true"
          >
            <circle cx="12" cy="12" r="4" />
            <path
              d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"
            />
          </svg>
        {:else}
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            aria-hidden="true"
          >
            <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
          </svg>
        {/if}
      </button>
      {#if bar}
        <button
          type="button"
          class="nf-tool"
          aria-pressed={!barVisible}
          aria-label="Cacher la barre de debug"
          title="Cacher la barre de debug"
          onclick={toggleBar}
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            aria-hidden="true"
          >
            <path d="M8 2l1.9 1.9M16 2l-1.9 1.9" />
            <rect x="7" y="6" width="10" height="14" rx="5" />
            <path
              d="M12 10v10M3 13h4M17 13h4M4 7l3 2M20 7l-3 2M4 19l3-2M20 19l-3-2"
            />
          </svg>
        </button>
      {/if}
    </div>
<% if (it.complete) { %>    {#if login.state.current.step === "authenticated" && login.state.current.user}
      <span class="nf-account">
        <span class="nf-session">{login.state.current.user.identifier}</span>
        <button type="button" class="nf-account-out" onclick={logout}>
          Se déconnecter
        </button>
      </span>
    {:else}
      <a class="nf-login" href={loginHref}>Se connecter</a>
    {/if}
<% } %>  </div>
</header>

<main class="nf-main">
  <div class="nf-hero">
    <img
      class="nf-hero-logo"
      src={NODEFONY_LOGO}
      alt=""
      width="80"
      height="80"
    />
    {#if dev}
      <h1>{dev.hero.title}</h1>
      <p class="nf-sub">{dev.hero.sub}</p>
      <p class="nf-sig">{dev.hero.sig}</p>
      <div class="nf-badges">
        <span class="nf-badge nf-agentic">{dev.hero.lead}</span>
        <span class="nf-badge nf-front">
          <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <path d={dev.front.logo} />
          </svg>
          {dev.front.name}
          {dev.front.version}
        </span>
        {#each dev.hero.badges as badge (badge)}
          <span class="nf-badge">{badge}</span>
        {/each}
      </div>
      <div
        class="nf-install"
        role="img"
        aria-label={`Commande d'installation : ${dev.hero.install.command} ${dev.hero.install.arg}`}
      >
        <span class="nf-p">$</span>
        <span>{dev.hero.install.command} <b>{dev.hero.install.arg}</b></span>
      </div>
      {#if demo !== null}
        <div class="nf-cta">
          <a class="nf-btn nf-primary" href={demo}>{dev.demoLabel}</a>
        </div>
      {:else}
        <p class="nf-learn">
          {dev.learn.label} : <code>{dev.learn.command}</code> —
          {dev.learn.note}
        </p>
      {/if}
    {:else}
      <h1><%= it.appName %></h1>
    {/if}
  </div>

  {#each dev?.sections ?? [] as section (section.id)}
    <section
      class={section.band ? "nf-section nf-band" : "nf-section"}
      aria-labelledby={`${section.id}-title`}
    >
      <div class="nf-sec-head">
        <p class="nf-kicker">{section.kicker}</p>
        <h2 id={`${section.id}-title`}>{section.title}</h2>
        <p>{section.intro}</p>
      </div>
      <div class="nf-grid">
        {#each section.cards as card (card.title)}
          <svelte:element
            this={card.href !== null ? "a" : "div"}
            class={card.tone === "safe" ? "nf-card nf-safe" : "nf-card"}
            href={card.href ?? undefined}
          >
            <h3>{card.title}</h3>
            {#if card.creds}
              <p class="nf-creds">
                <code>{card.creds.user}</code>
                {#if card.creds.password !== null}
                  / <code>{card.creds.password}</code>
                {/if}
              </p>
            {/if}
            <p>
              {#each card.text as part, i (i)}{#if part.code}<code
                    >{part.text}</code
                  >{:else}{part.text}{/if}{/each}
            </p>
            {#if card.go}<span class="nf-go">{card.go}</span>{/if}
            {#if card.skins}
              <form class="nf-skins" action={card.skins.action} method="get">
                <select
                  name="skin"
                  aria-label="Habillage de la page de connexion"
                  value={card.skins.selected}
                >
                  {#each card.skins.options as skin (skin)}
                    <option value={skin}>{skin}</option>
                  {/each}
                </select>
                <button type="submit">Voir</button>
              </form>
            {/if}
          </svelte:element>
        {/each}
      </div>
      {#if section.note}<p class="nf-note">{section.note}</p>{/if}
    </section>
  {/each}
</main>
