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

Stremio window placement waits for a restored window to report `normal` before
applying bounds separately. It reads back the settled bounds and retries only on
mismatch or a transient update failure, at most five attempts. The browser's
minimum panel width is preserved, and Trakt is rechecked after panel placement.
These retries never repeat episode navigation or create an additional panel.
The original source state and normal bounds are saved in `storage.session` while
the panel is open, surviving service-worker suspension without retaining stale
window IDs across browser restarts. Closing the panel restores that state; repeat
episode clicks keep the initial snapshot. A closed source is never reopened.
Closing during placement defers restoration until the pending layout work ends.
New panels are created unfocused and anchored right using the last browser-measured
minimum width from local storage, then fitted before Trakt leaves fullscreen.

`settings.js`, `poster-layout-utils.js`, `trakt-bootstrap.js`, and `trakt-early.css` run at
`document_start` on Trakt. The bootstrap only prevents the native poster layout from
flashing before the main content script loads and only does so when the viewport can
preserve enough room for Trakt's responsive content. `settings.js` is not injected a
second time at `document_idle`.

## Shared Foundation

- `theme.css`: shared Trakt accent colors for content pages, settings, and new-tab
  focus states. Native Trakt color tokens take precedence on Trakt; other contexts
  use the matching blue-violet palette. Rating bands and source/size colors retain
  their semantic palettes.
- `settings.js`: definitions, defaults, local persistence, and live change events.
- `extension-protocol.js`: shared message names used by pages and the service worker.
- `dom-runtime.js`: serialized DOM updates, mutation filtering, route detection, and cleanup.
- `rating-utils.js`: the fixed rating palette, formatting, averages, parsing, and star fill ratios.
- `spotify-playback.js`: confirms playback from observed progress, distinguishes buffering,
  stalled playback and normal track completion, and ignores seeks as proof of playback.
- `season-rating-utils.js`: validates aired, non-special seasons from Trakt and builds a compact monotone chart without changing their percentages.
- `stremio-url.js`: construction and validation of Trakt/Stremio media URLs.
- `stremio-open.js`: one user action to one extension message, with no delayed navigation retry.
- `spotify-protocol.js`: shared Spotify message names and trusted origins for both frames.
- `trakt-imdb-resolver.js`: validates Trakt media paths and extracts IMDb IDs from official
  Trakt API responses for the service worker. It also validates movie/show ratings paths,
  IMDb/MyAnimeList/Letterboxd scores, vote counts and URLs from Trakt's `ratings?extended=all` response.
- `poster-layout-utils.js`: pure viewport thresholds for enabling the fixed poster without
  clipping Trakt's responsive content.
- `window-layout.js`: pure monitor selection and popup geometry calculations.
- `tmdb-utils.js`: image language selection, media configuration, sorting, and shuffle helpers.

Site wrappers (`trakt-runtime.js` and `imdb-runtime.js`) configure the shared DOM
runtime with the selectors and timing appropriate to each site.

## Trakt Modules

- `trakt-stremio-ui.js`: cached IMDb ID discovery through the service worker, Stremio links,
  episode title links, and Continue Watching.
- `trakt-ratings.js`: `/10` labels, rating colors, stars, external source selection, and IMDb Ratings launcher.
  IMDb, MyAnimeList and Letterboxd use the original scores, vote counts and exact URLs supplied by
  Trakt. Available tiles reproduce the native breakdown's styling and local SVG artwork,
  ordered IMDb, MyAnimeList, Letterboxd. MyAnimeList is already scored on 10.
  Letterboxd's native one-decimal display is doubled from `/5` to `/10`, without a denominator; all scores use the
  shared palette. The real links precede the native ratings control, whose source items
  are hidden while its breakdown arrow remains available. Heatmap remains beside it.
  Disabling the setting removes the cards and restores the original row. Missing
  sources are omitted, missing vote counts are hidden, and counts are never doubled.
  The service worker deduplicates pending lookups, caches successful results for six
  hours, and bounds failed requests with a 12-second timeout and a one-second retry cooldown.
  Rating message validation uses the current browser tab URL because a document URL
  can remain stale across Trakt's SPA navigation. Transient failures trigger at most
  two scheduled retries (1.5s and 4s), even on an otherwise idle page. A changed route
  or disabled setting prevents a retry from updating another fiche; genuinely absent
  ratings are cached without retrying.
- `trakt-season-chart.js`: the 236×110 season-chart card replacing the old Heatmap icon,
  as wide as two score cards plus their gap, with the full Peak/Low summary above the plot.
  It uses the same background, radius and visualization color as Trakt's ratings drawer,
  shows every rated, aired season as a point, and exposes the percentage on hover or
  keyboard navigation. Clicking opens the existing IMDb episode-ratings popup.
  It precedes the native drawer arrow after the score cards. Seasons are loaded
  independently from `/shows/:slug/seasons?extended=full` with a three-hour cache;
  loading or missing season data never blocks the IMDb/Letterboxd cards.
- `trakt-poster-layout.js`: the fixed poster rail, controls placement, sizing, and responsive cleanup.
- `trakt-soundtrack.js`: Spotify metadata, sidebar artwork, playback state, and finite autoplay retries.
  The sidebar artwork uses Trakt's native `--color-card-border-hover` outline and its
  title uses the shared accent text color. `trakt-soundtrack-library.js` reads only the
  current title's fresh, already-authorized `movieSoundtrack`/`showSoundtrack` query from
  Trakt's IndexedDB cache in a readonly transaction, without reading credentials or
  making another API call. Valid Spotify IDs are deduplicated before uniform selection.
  The complete catalog supplies a persistent summary player; native drawer row clicks
  control that player, so closing the drawer cannot destroy playback. Native controls
  are restored on cleanup. If storage is unavailable, bounded discovery falls back to
  the native summary behavior instead of blocking the page or inventing a catalog.
  The artwork keeps a full-size play/pause button, a decorative central playback
  indicator, and separate sibling previous/next buttons.
  The overlay and arrows appear only on artwork hover or keyboard-visible focus, using
  the same condition as the border; a mouse click's retained focus cannot keep them visible.
  Each player owns an in-memory shuffle history: initial and manual selections count toward the cycle, previous
  revisits history, and next walks forward history before drawing an unseen song.
  Exhaustion begins a new cycle without immediately repeating the current song.
  Natural completion invokes the same Next operation. The bridge recognizes Spotify's
  paused/zero-slider reset only after real progress close to the expected end; explicit
  pause commands reset that evidence. Coarse slider changes are timed from their last
  value change, so one-second monitoring does not confuse five-second ticks with seeks.
  An already-authorized background playlist may continue into the next embed via a
  trusted parent `continueInBackground` request. New background tabs receive no such
  authorization, and handoff, manual pause or a changed fiche prevents auto-advance.
  Playback ownership survives a foreground start sent to a ready embed before its
  first progress tick, as well as transient native pauses during tab visibility
  changes. Unexpected pauses or explicit stalls in the owning hidden tab get at
  most two explicit continuation attempts per foreground visit; a manual pause,
  handoff or different fiche cannot be recovered by that path.
  A single-song catalog disables skipping. Pausing/resuming never adds history, and
  changing tracks keeps the card mounted while fresh artwork loads.
  A selected embed is loaded eagerly, without the native-control mounting delay when
  the complete catalog is ready. Before sending Play to a ready embed, the foreground
  fiche requests ownership from the background worker. The worker pauses the other
  detail tabs and waits for their handlers before granting the start; overlapping
  requests grant only the newest claim. Ordered claim IDs reject delayed handoffs,
  and stale playback reports cannot reclaim ownership. Returning to a paused fiche
  resumes its existing iframe and position rather than loading a new track.
  A Pause label alone cannot complete autoplay. Matching embed/entity progress confirms playback.
  A 12-second visible stall allows at most two pause/resume recovery attempts on the same track.
  A frozen hidden progress display never triggers stall recovery: Chromium may stop
  visual updates while audio continues. Returning to the tab resets the monitoring
  grace period; genuine pause and end-of-track reports remain active in the background.
  Manual pauses, hidden-tab handoff, changed entities and route cleanup cancel retries.
  The Spotify bridge queues a play request until its controls exist, cancels it on pause,
  and samples progress once per second only while the player reports playback.
  Mounted controls that still ignore playback get at most four start commands, spaced
  by one, two and four seconds. Duplicate parent requests share that retry budget;
  manual pause and page teardown cancel delayed starts.
  Browser Web Audio autoplay policy can still refuse a cold-page start until real user
  activation. Playback requests do not bypass that browser policy; an arbitrary click
  elsewhere on the page must not trigger a soundtrack retry.
  An embed that has not sent READY after eight seconds gets one reload per selected
  entity, only while playback is requested in the visible tab. READY, manual pause,
  route cleanup and background handoff cancel that watchdog.
- `trakt-customizations.js`: official collection card placement and sidebar navigation cleanup.
- `trakt-imdb-cache.js`: deduplicated, expiring Trakt-to-IMDb lookup cache in `localStorage`.

All modules expose a frozen API on `globalThis`. Only `trakt.js` decides which
features run, based on `CineTraktSettings`.

`trakt-fanart.js` adds a decorative landscape background to the enlarged detail
layout, beginning at its existing content-left boundary after the poster rail.
It reads only the current film/show's native public summary query from IndexedDB
and accepts official media.trakt.tv fanart URLs. It makes no extra metadata API
request. It adds a fixed viewport layer directly to body so main's layout
containment cannot make it scroll with the content. A resize observer tracks
the content boundary. The native poster-color gradient remains unchanged under
the transparent artwork. A dark overlay and edge fades preserve contrast; narrow layouts
keep their native background. Route changes, disabled poster layout, missing
artwork and image failures restore the original treatment. Initial cache retries
are bounded and cancelled on cleanup; late loads cannot attach to another title.

## IMDb Modules

- `imdb-page.js`: dedicated IMDb episode-collector route detection.
- `imdb-trakt-button.js`: media-type and parent-series detection plus the Trakt button. Its local official dark-background Circle Mark (`assets/trakt-logo.svg`) is rendered as an image so host-page SVG styles cannot flatten it into a solid shape. CineTrakt's popup and browser icons use the square mark with an open clapper; sources and export details are documented in `assets/branding.md`.
- `imdb-ratings.js`: heatmap colors, averages, title-page ratings, season loading, and popup sizing.
  The popup measures all episode columns including AVG, converts CSS dimensions using
  the tab's browser zoom, and clamps the window to its monitor. Tables wider than the
  screen retain horizontal scrolling instead of clipping the final columns.

The ratings module reuses `rating-utils.js`; it does not carry a second color palette.

## Lifecycle Rules

- Each site has a main DOM observer. Features can add narrowly scoped observers for
  rating values, media embeds, or temporary collection preloading.
- Updates are serialized and debounced, with a one-second maximum wait during continuous
  page mutations. Immediate route/settings updates retain priority. A running update
  can request one queued rerun.
- Mutations created entirely by CineTrakt are ignored. Native Trakt containers remain
  observable when CineTrakt adds layout classes to them.
- Full setup happens on the initial load and real route changes, not every child mutation.
- Timers are finite retries for content that has not appeared yet. Permanent `setInterval`
  polling is not used.
- `pagehide` disconnects observers and clears pending timers or animation frames.
- Disabling a feature removes or deactivates its owned UI where the module supports live cleanup.
- The Stremio compact controller starts and stops when its setting changes, including
  activation after the page has loaded. Badge presentation is the sole stream text
  styling path; hidden native text does not receive redundant highlight ranges.
- Provider logos are local PNGs with a maximum dimension of 128 pixels for their
  20-pixel display size. Preserve their aspect ratio and transparency.
- Official Trakt IMDb lookups abort after 12 seconds so a stalled request cannot
  indefinitely block the per-title resolution cache.

## Storage

`chrome.storage.local` contains:

- `cinetrakt:feature-settings:v1`: normalized feature flags.
- `cinetrakt:tmdb-credential:v1`: TMDB API key or bearer token, readable only by extension pages.
- `watchOnStremioWebWindowId`: legacy-compatible Stremio popup window ID.
- `cinetraktStremioMinimumWidth`: last browser-accepted minimum panel width.

`chrome.storage.session` keeps `cinetraktStremioSourceState` only while a panel
owns a source window's original state. This survives worker suspension and is
removed on closure; the browser clears session storage on restart.

Trakt IMDb lookups use `localStorage`. Existing `watch-on-stremio` classes and keys
remain where changing them could break persisted state, CSS, or page integrations.

## Security Boundaries

Clicking the season chart opens Trakt's own Ratings drawer and appends an
extension-owned table without replacing Svelte-owned DOM. Right click retains
the browser's context menu. The old IMDb popup, its resize flow and message
handlers have been removed. The `imdbEpisodeRatingsPopup` settings key is retained
only to preserve the user's existing feature preference. Seasons are columns;
the average per season is the first row, followed by episodes.
The header stays visible while scrolling, and the drawer grows with the number
of seasons up to the available screen width. Missing episodes stay empty and
unrated episodes never become zeroes. A partial snapshot is labeled explicitly;
its averages are withheld until the entire table is available.

Season columns have a continuous subtle background and side borders. Their
headers use the native Seasons 100×150 poster size, its Season label and optional
season title. Poster links use Trakt's native `view=seasons` route with the exact
season number and no episode target. Posters come
from the same official `shows/{slug}/seasons?extended=full,images` request used by
Trakt, shared with the existing season-ratings cache. They are keyed by season
number, never response order. Only official media.trakt.tv season-poster URLs are
accepted and converted to the small thumb variant. Images load lazily and
asynchronously; absent or broken posters leave a neutral placeholder. Artwork
arrival never rebuilds the table or resets its scroll position and does not
delay the IMDb notes.

`trakt-season-cards.js` reads the current show's ID from its native summary
query and its counts from Trakt's already-loaded watched-shows query. This is a
bounded read-only IndexedDB transaction, with no credentials, writes, or extra
history requests. Only this show's per-season counts leave the helper. Full and
partial watched indicators use the same aired-episode thresholds as Seasons;
missing or expired history never invents a watched state. A single delayed
retry accommodates initial cache loading and is cancelled with the drawer.

Trakt's frame-src policy excludes IMDb, so this path uses no iframe. The worker
opens one temporary, inactive IMDb ratings tab per request. The dedicated
`cinetrakt_ratings_data=1` collector uses IMDb's native season and episode paging
controls, exports only season/episode numbers, public title IDs and ratings, and
does not alter user IMDb tabs. Results must originate from
the exact collector tab, matching IMDb URL, and top-level frame. Requests are
limited to top-level Trakt show pages; cancellation is scoped to the requesting
tab. Collection is bounded to 45 seconds and three concurrent jobs. Complete
snapshots are cached for ten minutes with at most eight entries.

Collector tabs close on completion, cancellation or timeout, provided the user
has not activated or navigated them. Their IDs are recorded in
`chrome.storage.session.cinetraktImdbEpisodeCollectors` so a worker restart can
clean up its own inactive collectors. Native title/content return on closure,
navigation, feature disabling or a normal click on Trakt's ratings arrow. No
framing policies or browser protections are modified. Retry is available only
when loading fails or provides an incomplete table.

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
