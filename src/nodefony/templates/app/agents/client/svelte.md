- **Le geste concret avec `nodefony/svelte`** — la liaison Svelte 5
  du paquet `nodefony`, résolue à l'identique par Vite, Node et le typecheck.
  Ce subpath ne publie AUCUNE rune (`$state`/`$effect` n'existent que dans un
  `.svelte`) : il rend des sources réactives ordinaires, qui se lisent `.current`
  et se libèrent seules quand plus aucun effet ne les lit :

```ts
// frontend/src/main.ts — ce que l'entrée générée fait déjà
import { mount } from "svelte";
import { configureNodefony } from "nodefony/svelte";
import App from "./App.svelte";

const el = document.getElementById("app");
if (!el) throw new Error("#app not found");

configureNodefony({ url: "/api/live/realtime" });
mount(App, { target: el });
```

```svelte
<script lang="ts">
  import { nodefonyChannelData } from "nodefony/svelte";

  const flux = nodefonyChannelData<{ message: string }>("live:events");
  const last = $derived(flux.current);
</script>

<p>{last?.message ?? "en attente…"}</p>
```

Les autres fonctions (`nodefony`, `nodefonyState`, `nodefonyIdentity`,
`nodefonyChannel`) et pourquoi aucune rune n'est publiée :
`node_modules/nodefony/docs/svelte-reactivite.md`.
