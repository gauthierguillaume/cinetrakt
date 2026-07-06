# CineTrakt Project Audit

## Summary

CineTrakt is a compact Chrome Manifest V3 extension related to Trakt, IMDb, and Stremio. It injects content scripts on Trakt, IMDb title pages, and Stremio Web, and uses a background service worker to open or reuse a dedicated Stremio Web popup.

The current project has no build system, no package manager metadata, no automated tests, no extension options page, and no popup HTML. The application surface is implemented directly through JavaScript content scripts and the MV3 service worker.

The former working name, Watch on Stremio, is still present in technical identifiers such as CSS classes, dataset keys, storage keys, window names, and internal helper names. These names should be treated as compatibility-sensitive and must not be renamed mechanically.

## File Structure

```text
.
├── .gitignore
├── background.js
├── favicon.png
├── imdb.js
├── manifest.json
├── stremio.js
└── trakt.js
```

There are no source subdirectories in the initial project. This document adds the `docs/` directory for repository documentation only.

## Main Files

### manifest.json

Defines the Chrome Manifest V3 extension:

- Extension name: `CineTrakt`.
- Version: `0.4.51`.
- Background service worker: `background.js`.
- Content script on IMDb title pages: `imdb.js`.
- Content script on Trakt app pages: `trakt.js`.
- Content script on Stremio Web: `stremio.js`.
- Permissions: `tabs`, `system.display`, `storage`.
- Host permissions: `https://app.trakt.tv/*`, `https://web.stremio.com/*`, `https://www.imdb.com/*`.

### background.js

Manages the Stremio Web popup lifecycle and window layout:

- Stores the popup window ID in `chrome.storage.local`.
- Reuses an existing Stremio Web popup when possible.
- Creates a popup window when none exists.
- Calculates display bounds using `chrome.system.display`.
- Resizes the source Trakt window and positions the Stremio popup beside it.
- Handles messages of type `WATCH_ON_STREMIO_OPEN_WEB`.

### trakt.js

Main Trakt integration script. It:

- Detects Trakt media pages and Continue Watching contexts.
- Extracts IMDb IDs from Trakt HTML or external IMDb links.
- Builds Stremio deep links for movies, series, and episodes.
- Converts Stremio deep links to Stremio Web URLs.
- Sends popup-opening requests to the background service worker.
- Makes Trakt poster links or episode text open Stremio.
- Protects native Trakt links from accidental Stremio replacement.
- Caches show IMDb IDs in `localStorage`.
- Colorizes Trakt and IMDb rating values shown on Trakt.
- Adds a compact ratings toggle on media detail pages.
- Adjusts poster sizing on Trakt detail pages.

### imdb.js

IMDb content script. It:

- Adds a Trakt button next to the IMDb logo.
- Adds a Stremio button next to the Trakt/IMDb header area.
- Detects the IMDb title ID from the URL.
- Attempts to classify pages as movie or series.
- Opens native Stremio deep links from IMDb.
- Colorizes IMDb ratings, user ratings, episode heatmaps, histograms, and average episode ratings.
- Removes or hides some `/10` display fragments around ratings.

No MDB-specific script or host permission was found. The current implementation targets IMDb, not MDB.

### stremio.js

Stremio Web content script. It only activates when the URL contains `wos_stream_panel=1`. It:

- Detects Stremio detail routes.
- Finds Stremio stream or video list containers.
- Hides surrounding UI.
- Keeps only the useful stream or episode list visible in a compact popup panel.

### favicon.png

Extension icon used for all configured icon sizes and the extension action.

### .gitignore

Ignores dependencies, build output, logs, caches, local environment files, secrets, and common OS/editor artifacts.

## Current Trakt Behavior

The Trakt script runs on `https://app.trakt.tv/*` and limits its main work to pages that look relevant:

- Movie detail pages.
- Show detail pages.
- Episode detail pages.
- Progress pages.
- Home/dashboard pages that may contain Continue Watching.

For movie and show detail pages, the script searches the page for an IMDb ID using external IMDb links or a fallback regex over the HTML. It then builds a Stremio link and changes the main poster click behavior.

For episode pages and Continue Watching cards, the script needs the series IMDb ID, not an episode-specific IMDb ID. It derives the show slug from Trakt URLs, checks a local cache, fetches the Trakt show page, and falls back to a hidden iframe if needed.

Episode actions currently favor making visible `Sx • Ey` text clickable instead of injecting persistent episode buttons. Some older button-related helpers remain in the file and appear compatibility or cleanup related.

## Current IMDb / MDB Behavior

The extension currently targets IMDb title pages only:

- Match pattern: `https://www.imdb.com/title/*`.
- IMDb ID source: URL path segment matching `/title/tt...`.
- Trakt action: opens `https://app.trakt.tv/search/imdb?q={imdbId}` in a new tab.
- Stremio action: opens a native Stremio deep link.
- Series detection: looks for `.ipc-inline-list__item` text containing `TV Series`.

No MDB host permission, file, or URL handling was found. MDB is not currently implemented.

## Current Stremio Behavior

The Trakt script can open Stremio in two ways:

- Left click: Stremio Web popup through the extension background worker.
- Context menu / right click: native `stremio:///` protocol link.

For Stremio Web, the script converts native Stremio URLs to `https://web.stremio.com/#/detail/...` URLs and appends `wos_stream_panel=1` inside the hash query. The `stremio.js` script detects that flag and turns the Stremio page into a compact panel focused on streams or videos.

## Stremio Link Formats

### Movie

```text
stremio:///detail/movie/{imdbId}
```

Example shape:

```text
stremio:///detail/movie/tt1234567
```

### Series

```text
stremio:///detail/series/{imdbId}
```

Example shape:

```text
stremio:///detail/series/tt1234567
```

### Episode

```text
stremio:///detail/series/{seriesImdbId}/{encodedVideoId}
```

Where the raw video ID is:

```text
{seriesImdbId}:{season}:{episode}
```

Example shape before URL encoding:

```text
stremio:///detail/series/tt1234567/tt1234567:1:2
```

The current implementation uses `encodeURIComponent` for the video ID segment.

## Local Storage

### chrome.storage.local

`background.js` uses:

```text
watchOnStremioWebWindowId
```

This stores the Chrome window ID of the Stremio Web popup so the extension can reuse it.

### window.localStorage

`trakt.js` uses:

```text
watchOnStremio:traktImdbCache:v1
```

This stores a persistent cache mapping Trakt show slugs to IMDb IDs. Cache entries include an `updatedAt` timestamp and are treated as valid for about six months.

### Compatibility Keys And Names

Many technical identifiers still use `watch-on-stremio`, `watchOnStremio`, or `wos` prefixes. They are used in:

- CSS classes.
- Dataset flags.
- Style element IDs.
- Storage keys.
- Window names.
- Internal function and variable names.

These identifiers should be preserved unless a dedicated migration plan exists.

## Page-by-Page Analysis

### Trakt Movie Page

Detected with a path matching `/movies/{slug}`.

Behavior:

- Reads IMDb ID from the page.
- Builds `stremio:///detail/movie/{imdbId}`.
- Replaces the main poster link behavior.
- Opens Stremio Web on left click.
- Opens native Stremio on context menu.
- Colorizes ratings.
- Adds ratings toggle behavior.
- Adjusts poster sizing.

Fragile dependencies:

- `.trakt-summary-poster a`.
- `.trakt-summary-ratings`.
- Trakt rating DOM structure.
- Presence of an IMDb link or IMDb ID in the HTML.

### Trakt Series Page

Detected with a path matching `/shows/{slug}`.

Behavior:

- Reads or retrieves the series IMDb ID.
- Builds `stremio:///detail/series/{imdbId}` for the poster.
- Scans visible text nodes for `Sx • Ey` episode labels.
- Converts episode labels into Stremio episode links.
- Colorizes ratings and personal rating stars.
- Adjusts poster sizing.

Fragile dependencies:

- Episode text format.
- Trakt show page HTML.
- Rating and poster classes.
- Svelte rerender behavior.

### Trakt Season Page

There is no isolated season-page module, but season-like contexts are handled by scanning text and DOM around episode labels.

Behavior:

- Finds text matching `S n • E n`, `S n - E n`, or similar separators.
- Finds nearby episode context.
- Retrieves the show link from surrounding anchors.
- Resolves the show IMDb ID.
- Makes the episode text open the matching Stremio episode.

Fragile dependencies:

- Text format.
- Nearby show links.
- Card dimensions and visibility heuristics.

### Trakt Episode Page

Detected with a path matching:

```text
/shows/{showSlug}/seasons/{season}/episodes/{episode}
```

Behavior:

- Parses show slug, season, and episode from the URL.
- Retrieves the IMDb ID of the series.
- Builds an episode Stremio link.
- Makes the main episode poster open the exact Stremio episode.

Important detail:

- The code intentionally uses the series IMDb ID, not an episode IMDb ID.

Fragile dependencies:

- URL structure.
- `.trakt-summary-poster` variants.
- Stremio episode URL compatibility.

### Progress / Continue Watching / Home

Detected through `/progress`, home/dashboard paths, and visible section titles such as `Continue Watching`.

Behavior:

- Finds cards that look like Continue Watching items.
- Detects episode text.
- Finds the related show URL in the card.
- Retrieves or caches the show IMDb ID.
- Makes the episode text clickable.

Fragile dependencies:

- Exact section title text.
- Card structure.
- Presence of images and action buttons.
- Position-based section heuristics.

### IMDb Pages

Detected through `https://www.imdb.com/title/*`.

Behavior:

- Adds a Trakt button near `a#home_img_holder`.
- Adds a Stremio button near the same header area.
- Builds Stremio movie or series deep links from the IMDb ID.
- Colorizes rating values in several IMDb contexts.
- Adds an average column to episode heatmaps.

Fragile dependencies:

- `a#home_img_holder`.
- `.ipc-inline-list__item` containing `TV Series`.
- IMDb `data-testid` values.
- Heatmap table classes.

### Stremio Web

Detected through `https://web.stremio.com/*`, but the script returns immediately unless `wos_stream_panel=1` is present.

Behavior:

- Checks for detail routes in the hash.
- Finds stream or video list containers.
- Hides surrounding UI.
- Keeps the stream/video list visible as a compact panel.

Fragile dependencies:

- Hash routing format.
- `streams-list-container` and `videos-list-container` class fragments.
- Stremio Web rendering timing.

## Fragile Points

- Trakt DOM selectors such as `.trakt-summary-poster`, `.trakt-summary-ratings`, `.trakt-rate-now`, and `[data-star-fill]`.
- Text-based Trakt section detection, especially `Continue Watching`.
- Episode detection based on `Sx • Ey` text.
- Fetching and scraping Trakt HTML for IMDb IDs.
- Hidden iframe fallback for Trakt show pages.
- Stremio Web hash routing.
- Stremio Web class fragments for streams and videos.
- Chrome MV3 service worker availability.
- Popup creation, reuse, and resizing under Chrome window-management constraints.

## Technical Debt

- `trakt.js` is very large and combines media detection, Stremio URL building, popup messaging, DOM mutation, UI styling, ratings formatting, cache handling, and cleanup.
- `imdb.js` also combines header actions with rating visualization logic.
- Rating color palettes and parsing logic are duplicated between Trakt and IMDb scripts.
- Some old episode button helpers appear residual now that episode text linkification is the preferred behavior.
- The project has no automated tests.
- The extension relies heavily on third-party DOM structures that can change without notice.
- Many compatibility-sensitive Watch on Stremio names remain. They are not necessarily bugs, but they raise migration risk if renamed carelessly.

## Future Branch Plan

### audit/document-project-structure

- Objective: add or refine project documentation.
- Files: `docs/*`, possibly `README.md`.
- Risk: low.
- Priority: high.
- Tests: documentation review only.

### fix/trakt-dom-selectors

- Objective: harden Trakt selectors against current UI changes.
- Files: `trakt.js`.
- Risk: medium.
- Priority: high.
- Tests: movie, series, episode, season, Continue Watching.

### fix/stremio-launch-links

- Objective: verify and update Stremio native and web link behavior.
- Files: `trakt.js`, `imdb.js`, `stremio.js`.
- Risk: medium.
- Priority: high.
- Tests: Stremio Desktop, Stremio Web popup, right click native open.

### fix/episode-detection

- Objective: improve episode detection and show IMDb resolution.
- Files: `trakt.js`.
- Risk: high.
- Priority: high.
- Tests: season page, episode page, Continue Watching, missing IMDb ID.

### fix/movie-detection

- Objective: ensure Trakt and IMDb movie detection is reliable.
- Files: `trakt.js`, `imdb.js`.
- Risk: medium.
- Priority: medium.
- Tests: Trakt movie page, IMDb movie page, Stremio movie opening.

### refactor/shared-media-detection

- Objective: isolate shared parsing and URL-building logic.
- Files: likely new helper file plus `trakt.js` and `imdb.js`, subject to manifest constraints.
- Risk: medium to high.
- Priority: medium.
- Tests: all media opening flows.

### refactor/shared-rating-colors

- Objective: reduce duplicated rating color logic.
- Files: `trakt.js`, `imdb.js`, possibly a shared script if manifest loading allows it.
- Risk: medium.
- Priority: medium.
- Tests: Trakt ratings, IMDb ratings, IMDb heatmap.

### chore/cleanup-dead-code

- Objective: remove truly unused legacy code after validation.
- Files: mostly `trakt.js`.
- Risk: high.
- Priority: low.
- Tests: full manual regression suite.

## Manual Test Checklist

- Install the unpacked extension in Chrome.
- Confirm extension permissions and service worker load without errors.
- Confirm no errors appear on normal Trakt load.
- Test Trakt movie page poster left click to Stremio Web.
- Test Trakt movie page poster context menu / right click to native Stremio.
- Test Trakt series page poster opening.
- Test Trakt series page episode text opening.
- Test Trakt season page episode text opening.
- Test Trakt episode page exact episode opening.
- Test Trakt Progress page episode opening.
- Test Trakt Home / Dashboard Continue Watching episode opening.
- Test after page refresh.
- Test after scrolling through dynamic Trakt content.
- Test media with missing IMDb ID.
- Test already watched and not watched Trakt items.
- Test Trakt ratings coloring and ratings toggle.
- Test Trakt personal rating display.
- Test Stremio Web popup creation.
- Test Stremio Web popup reuse.
- Test Stremio Web compact stream panel.
- Test IMDb movie page Trakt button.
- Test IMDb movie page Stremio button.
- Test IMDb series page Stremio type detection.
- Test IMDb ratings coloring.
- Test IMDb heatmap and average column.
- Confirm no duplicate injected controls after repeated rerenders.

## Open Questions And Uncertainties

- The extension targets `app.trakt.tv`, not the classic `trakt.tv` domain. This appears intentional for Trakt V3, but should remain explicit.
- MDB is mentioned as a possible concern, but no MDB code or host permission currently exists.
- TMDB and TVDB IDs are not directly handled by the current code.
- The extension action has an icon and title, but no configured popup.
- Some old Watch on Stremio identifiers are probably legacy but still operationally important.
- Some button-injection helpers in `trakt.js` may be old code, but they should not be removed without regression testing.
- Stremio Web behavior may depend on the current v5 hash route and class names.
