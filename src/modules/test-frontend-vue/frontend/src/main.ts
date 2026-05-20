import { createApp } from "vue";
import App from "./App.vue";

const el = document.getElementById("app");
if (!el) throw new Error("#app not found");
createApp(App).mount(el);
