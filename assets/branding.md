# Branding assets

Source: https://app.trakt.tv/branding, Dark Background variants, retrieved 2026-10-24.

- `trakt-logo.svg`: official Circle Mark, used by the IMDb link to Trakt.
- `cinetrakt-logo.svg`: official square Logo Mark with a CineTrakt clapper added above it, as requested for this extension. The square's geometry and proportions are preserved.
- `icons/cinetrakt-{16,32,48,128}.png`: transparent PNG exports of `cinetrakt-logo.svg`, used by the extension manifest and toolbar action.
- `../favicon.png`: 256px export of the same CineTrakt artwork for the new-tab favicon.

The official mark background is `--purple-600: oklch(49% .217 289)`, exported as its 8-bit sRGB equivalent `#6438d0`. The emblem is white. Standalone files use explicit colors so IMDb, dark-mode extensions, and popup CSS cannot flatten the artwork's internal SVG paths.

PNG files are rendered from the SVG at high resolution and then resized to their target size. The popup uses the SVG directly and applies no hue filter.
