# CineTrakt Architecture

## Goals

CineTrakt is a Manifest V3 Chrome extension that augments Trakt, IMDb, Stremio Web,
Spotify embeds, and the new-tab page. The code is organized around three rules:

1. Entry files coordinate features but do not implement them.
2. Pure logic lives in small modules that can be tested without Chrome or a DOM.
3. DOM work is event-driven, route-aware, and safe to run repeatedly.

## Entry Points

| Context | Entry point | Responsibility |
| --- | --- | --- |
| Service worker | `background.js` | Window lifecycle, trusted messages, and new-tab replacement |
| Trakt | `trakt.js` | Read settings and coordinate Trakt feature modules |
| IMDb | `imdb.js` | Coordinate the IMDb button and ratings modules |
| Stremio Web | `stremio.js` | Prepare and maintain the compact streams panel |
| Spotify embed | `spotify-embed.js` | Relay metadata and playback commands across the iframe boundary |
| Extension popup | `popup.js` | Edit feature settings and the local TMDB credential |
| New tab | `newtab.js` | Select and render random TMDB movie or series artwork |

`settings.js`, `poster-layout-utils.js`, `trakt-bootstrap.js`, and `trakt-early.css` run at
`document_start` on Trakt. The bootstrap only prevents the native poster layout from
flashing before the main content script loads and only does so when the viewport can
preserve enough room for Trakt's responsive content. `settings.js` is not injected a
second time at `document_idle`.

## Shared Foundation

- `settings.js`: definitions, defaults, local persistence, and live change events.
- `extension-protocol.js`: shared message names used by pages and the service worker.
- `dom-runtime.js`: serialized DOM updates, mutation filtering, route detection, and cleanup.
- `rating-utils.js`: the fixed rating palette, formatting, averages, parsing, and star fill ratios.
- `stremio-url.js`: construction and validation of Trakt/Stremio media URLs.
- `stremio-open.js`: one user action to one extension message, with no delayed navigation retry.
- `spotify-protocol.js`: shared Spotify message names and trusted origins for both frames.
- `trakt-imdb-resolver.js`: validates Trakt media paths and extracts IMDb IDs from official
  Trakt API responses for the service worker.
- `poster-layout-utils.js`: pure viewport thresholds for enabling the fixed poster without
  clipping Trakt's responsive content.
- `window-layout.js`: pure monitor selection and popup geometry calculations.
- `tmdb-utils.js`: image language selection, media configuration, sorting, and shuffle helpers.

Site wrappers (`trakt-runtime.js` and `imdb-runtime.js`) configure the shared DOM
runtime with the selectors and timing appropriate to each site.

## Trakt Modules

- `trakt-stremio-ui.js`: cached IMDb ID discovery through the service worker, Stremio links,
  episode title links, and Continue Watching.
- `trakt-ratings.js`: `/10` labels, rating colors, stars, source toggle, and IMDb Ratings launcher.
- `trakt-poster-layout.js`: the fixed poster rail, controls placement, sizing, and responsive cleanup.
- `trakt-soundtrack.js`: Spotify metadata, sidebar artwork, playback state, and finite autoplay retries.
- `trakt-customizations.js`: official collection card placement and sidebar navigation cleanup.
- `trakt-imdb-cache.js`: deduplicated, expiring Trakt-to-IMDb lookup cache in `localStorage`.

All modules expose a frozen API on `globalThis`. Only `trakt.js` decides which
features run, based on `CineTraktSettings`.

## IMDb Modules

- `imdb-page.js`: ratings-popup route detection.
- `imdb-trakt-button.js`: media-type and parent-series detection plus the inline Trakt SVG button.
- `imdb-ratings.js`: heatmap colors, averages, title-page ratings, season loading, and popup sizing.

The ratings module reuses `rating-utils.js`; it does not carry a second color palette.

## Lifecycle Rules

- A site has one `MutationObserver`, owned by its runtime or its dedicated panel controller.
- Updates are serialized and debounced; a running update can request one queued rerun.
- Mutations created entirely by CineTrakt are ignored.
- Full setup happens on the initial load and real route changes, not every child mutation.
- Timers are finite retries for content that has not appeared yet. Permanent `setInterval`
  polling is not used.
- `pagehide` disconnects observers and clears pending timers or animation frames.
- Disabling a feature removes or deactivates its owned UI where the module supports live cleanup.

## Storage

`chrome.storage.local` contains:

- `cinetrakt:feature-settings:v1`: normalized feature flags.
- `cinetrakt:tmdb-credential:v1`: TMDB API key or bearer token, readable only by extension pages.
- `watchOnStremioWebWindowId`: legacy-compatible Stremio popup window ID.
- `cinetraktImdbRatingsWindowId`: IMDb Ratings popup window ID.

Trakt IMDb lookups use `localStorage`. Existing `watch-on-stremio` classes and keys
remain where changing them could break persisted state, CSS, or page integrations.

## Security Boundaries

- The service worker accepts Stremio-open requests only from `https://app.trakt.tv/`.
- Trakt-to-IMDb lookup requests accept only `https://app.trakt.tv/` senders and exact movie or
  show detail paths before querying `https://api.trakt.tv/` with Trakt's public web client ID.
- Stremio destinations must pass `isStremioWebUrl` and contain a valid IMDb detail route.
- Spotify messages are accepted only from the expected iframe window and Spotify origin.
- The TMDB credential is never inserted into content pages or committed to the repository.
- External links opened by CineTrakt use `noopener`/`noreferrer` where applicable.

## Adding A Feature

1. Add its default and popup definition in `settings.js`.
2. Put pure transformations in a standalone testable helper.
3. Put site-specific DOM behavior in a dedicated feature module.
4. Expose a small frozen API such as `update`, `setEnabled`, or `cleanup`.
5. Load dependencies before the entry point in `manifest.json`.
6. Let the site entry point coordinate the module.
7. Add unit tests and an architecture guard for important invariants.
8. Run `npm test`, `npm run check`, and `git diff --check`.

## Verification

The automated suite covers rating bands, route parsing, URL construction, request
validation, cache behavior, settings failures, TMDB image preferences, monitor layouts,
and module boundaries. DOM selectors still depend on third-party sites, so releases also
require manual checks on representative Trakt, IMDb, Stremio, Spotify, and new-tab flows.
