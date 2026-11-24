# Whistle → MIDI

Whistle the pitch, tap the rhythm on any key, get MIDI.

**Try it:** https://pf274.github.io/open-daw/ (every push to `main` is tested and published there by GitHub Actions; see `.github/workflows/deploy.yml`).

**Install it as an app:** OpenDAW is a progressive web app. In Chrome or Edge (desktop or Android), use **Settings → App → Install app** or the install icon in the address bar. On an iPhone or iPad, tap Share → **Add to Home Screen**. The installed app opens in its own window and starts without a connection; instrument samples work offline once they've been played. A service worker (`pwa/sw.js`, written into the build with its file list by the plugin in `vite.config.js`) caches the app, and each new version is picked up the next time you open it online.

## Run

```sh
cd open-daw
npm install
npm run dev        # http://localhost:5173 (the mic needs localhost or https)
npm test           # unit + component tests (Vitest)
npm run build      # static production build in dist/
```

## Workflow

1. In **Settings → Recording**, choose whether you'll **whistle** or **hum or sing**, then press **🎤 Mic** and try it. The readout next to it shows the detected note and what it maps to after transposition. (You can skip the mic check: **● Rec** switches the mic on by itself.)
2. Pick a layer, set the playhead (click the ruler), press **● Rec** or `R`.
3. After the count-in, whistle (or hum) and **tap any key once per note**. `Esc` stops.
4. Tap times set the rhythm. Each note's pitch is the average pitch heard over the whole note, from its tap to where it ends. Silence doesn't count, and neither do moments much quieter than the note itself, such as the fading tail of a whistle or background noise in a gap. Brief slides and slips, like the lowest and highest fifth of what's heard, are left out of the average too.
5. Edit in the piano roll, add layers, then **⬇ MIDI** exports every audible layer (SMF type 1, one track per layer, GM program and volume set).

If notes come out wrong, change the options under **Settings → Recording** and press **Re-align last take**. The raw pitch trace and taps are saved, so you don't need to record again. Each setting there says which tool it affects:
- *Note length*: until next tap (legato), how long you held the key, or fixed.
- *Pitch from*: **the whole note (average)**, the default, or **a window around the tap**, which takes the middle value heard in a short window at each note's start. Use the window if you slide between notes and want the start of each one. *Window start/length* set that window relative to the tap.
- *Tap offset*: shifts every tap (latency compensation).
- *Whistle / hum*: humming and singing are much lower than whistling (about 65–1000 Hz instead of 400–4500 Hz), so **hum or sing** makes the pitch detector listen lower. Each mode has its own transpose: whistling sits around C5–C7 and the default −12 drops it an octave, while a hum stays where you sing it (0). A take remembers which mode it was recorded in, so re-aligning keeps the right transpose.
- *Min pitch clarity*: raise it if breath or noise turns into wrong notes, lower it if notes are missed.
- *Record at … BPM* (**Settings → Recording**): record at your own tempo, for example slower for fast passages. While you record with ● Rec or 🥁 Tap rhythm, the playback, metronome and count-in all run at that tempo; the notes are placed by beat, so they land in place when the song plays at its own tempo. Ticking it starts at ¾ of the song's tempo.
- **Settings → Key & scale** snaps recorded pitches to a scale in a key (major, minor, pentatonic, blues, dorian, mixolydian), or to notes you pick yourself with **custom (pick notes)**. Choosing custom starts from the scale you were on, so you can add or remove single notes. **Chromatic** means no snapping. *Snap to scale* in the note menu uses the same notes.

## Patterns and the Song view

Everything you write in the note editor belongs to a **pattern**: a set of instrument layers with their notes, such as "Verse", "Chorus" or "Fill". The **Song view** arranges patterns into a song, so you can repeat and mix sections without copying notes.

To open a pattern in the editor, press **Edit** on it in the Song view's side panel, double-click one of its clips, or right-click a clip → **Edit pattern**. **🎼 Song** in the header takes you back to the arrangement.

**Song view**
- **Fold the track column** with **«** in its top-left corner to see more of the song: each row shrinks to a strip of its colour (striped for automation, faded when muted or switched off). Click a strip for that row's actions (mute, solo, colour, move, delete). **»** brings the names back, and the folded state is remembered in this browser. When the column is narrow, each row shows just its name and a **⋯** actions button, as on phones.
- **Tracks** are the rows. Name each one on the left and click the round swatch to colour it. **M**/**S** mute and solo a track (while any track is soloed, the others fade like muted ones), the **Vol** slider under the name sets its volume (applied before the track's automation, in playback and WAV export; undoable), ✕ (shown when you're on the row) removes it, and **+ Add track** adds one. Drag the divider at the right of the **Tracks** header to widen the names column (←/→ when focused; double-click resets); the width is remembered in this browser.
- **Rearrange rows**, pattern tracks and automation tracks alike: drag a row's **⠿** grip up or down (a line shows where it will land), or focus the grip and press **↑/↓**. So you can put an automation row right under the track it controls. Moves are undoable and saved.
- **Patterns** are listed on the left. **Click** one to select it (Enter works too), then **double-click** an empty spot on a track to place it, or **drag** it onto a track. It snaps to the **song snap**, 1 beat by default; change it in the Song view's top-left corner or in Settings (1 bar, 1 beat, ½ beat, ¼ beat, or off). Beats follow the time signature: eighth notes in 6/8, and three per bar in 3/4. Lanes and the ruler show a line for each beat. Double-click places the pattern you selected most recently: the one you clicked in the list, or the one whose clip you last clicked on the timeline. Each pattern shows its length and how often it's used.
- **Clips** are placed patterns. Each shows its notes in miniature and is as long as its pattern (rounded up to whole bars).
  - **Truncate** a clip by dragging its left or right edge. Dragging the right edge in cuts off the end. Dragging the left edge in cuts off the beginning, and the rest of the clip stays where it was. Edges snap to the song snap (hold Ctrl for fine adjustment). A clip can't be stretched past the end of its pattern or sound. Only notes that start inside the visible part play. A cut edge is drawn square; right-click → **Restore full length** undoes the truncation.
  - Drag to move along a track and between tracks, on the song snap grid. **Alt**-drag leaves a copy behind.
  - **Fine adjustment:** hold **Ctrl** (⌘ on a Mac) to ignore the snap and position things to 1/64 of a beat. This works while dragging clips, when dropping or double-click placing them, for automation points, and for Ctrl+click on the ruler. **←/→** nudge the selected clips one snap step (a beat with snap off), and **Ctrl+←/→** nudge them by 1/64 beat. (Shift still works for fine dragging, as before.)
  - Click selects and Shift-click adds to the selection. **Drag on empty space** in the tracks to draw a box: every clip it touches, patterns and sounds alike, across as many tracks as you like, gets selected. Hold **Shift** while you start the box to add to the current selection. The view scrolls when you drag near its edge. **Delete** removes, **Ctrl+D** duplicates right after the selection, **Ctrl+A** selects all.
  - **Ctrl+C / Ctrl+X / Ctrl+V** copy, cut and paste clips. Paste puts them at the song playhead on the same tracks, then moves the playhead to the end of the pasted block, so pressing Ctrl+V again lays another copy right after. Right-click an empty spot on a track for **Paste here**, which pastes at that spot starting on that track.
  - **Double-click** a clip, or press **Edit** in the pattern list, to open its pattern in the editor. Editing a pattern changes every clip of it.
  - Right-click a clip for **Make unique**, which gives that clip its own copy of the pattern so you can vary one occurrence.
- **Sections** label parts of the song (intro, verse, chorus, bridge…) in the strip under the ruler. Drag across the strip to mark one, or double-click it for 4 bars, then type a name. New sections are named Intro, Verse, Chorus… in a typical order. Each one lightly tints the lanes below it in its colour (click the small swatch to change it). Drag a section to move it, drag its edges to resize it, and double-click its name (or press Enter) to rename it. ✕ or Delete removes it. Right-click the strip for **Add section here** (4 or 8 bars), or right-click a section for Rename, Change colour… and Delete. On a touch screen, **double-tap** the strip to add a 4-bar section (a swipe scrolls the song), **long-press** the strip or a section for those menus, and double-tap a section to rename it. Sections can't overlap. They are saved with the project and can be undone.
- **▶ Play** (Space) plays the song from the song playhead; click the ruler to move it (to the nearest grid line). **⏮ Restart** (Home) moves the playhead back to the beginning and scrolls there. If the song is playing, it keeps playing from the start. In the pattern editor it does the same for the pattern. Ctrl+wheel zooms. The pattern editor keeps its own playhead.
- Recording happens in the pattern editor, so the Rec and Tap rhythm buttons only appear there.

**Sound effects**: put audio files (WAV, MP3, OGG, FLAC, M4A… anything your browser can decode, up to 50 MB each) on the song timeline.
- **+ Import sound…** under **Sounds** in the Song view sidebar adds files to the project. You can also **drop audio files from your computer** straight onto a track: they're imported and placed one after another from the drop point.
- Each sound in the list has a name, its length, how often it's used, a **volume** slider, **▶** to hear it, and **✕** to delete it along with its clips. Drag a sound onto a track to place it (it snaps to the song snap).
- **Sound clips** sit on the same tracks as pattern clips and show the waveform. They move, copy, paste, duplicate and delete like pattern clips. A sound plays at its own speed, so its clip gets longer or shorter in beats when you change the tempo. **Double-click** a sound clip to hear it.
- Sounds play through their track's automation (volume, pan, filters, reverb, effects…) and follow its mute/solo. Starting playback part-way through a sound plays it from that point. They're included in song **WAV** export, but not in MIDI.
- **Storage:** the audio stays in your browser (IndexedDB), and the autosaved project only keeps each sound's details. **Save** embeds the audio in the project file, so the file can be opened on another computer. A sound whose audio isn't in this browser shows as **audio missing**; open the saved project file to restore it.

**Automation tracks**: **+ Add automation** adds a row below the pattern tracks whose curve drives one effect over time.
- On the left: name, colour, **On/Off** (off keeps the curve but stops applying the effect; the row dims), the **effect** (Volume, Pan, Low-pass filter, High-pass filter, Reverb, and every insert effect: Echo, Distortion, Bitcrusher, Wah-wah, Chorus, Phaser, Tremolo), and **→ tracks**, a checklist of which song tracks it applies to (one or more).
- In the timeline: **double-click** to add a point (snaps to the song snap; hold **Ctrl** for fine placement), **drag** points to change time and value, and **right-click** a point or press **Delete** to remove it. Hover or drag to see the value ("−6.0 dB", "L 40%", "1.2 kHz").
- Each segment is a **bezier curve with horizontal handles**. Select a point to show its handles, then drag one sideways: further out eases more smoothly into and out of the point, all the way in makes a sharp corner. Before the first point and after the last, the value holds.
- **Effect automation:** the curve drives the effect's main control (shown in its name, e.g. "Distortion — drive", "Wah-wah — position"). The **⚙** next to the targets sets its other controls, and each adjustment is one undo step.
  - **Reverb:** the curve is the amount; ⚙ sets the room.
  - **Wah-wah:** the curve is a **wah pedal you draw**. Its automatic Rate starts off; turn it up in ⚙ for auto-wah on top.
- **Order:** when several automation tracks target the same track, their effects are applied **top to bottom**, in the order the rows appear (rearrange rows to change it). A custom synth's own effects and reverb come first.
- Automation plays in the song (each targeted track runs through the effect, sampled about 50 times a second) and in song WAV export. MIDI export ignores it for now. Everything is undoable and saved with the project.

**Pattern editor**: the sidebar's **Pattern** box switches between patterns, renames the current one, and makes a **+ New** pattern (same instruments, no notes) or a duplicate (⧉).

**Exports follow the view**: in the Song view, **⬇ MIDI / ⬇ WAV** export the whole song. Song MIDI has one track per instrument (layers sharing an instrument are merged, all drums on channel 10), so even a song with many patterns fits MIDI's 16 channels. In the pattern editor they export just that pattern, as before.

Older project files open as a single pattern placed at bar 1 of a new song.

## Phones and tablets

The app works on touch screens and narrow windows.

- **Layout:** on a phone-sized screen the side panel (patterns, layers, sounds) slides in from the left. Open it with **☰** and close it with ✕ or by tapping outside it. The toolbar is a single row that you swipe sideways. In the Song view, each track and automation row shows its name and a **⋯** button. The ⋯ menu has mute and solo (on/off for automation), **Change colour…**, move up/down, and delete. Small **M** / **S** / **Off** badges next to the name show what's switched on.
- **Piano roll:** drag a note to move it, or drag its right end to resize it. Drag empty space to scroll. Pinch with two fingers side by side to zoom time, or one above the other to make notes taller (up to 3×). The page itself never zooms: pinching always zooms the piano roll or song timeline. **Double-tap** adds a note, or deletes the note you tap. **Long-press** opens the menu that right-click opens on a computer. To box-select notes, tap empty space, then press again and drag (double-tap and drag). A tap without dragging clears the selection.
- **Recording:** a microphone works as usual. Instead of pressing a key, **tap the roll** on each note. Tapping the roll with a mouse works the same way.
- **Pick mode:** hold a key on the keyboard strip at the left to try that pitch, and keep holding to confirm it. The pick-mode box has buttons for previous and next note, octave (or drum bank), hearing the phrase, confirming, and finishing.
- **Song view:** swipe to scroll, and pinch with two fingers (or use **− / +** in the top-left corner) to zoom the timeline. Drag-and-drop from the side panel isn't available on touch screens. Instead, tap a pattern or a **sound** in the side panel (it closes so you can see the song), then **double-tap** a track to place it. Double-tap a clip to open it, drag clips to move them, drag their edges to shorten them, and long-press for the clip menu. A drag on empty track space scrolls; to box-select clips, tap, then press again and drag (double-tap and drag).
- On touch screens, buttons and drag handles are bigger, and the ✕ delete buttons stay visible because there's no hover.

Sounds can also be selected with a mouse: click a sound in the list, then double-click a track to place it.

## Light and dark mode

The **☀ / ☾** button at the right of the toolbar switches between light and dark. **Settings → Appearance → Theme** has three choices: **System** (the default), **Light** and **Dark**. System follows your computer's setting and changes when it does. Your choice is remembered in this browser.

## Time signature

**Settings → Time** sets the **time signature**: pick a preset (4/4, 3/4, 2/4, 5/4, 6/8, 7/8, 9/8, 12/8, 2/2), or set **Beats per bar** (1–16) and the **Beat unit** (half, quarter, eighth or sixteenth note) separately. It controls:

- bar lines and bar numbers in the pattern editor and the Song view, plus a beat line per counted beat (eighth notes in 6/8)
- the metronome, which clicks every counted beat and accents the first of each bar; the count-in counts those beats
- pattern lengths, which round up to whole bars, and so clip lengths; song snap counts these beats
- the position readout (bar.beat.hundredths) and the time signature written into exported MIDI files

Changing it never moves notes; bars just regroup them. It's saved with the project and can be undone. BPM always counts quarter notes, as in MIDI.

## Tap-rhythm + keyboard-piano mode (no mic)

1. Press **🥁 Tap rhythm** (or `T`). Tap any key on each note, then press `Esc`. Each tap becomes an empty note slot. Note lengths follow the same *Note length* setting. The new notes are **added** to the layer: its existing notes stay, and keep playing while you tap. Taps already count during the count-in, so you can tap pickup notes that lead into the playhead. Taps that would land before the start of the pattern are left out, so start further in for pickups at the very beginning.
2. Pick mode starts on the first slot. The keyboard is now a piano:
   - `A W S E D F T G Y H U J K O L P ; '` play C through F, an octave and a half. The home row is the white keys, the row above is the black keys. The letters also show on the roll's keyboard.
   - A **short press** previews the pitch and sets it on the current note.
   - **Hold for 0.75 s** to confirm and move to the next note. A bar fills while you hold. The time is adjustable under *Confirm hold* in the Settings tab.
   - `Z`/`X` shift the octave · `↑`/`↓` nudge a semitone · `←`/`→`/`Backspace` move between notes · click a note to jump to it · `Enter` confirms without holding · `Space` plays the last 4 beats through the current note · `Esc` finishes.
3. **🎹 Pick pitches** (or `P`) runs the same mode on any existing notes: the selection, or every note from the playhead onward if nothing is selected.

## Drums

Click **+ Add drums**, or choose *Drum kit* as any layer's instrument. On a drum layer:

- **🥁 Tap rhythm** (`T`) works in two parts, like the other instruments. First tap the rhythm with any key, then step through the hits and choose each one's drum with the pad keys (short press previews, hold to confirm):

  The kit has the **full General MIDI percussion set** (notes 35–81, 47 sounds), split into three **pad banks**. **Z / X** switch banks, the same keys that change octave on the piano. The roll's drum strip shows the current bank's keys (and the bank name in its corner). Within a bank, keys run left to right in note order, the same layout as the pick-mode piano, so the strip reads in order from bottom to top. **Space** is always the kick.

  | Key | Bank 1 · Kit | Bank 2 · Cymbals & Latin | Bank 3 · Extras |
  |---|---|---|---|
  | A | Kick | Tambourine | Bass drum 2 |
  | W | Rim | Splash | Whistle long |
  | S | Snare | Cowbell | Guiro short |
  | E | Clap | Crash 2 | Guiro long |
  | D | Snare 2 | Vibraslap | Claves |
  | F | Floor tom low | Ride 2 | Wood block high |
  | T | Hat | Bongo high | Wood block low |
  | G | Floor tom high | Bongo low | Cuica mute |
  | Y | Pedal hat | Conga mute | Cuica open |
  | H | Tom low | Conga high | Triangle mute |
  | U | Open hat | Conga low | Triangle open |
  | J | Tom low-mid | Timbale high | |
  | K | Tom high-mid | Timbale low | |
  | O | Crash | Agogo high | |
  | L | Tom high | Agogo low | |
  | P | Ride | Cabasa | |
  | ; | China | Maracas | |
  | ' | Ride bell | Whistle short | |

  When pick mode starts on a drum layer, it opens the bank of the first note.

- Drum passes **add to** the layer instead of replacing it. Turn on **Loop** to build a beat in passes (kick first, then snare, then hats). `Ctrl+Z` undoes a pass.
- To play and record drums live in one pass instead, tick **Live drum pads (one pass)** in the Settings tab. Tap rhythm then plays each pad as you hit it (Z / X switch banks mid-take), and the new hits stay selected so `Q` quantizes them.
- The keyboard strip shows drum names and their pad keys. "Change notes…" and 🎹 Pick pitches use the same pads to swap drums while keeping the timing.
- MIDI export puts drum layers on GM channel 10, so any GM player or DAW plays them as drums.

## Transpose (write in C, hear and export in another key)

**Song transpose** shifts playback and export by −12 to +12 semitones. Set it in **Settings → Playback**, or with the **Song key** stepper under right-click → **Transpose ▸**. Notes in the editor stay as written. The label shows the key change based on the *Key* setting, e.g. `+3 (C → E♭)`. Note previews while editing and pick mode also sound transposed, so everything you hear matches the export. Drum layers are never transposed. The exported file is named for the new key (e.g. `whistle-melody-Eb.mid`). The setting is saved with the project and can be undone.

## Slides (connect)

Select two or more notes that don't overlap, right-click, and choose **Connect**. Each note then slides into the next, and the roll draws a line joining them. The menu item is greyed out, with a tooltip saying why, when only one note is selected, when the notes overlap (chords included), or on a drum layer. **Disconnect** removes slides from the selected notes.

- **Playback / WAV:** a connected chain plays as one voice whose pitch glides from note to note. A gap between notes is filled by the glide. For back-to-back notes, the ~80 ms glide is centred on the boundary: half at the end of the first note and half at the start of the second, capped at half of either note. Starting playback partway through a chain still plays the rest of it.
- **MIDI:** slides are ignored, so connected notes export as plain notes.
- Slides survive copy/paste and duplicate when both ends are copied. Moving a note so that it starts before the note sliding into it, or deleting one end, drops that slide.

## Tremor

Select notes, right-click, and choose **Tremor…**. A dialog opens with two sliders:

- **Strength:** 1–100 cents either side of the pitch (100¢ = ±1 semitone).
- **Frequency:** 1–12 wobbles per second.

**▶ Preview** (or `Space`) plays just the selection with the current slider values, before anything is applied. It plays even if the layer is muted. **Apply** (`Enter`) sets the tremor on the selected notes. **Remove** clears it, and **Cancel** (`Esc`) closes the dialog. The dialog opens with the settings of any selected note that already has tremor.

Notes with tremor show a horizontal zig-zag. Its height follows the strength and its spacing follows the frequency at the current tempo and zoom. Tremor works inside slide chains (each note keeps its own setting), is audible in playback and WAV export, and is ignored in MIDI export. It isn't available on drum layers.

## Piano

Piano layers play **recordings of a real grand piano**: the free FluidR3 GM acoustic grand, with one recording per key.

- **Playing:** velocity sets loudness and brightness, and releasing a note drops the damper. Slides and tremor work too.
- **Downloads:** each note is a ~25 KB file, fetched when needed and cached. Once a piano layer exists, the notes it uses plus the middle of the keyboard (C3–C6) load in the background, so playback is instant. A note that isn't loaded yet plays the modelled piano once while it downloads. **WAV export** waits for every piano note it needs, so the file always has the real piano.
- **Modelled piano:** used offline, while loading, or with **Settings → Playback → Recorded piano** turned off (then nothing is downloaded). It's an additive model with slightly stretched overtones, high overtones dying faster than low ones, a quick first decay then a long ring, gently beating double strings, a hammer "thunk", and longer decays in the bass.

## Custom synth

Set a layer's instrument to **Custom synth** and the synth editor opens. You can reopen it later with **Edit synth…** on the layer card. Each custom layer has its own sound:

| Section | Controls |
|---|---|
| Oscillator 1 | waveform: sine, triangle, sawtooth, square |
| Oscillator 2 | waveform, level (0 = off), octave −2…+2, detune ±50¢ |
| Envelope | attack, decay, sustain, release, with a live graph of the shape |
| Vibrato & output | vibrato depth and rate, volume, and the **MIDI export instrument** (any of the 128 GM programs) |

- **Presets**, grouped in the dropdown. Use one as a starting point:
  - *Bass:* Fat bass, Acid bass (squelchy resonant sweep), Sub bass
  - *Leads:* Square lead, Supersaw lead, Chiptune, Wah pluck, Pluck
  - *Pads & keys:* Soft pad, Warm strings, Organ, Glass, Swell brass
  - *Voices & character:* **Cat meow** (a low-pass and a Frequency Amplifier that snap open, then sweep down together: "mm-aa-owww"), Choir ah (Frequency Amplifiers on the "ah" vowel's formants at ~700, 1220 and 2600 Hz), Hollow flute

### Effects tab

The synth editor's **Effects** tab holds a chain of up to **6 insert effects**, followed by a reverb.
- **+ Add effect…** adds one. Each card has **On**, **↑/↓** to reorder and **✕** to remove; effects run top to bottom.

| Effect | Controls |
|---|---|
| **Echo** | time, feedback (how many repeats), tone (repeats get darker), mix |
| **Distortion** | drive, tone, mix |
| **Bitcrusher** | bits (grit), downsample (lo-fi aliasing), mix. Uses an AudioWorklet; if that's unavailable it reduces bits only |
| **Wah-wah** | position (heel = dark … toe = bright), rate and depth (automatic wah; rate 0 = off), resonance, mix |
| **Chorus** | rate, depth, mix: two detuned copies spread left/right |
| **Phaser** | rate, depth, feedback, mix |
| **Tremolo** | rate, depth: pulsing volume |

- New presets: **Funky wah** (auto-wah into light distortion), **Dub stab** (echo), **Dreamy keys** (chorus + tremolo), and **Chiptune** now has a bitcrusher.

**Reverb** (always last in the chain):
- **Amount** (0 = off), **Decay** (room size, 0.2–8 s), **Tone** (dark ↔ bright) and **Pre-delay** (0–150 ms).
- The picture above the sliders shows the tail's shape.
- Effects and reverb run once per layer, after the notes, so echoes and tails ring across notes and cost the same however many notes play.
- They're used in preview, playback in both views and WAV export (which waits for the bitcrusher worklet and leaves room for echo and reverb tails). MIDI export sends the reverb and chorus amounts as CC91 / CC93 (General MIDI reverb / chorus depth).
- Soft pad, Warm strings, Glass, Choir ah and Hollow flute presets come with some reverb.

### Filters tab

The editor has two tabs: **Sound** (oscillators, envelope, vibrato, output) and **Filters**. A patch can chain up to **6 filters**, applied in order:

| Filter | Controls |
|---|---|
| Low-pass / High-pass | cutoff, resonance (dB peak at the cutoff) |
| Band-pass / Notch | centre, width (octaves) |
| **Frequency Amplifier** | centre, width (octaves), boost (0 to +24 dB). Amplifies a range of frequencies with a soft bell-shaped curve. |

- **Response graph** at the top: low frequencies on the left, high on the right (20 Hz–20 kHz, log scale), gain up/down in dB. Each filter has a faint coloured curve and the whole chain a bold one. A dashed curve shows the chain at its envelope peak when a filter sweeps. Drag a numbered handle left/right to move a filter; for a Frequency Amplifier, drag up/down to set its boost.
- **Live while previewing:** press **▶ Preview** with the Filters tab open and the graph animates in real time. A green curve shows the whole chain right now, ring markers follow each filter, and a badge shows the time into the current note. It follows the most recently started note, or slide chain, using the same envelope curves the audio engine schedules. It uses the settings the preview was started with, so it stays in step with the sound even if you move sliders meanwhile.
- **Per-filter envelope** with attack, decay, sustain and release, in one of two modes:
  - **Sweep frequency:** moves the filter by an amount of ±4 octaves at the envelope peak. This is the classic "wah"/"brass swell" filter sweep.
  - **Fade boost** (Frequency Amplifier only): the boost itself swells in, settles to the sustain level, and fades on release.
- Each filter has an **On** switch for quick A/B comparison, and ✕ to remove it.
- The graph uses the same filter formulas as the browser's audio engine, so it matches what you hear. Old projects with a single filter are converted automatically.
- **Preview** (`Space`) plays the selected notes on that layer, or a short test phrase if nothing is selected. It uses the unsaved settings.
- **Apply** (`Enter`) saves the sound as one undoable step. **Cancel** (`Esc`) discards your changes.
- **▶ Hear** next to *MIDI export instrument* plays the same notes with real samples of that General MIDI program, so you can hear roughly what the exported file will sound like. The samples are the free **FluidR3 GM** set from [midi-js-soundfonts](https://github.com/gleitz/midi-js-soundfonts), downloaded per note (~25 KB) the first time and cached after that. This needs an internet connection; if it's unavailable you'll see a message. Other players and DAWs may use a different GM sound set.
- Custom layers work with everything else: slides, tremor, song transpose, playback and WAV export. MIDI can't carry a synth sound, so the exported file names the GM instrument you picked instead.
- Patches are saved with the project. Switching a layer to another instrument and back keeps its patch.

## Audio export

**⬇ WAV** renders every audible layer offline with the same synths you hear, then saves a 16-bit stereo WAV. Slides, transpose, layer volumes and mute/solo all apply, with a 2 s tail for releases.

## Layout

- **Header:** tabs on the left, then the controls: 🎼 Song, Rec, Tap rhythm and Loop (pattern editor only), Play, Stop, Restart, Metronome, Undo/Redo, theme. Tempo (**BPM**) is in **Settings → Time**, and the **🎤 Mic** switch (with level meter and live note) is in **Settings → Recording**.
  - **File tab:** New, Open…, Save…, Export MIDI, Export WAV.
  - **Settings tab:** each section starts with a line saying what it's for. Time (tempo, time signature), Playback (song transpose, volume, recorded piano), Editing (note snap, song snap, new-note velocity), Key & scale (key, scale or custom notes), Recording (whistle / hum, mic, mic input, transpose, count-in; *Taps → notes* for ● Rec and 🥁 Tap rhythm; *Reading the pitch* for ● Rec only, with the trace and Re-align), Pick mode & drums (confirm hold, live drum pads), Appearance.
  - Click the open tab again to collapse the panel and give the roll more room. The choice is remembered in this browser.
- **Left:** layers and help. **Centre:** piano roll. **Bottom:** status, selection count, position, tempo and song transpose.

## Editing

| Action | How |
|---|---|
| Add / delete note | double-click empty space / a note |
| Move, resize | drag; drag right edge (Ctrl = no snap) |
| Duplicate by dragging | Alt-drag |
| Select region | drag a box, Shift-click, Ctrl+A, right-click → Select ▸ (in loop, from playhead) |
| Transpose | ↑/↓ (Shift = octave), or right-click → Transpose ▸ |
| Nudge | ←/→ by the snap value |
| Quantize | right-click → Timing ▸ Quantize… (dialog); `Q` repeats the last settings |
| Context menu | right-click anywhere in the roll; right-clicking an unselected note selects it first |
| Copy / cut / paste at playhead | Ctrl+C / X / V |
| Duplicate | Ctrl+D |
| Undo / redo | Ctrl+Z / Ctrl+Shift+Z |
| Loop region | Shift-drag the ruler |
| Zoom | Ctrl+wheel (time), Ctrl+Shift+wheel (pitch) |

Everything else is in the right-click menu: **Select ▸**, **Transpose ▸** (semitone/octave, snap to scale, song key), **Timing ▸** (Quantize… dialog with grid, strength, ends and preview; nudge; length = snap; legato; stretch ×2/×½), **Velocity ▸** (louder/softer, pp–fff), **Move to layer ▸**, plus Change notes…, Connect/Disconnect and Tremor…. The status bar shows how many notes are selected.

The project autosaves to the browser. **Save…/Open…** write and read JSON. **Save…** lets you choose the file name: in Chrome and Edge on a computer it opens the system Save window, so you pick the folder too (it starts where you saved last time). Other browsers and phones ask for the name and then download the file, and the browser decides where it goes, usually your Downloads folder. The name you last saved under, or the name of the file you opened, is suggested next time.

## Architecture

Vite + Vue 3. State is held in plain reactive modules, with no Pinia. Dependencies only point downward:

```
components/ (Vue UI)  ─┐
roll/ (canvas)        ─┼─→ engine/ (behaviour) ─→ stores/ (state) ─→ core/ + audio/
                       └──────────────────────────────────────────→
```

| Folder | What lives there | Depends on |
|---|---|---|
| `src/core/` | Pure logic: YIN pitch detection, tap→note alignment, scales, quantize, slides, tremor, MIDI writer, WAV encoder, note names | nothing (fully unit-tested) |
| `src/audio/` | Web Audio: shared context and clock conversions, instrument catalogue, synth voices, drum kit, per-layer buses | `core` |
| `src/stores/` | Reactive state. `project` (the saved document), `ui` (editor/session), `history` (undo), `view` (roll geometry), `persistence` (autosave) | `core`, `audio/instruments` |
| `src/engine/` | Behaviour. `transport` (look-ahead scheduler, loop anchors), `mic`, `recorder`, `pick` (keyboard-piano mode), `editing` (all note actions), `keyboard` (shortcut routing), `files` (export/save/load), `frame` (shared rAF loop) | stores, audio, core |
| `src/roll/` | Piano-roll `render.js` (canvas drawing) and `interaction.js` (mouse) | engine, stores |
| `src/components/` | Vue SFCs: AppHeader (tabs, view switch, transport), FileTab, SettingsTab, SongView, PatternList, PatternBar, TrackList/TrackItem, HelpPanel, PianoRoll, Rec/Pick overlays, ContextMenu + MenuList, BaseModal → Tremor/Quantize modals, StatusBar | everything above |
| `src/menus/` | Menus as data: `noteMenu.js` (piano roll) and `clipMenu.js` (song clips): items, submenus, steppers | engine, stores |
| `tests/` | `core.test.js` (pure logic), `editing.test.js` (stores + actions + pick mode + export), `app.test.js` (mounts the whole app in happy-dom) | |

Conventions:
- **Mutate state through the reactive proxies** (`project`, `ui`). The roll redraws and autosave runs on their own through deep watchers, so nothing needs to call `draw()` or `save()`.
- **Fast-changing values aren't reactive.** This covers the playhead, live pitch, hold progress and mic frames. Components read them per animation frame with `useFrameValue()`, and the canvas reads them in its frame callback.
- **Raw takes are `markRaw`'d** (thousands of pitch frames) to keep reactivity cheap. Use `setTake()`.
- **Undo** is snapshot-based. Call `pushUndo()` before a mutation you want undoable, or wrap selection edits in `edit()`.
- `transport` ↔ `recorder` and `mic` → `recorder` talk through hooks (`transportHooks`, `setPitchSink`) instead of importing each other.

Where to add things:
- **New instrument:** add an entry to `src/audio/instruments.js`.
- **Insert effects:** `audio/fx.js` holds one definition per effect: controls (which also drive the UI sliders), which control automation drives (`auto`/`autoMap`), and `create()`. Adding a definition adds it to the synth's Effects tab and to automation. `audio/fxChain.js` chains a layer's effects + reverb, and `audio/worklets.js` loads the bitcrusher's AudioWorklet from inline code.
- **Reverb:** `audio/reverb.js` has one convolution reverb unit with a generated, deterministic impulse response. It's used per layer via `busFor(id, gain, reverb)` and the song graph, and by Reverb automation, which drives its `wet` gain.
- **Sampled instruments:** `audio/piano.js` shows the pattern. The scheduler only uses samples already decoded (`peekSample`), requests missing ones in the background, and falls back to a synth. `engine/samples.js` preloads what the project uses. Tests block the network (`tests/setup.js`).
- **New synth control or preset:** add the field to `DEFAULT_PATCH` + `PATCH_LIMITS` (or a `PRESETS` entry) in `src/audio/customSynth.js`, map it in `patchToSpec()`, and add a slider to `SynthModal.vue`. Old projects pick up the default automatically.
- **New filter type:** add it to `FILTER_TYPES`/`FILTER_LABELS`/`TYPE_DEFAULTS` and its Web Audio node type in `customSynth.js`, plus its coefficients in `core/filterResponse.js` so the graph can draw it. `FilterCard.vue` shows controls based on `usesResonance`/`usesWidth`/`usesGain`.
- **Turning a layer into sound:** always go through `specFor(tr)` / `gmProgramFor(tr)` in `audio/instruments.js`; never read `INSTRUMENTS[tr.inst]` directly, or custom layers break.
- **New drum sound or pad key:** `DRUMS` and `playDrum` in `src/audio/drums.js`.
- **Data model:** `project.patterns` (each with `layers` → `notes`) and `project.song` (`tracks` = pattern rows, `automation` = automation rows, `clips` = `{ trackId, patternId | soundId, start }` in beats (use `clipLength()`/`clipTarget()` rather than assuming a pattern), `order` = display order of all rows as `'t:<id>'` / `'a:<id>'` keys; read it with `songRows()`/`orderedTracks()`). In code, `project.tracks` is an accessor for **the open pattern's layers**: the pattern editor predates the song view and reads it everywhere. Song rows are `project.song.tracks`.
- **Automation:** curve maths in `core/automation.js`, effects in `audio/effects.js` (add one entry to add an effect; effects return `{ input, output, param }` units, and `options` adds per-track settings like reverb's room), and editing plus the song audio graph (layer → song-track effect chain → master) in `engine/automation.js`.
- **Imported sounds:** metadata in `project.sounds` (`{ id, key, name, duration, vol, … }`). The bytes are in IndexedDB under `key` (`stores/soundStore.js`; `key` is unique across projects, ids aren't). `engine/sounds.js` handles import, delete, restore at startup, and embedding in saved files. `audio/soundBank.js` holds the decoded buffers and waveform peaks and schedules sound clips (`scheduleSoundClips`) for both playback and WAV export, through the song graph's `soundDest()`.
- **Song actions** (patterns, clips, song tracks, view switching) are in `engine/song.js`; song playback is the `'song'` mode of `engine/transport.js`; `playedLayers()` in `engine/files.js` lists what sounds where for both MIDI and WAV export.
- **New note operation:** add it to `ACTIONS` in `src/engine/editing.js`, then add an entry to `src/menus/noteMenu.js` (top level or inside a submenu) and/or a shortcut in `engine/keyboard.js`.
- **New saved setting:** add it to `DEFAULT_SETTINGS` in `stores/project.js`, plus a field in the right fieldset of `SettingsTab.vue`. Old saves pick up the default automatically.
- **New export format:** use `buildSong()` in `engine/files.js` for note data (mute/solo and transpose applied, slides dropped), or `renderSong()` for rendered audio.
- **Anything that turns notes into sound** goes through `scheduleTrack()` in `engine/voices.js`, so live playback, previews (`engine/preview.js`) and WAV export always match.
- **New per-note effect:** store it on the note (like `tremor` or `slideTo`), turn it into automation in `voices.js` → `playVoice(…, { … })`, and draw it in `roll/render.js`. `cloneNotes()` should copy any nested objects.
- **New dialog:** wrap it in `BaseModal.vue` (Esc/Enter/Space handled), use `usePreview()` for a Preview button, and add its open flag to `modalOpen()` in `stores/ui.js` so global shortcuts pause. `QuantizeModal.vue` is a short example.
- **New header tab:** add it to `TABS` in `AppHeader.vue` with a panel component.

`legacy/` holds the pre-Vite single-file version. Delete it once you've confirmed the new build works for you.
