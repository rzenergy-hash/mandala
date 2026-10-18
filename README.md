# Mandala

An interactive generative artwork. At rest, a dense field of fine threads drifts
slowly across the canvas — a loose grey web that only hints at the form hidden
inside it. Move the cursor and hold it over a spot: the nearby threads gather and
align, and a delicate radial mandala slowly resolves into being where you point —
its fine guilloché curves sharpening on white, its edge melting softly back into
the threads around it. At the center, a luminous eight-pointed burst. Stop moving
and the mandala dissolves as the threads fly apart again. The work is never
finished and never gone — it is continually becoming.

**Concept:** permanence through continual transformation — order emerging from a
restless field, held only as long as attention rests on it.

## View it

Open the published page, then **move your mouse across the canvas** (or touch,
on mobile). Hover and hold to weave the mandala in; move to a new spot to weave it
there. A soft rustling sound responds to the threads — it starts on your first
interaction (browsers require a gesture before playing audio).

## How it works

Everything — the thread tones, the hidden mandala, the reveal — is derived from
**one image** (`assets/artwork.jpg`). Tens of thousands of short and long fibers
are importance-sampled from the picture (weighted by darkness and edge strength)
and given home positions on its lines. Because the source is fine light-grey
line-art on white, each fiber is coloured as a cool charcoal *ink* scaled by how
much darker than the paper its line is, so the threads read clearly against the
white. At rest they drift as a loose net; hover and hold gathers them home and the
crisp mandala dissolves in through a soft disc; stop moving and it fades as the
fibers scatter.

- `js/main.js` — config, the loop, dwell/reveal timing, the soft-edged dissolve.
- `js/fiber-overlay.js` — the fiber field: sampling, ink colouring, spring physics,
  the water-like ripple, and batched rendering.
- `js/interaction.js` — pointer/touch energy and velocity.
- `js/audio.js` — the procedural rustle sound (Web Audio, no files).
- `js/lib.js` — noise, RNG, and math helpers.
- `assets/artwork.jpg` — the source mandala (the only thing you swap to reskin it).

Built from the reusable **Woven** engine (a sibling piece), retuned for delicate
line-art on white: inked threads, a lighter atmospheric haze, and a larger crisp
reveal window so the fine curves resolve clearly inside the ring of gathered
threads.

## Run locally

The image is read directly from `assets/`, so **serve the folder over http**
(browsers block reading image pixels from a `file://` page):

```
cd mandala && python3 -m http.server 8000   # then open http://localhost:8000
```

Deploying to GitHub Pages (or any static host) works the same way with no changes.
Built with plain HTML, CSS, and JavaScript — no dependencies, no build step.
