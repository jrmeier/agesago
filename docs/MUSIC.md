# Recorded music

Ages Ago bundles three full 0 A.D. recordings: Sunrise and Peaks of Atlas in the
calm playlist, and Honor Bound in the battle playlist. The compressed MP3 stereo
files total 5,838,242 bytes (5.57 MiB), with 486.28 seconds of music. MP3 was
chosen for Chrome, Firefox, Safari and unbranded Chromium media support.
Chromium includes MP3 decoding without proprietary AAC codecs: see the
[upstream codec change](https://chromium.googlesource.com/chromium/third_party/ffmpeg/+/6ff143c61bc81049d730872b23e4993ca18080fc).
The title Credits panel
links the soundtrack, Wildfire Games, CC BY-SA 3.0 and the distributed attribution
and downloads. Attribution, individual performer credits, source revision and
checksums accompany the audio in `public/audio/0ad/`.

Playback uses four HTML audio streams (current and next per bed) routed through
Web Audio gain nodes into the existing music/master controls. It never calls
`decodeAudioData` or stores full-track AudioBuffers. Browsers own their streaming decoder/buffer memory; no JavaScript PCM
playlist is allocated. The application keeps exactly four media elements.
For comparison, decoding this entire playlist to stereo 48 kHz floats would
retain about 178 MiB of sample data. Streams preload compressed media, share
browser caching and are released when the match is disposed.

A two-second equal-power overlap joins tracks and repeated battle music. The
next slot starts before the current ends; equal-power gain curves run on the
audio clock, so delayed rendering cannot interrupt their ramps.
Timeupdate/ended events and a 200 ms timer keep transitions
working during pause or skipped render frames. Media failures or a locked device
leave the match operational; a pointer/key gesture retries playback. The original
local-player combat triggers, six-second hold, 2.5-second release, music/master
sliders and procedural effects remain in place.

To reproduce the encoding, download each pinned source from `provenance.json`,
then use FFmpeg with `-c:a libmp3lame -b:a 96k`, preserving the
track title, artist and license metadata. Do not replace audio without updating
its provenance and attribution.

Focused verification covers the combat envelope and playlist lifecycle in Vitest
(9 music tests), plus existing settings/SFX tests (20). The music Playwright
tests check real decoded PCM through an analyser, gesture startup including the
asynchronous title Start flow, both streamed beds, an audio-clock track join,
music/master mute controls, unchanged SFX gain, credits and stream release.
Chrome desktop/phone emulation and macOS WebKit passed all cases; bundled
Chromium with the default software WebGL configuration uses the same assertions.
This verification does not claim a physical mobile-device memory measurement.
