# Stream badges

PNG badges supplied by the user from [Badger](https://nintle.github.io/Badger/).
The originals are packaged locally without image changes or runtime requests to Badger.

White video and audio SVG logos come from the community pack
[nuvio-minimalist-badges](https://github.com/sweatycab/nuvio-minimalist-badges)
listed by Badger. AAC, Opus, FLAC, MP3 and AI use simple local white wordmarks.
The white IMAX logo comes from the same pack and replaces only an exact IMAX tag
on the year/edition line, preserving the year and other edition text.
The local 2.0 and 2.1 wordmarks match the proportions and weight of the other channel badges.
DTS-ES combines the pack's DTS logo with an explicit ES label.
The entire source row above file size is tinted blue through CSS, including logos
and unrecognized text such as DVD or DVD Remux. Resolution, HDR and languages keep their own colors.
All assets are packaged locally; no external requests are made when viewing streams.

Only recognized whole characteristic lines in the compact Stremio panel use these assets.
Other stream information remains text. 2160p uses the equivalent 4K badge;
1080i, unknown sources and ambiguous lines retain their original text.
Video tags are recognized individually, preserving unknown tags beside known logos.
Audio codec logos require a fully recognized line. On other audio lines, standalone
known channel layouts still use their channel badge, while codec names and qualifiers
retain their original text. Unsupported channel layouts are never approximated.
File sizes use ordinary digits and units in the presentation; native addon text is preserved.
HDR10+ never becomes HDR10.
Language flags are never replaced.
