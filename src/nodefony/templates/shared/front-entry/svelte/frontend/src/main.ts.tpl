import { mount } from "svelte";
import App from "./App.svelte";

const el = document.getElementById("app");
if (!el) throw new Error("#app not found");
mount(App, { target: el });
