<script lang="ts">
  // Un composant qui LIT la valeur : c'est cette lecture, dans le template
  // (donc dans un effet), qui déclenche l'abonnement.
  let { source }: { source: { current: unknown } } = $props();
</script>

<p data-testid="valeur">{JSON.stringify(source.current)}</p>
