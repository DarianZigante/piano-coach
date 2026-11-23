# Piano Coach

A practice page for the piano. It shows sheet music, listens through the computer's microphone, follows along as you play, waits when you pause, and marks the notes to fix.

**Open it:** https://darianzigante.github.io/piano-coach/ (use Chrome, and allow the microphone when asked)

**Report or request:** the button of that name opens a ready-written email with the note and a few details (piece, bar, what the listener heard, version). The page itself sends nothing.

## How it is put together

Everything runs in the browser. Nothing is recorded or sent anywhere.

| Path | What it is |
| --- | --- |
| `index.html` | The built page that GitHub Pages serves. Do not edit by hand. |
| `src/template.html` | Page layout and styles |
| `src/app.js` | Screens, sheet music, keyboard, microphone, end-of-run report |
| `src/engine.js` | Works out which piano notes are sounding from the microphone signal |
| `src/follower.js` | Compares what was heard with the score and decides right / wrong / wait |
| `src/pieces.js` | The built-in pieces and the note shorthand they are written in |
| `src/artifact/` | Extras for the Claude artifact version: a Download button and notes for whoever edits it |
| `build.js` | Combines the files above into `index.html`, and into `dist/artifact/index.html` for publishing as a Claude artifact |
| `test/`, `tools/`, `probe/` | Development checks (simulated performances, browser runs) |

Sheet music is drawn with [OpenSheetMusicDisplay](https://opensheetmusicdisplay.org) 1.9.0 (BSD-3-Clause), which is bundled into `index.html`.

## The artifact version

The same page is also published as a Claude artifact so that a copy can be duplicated and changed by chatting with Claude. The microphone is blocked inside an artifact, so that version adds a **Download Piano Coach** button; the downloaded file is opened in Chrome. To keep the file small enough to edit in a chat (about 110 KB instead of 1.3 MB), it loads the sheet-music library from a CDN instead of bundling it.

## Making a change

```
npm ci
node build.js
```

Commit the rebuilt `index.html` with the source change and push to `main`. The live page updates within a few minutes. The bottom of the first screen shows the version date, so it is easy to confirm which version is open.

The checks in `test/` need piano audio samples that are not stored in this repository.

## Known limits

- Two notes struck at the same instant exactly an octave apart cannot always be told apart by a microphone, so the upper note is assumed.
- Repeated notes over a held chord are the weakest case.
- The built-in pieces were written out from memory and have not been checked against a published edition.
