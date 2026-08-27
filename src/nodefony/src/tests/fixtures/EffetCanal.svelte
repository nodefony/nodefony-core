<script lang="ts">
  // La forme NON paresseuse : `$effect` attend un teardown, c'est exactement ce
  // que rend `nodefonyChannel`. L'abonnement est pris qu'on affiche ou non.
  let { brancher }: { brancher: () => () => void } = $props();
  $effect(() => brancher());
</script>

<p>abonné sans rien afficher</p>
