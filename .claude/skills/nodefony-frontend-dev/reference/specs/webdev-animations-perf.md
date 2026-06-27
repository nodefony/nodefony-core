Title: How to create high-performance CSS animations

URL Source: https://web.dev/articles/animations-guide

Warning: Target URL returned error 403: Forbidden

Markdown Content:
![Image 1: Kayce Basques](https://web.dev/images/authors/kaycebasques.jpg)

![Image 2: Rachel Andrew](https://web.dev/images/authors/rachelandrew.jpg)

This guide teaches you how to create high-performance CSS animations.

See [Why are some animations slow?](https://web.dev/articles/animations-overview) to learn the theory behind these recommendations.

## Browser compatibility

All the CSS properties that this guide recommends have good cross-browser support.

`transform`

`opacity`

`will-change`

## Move an element

To move an element, use the `translate` or `rotation` keyword values of the [`transform`](https://developer.mozilla.org/docs/Web/CSS/transform) property.

For example, to slide an item into view, use `translate`.

```
.animate {
  animation: slide-in 0.7s both;
}

@keyframes slide-in {
  0% {
    transform: translateY(-1000px);
  }
  100% {
    transform: translateY(0);
  }
}
```

Use `rotate` to rotate elements. The following example rotates an element 360 degrees.

```
.animate {
  animation: rotate 0.7s ease-in-out both;
}

@keyframes rotate {
  0% {
    transform: rotate(0);
  }
  100% {
    transform: rotate(360deg);
  }
}
```

## Resize an element

To resize an element, use the `scale` keyword value of the [`transform`](https://developer.mozilla.org/docs/Web/CSS/transform) property.

```
.animate {
  animation: scale 1.5s both;
}

@keyframes scale {
  50% {
    transform: scale(0.5);
  }
  100% {
    transform: scale(1);
  }
}
```

## Change an element's visibility

To show or hide an element, use [`opacity`](https://developer.mozilla.org/docs/Web/CSS/opacity).

```
.animate {
  animation: opacity 2.5s both;
}

@keyframes opacity {
  0% {
    opacity: 1;
  }
  50% {
    opacity: 0;
  }
  100% {
    opacity: 1;
  }
}
```

## Avoid properties that trigger layout or paint

Before using any CSS property for animation (other than `transform` and `opacity`), determine the property's impact on the [rendering pipeline](https://web.dev/articles/animations-overview#pipeline). Avoid any property that triggers layout or paint unless it's absolutely necessary.

## Force layer creation

As explained in [Why are some animations slow?](https://web.dev/articles/animations-overview), placing elements on a new layer lets the browser repaint them without needing to repaint the rest of the layout.

Browsers can usually make good decisions about which items should be placed on a new layer, but you can manually force layer creation with the [`will-change`](https://developer.mozilla.org/docs/Web/CSS/will-change) property. As the name suggests, this property tells the browser that this element is going to be changed in some way.

In CSS, you can apply `will-change` to any selector:

```
body > .sidebar {
  will-change: transform;
}
```

However, [the specification](https://www.w3.org/TR/css-will-change/) suggests that you should only add this to elements that are always about to change. For example, this could be used for a sidebar the user can slide in and out. If the element doesn't change frequently, apply `will-change` using JavaScript when a change is likely to happen. Make sure to give the browser enough time to perform the necessary optimizations, and remove the property when the change has stopped.

To force layer creation in a browser without support for `will-change`, you can set `transform: translateZ(0)`.

## Debug slow or glitchy animations

[Chrome DevTools](https://developer.chrome.com/docs/devtools/performance/overview) and Firefox DevTools can help you figure out why your animations are slow or glitchy.

### Check whether an animation triggers layout

An animation that moves an element using something other than `transform` is likely to be slow. The following example compares an animation using `transform` to an animation using `top` and `left`.

Don't

.box {
position: absolute;
top: 10px;
left: 10px;
animation: move 3s ease infinite;
}

@keyframes move {
50% {
top: calc(90vh - 160px);
left: calc(90vw - 200px);
}
}

Do

.box {
position: absolute;
top: 10px;
left: 10px;
animation: move 3s ease infinite;
}

@keyframes move {
50% {
transform: translate(calc(90vw - 200px), calc(90vh - 160px));
}
}

You can test this in the following two examples and explore performance using DevTools.

- [Before, with `top` and `left` animation](https://codepen.io/web-dot-dev/full/gbpLqwa).
- [After, with `transform`](https://codepen.io/web-dot-dev/full/emNBxBr).

#### Chrome DevTools

1.  Open the **Performance** panel.
2.  [Record runtime performance](https://developer.chrome.com/docs/devtools/evaluate-performance/reference#record-runtime) while your animation is happening.
3.  Inspect the **Summary** tab.

If you see a nonzero value for **Rendering** in the **Summary** tab, it might mean your animation is making the browser do layout work.

![Image 3: The Summary panel shows 37ms for rendering and 79ms for painting.](https://web.dev/static/articles/animations-guide/image/the-summary-panel-shows-3-d8a0efc73229b.jpg)

The [animation-with-top-left](https://animation-with-top-left.glitch.me/) example causes rendering work.

![Image 4: The Summary panel show zero values for rendering and painting.](https://web.dev/static/articles/animations-guide/image/the-summary-panel-show-ze-6036893c491f8.jpg)

The [animation-with-transform](https://animation-with-transform.glitch.me/) example doesn't cause rendering work.

#### Firefox DevTools

In Firefox DevTools the [Waterfall](https://developer.mozilla.org/docs/Tools/Performance/Waterfall) can help you understand where the browser is spending time.

1.  Open the **Performance** panel.
2.  Start recording performance while your animation is happening.
3.  Stop the recording and inspect the **Waterfall** tab.

If you see entries for [**Recalculate Style**](https://developer.mozilla.org/docs/Tools/Performance/Scenarios/Animating_CSS_properties), that means the browser has to return to the start of the [rendering waterfall](https://developer.mozilla.org/docs/Tools/Performance/Scenarios/Animating_CSS_properties) to render the animation.

### Check for dropped frames

1.  Open the [**Rendering** tab](https://developer.chrome.com/docs/devtools/evaluate-performance/reference/#rendering) in Chrome DevTools.
2.  Enable the **FPS meter** checkbox.
3.  Watch the values while your animation runs.

Pay attention to the **Frames** label at the top of the **FPS meter** UI. This shows values like `50% 1 (938 m) dropped of 1878`. A high-performance animation has a high percentage, such as `99%`, meaning that few frames are being dropped and the animation looks smooth.

![Image 5: The fps meter shows 50% of frames were dropped](https://web.dev/static/articles/animations-guide/image/the-fps-meter-shows-50-e279493d08c47.jpg)

The [animation-with-top-left](https://animation-with-top-left.glitch.me/) example causes 50% of frames to be dropped

![Image 6: The fps meter shows only 1% of frames were dropped](https://web.dev/static/articles/animations-guide/image/the-fps-meter-shows-1-97f98fe03092a.jpg)

The [animation-with-transform](https://animation-with-transform.glitch.me/) example causes only 1% of frames to be dropped.

### Check whether an animation triggers paint

Some properties are more expensive for the browser to paint than others. For example, anything that involves a blur (like a shadow, for example) takes longer to paint than drawing a red box. These differences aren't always obvious in the CSS, but browser DevTools can help you to identify which areas need to be repainted, as well as other painting-related performance issues.

#### Chrome DevTools

1.  Open the [**Rendering** tab](https://developer.chrome.com/docs/devtools/evaluate-performance/reference/#rendering) in Chrome DevTools.
2.  Select **Paint Flashing**.
3.  Move the pointer around the screen.

![Image 7: A UI element highlighted in green to demonstrate it will be repainted](https://web.dev/static/articles/animations-guide/image/a-ui-element-highlighted-43b56111254fb.jpg)

In this example from Google Maps, you can see the elements being repainted.

If you see the whole screen flashing, or areas highlighted that you don't think should change, investigate further.

If you need to determine whether a particular property is causing painting-related performance issues, the [paint profiler](https://developer.chrome.com/docs/devtools/performance/reference#paint-profiler) in Chrome DevTools can help.

#### Firefox DevTools

1.  Open **Settings** and add a Toolbox button for [Toggle paint flashing](https://developer.mozilla.org/docs/Tools/Paint_Flashing_Tool).
2.  On the page you want to inspect, toggle the button on and move your mouse or scroll to see highlighted areas.

## Animate at the composite stage

Where possible, restrict animations to `opacity` and `transform` to keep animations on the compositing stage of the rendering path. Use DevTools to check which stage of the path is being affected by your animations.

Use the paint profiler to see if any paint operations are particularly expensive. If you find anything, check whether a different CSS property gives the same look and feel with better performance.

Use the `will-change` property sparingly, and only if you encounter a performance issue.
