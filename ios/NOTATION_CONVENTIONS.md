# Groove Builder — Drum Notation Conventions (for the native engraver)

How the iOS `Engraver` should decide between **flags** and **beams**, group
notes, and place stems/rests. This matches what the web app produces via abcjs
today, so the native output looks the same. Where a rule is a stylistic choice,
the choice Groove Builder makes is stated explicitly — follow it for parity.

---

## 1. Note value → flags / beams

A note's *value* determines how many flags (when isolated) or beam lines (when
grouped) it has:

| Value | Flags (isolated) | Beam lines (grouped) |
|---|---|---|
| Quarter | 0 (plain stem) | n/a |
| 8th | 1 flag | 1 beam |
| 16th | 2 flags | 2 beams |
| 32nd | 3 flags | 3 beams |

**The core rule:** an *isolated* flaggable note gets **flags**; **two or more
consecutive flaggable notes in the same beat get joined by a beam** instead of
flags. You never mix — a note is either flagged or beamed, never both.

So a lone 8th note → stem + one flag. Two 8ths in the same beat → no flags, one
beam connecting their stems. A lone 16th → two flags. Two 16ths → double beam.

---

## 2. Beam grouping — beam per beat

**Beams group notes within one beat; beams break at every beat boundary.**

- The "beat" is the time signature's lower number: in **4/4** the beat is a
  quarter note; in **6/8** (compound) the beat is a dotted quarter (3 eighths).
- In 4/4, 8ths and 16ths beam within each quarter-note beat and a **new beam
  starts on each beat**. Do not beam across the beat line.
- Groove Builder deliberately uses **beam-per-beat** (not the alternative
  "beam all 8ths in each half-bar" style). It's the clearest for teaching and
  it's what the web app emits — match it.
- Triplet grids: the group is the beat's triplet (3 notes), drawn with a `(3`
  tuplet bracket/number and beamed as a group of three.

This is already how the grid maps: the engraver walks each beat as one group,
beams within the group, and starts a fresh group (fresh beam) next beat.

---

## 3. Isolated notes and the look-ahead duration model

Groove Builder does **not** place a note on every subdivision. A hit **lasts
until the next event in its voice** (capped at the end of its beat). So:

- A single hit on the first 16th of a beat with **nothing after it in that
  beat** is written as a **quarter note** (it fills the beat), *not* a 16th
  followed by rests.
- A hit on the "1" and a hit on the "&" (8th apart) render as **two 8th notes**
  (beamed if same beat).
- You therefore only draw an **isolated flagged 8th/16th** when the note is
  genuinely that short *and* alone in its beat — e.g. a single 16th on the last
  16th of a beat, or a lone 8th sitting by itself in a beat that is otherwise
  empty.

**Practical consequence for the engraver:** compute each note's value by
look-ahead (cells until the next hit in the same voice, within the beat). Then:
- run of ≥2 flaggable notes in the beat → **beam** them;
- a single flaggable note in the beat → **flag** it;
- a note that fills the whole beat → quarter (no flag/beam).

---

## 4. Leading rests

If a beat **starts with silence** before its first hit, draw the matching rest
up to that hit (8th rest, 16th rest, etc.), then the note. Rests are not beamed.
Mid-beat gaps do not usually produce rests, because the look-ahead model extends
the previous note's duration to the next event instead.

---

## 5. Stems and flag direction (drum-specific)

Stem direction is **fixed by voice**, not by pitch:

- **Hands voice** — hi-hat, ride, crash, snare, toms, cross-stick: **stems up**.
- **Feet voice** — kick and hi-hat foot: **stems down**.

Flags and beams follow the stem:

- **Up-stem** notes use **up-stem flag glyphs** (Bravura `flag8thUp` U+E240,
  `flag16thUp` U+E242, `flag32ndUp` U+E244); the flag sits on the **right** of
  the stem, hanging down from the top.
- **Down-stem** notes use **down-stem flag glyphs** (`flag8thDown` U+E241,
  `flag16thDown` U+E243, `flag32ndDown` U+E245); the flag sits on the right of
  the stem, rising from the bottom.
- Beams are drawn as filled rectangles between stem *ends* (top of up-stems,
  bottom of down-stems), one rectangle per beam line, spaced by ~1 staff space.

When a hand and a foot land on the same subdivision they stay in their two
separate voices (up and down), each with its own stems/flags/beams — they are
never merged into one stem.

---

## 6. Partial beams (beamlets)

Within one beamed beat-group that **mixes values** (e.g. an 8th then two 16ths,
or 16th–8th–16th):

- The **primary beam** (1 line) spans the entire group — every note in the group
  touches it.
- **Secondary beams** (the 2nd line for 16ths, 3rd for 32nds) span only the
  consecutive sub-runs that share that value.
- A note that needs a secondary beam but has **no same-level neighbour** on
  either side gets a **partial beam / beamlet** — a short stub of that beam line
  pointing **toward the beat** (toward the start of the group). Example: a 16th
  alone between two 8ths gets a single 16th-level stub.

---

## 7. Worked examples (4/4, quarter-note beat)

- **8th + 8th on beat 1** → two noteheads, stems up, **one beam** between them.
  No flags.
- **Single 8th on beat 1, rest of beat empty** → one notehead + **one flag**
  (isolated). (In the look-ahead model this only happens if the beat's second
  8th is empty *and* nothing else fills the beat, i.e. a hit exactly on the beat
  followed by an 8th of silence and then a new beat.)
- **Four 16ths on beat 1** → four noteheads under a **double beam**.
- **16th + 16th + 8th on beat 1** → primary beam across all three; secondary
  beam only over the first two 16ths; the trailing 8th has just the primary
  beam.
- **8th + 16th + 16th on beat 1** → primary beam across all three; secondary
  beam only over the last two 16ths; the leading 8th has just the primary beam.
- **Lone 16th on the last 16th of beat 1** (nothing else in the beat) → a single
  16th with **two flags**, preceded by a dotted-8th rest.
- **Triplet 8ths on beat 1** (Div=12) → three noteheads under one beam with a
  `3` above (tuplet), beamed as a group.

---

## 8. Mapping to the `Engraver` primitives

Per beat, per voice:

1. Read the beat's cells; by look-ahead assign each hit a value (8th/16th/…/
   quarter) and an x-position.
2. If the beat has **one** flaggable note → emit the notehead + a **flag glyph**
   (up/down per voice).
3. If it has **≥2** flaggable notes → emit their stems and one or more **Beam**
   primitives: one full-width primary beam, plus secondary beams over 16th/32nd
   sub-runs, plus beamlets for singletons (§6).
4. Quarter (beat-filling) notes → stem only, no flag/beam.
5. Emit leading **rest** glyphs for silence at the start of the beat (§4).
6. Stems: up for the hands voice, down for the feet voice; beams connect stem
   ends accordingly (§5).

Keep beam thickness ≈ 0.5 staff space and the gap between stacked beams ≈ 1
staff space, with stems long enough (≈ 3.5 staff spaces) that stacked 16th/32nd
beams clear the notehead.
