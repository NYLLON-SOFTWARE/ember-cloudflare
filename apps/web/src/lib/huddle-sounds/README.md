# A huddle's sounds

What a huddle plays besides the voices in it (`../huddle-sounds.ts`), where Slack's huddles have
sounds of their own.

| File | Plays | What it is |
|---|---|---|
| `joined.mp3` | As someone joins the huddle, the tab's own person included | Two marimba notes a fourth apart, rising (E5, A5): 0.7 s, mono |
| `left.mp3` | As someone leaves it, the tab's own person included | The same two notes, falling |
| `music.mp3` | To whoever is the only one in the huddle, from five seconds after they find themselves alone until someone joins them | Sixteen bars of slow jazz in D, at 84 beats a minute, for electric piano, bass, guitar and drums: 46 s, stereo, played on a loop. Its last bar rings out to silence, so the loop turns over on a rest |

All three were written for Ember and are under its license (`LICENSE`): nobody is owed a royalty or a
credit for them, and nothing in them is sampled from anyone's recording. FluidSynth played them
through the Fluid R3 General MIDI SoundFont, which Frank Wen released under the MIT license
(`FluidR3-GM-LICENSE.txt`).

A file plays as loud as it is, since a phone's browser plays an `<audio>` at no volume but the
phone's own. So each is levelled as it should sound: the two sounds peak at -13 dBFS, and the music
measures -30 LUFS, well under a voice. To change one, put another MP3 in its place under the same
name, levelled the same way. The music starts over from wherever its file ends, so a piece that ends
on a rest turns over cleanly.
