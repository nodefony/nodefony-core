import { mount } from "svelte";
<% if (it.complete) { %>// La politique temps réel du framework. Svelte n'a pas de contexte applicatif :
// elle s'écrit ici, comme ce qu'elle est — une configuration de module, posée
// AVANT le montage. C'est le seul endroit où l'adresse du serveur est écrite ;
// le framework n'en devine aucune : une adresse devinée marche en développement
// et se trompe en production.
import { configureNodefony } from "nodefony/svelte";
<% } %>import App from "./App.svelte";

const el = document.getElementById("app");
if (!el) throw new Error("#app not found");
<% if (it.complete) { %>configureNodefony({ url: "/api/live/realtime" });
<% } %>mount(App, { target: el });
