<script lang="ts">
  // Le canal vit dans un `$state` : la source est refabriquée quand il change,
  // et c'est le système d'effets qui décide de l'ordre prendre/rendre.
  let { fabrique }: { fabrique: (canal: string) => { current: unknown } } =
    $props();
  let canal = $state("live:a");
  const source = $derived(fabrique(canal));
  export function changer(n: string): void {
    canal = n;
  }
</script>

<p data-testid="valeur">{JSON.stringify(source.current)}</p>
