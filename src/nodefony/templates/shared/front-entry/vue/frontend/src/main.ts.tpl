import { createApp } from "vue";
<% if (it.complete) { %>// La politique temps réel du framework s'installe comme tout le reste en Vue :
// un PLUGIN. C'est ici, et ici seulement, que l'adresse du serveur est écrite —
// les composables de la page n'en connaissent aucune, et le framework n'en
// devine aucune : une adresse devinée marche en développement et se trompe en
// production.
import { nodefonyVue } from "nodefony/vue";
<% } %>import App from "./App.vue";

const el = document.getElementById("app");
if (!el) throw new Error("#app not found");
<% if (it.complete) { %>createApp(App).use(nodefonyVue, { url: "/api/live/realtime" }).mount(el);<% } else { %>createApp(App).mount(el);<% } %>
