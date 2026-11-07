<script setup lang="ts">
/**
 * Page d'accueil de <%= it.appName %> — MINIMALE, et c'est voulu : c'est TA page.
 *
 * Elle dit quelle application répond<% if (it.hasSecurity) { %>, propose la connexion et nomme le
 * compte connecté<% } %>. Rien de plus : ce qui part ici part en PRODUCTION, vers
 * n'importe qui — ni mot de passe, ni version, ni lien vers la console
 * d'administration.
 *
 * Pour VOIR ce que le framework sait faire, installe la démo : elle se copie
 * dans l'application et se lit comme ton propre code.
 */
<% if (it.hasSecurity) { %>import { onMounted } from "vue";
// La liaison Vue de la connexion : l'état de session en composable, la page de
// connexion servie par le framework (jamais un formulaire recopié ici).
import { useNodefonyLogin } from "nodefony/vue";
import { loginPagePath } from "nodefony/client";
<% } %>import { NODEFONY_LOGO } from "./brand";
import "./showcase.css";
import "./accent.css";
<% if (it.hasSecurity) { %>
const { state: login, flow } = useNodefonyLogin();
const loginHref = loginPagePath(location.pathname + location.search);

// Reprend la session existante au montage (cookie de session, s'il y en a un).
onMounted(() => {
  void flow.me();
});

async function logout(): Promise<void> {
  // Session venue d'un fournisseur : suivre son adresse ferme AUSSI la sienne.
  const providerLogout = await flow.logout();
  if (providerLogout !== null) window.location.assign(providerLogout);
}
<% } %></script>

<template>
  <main class="nf-main">
    <img class="nf-fwlogo" :src="NODEFONY_LOGO" alt="" width="48" height="48" />
    <h1><%= it.appName %></h1>
<% if (it.hasSecurity) { %>    <div class="nf-card" role="status">
      <p v-if="login.step === 'authenticated' && login.user">
        Connecté en tant que
        <span class="nf-session" data-open="">{{ login.user.identifier }}</span>
        <button type="button" class="nf-action" @click="logout">
          Se déconnecter
        </button>
      </p>
      <a v-else class="nf-action" :href="loginHref">Se connecter</a>
    </div>
<% } else { %>    <p class="nf-dim">Ton application répond. Cette page est la tienne.</p>
<% } %>  </main>
</template>
