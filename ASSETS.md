# Assets

## Audio

Sound effects are synthesised in the browser (`src/game/sfxPlayer.ts`). Oscillators and a one-second noise buffer are created at runtime. No mp3, ogg, wav, or other sample is downloaded.

Bundled audio is 0 bytes. That is under the 2 MB budget for match audio.

There is no third-party recording to credit. The settings chime uses the same bus.

Music is two generated phrases, also with no downloaded file (`src/game/music.ts`). A calm lyre-and-drone bed loops every 8 seconds. A combat bed (frame drum, drone, aulos) is queued on the same clock, so the join has no gap. Fighting that involves you crossfades toward the combat bed; the calm bed returns after the fighting stops. The licence line on the title screen is the same sentence: sound and music are synthesised here, and no recorded soundtrack is downloaded.
