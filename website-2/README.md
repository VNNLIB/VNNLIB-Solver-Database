# vnnlib.org

The VNN-LIB website. Static files, served by GitHub Pages from `www.vnnlib.org`
(see `CNAME`). There is nothing to install to work on it: open `index.html` in a
browser.

## Layout

```
index.html              the whole site: anchored sections, and the solver
                        search as a panel that slides in over one of them
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
    solver-search.js      the solver search panel
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

## The solver search

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

### A panel, not a page

The search is not a separate page. It is the second of two panels inside the
news section: the news and the hand-kept solver table slide out to the left, the
search slides in from the right, and a Back button reverses it.

It belongs there because it is the same subject as the table it sits beside. The
table is what was reported by hand, the search is what the pipeline measured,
and sending a reader to another document to cross one to the other cost them
their place on the page and a full reload for content that was already one
section away.

What the implementation has to get right, in `js/site.js`:

- **The URL.** Opening pushes `#find-a-solver`, so the browser's own Back button
  reverses the slide, a reload comes back to the search, and it can be linked to.
  The Back button in the panel calls `history.back()` rather than sliding
  directly, so the two cannot get out of step.
- **Going back does not scroll.** Both panels are the same box in the same
  section, so when the search slides away the reader is already looking at what
  replaced it. Scrolling `#solvers` to the top of the viewport, which is what
  this did at first, moved the page *down* past the Latest News column to reach
  it, which reads as being thrown elsewhere for pressing Back. The one case that
  does need a scroll is a reader deep in a long results list: the overview is far
  shorter, so the section can end up off screen entirely, and `keepInView` only
  corrects when the box has actually left the viewport.
- **The height.** The two panels are very different heights, so the box is
  pinned to the outgoing height, released to the incoming one, and set back to
  `auto` when the slide ends. Skipping that last step leaves the box frozen at
  whatever it measured, and a search returning fifty rows overflows it.
- **Focus and the reading order.** The panel that is off screen carries `hidden`
  as well as a transform. A panel that is invisible but still focusable is how a
  keyboard user ends up typing into a form they cannot see.
- **The first fetch.** The database is only requested the first time the panel
  opens, since the search now shares a page with everyone who came to read the
  news.

`#find-a-solver` is also why the button is still an `<a href>` rather than a
`<button>`: it can be middle-clicked, copied and shared, and it works before the
script runs.

Note that the old `solvers.html` is gone. Anything linking to it from outside
the site now 404s; a one-line redirect stub would fix that if it matters.

### One row per solver

A solver with several releases is **one row**, showing the versions that matched
as a range: `1.0.0 to 2.0.0`, or `1.0.0, 2.0.0` when the matches are not
consecutive. The Details dialog is where the releases separate again, behind a
picker that switches between them in place.

The grouping is **not computed here**. `/search` returns it, in a `matches`
object beside the narrowed `versions` list, and the page only formats it. That
is not a preference about where code should live, it is the only place the
question can be answered: whether two matching releases are consecutive depends
on the releases between them, and a search response contains only the ones that
matched. Given `1.0.0`, `1.1.0` and `2.1.0`, nothing in the payload says a
`1.2.0` and a `2.0.0` exist and were rejected. A range drawn from that alone
would claim a measurement the page does not have.

So a run of matches is a range, a gap ends one range and starts another, and a
row says `2 of 3` beside the versions when some releases did not qualify. The
badge is shown only in that case: printing `3 of 3` on every other row would
bury the one that matters.

`Updated at` and the version sort both key off the **newest matching release**,
since a row no longer has one version or one date, and a solver is as current as
its newest usable release.

### Paging must not move the page

Two rules, both learned by getting them wrong:

**Nothing scrolls when you page.** The pager is already under the reader's eyes
and cursor, and the rows it replaces are above it, so the page stays exactly
where they put it. Scrolling the results to the top of the viewport reads as a
jump *downwards* whenever the toolbar was visible above them, which it usually
is. Opening the panel still scrolls, because that one was asked for.

**The rows stay put while the next page loads.** The skeleton is the right
loading state for a new search, where the answer could be anything, but swapping
it in to page means the box shrinks to the skeleton's height, the pager jumps up
under the cursor, and everything grows back a moment later. Paging instead dims
the current rows in place and sets `aria-busy`, so nothing moves and the button
just pressed is still where it was pressed.

**And the table is only ever as tall as the rows in it.** The skeleton draws a
few placeholder rows rather than a page's worth: sizing it to the page size drew
a ten-row box for a search with six results, which made the table look like it
had a fixed height and then collapse. `renderPage` also releases the pixel
height `js/site.js` pins on the sliding box, because that height was measured
from whatever was on screen when the slide began, which on first open is the
loading state.

### What runs where

**Everything that decides which solvers appear, and in what order, is the API's.**
The capability filters, the name box, the sort and the paging are all parameters
on one `/search` request, and the page renders what comes back without
reordering or slicing it.

That is not tidiness. The three cannot be separated: the API decides which ten
solvers a page holds, so sorting those ten in the browser only reorders that
page, which looks correct until the reader notices the top result is missing
because it was on page two. Filtering them locally leaves a page of ten minus
however many were dropped, and a total that counts solvers they cannot reach.

So every control on the panel ends in the same place, a request:

| | |
|---|---|
| Capability filters | the Search button inside the panel |
| Name | its own Search button beside the box, or Enter. **Never as it is typed** |
| Sort by | `sort=` |
| Per page | `limit=`, default 10 |
| Previous / Next / a page number | `offset=`, the only control that does not reset to page one |

Nothing searches on a keystroke. Searching per keystroke meant a request for
every prefix on the way to the word the reader wanted, results flickering
through answers to half-typed names, and no way to tell a finished thought from
a passing one. A button says when.

### The advanced filter panel is a mode

Open, the search is by capability. Closed, it is by name. Whichever is showing
is the one that applies, so a filter the reader cannot see never narrows their
results, and neither does a name they cannot see.

- **Closing the panel drops the capability filters** from the query without
  clearing the controls. Reopening it and pressing Search puts them back exactly
  as they were: the values are the form's own, and only whether they count
  changes.
- **While it is open the name box is disabled**, dimmed rather than hidden, so
  what was typed is still there when it becomes live again.
- **Toggling the panel re-runs the search**, because opening or closing it
  changes which criteria apply. Leaving the old rows up would show the answer to
  a question the controls no longer ask.
- The `vnnfilter` banner follows the same rule, so it only ever shows the command
  for what is actually applied.

The operator picker and the element type list come from `/vocabulary`, one
request on first open, not from the search response: a response is ten solvers
now, so building the picker from it would offer whatever those ten support and
omit the rest.

### The command banner

Whatever you assemble by clicking is shown as the equivalent `vnnfilter`
command, rebuilt on every change. The flag names are not derivable from the API's
field names, so `CLI_FLAGS` in `js/solver-search.js` maps them explicitly: the
API takes a list under `vnnlib_versions` where the package's flag is singular,
and the rest differ by hyphenation. If the package's CLI changes, that map is
what to update, or the page will display a command that does not run.

The name box is not in the command, because the package has no equivalent flag.

## Form controls

### The two pickers

The ONNX operators and the element types are both lists of names chosen from the
database, and they are the same control used twice.

**Not a text box.** Operator names are case sensitive and awkward (`LeakyRelu`,
`ConstantOfShape`, `ScatterND`), so a typed name is usually a typo, and a typo
returns an empty result that looks exactly like a real answer. Matching is
anywhere in the name, not only at the start, because the useful queries are
things like `pool` or `conv`; the matched span is shown in bold so a substring
hit does not look arbitrary.

**Not a `<select multiple>`.** It needs ctrl-clicking to add a second value,
gives no way to search fifty names, and shows the selection as highlighted rows
that scroll out of sight. Chips stay visible and each one is removable on its
own.

Element types are a picker for a further reason: a solver can be asked for
several at once, and they have no ordering between them, so there is nothing a
single choice could stand in for. `float64` does not imply `float32`.

Each selection is written into a hidden comma separated field, so the query
builder, the command banner and the API all see an ordinary text field. Commas
and repeats both mean AND to the API, so several chips mean "all of these".

#### An operator's element types

Each operator row lists the types it can be asked for, printed after the name
the way the standard's own output does:

```
Conv     float64 float32
Relu     float64 float32
MatMul
Gemm
Add      float64 float32 int64 int32
Flatten
```

Typing a colon switches the list to that one operator's types, so `conv:` offers
`Conv` (any element type) followed by `Conv:float32`, `Conv:float64` and the
rest, and the API is asked for `operators=Conv:float64`. The expansion only
happens once the reader has asked for it: offering every name crossed with every
type would be several hundred rows, most of them combinations no solver reports.

The types themselves come from `/vocabulary`, because working them out means
reading every release in the database. A name with nothing listed after it is
not restricted, which per section 5.4.1 means every element type its solver
reports, not none.

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
`index.html`; nothing else has to change.

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

Clicking a rail dot while the solver panel is showing puts the overview back
first, since every dot points at a section of it.

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
