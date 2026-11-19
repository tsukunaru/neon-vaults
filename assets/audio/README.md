# Audio assets

Neon Vaults intentionally has no downloaded music or sound files. The original soundtrack and all effects are synthesized at runtime with the Web Audio API in `src/audio.js`. This keeps the package small, avoids third-party copyright concerns, and lets the game pause/resume both audio buses precisely around ads and visibility changes.
