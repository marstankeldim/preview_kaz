# The Living Land

An interactive gallery of six Kazakhstan landscapes. Each photograph is
composited in WebGL with restrained motion from timelapse skies, water
displacement, mist, light, or the owner-supplied Kolsai animation.

## Run locally

```sh
python3 -m http.server 8407
```

Open [http://localhost:8407](http://localhost:8407).

The site has no build step or runtime dependencies. Serve it over HTTP rather
than opening `index.html` directly so browsers can load video textures
consistently.

## Implementation

- `index.html` contains the gallery, captions, and image credits.
- `style.css` provides the responsive gallery and fullscreen presentation.
- `app.js` lazily starts each WebGL portrait near the viewport and pauses video
  when it is out of view.
- `img/`, `video/`, and `masks/` hold the photographs, motion footage, and
  scene-specific mattes.
- The `*-v2.mp4` files are color-matched, 24 fps seamless loop masters. Their
  `*-1280.mp4` counterparts are selected below the 700px mobile breakpoint.
- Kolsai uses the supplied animation only inside a refined sky matte. The
  terrain, lake, stairs, and people come from a static 1920px photograph.
- Water motion is perspective-scaled and constrained to refined lake mattes so
  reflections move without bending shorelines, trees, or foreground objects.
- Add `?debug` to show mask alignment guides.
- Add `?reduce` to preview the still-photo reduced-motion experience.
- `?verify` loads the local capture harness in `verify.js`; it expects a capture
  listener on port `8408`.

Photograph and license links are listed in the page footer. Stock video files
must retain their original license records outside the public site.
