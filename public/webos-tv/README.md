# Hosted Frontend

This folder is the TV-optimized MoonTVPlus frontend that should be hosted under
the same MoonTVPlus origin as `/webos-tv/index.html`.

Why this shape:

- MoonTVPlus playback and authenticated API flows are most reliable same-origin.
- The webOS launcher can open this URL as a hosted app.
- MoonTVPlus authenticated TV API routes are not exposed for general cross-origin browser use, so this frontend should be deployed under the same MoonTVPlus origin.
