<template>
  <p>{{ hasDefault }}</p>
</template>

<script setup lang="ts">
import { useSlots } from "vue";

// Un appel `use…()` dans le `setup` suffit : oxc y voit un hook React et, si
// l'option de rafraîchissement lui parvient, y injecte la signature React.
const slots = useSlots();
const hasDefault = !!slots.default;
</script>
