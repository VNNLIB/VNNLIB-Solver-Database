# vnnlib.org

The VNN-LIB website. Static files, served by GitHub Pages from `www.vnnlib.org`
(see `CNAME`). There is nothing to install to work on it: open `index.html` in a
browser.

## Layout

```
index.html              the home page, anchored sections
solvers.html            search the solver database by capability
bibtex.html             the 1.0 citation, linked from elsewhere
tailwind.config.js      the design tokens: palette, fonts, shadows
build.js                compiles css/tailwind.css, to drop the CDN
css/
    site.css              only what Tailwind cannot express
    tailwind.css          compiled, unused until you switch to it
    heading.css           Montserrat subset, as font family "SB Heading"
    body.css              Lato subset, as font family "SB Body"
js/
    site.js               the rail, page transition, scroll reveal, back to top
    solver-search.js      everything on solvers.html
    select.js             a styleable dropdown for every <select class="field">
    neurons.js            the masthead's neuron field
assets/                 images, favicons, the neuron artwork, the standard PDFs
```

## Styling

Tailwind, loaded from the Play CDN. Every colour, font and shadow comes from
`tailwind.config.js`, so a section is styled by composing utilities rather than
by adding a rule to a stylesheet. Repeated patterns (`.card`, `.badge`,
`.link`, `.field`) are declared once in an `@apply` block at the foot of
`index.html`, which keeps them reading from the same config.

What is not expressible as a utility stays as plain CSS in `css/site.css`: the
code box, the timeline down the left of the news list, the rail, the wordmark,
the replacement dropdown, and the open and close transitions on the filters
panel and the details dialog.

### Shipping a compiled stylesheet

The Play CDN compiles in the browser. That is convenient to work with and fine
for a site this size, but it logs a production warning to the console and adds a
small delay on first paint. `css/tailwind.css` is the compiled equivalent, 26 KB
minified, produced by:

```bash
node build.js        # needs node and network, for npx
```

To switch to it, replace these two lines in `index.html`:

```html
<script src="https://cdn.tailwindcss.com/3.4.16"></script>
<script src="tailwind.config.js"></script>
```

with one link, and delete the `<style type="text/tailwindcss">` block at the
foot of the file, which the compiled stylesheet already contains:

```html
<link rel="stylesheet" href="css/tailwind.css">
```

No markup changes otherwise. `tailwind.config.js` works unmodified either way:
it hands the config to the CDN through `window` and to the CLI through
`module.exports`.

`build.js` exists because of one wrinkle. The component classes (`.card`,
`.badge`, `.field` and the rest) are declared with `@apply` inside
`<style type="text/tailwindcss">` in `index.html`, which is how the Play CDN is
given such rules, and only the CDN understands that script type. Rather than
keep a second copy in a stylesheet, where the two would drift apart the first
time anyone edited one, `build.js` lifts the block out of `index.html` and
feeds it to the CLI. `index.html` stays the single source.

Re-run it after changing any class name or colour, or the compiled file goes
stale while the CDN version stays correct.

## solvers.html

VNN-LIB 2.0 requires a solver to report its own capabilities through a
`supports` command. Those answers are collected automatically by the
[solver database](https://github.com/VNNLIB/VNNLIB-Solver-Database), which
installs each registered solver, asks it the eleven mandatory queries, records
the answers and throws the solver away.

This page reads that database over HTTP and lets a visitor search it by
capability. Matching is done by the API rather than in the browser, because two
of the rules are easy to get wrong and a second implementation would eventually
disagree with the first:

- **Downward closure.** A solver reporting `POLY` also handles `BND`, `OUTC`
  and `LIN`. Each record carries a `satisfies` field holding that closure, so
  matching is a containment test and nothing more.
- **An empty operator type list means every element type the solver reports,
  not none.** Section 5.4.1 of the standard says so explicitly.

The endpoint is one constant at the top of `js/solver-search.js`. If the API
moves, that is the only line to change. When it cannot be reached the page
explains what happened and links to the database in the repository, rather than
sitting empty.

### What runs where

Two kinds of narrowing happen on this page, and they are deliberately split.

**Capability filters go to the API**, for the reasons above. Each change means a
request, which is why they are behind a Search button rather than live.

**The name box and the sort are local**, over the rows already fetched. A name is
not a capability, so `/search` has no field for it; sending one would be
inventing a filter the endpoint does not have, and it would mean a request per
keystroke. Sorting is the same: the result set is small enough to order in the
browser, and doing it server-side would add a round trip for no gain. Both are
therefore instant.

Pagination is local too, for the same reason. If the database grows to the point
where the whole thing is too much to hold, the natural change is `limit` and
`offset` on the API and paging becomes a request; nothing in the markup has to
move for that.

### The command banner

Whatever you assemble by clicking is shown as the equivalent `vnnfilter`
command, rebuilt on every change. The flag names are not derivable from the API's
field names, so `CLI_FLAGS` in `js/solver-search.js` maps them explicitly: the
API takes a list under `vnnlib_versions` where the package's flag is singular,
and the rest differ by hyphenation. If the package's CLI changes, that map is
what to update, or the page will display a command that does not run.

The name box is not in the command, because the package has no equivalent flag.

## Form controls

### The operator picker

ONNX operator names are case sensitive and awkward (`LeakyRelu`,
`ConstantOfShape`, `ScatterND`), so a typed name is usually a typo, and a typo
returns an empty result that looks exactly like a real answer. The field in the
advanced filters is therefore a picker over the names the database actually
contains.

Matching is anywhere in the name, not only at the start, because the useful
queries are things like `pool` or `conv`. The matched span is shown in bold, so
a substring hit does not look arbitrary. Chosen names become chips, and the
selection is written into a hidden comma separated field, so the query builder,
the command banner and the API all see an ordinary text field.

The suggestion list opens on focus, on input and on click. The click listener is
needed because the input keeps focus through a pick (the option's `mousedown` is
prevented, so the list does not vanish before the click lands), and clicking an
input that already has focus fires no `focus` event. After a pick the list stays
open, since picking one operator is usually the first of several.

### The dropdowns

A native `<select>` popup is drawn by the operating system, so no CSS reaches
inside it: it cannot be rounded, tinted or animated, and beside the operator
picker it looked like it belonged to a different site.

`js/select.js` enhances every `select.field` with a button and a listbox that
are page markup. The select itself stays in the form, keeps its name and its
value, and is still what the browser submits, so `FormData`, `form.reset()` and
every existing `change` listener keep working. Options are rebuilt through a
`MutationObserver`, so a select filled in later from the database is not left
showing an empty list.

The button carries the combobox role, the list carries listbox and option roles,
and the arrow keys, Home, End, Enter, Escape and Tab behave as they do in a real
select. What is lost is the OS picker on a phone, which is better on touch than
any of this. To give it back, delete the `<script src="js/select.js">` line in
`solvers.html`; nothing else has to change.

## Motion

Nothing moves for its own sake, and everything below is skipped entirely under
`prefers-reduced-motion`.

| | |
|---|---|
| Scroll reveal | Sections fade and lift in once, on `opacity` and `transform` only, so the browser can do it on the compositor without laying the page out again. Items in a list stagger by position. |
| The code example | Typed out the first time it scrolls into view, over a fixed total duration rather than a fixed rate. The box is given its finished height first, so nothing below it moves. |
| The command banner | Edited in place: the old and the new command are compared from both ends, and only the differing middle is deleted and retyped. |
| The filters panel | 420ms, on `grid-template-rows: 0fr → 1fr`, which animates to a height nothing has measured. |
| The details dialog | 220ms in and out. No backdrop blur: blurring the whole page per frame made scrolling behind the dialog stutter. |
| Dropdowns and suggestions | 200ms. |

## The footer crest

The UniGE crest is drawn in black and dark grey inside `assets/svg/unige.svg`,
which on the navy footer read as a hole. It is loaded as an `<img>`, so `fill`
does not reach inside it; `.img-footer` in `css/site.css` applies
`brightness(0) invert(1)` instead, which flattens every colour to black and then
turns it white, keeping the artwork's shape and transparency.

## Page transitions

Clicking an internal link shows a brief overlay before the next page loads.
These are static pages that usually arrive in well under a second, and in that
window the browser shows nothing, which reads as a click that did not land.

`MINIMUM_MS` in `js/site.js` is a floor on how briefly the overlay may appear,
so it cannot flash in and out and look like a glitch. It is not a timer the
navigation waits on: a page slower than that keeps the overlay until it arrives.
Raising it to a few seconds would make every page change feel slower than showing
nothing, so it is set to 450ms, about the shortest interval that still registers
as deliberate.

External links, anchors on the current page, downloads and modifier-clicks are
all left to the browser.

## The rail

The navigation is a fixed column of dots at the right edge, one per section, on
a vertical progress line. The filled part of the line shows how far down the
page the reader is, the dot for the section being read is lit, and hovering or
focusing a dot names it. On a touch screen there is no hover, so the label for
the current section is shown permanently.

Two observers in `js/site.js` drive it. Scroll position drives the fill, and an
`IntersectionObserver` picks the current section: among the sections on screen,
the one nearest the top of the viewport. The fill is not driven by which section
is current, because a reader halfway through a long section is halfway down the
page, and a fill that only moved at section boundaries would sit still for a
screen and a half and then jump.

The VNN-LIB wordmark is fixed and centred at the top, separate from the rail: it
is the way back to the top and to the home page, not a section. Its colour is
set in `css/site.css` rather than by a utility class, so the scrollspy cannot
take it away.

On `solvers.html` the rail's links point back at `index.html#...`, so it shows
progress and the current page but lights no dot.

## The masthead field

`js/neurons.js` draws drifting neurons that find each other, hold a link for a
while, and let go. Each one is a tinted copy of `assets/img/neuron.png`, a black
silhouette with the nucleus punched out; the tint is a `source-in` composite
rather than a filter, so the hole stays a hole and the gradient shows through.

It sits behind the text with `pointer-events: none`, stops entirely when the
masthead is off screen or the tab is in the background, and draws a single still
frame under `prefers-reduced-motion`.

## The 1.0 table

The hand-written table under **Known to support VNN-LIB 1.0** is separate on
purpose. Those solvers predate the `supports` command, so nothing about them
was measured: it was reported by hand in a pull request. Mixing the two would
present a claim and a measurement as though they were the same thing.

## What was removed

**Bootstrap 4, jQuery, jQuery Easing and Font Awesome**, along with the Start
Bootstrap Freelancer theme they came with. The page now makes no third-party
request except for Tailwind itself, and icons are inline SVG.

The theme's JavaScript existed to provide smooth anchor scrolling, an offset for
the fixed navbar, and scrollspy. The first two are native CSS
(`scroll-behavior`, `scroll-margin-top`) and the third is a short
`IntersectionObserver` in `js/site.js`.

**The fixed top bar**, replaced by the rail. With it went the `.nav-link` and
`.nav-link-mobile` component classes, the `spacing.nav` and `shadow.nav` tokens,
and the mobile menu toggle the bar needed.

**The team carousel and the library marquee.** Both were auto-scrolling strips
that had to stay in step with the reader's own horizontal scrolling, and the two
offsets are independent, so the loop came apart the moment anyone dragged the
track. The members and the libraries are plain grids again.

Deleted rather than left unlinked, since an unreferenced file is a question
someone has to answer later:

| | |
|---|---|
| `css/styles.css` | 196 KB, the Bootstrap theme |
| `js/scripts.js` | the theme's jQuery behaviour |
| `css/internal-style.css` | overrides that existed to fight Bootstrap's defaults |
| `css/canvas.css`, `css/progress-stepper.css` | styled elements no page has |
| `js/pdfviewer.js` | drew into a canvas no page has |
| `assets/img/tutorials/` | 1.8 MB, illustrations for tutorial pages that are not in this repository |
| `assets/img/logos/` | 336 KB, unreferenced |
| `assets/img/team/gc.jpg`, `assets/svg/neverlogo.svg` | unreferenced |

Two `<meta>` tags went with them: `msapplication-config` pointed at a
`browserconfig.xml` that is not in `assets/`, and the `msapplication-TileColor`
beside it only had meaning with that file.

The team photographs were re-encoded at 320px, since they render at 128px. That
alone was 5.5 MB down to 149 KB, `md.jpg` having been 4.9 MB on its own. With
the deletions above, `assets/` went from 8.8 MB to 1.1 MB.

## The standard PDFs

Both rows of the Documents table link to the GitHub releases, which are the
authoritative copies and always match their tag.

`assets/doc/` keeps local copies, currently unreferenced. One thing to know
before relying on them: **`standard-v2.0.pdf` is the wrong file.** It is byte
for byte identical to `standard-v1.0.pdf`: 14 pages, dated November 11th 2022,
titled *The VNN-LIB standard for benchmarks*. The real 2.0 document is
*VNN-LIB 2.0: Rigorous Foundations for Neural Network Verification*, from
December 2025. Anything served from that path would hand a reader the 1.0
document under a 2.0 name.
