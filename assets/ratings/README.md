# Native Trakt rating artwork

These SVGs come from the native IMDb and Letterboxd tiles in Trakt's ratings panel,
retrieved from https://app.trakt.tv/movies/thunderbolts-2025?view=ratings on 2026-10-24.

- `imdb.svg` and `letterboxd.svg` retain the original logo geometry and colors.
- `mal.svg` reproduces the native MyAnimeList tile from https://app.trakt.tv/shows/frieren-beyond-journey-s-end?view=ratings (2026-10-25).
- `voters.svg` retains the native people icon, exported in the neutral secondary-text color.

CineTrakt uses local images so host-page SVG styles cannot flatten the artwork.
Tile spacing, background and radii use the same theme variables as Trakt's native
`RatingItem` tile. Scores, counts and destination URLs come from the official Trakt
ratings endpoint; only the Letterboxd score is multiplied by two for the /10 display.
