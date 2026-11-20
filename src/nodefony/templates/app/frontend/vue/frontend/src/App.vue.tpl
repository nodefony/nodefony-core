<script setup lang="ts">
/**
 * Page d'accueil de <%= it.appName %> — c'est TA page.
 *
 * Ce que voit tout visiteur : la marque, le thème<% if (it.complete) { %>, la session<% } %>, puis le nom de
 * l'application. Rien de plus en production : ni mot de passe, ni version, ni
 * lien vers la console d'administration.
 *
 * En DÉVELOPPEMENT seulement : la présentation du framework, les liens utiles
 * et où personnaliser la page. Ce contenu vit dans `devHome.ts`, qui vaut
 * `null` dans le build de production — c'est là qu'est la garde, pas ici :
 * Vue compile les textes de ce gabarit dans le bundle, affichés ou non.
 */
import { onMounted, onUnmounted, ref, shallowRef } from "vue";
<% if (it.complete) { %>// La liaison Vue de la connexion : l'état de session en composable, la page de
// connexion servie par le framework (jamais un formulaire recopié ici).
import { useNodefonyLogin } from "nodefony/vue";
import { loginPagePath } from "nodefony/client";
<% } %>import { NODEFONY_LOGO } from "./brand";
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
const dark = ref(readDarkTheme());
applyDarkTheme(dark.value, false);
function toggleTheme(): void {
  dark.value = !dark.value;
  applyDarkTheme(dark.value);
}

// UN bouton pour la barre de debug : la cacher ou la montrer.
const bar = shallowRef<IDebugBarHandle | null>(null);
const barVisible = ref(true);
function toggleBar(): void {
  if (bar.value === null) return;
  barVisible.value = !barVisible.value;
  bar.value.setVisible(barVisible.value);
}

// La démo est-elle chargée ? Le serveur le dit dans la page (développement).
const demo = dev === null ? null : findDemo();
<% if (it.complete) { %>
const { state: login, flow } = useNodefonyLogin();
const loginHref = loginPagePath(location.pathname + location.search);

async function logout(): Promise<void> {
  // Session venue d'un fournisseur : suivre son adresse ferme AUSSI la sienne.
  const providerLogout = await flow.logout();
  if (providerLogout !== null) window.location.assign(providerLogout);
}
<% } %>
let stopLight: (() => void) | null = null;
let frame = 0;
onMounted(() => {
<% if (it.complete) { %>  // Reprend la session existante au montage (cookie de session, s'il y en a un).
  void flow.me();
<% } %>  stopLight = startPointerLight(".nf-card");
  if (dev === null) return;
  // La barre est injectée à côté de la page : sa poignée arrive après le rendu.
  frame = requestAnimationFrame(() => {
    bar.value = findDebugBar();
    if (bar.value !== null) barVisible.value = bar.value.isVisible();
  });
});
onUnmounted(() => {
  stopLight?.();
  cancelAnimationFrame(frame);
});
</script>

<template>
  <header class="nf-topbar">
    <a class="nf-brand" href="/">
      <img :src="NODEFONY_LOGO" alt="" width="30" height="30" />
      <span><%= it.appName %></span>
      <span v-if="dev" class="nf-tag">développement</span>
    </a>
    <nav v-if="dev" class="nf-topnav" aria-label="Liens de développement">
      <template v-if="dev.console">
        <a :href="dev.console.href">{{ dev.console.label }}</a>
        <span class="nf-topnav-sep" aria-hidden="true"></span>
      </template>
      <a
        v-for="link in dev.external"
        :key="link.href"
        class="nf-ext"
        :href="link.href"
        >{{ link.label }}</a
      >
    </nav>
    <div class="nf-topbar-tools">
      <div class="nf-tools" role="group" aria-label="Affichage">
        <button
          type="button"
          class="nf-tool"
          :aria-pressed="dark"
          aria-label="Thème sombre"
          title="Thème sombre"
          @click="toggleTheme"
        >
          <svg
            v-if="dark"
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
          <svg
            v-else
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            aria-hidden="true"
          >
            <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
          </svg>
        </button>
        <button
          v-if="bar"
          type="button"
          class="nf-tool"
          :aria-pressed="!barVisible"
          aria-label="Cacher la barre de debug"
          title="Cacher la barre de debug"
          @click="toggleBar"
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
      </div>
<% if (it.complete) { %>      <span
        v-if="login.step === 'authenticated' && login.user"
        class="nf-account"
      >
        <span class="nf-session">{{ login.user.identifier }}</span>
        <button type="button" class="nf-account-out" @click="logout">
          Se déconnecter
        </button>
      </span>
      <a v-else class="nf-login" :href="loginHref">Se connecter</a>
<% } %>    </div>
  </header>

  <main class="nf-main">
    <div class="nf-hero">
      <img
        class="nf-hero-logo"
        :src="NODEFONY_LOGO"
        alt=""
        width="80"
        height="80"
      />
      <template v-if="dev">
        <h1>{{ dev.hero.title }}</h1>
        <p class="nf-sub">{{ dev.hero.sub }}</p>
        <p class="nf-sig">{{ dev.hero.sig }}</p>
        <div class="nf-badges">
          <span class="nf-badge nf-agentic">{{ dev.hero.lead }}</span>
          <span class="nf-badge nf-front">
            <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path :d="dev.front.logo" />
            </svg>
            {{ dev.front.name }} {{ dev.front.version }}
          </span>
          <span
            v-for="badge in dev.hero.badges"
            :key="badge"
            class="nf-badge"
            >{{ badge }}</span
          >
        </div>
        <div
          class="nf-install"
          role="img"
          :aria-label="`Commande d'installation : ${dev.hero.install.command} ${dev.hero.install.arg}`"
        >
          <span class="nf-p">$</span>
          <span
            >{{ dev.hero.install.command }}
            <b>{{ dev.hero.install.arg }}</b></span
          >
        </div>
        <div v-if="demo !== null" class="nf-cta">
          <a class="nf-btn nf-primary" :href="demo">{{ dev.demoLabel }}</a>
        </div>
        <p v-else class="nf-learn">
          {{ dev.learn.label }} : <code>{{ dev.learn.command }}</code> —
          {{ dev.learn.note }}
        </p>
      </template>
      <h1 v-else><%= it.appName %></h1>
    </div>

    <section
      v-for="section in dev?.sections ?? []"
      :key="section.id"
      :class="section.band ? 'nf-section nf-band' : 'nf-section'"
      :aria-labelledby="`${section.id}-title`"
    >
      <div class="nf-sec-head">
        <p class="nf-kicker">{{ section.kicker }}</p>
        <h2 :id="`${section.id}-title`">{{ section.title }}</h2>
        <p>{{ section.intro }}</p>
      </div>
      <div class="nf-grid">
        <component
          :is="card.href !== null ? 'a' : 'div'"
          v-for="card in section.cards"
          :key="card.title"
          :class="card.tone === 'safe' ? 'nf-card nf-safe' : 'nf-card'"
          :href="card.href ?? undefined"
        >
          <h3>{{ card.title }}</h3>
          <p v-if="card.creds" class="nf-creds">
            <code>{{ card.creds.user }}</code>
            <template v-if="card.creds.password !== null">
              / <code>{{ card.creds.password }}</code>
            </template>
          </p>
          <p>
            <template v-for="(part, i) in card.text" :key="i">
              <code v-if="part.code">{{ part.text }}</code>
              <template v-else>{{ part.text }}</template>
            </template>
          </p>
          <span v-if="card.go" class="nf-go">{{ card.go }}</span>
          <form
            v-if="card.skins"
            class="nf-skins"
            :action="card.skins.action"
            method="get"
          >
            <select name="skin" aria-label="Habillage de la page de connexion">
              <option
                v-for="skin in card.skins.options"
                :key="skin"
                :value="skin"
                :selected="skin === card.skins.selected"
              >
                {{ skin }}
              </option>
            </select>
            <button type="submit">Voir</button>
          </form>
        </component>
      </div>
      <p v-if="section.note" class="nf-note">{{ section.note }}</p>
    </section>
  </main>
</template>
