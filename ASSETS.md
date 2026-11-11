# Assets

## Audio

Sound effects are synthesised in the browser (`src/game/sfxPlayer.ts`). Oscillators and a one-second noise buffer are created at runtime. No mp3, ogg, wav, or other sample is downloaded.

Bundled audio is 0 bytes. That is under the 2 MB budget for match audio.

There is no third-party recording to credit. The settings chime uses the same bus.

Siege engines (M16-3) use three more synthesised voices, again with no sample: `catapult` (a winch creak, then the arm hitting its padded crossbar), `bolt` (a torsion-string snap) and `siegeHit` (a low crunch). A boulder or bolt sounds `siegeHit` where it lands, when its sim flight time is up. A ram sounds `siegeHit` on each blow. The 0 A.D. recordings in `public/audio/0ad/` are music only (see its `ATTRIBUTION.md` and `provenance.json`); no 0 A.D. sound effect is bundled, so there was nothing new to credit.

Music is two generated phrases, also with no downloaded file (`src/game/music.ts`). A calm lyre-and-drone bed loops every 8 seconds. A combat bed (frame drum, drone, aulos) is queued on the same clock, so the join has no gap. Fighting that involves you crossfades toward the combat bed; the calm bed returns after the fighting stops. The licence line on the title screen is the same sentence: sound and music are synthesised here, and no recorded soundtrack is downloaded.

## Models

Every unit, building and projectile is built in code from Three.js primitives with vertex colours. No model or texture file is downloaded.

The siege models (M16-3) are in `src/render/siegeModels.ts`:

- **Ram:** a covered ram with a swinging beam.
- **Catapult:** an onager with packed and set-up poses and an arm throw.
- **Bolt shooter:** a scorpion with packed and set-up poses and a string snap.

The siege workshop, boulder and bolt are in `src/render/buildings.ts` and `src/render/modelBridge.ts`. Impact dust is in `src/render/impacts.ts`. All are original work with no third-party source.
