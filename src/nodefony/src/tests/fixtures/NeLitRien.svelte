<script lang="ts">
  // Le témoin du comportement PARESSEUX : la source est là, personne ne la lit.
  let { source }: { source: { current: unknown } } = $props();
  void source;
</script>

<p>ne lit rien</p>
