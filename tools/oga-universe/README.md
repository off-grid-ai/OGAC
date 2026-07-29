# OGA Universe — the control-plane poster

Generates the landing hero poster as a **true vector SVG**: live `<text>`, vector icons, and only the
device screenshots / headshots as embedded rasters. Vector matters here because the poster is dense —
it has to stay crisp at any size and any device pixel ratio, and be readable when opened full size.

```bash
python3 build.py ../../public/hero/control-plane-light.svg --theme light
python3 build.py ../../public/hero/control-plane-dark.svg  --theme dark
```

Requires ImageMagick (`magick`) for the raster downscales.

## Two real assets, not a CSS inversion

The poster depicts the console, and the console is itself light/dark. Inverting the light SVG with a
CSS filter would wreck the embedded device screenshots and turn the emerald into magenta — so the
palette is resolved at build time and each theme is its own file. Dark uses the console's own dark
tokens from `globals.css` (`#0a0a0a` background, `#141414` surface, `#34d399` emerald), so the poster
and the product it shows agree. All palette values live in `PALETTES` at the top of `build.py`.

## Why the inputs are vendored

`assets/` holds the headshots and app screenshots. They used to be read from `~/Downloads` while the
generator itself lived in a session scratchpad, which meant the poster could not be regenerated at all
once either moved. Both are now in the repo.

## Weight

~393 KB raw, ~260 KB over the wire, and only the active theme is fetched. ~95% of that is the nine
base64 rasters, each sized at about 2x its largest realistic display size (the laptop shot occupies
226px of the 1535px canvas, so ~452 device pixels at full width on a 2x screen). They were previously
embedded at up to 4x that. If it needs to get smaller, the rasters are the only place worth looking —
the vector markup is a rounding error.

## Known imperfection

The two embedded device screenshots are light-mode captures, so on the dark poster they read as two
bright screens. That is not wrong — a device screen IS bright — but dark-mode captures of OGAM/OGAD
would be better. Do not simulate it by darkening the PNGs; it muddies them.
