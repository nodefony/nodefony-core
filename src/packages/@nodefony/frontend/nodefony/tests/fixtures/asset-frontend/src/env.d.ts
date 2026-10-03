declare module "*.png" {
  const url: string;
  export default url;
}
declare module "*.css";
declare module "*.vue" {
  import type { Component } from "vue";
  const component: Component;
  export default component;
}
