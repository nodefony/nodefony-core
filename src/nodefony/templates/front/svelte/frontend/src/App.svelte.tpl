<script lang="ts">
  /**
   * Page « <%= it.kebab %> » — squelette VOLONTAIREMENT minimal : c'est TA page,
   * pas une vitrine. Le compteur prouve le HMR (édite le markup : Vite
   * recompile à la volée sans recharger). Les appels backend passent par
   * `fetch("/api/…")` (proxifiés vers Nodefony en dev, cf `apiProxyPaths`).
   */
  let count = $state(0);
</script>

<main style="font-family: system-ui, sans-serif; padding: 32px">
  <h1><%= it.kebab %></h1>
  <p>Svelte 5 servi par Nodefony via Vite — entry « <%= it.kebab %> ».</p>
  <button onclick={() => count++}>count is {count}</button>
  <p style="color: #666; font-size: 14px">
    Édite <code>frontend/src/App.svelte</code> — HMR sans recharger, compteur
    conservé.
  </p>
</main>
