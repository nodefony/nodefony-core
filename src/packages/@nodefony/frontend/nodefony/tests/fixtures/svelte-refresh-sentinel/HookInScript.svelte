<script lang="ts">
  import { useLabel } from "./useLabel";

  // Un appel `use…()` dans le script d'un composant : si l'option de
  // rafraîchissement de React parvenait au TypeScript de Svelte, oxc y
  // injecterait la signature de rafraîchissement React. Ce commentaire ne
  // doit jamais en écrire le nom : Svelte le conserve dans le code servi.
  const label: string = useLabel();
</script>

<p>{label}</p>
