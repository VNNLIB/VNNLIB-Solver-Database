# vnnlib.org

The VNN-LIB website. Static files, with nothing to install to work on them:
open `index.html` in a browser.

## Layout

```
index.html              the whole site: anchored sections, and the solver
                        search as a panel that slides in over one of them
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
assets/                 images, favicons, the standard PDFs
```

## Styling

### The content column and the type scale

Every section puts its contents in one `.shell`. It is **70% of the viewport from
`lg` up, with a 45rem floor and a 76rem cap**, and full width less a 1.5rem
gutter below that. A share of the screen rather than a fixed width, because a
fixed 1152px column is most of a 1280 laptop and reads as edge to edge. The floor
matters as much as the share: 70% of 1024 is 717px, about as narrow as the filter
grid and the results table can work in, so under roughly 1030 the floor holds the
column at 720px. The cap stops the lines growing unreadably long on a wide
monitor.

| Viewport | Content |
|---|---|
| 1024 | 720 |
| 1280 | 896 |
| 1366 | 956 |
| 1440 | 1008 |
| 1740 | 1216, the cap |

Two modifiers. `.shell--narrow` holds a single column of prose to a 48rem
measure, which the masthead heading uses. `.shell--wide` is 90% with an 88rem
cap, used by the team, which is five portraits abreast and is the one section
that wants the room.

### The type scale

Two steps below where it started. Body copy is 0.875rem, section titles
1.25/1.5rem, the masthead heading tops out at 1.875rem, card titles are 1rem, and
the code example is 0.8rem, chosen by arithmetic rather than by eye: its longest
line is 52 characters, which at 0.8rem is 399px against the 416px the box gets
inside a two-column grid on a 1280 screen, and 0.85rem would have overflowed and
scrolled sideways.

Form fields are the exception at `text-base sm:text-sm`. Anything under 16px in
an input makes iOS zoom the page when it is focused, so they stay at 16px on a
phone and come down on a real pointer.

### Row and control heights

A row is as tall as the tallest thing in it, so the sizes above only take effect
if nothing in the row is quietly taller. Two places where something was.

The results table: the Details button was `px-3 py-2 text-sm` in a cell with its
own `px-4 py-3`, which made the button, not the text beside it, set the height of
every row. It is now `px-2 py-0.5 text-xs` in an ordinary `.table-td`.

The toolbar: the buttons were `py-2.5` against the fields' `py-2`, so the flex row
was four pixels taller than the inputs in it and the buttons sat proud of them.
Everything in that row is now one height. The search panel also had an emptied
`<p>` left behind when the explanatory copy came out, still holding a line box and
a 1.5rem margin at the top of the panel.

### The dropdown popup, and why it was the odd one out

`<select>` is replaced by a styleable dropdown (see *Form controls*), and the
replacement is the one control whose popup is not built from utilities: the button
takes `.field`, the panel is hand-written CSS in `css/site.css`, and the wrapper
deliberately does not take `field`, so the panel has nothing to inherit a size
from. It sat at 1rem while everything around it came down, which made every
dropdown a step larger than the control that opened it. `.select__panel` now
mirrors `.field` exactly, 1rem below `sm` and 0.875rem above, and
`.select__option` inherits from the panel so there is one number to change. The
two are coupled by hand: change `.field`'s size and this has to follow.

### What the Play CDN cannot be trusted with

Tailwind is loaded from the Play CDN, which compiles in the browser, and two
things went wrong there that the CLI build did not catch, because the CLI is a
different compiler run offline.

An **arbitrary value containing a comma inside `@apply`**, which is how `.shell`
was first written (`lg:w-[max(70%,45rem)]`). When the in-browser compiler trips
on one rule it does not lose that rule, it loses the whole `@layer components`
block, which takes `.field`, `.field-label`, `.card` and `.table-td` with it. The
advanced filters are the densest user of those, so a failure shows up there first
as a wall of unstyled native controls. No `@apply` rule in this file contains a
bracket now, and the column widths are plain CSS in `css/site.css`.

**Ordering between breakpoint variants**, which is what `sm:grid-cols-2
lg:grid-cols-1` depends on: it is only correct if the `lg` rule is emitted after
the `sm` one. The CLI sorts by breakpoint; the CDN orders by what it finds, so
the groups stayed two across above 1024 when they should have gone to one.
`.filter-grid` states a range instead, one column by default and two only between
640 and 1024, and a range has no order to get wrong.

The rule of thumb: utilities in class attributes are fine, and so is `@apply`
with ordinary utilities. Anything whose correctness depends on the compiler's
output order, or on it parsing something unusual, belongs in `css/site.css`.

### Counting grid columns against the content, not the breakpoint

The filter grids used to read `lg:grid-cols-3 xl:grid-cols-5`, which was right
while the column was the full viewport less a gutter. At 70% it is not: five
selects at `xl` were sharing 896px. The longest option, `OUTC, hidden or output
comparisons`, needs about 286px, and that is what sets the counts. Two columns up
to `xl`, three above it (291px at 1280, 328 at 1440), and the ONNX and Other
groups the same one step later. A breakpoint name says how wide the window is; it
does not say how wide this column is.

The levers here are independent. Change `.shell` for the width and nothing about
the sizes moves.

### Tailwind

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

**The table is ten rows tall, always.** `height`, not `max-height`: the box is
the same size whether the answer is three solvers or fifty, so paging does not
move the pagination under the reader's cursor and the filter rail beside it does
not have the section changing length around it. More than ten scroll inside.

**The scrollbar belongs to the rows, not to the table.** A sticky head inside a
scrolling box does stay put, but the box's scrollbar is the box's: it runs the
full height and sits beside the head as well as the rows. For the bar to start
under the head, the rows have to be the scrolling element, which means giving up
`display: table` on the parts and paying for it twice. The automatic column
widths go, because each row becomes its own table and nothing lines one row's
columns up with the next, so `table-layout: fixed` and a stated width per column
do it instead. And the table roles go, because `display: block` on a `<table>`,
`<thead>` or `<tr>` takes its role with it and leaves a screen reader a stack of
text, so `js/solver-search.js` states every one of them back.

The head is outside the scroller, so it is a scrollbar's width wider than the
rows whenever there is one. `renderPage` adds `is-scrolling` when there are more
rows than the box is tall, and the head gives that width back as padding, which
keeps its columns over the body's. The test is exact rather than a guess: the box
is exactly ten rows, so more than ten rows is exactly when a bar appears.

The height is written as the rules above rather than as a measurement: a row is
`.table-td`'s 0.625rem of padding twice around a 1.25rem line box, so 2.5rem plus
a 1px divider, and the head is `.table-th`'s same padding around a 1rem line box.
Change either rule and `--table-row` and `--table-head` change with it.

The skeleton draws a few placeholder rows rather than a page's worth: sizing it
to the page size drew a ten-row box for a search with six results, which made the
table look as though it had a fixed height and then collapsed. `renderPage` also releases the pixel
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
| Every capability filter | the one Search button inside the panel |
| Sort by | `sort=`, applied on change |
| Per page | `limit=`, default 10, applied on change |
| Previous / Next / a page number | `offset=`, the only control that does not reset to page one |

**There is no search by name.** The API still takes a `name` parameter and
`vnnfilter` still has the flag; the page does not offer a box for it. Putting one
back is one entry in the query and one chip, and nothing else moves.

**Sort and page size sit on the results line**, beside "22 solvers, 10 releases
on this page", not in the panel. They say how to present an answer rather than
what to ask for, so they belong with the answer. They are outside the `<form>`
and carry no `name` attribute, so `FormData` cannot pick them up as filters; the
request reads them by id.

Nothing searches on a keystroke. Searching per keystroke meant a request for
every prefix on the way to the word the reader wanted, results flickering
through answers to half-typed names, and no way to tell a finished thought from
a passing one. A button says when.

### The filters are a rail beside the table

No button, nothing to open. The filters are a column to the left of the results,
with Search and Clear filters at their foot; Sort by and Per page sit on the
results line with the count.

Three arrangements were tried before this one and each had the same fault, which
is that a filter and the thing it filters want to be on screen together. A panel
that grew in place pushed the results down the page as it opened, and on a laptop
the groups are taller than the viewport, so choosing a filter scrolled the answer
out of sight. A modal took the whole screen for ten dropdowns. A box floating
under the button covered the table it was narrowing. Side by side, choosing and
reading are one glance, and what is applied is always visible.

**This section, and only this section, is 80% wide.** 70% is a reading measure
and right for prose; this is a filter rail, a table and a command line, and it is
the only place on the page that has to fit three things across. Widening `.shell`
itself would stretch every paragraph on the page to match, so the rule is
`#news .shell:has(#solver-swap[data-showing="search"])`. `:has` rather than a
class toggled in `js/site.js`, because the condition is already in the DOM:
`slide()` sets `data-showing`, and a second thing to keep in step with it is a
second thing to get wrong. The width transition matches the slide, so the box
grows as the panel arrives rather than snapping wider before it.

Two columns from 1024, which is where there is room for both once the section is
at 80%: the shell is 819px there, so the rail and the gap still leave the table
523px. At 70% that would have been 424 and it had to wait until 1180.

| Viewport | Overview | Search | Rail | Table |
|---|---|---|---|---|
| under 1024 | full | full | a band above, three groups across | full |
| 1024 | 720 | 819 | 272 | 523 |
| 1280 | 896 | 1024 | 272 | 728 |
| 1440 | 1008 | 1152 | 272 | 856 |
| 1920 | 1216 | 1216 | 272 | 920 |

Three things the layout depends on:

- **`minmax(0, 1fr)` for the table's track, not `1fr`.** A grid track's default
  minimum is `auto`, which is its content's minimum, and a table will not go
  below the width of its widest cell. Without the zero minimum a long solver name
  pushes the track past the column and the page overflows sideways.
- **The rail is `position: sticky`,** so the filters are reachable from anywhere
  in a long list rather than only from the top, and it scrolls itself if it is
  ever taller than the viewport.
- **The dropdown popup may be wider than its control.** The rail is 17rem and the
  longest option is about 18rem, so `right: 0` made the list clip exactly the
  words the closed button was already clipping. It is `width: max-content` with a
  22rem cap now, which is what a native select's popup does.

**The rail is sized to a total, not to taste.** Ten controls, their labels, the
gaps between them and the two buttons have to come to less than the viewport, or
the rail grows its own scrollbar beside a table that has none and the two read as
separate pages. At 0.8125rem controls, 0.6875rem labels and the padding in
`css/site.css` a control costs about 42px and the rail comes to 565, which clears
a 700-tall window with room over. `.field` itself is unchanged, because the sort
and page size on the results line share it and are not in the rail.

**Nothing in the rail is a heading.** The "Filters" title and its count badge
went, and the three group names are `<legend class="sr-only">`: four rows of
height for words the reader can infer from a rail standing against the table it
filters. The legends stay in the markup rather than being deleted, because a
fieldset is how a screen reader is told which question each of the ten controls
belongs to, and that is worth nothing on screen and everything off it. What is
applied is still visible, as the chips above the results.

**The `vnnfilter` banner is gone.** It showed the current selection as the
equivalent command line, and there was no good place left for it: in the 17rem
rail it was a terminal the width of a dropdown, beside the table it took room
from the answer, and across the foot of both it was a strip of height for
something nobody had asked to see. `CLI_FLAGS`, `shellArg`, `commandFor`, the
typewriter, the Copy button and the `.cmd-edit` caret went with it.
`VALUELESS_FLAGS` stayed: it is still what makes the `serialise_assignments` chip
read "required" rather than "true", and why that control offers Any or Required
and not No. The package is still named in the paragraph under the results.

**Scrollbars are the page's, not the platform's, and the two ways of doing that
cannot be mixed.** `::-webkit-scrollbar` draws the bar from scratch;
`scrollbar-width` and `scrollbar-color` ask the engine for its own bar, thinner
and in given colours. Setting both in Chrome does not give the first and fall
back to the second: Chrome takes the standard path and ignores every
`::-webkit-scrollbar` rule on that element, which is how the bar stayed Chrome's
own, only narrower. So the pseudo-elements are unconditional and the standard
properties sit behind `@supports not selector(::-webkit-scrollbar)`, which today
means Firefox. Applied to a named list (`.scroll-area`, `.filters-rail`, `.dialog-scroll`,
`.select__panel`, `.suggestions`, `.code-box`) rather than to everything, so the
page's own bar is still the one the reader's system gave them. The code example
gets the brand blue instead of ink, which on navy would be invisible. The results
table sits in a `.scroll-area` that scrolls sideways, so a wide table stays
inside its own box instead of stretching the layout.

The mode is gone too. Name and filters used to be two searches with a button
each, and whichever was showing was the one that counted. There is no name box
now and nothing to show or hide: one form, one question, one Search. Choosing a
filter does not search; Search does, and Clear filters resets and searches again.

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
reading every release in the database, and one search response is ten solvers.
A name with nothing listed after it is unrestricted, per the empty-list rule
above.

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

### Three things that made it stutter

Each was a case of doing layout work where none was needed.

**The rail fill was resized on every scroll event.** `fill.style.height = n%`
with a `transition: height 120ms` on it. Three faults at once: a trackpad reports
many small deltas, so the work ran far more often than the screen refreshes;
`scrollHeight` was read each time, which forces the browser to lay the page out
before it can answer; and the answer was written to `height`, which lays it out
again, with a layout transition permanently in flight and re-targeted before it
could finish. Now the page measurements are cached and refreshed by a
`ResizeObserver` (the page changes height without a resize: the panel slides, a
search returns a different number of rows), the scroll position is read at most
once a frame, and the fill is `transform: scaleY()`, which the compositor scales
without touching layout. No transition, because none is needed.

**The node field built a gradient per node per frame.** `createRadialGradient`
at 160 nodes and 60 frames a second is nearly ten thousand gradient objects a
second, each built, rasterised and discarded. The cost is the work and the
garbage both, and a collection pause mid-animation is exactly what it looked
like. Every halo is the same picture at a different size, so it is one 64px
sprite drawn once and `drawImage`d scaled. 64 is larger than the biggest halo
drawn, three times the 7px maximum radius, so it is only ever scaled down.

**The panel's width was transitioned.** Animating the width of a box holding a
table and a filter rail lays both out on every frame, for 440ms, at the one
moment the panel is already animating and has no frames to spare. The width now
changes in one step and only the slide is animated.

Everything below is skipped entirely under `prefers-reduced-motion`.


| | |
|---|---|
| Scroll reveal | Sections fade and lift in once, on `opacity` and `transform` only, so the browser can do it on the compositor without laying the page out again. Items in a list stagger by position. |
| The code example | Typed out the first time it scrolls into view, over a fixed total duration rather than a fixed rate. The box is given its finished height first, so nothing below it moves. |
| The filters panel | 420ms, on `grid-template-rows: 0fr → 1fr`, which animates to a height nothing has measured. |
| The details dialog | 220ms in and out. No backdrop blur: blurring the whole page per frame made scrolling behind the dialog stutter. |
| Dropdowns and suggestions | 200ms. |
| A copied citation | The copy glyph shrinks out, the tick springs in, and a band of colour sweeps across the row once. It clears itself after two seconds, so copying the same entry twice animates twice. |
| The solver panel slide | 440ms, with the container's height animated alongside it. See *A panel, not a page*. |

## Citing the standard

Each citation is a button that copies the line printed on it, and nothing else.
The text is read off the element at click time rather than kept in an attribute,
so there is no second copy of the reference to drift from the one the reader is
looking at. The whitespace is collapsed on the way out: the markup wraps each
reference over three indented lines, and `textContent` returns every one of those
newlines, which pasted into a document is a reference with the middle of its
title on a line of its own.

There is no dialog and no `alert`. The copy glyph at the end of the line becomes
a tick, which is both the affordance and the confirmation, and one `role="status"`
region announces the result for anyone who cannot see it. Where the clipboard API
is unavailable, which includes any copy of this page not served over https, the
reference is selected instead and the announcement says to press Control and C.

## The footer crest

The UniGE crest is drawn in black and dark grey inside `assets/svg/unige.svg`,
which on the navy footer read as a hole. It is loaded as an `<img>`, so `fill`
does not reach inside it; `.img-footer` in `css/site.css` applies
`brightness(0) invert(1)` instead, which flattens every colour to black and then
turns it white, keeping the artwork's shape and transparency.

## Page transitions

Clicking a link to another page on this site shows a brief overlay while it
loads, because a static page usually arrives in well under a second and in that
window the browser shows nothing, which reads as a click that did not land.

`MINIMUM_MS` in `js/site.js` is a floor on how briefly the overlay may appear, so
it cannot flash in and out and look like a glitch. It is not a timer the
navigation waits on: a slower page keeps the overlay until it arrives. It is set
to 450ms, about the shortest interval that registers as deliberate.

External links, anchors on the current page, downloads and modifier-clicks are
all left to the browser.

**Dormant, as it stands.** The site became one page when the solver search
stopped being `solvers.html`, so nothing currently triggers this. It is kept
because it costs nothing while idle and a second page would want it, but it is
the first thing to delete if the site stays as one.

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

The VNN-LIB wordmark is centred in the masthead and scrolls away with it, rather
than being pinned over the page. The way back to the top is the button in the
bottom corner, so a fixed wordmark was a second control for the same job that
covered a strip of the content permanently.

**A click and the scroll take turns owning which dot is lit.** They used to
fight. A click asks the browser to scroll somewhere; that scroll passes over
every section in between, and the observer reports each one as it goes, so the
dot walked down the rail and landed on the right one only at the end. The reader
saw their click apparently ignored, and for a moment two dots looked live: the
one they pressed, which still has focus, and the one the scroll was passing.

So a click claims the state, paints its dot at once, and holds it until that
scroll finishes; after that, and at every other time, the scroll has it.
`highlight()` refuses to write while a click owns it. Handing back is `scrollend`
where it exists and 140ms of quiet where it does not, because a smooth scroll
fires scroll events continuously so silence is the only available signal. There
is a 1200ms floor as well, for a click on the dot of the section already on
screen: that scrolls nowhere, so neither signal would ever arrive.

The click handler sits outside the `IntersectionObserver` guard, so a browser
without one still answers a click even though it has no scrollspy.

**One label at a time.** A clicked dot keeps focus and some browsers count a
click as focus-visible, so its label stayed up while the pointer moved to another
dot and showed a second one, which reads as two current sections. The pointer is
the more recent of the two intentions, so while anything is hovered the focused
dot's label stands down, unless they are the same dot.

Clicking a rail dot while the solver panel is showing puts the overview back
first, since every dot points at a section of it.

## The masthead field

`js/neurons.js` draws drifting nodes that find each other, hold a link for a
while, and let go. Each is a filled arc, so there is no image to load and the
field is there on the first frame.

Radii run from 1.2 to 7 pixels, squared so they bunch towards the small end. A
flat spread puts as many large nodes on screen as small ones, which at this
density is a field of blobs; weighted, the small ones sit back and an occasional
large one comes forward, and the field has depth.

**One colour, `#4db8ff`.** It used to pick from nine, which meant a different
colour mix on every load and no two screenshots alike. A single hue leaves the
size and the linking to carry the variation, which is what the field is about.
Not `brand` itself: `#008ae6` is the blue for links on white and sits too close
to the navy to read against it.

**The halo and the disc composite differently, and this matters.** The halo is
the large-area one and is drawn `source-over`. Additively, overlapping halos
accumulate without a ceiling, so the header brightened and dimmed as the field
drifted through it and the gradient behind stopped reading as a fixed background.
Normal alpha compositing approaches the halo colour and never passes it, so a
dense patch is tinted rather than blown out. The disc keeps `lighter` because it
is a few pixels across: enough to make two nodes flare as they cross and to stop
a node cutting a hole in a link, not enough to affect the header.

Density is one node per 8,500 square pixels, capped at 160. Each link is
deliberately faint, because alpha accumulates where lines cross and a link that
looks right on its own turns the middle of a dense field into a pale sheet.

**Hovering the banner joins the nodes near the pointer to it.** The reach is
120px, deliberately shorter than the 135px the nodes use on each other: the
cursor should pick up the few nodes it is among rather than rope in half the
field, which reads as a starburst instead of as touching a network. Each line
fades with the square of the distance, so a node arrives as it comes into range
rather than snapping in at a boundary, and the whole effect eases in and out over
about a fifth of a second so leaving the banner does not cut a dozen lines at
once.

Two things it is careful about. The pointer handler stores viewport coordinates
and nothing else: turning them into canvas coordinates needs
`getBoundingClientRect`, which is a layout read, and a pointer reports far more
often than the screen refreshes. That conversion happens once a frame in
`place()`, which is also the only way it stays right while the page scrolls under
a still pointer. And a touch pointer is ignored, because a finger on the banner
is usually on its way to scrolling past it.

**Links are objects with their own lifetime, not a distance test.** Two nodes
within 135px *may* bond, and the partner is chosen at random from all those in
range rather than every one of them being connected. A bond then holds for 60 to
260 frames, fades in and out over its own life, and breaks early if the two drift
past 190px or if either node reaches the end of its life. No node holds more than
three at once, and the field keeps to about 1.1 links per node.

Distance alone made the field deterministic: the same arrangement always drew the
same web, so nothing changed unless something moved, and there was nothing random
about it. Holding the links as state also made drawing cheaper, since it is now
one pass over roughly as many links as there are nodes rather than a rediscovery
of every pair. `MAX_NODES` is still the number to lower if it ever stutters,
because finding new partners is the one cost that scales with node count.

**It ignores the mouse.** There is no pointer tracking and no attraction, so the
field behaves the same whether or not anyone is moving a mouse over it, and on a
touch screen it is not a lesser version of itself.

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

Local copies were kept in `assets/doc/` for a while and have been removed.
Nothing referenced them, and the file named `standard-v2.0.pdf` was byte for byte
identical to `standard-v1.0.pdf`: 14 pages, dated November 11th 2022, titled
*The VNN-LIB standard for benchmarks*. The real 2.0 document is *VNN-LIB 2.0:
Rigorous Foundations for Neural Network Verification*, from December 2025, so
anything served from that path would have handed a reader the 1.0 document under
a 2.0 name. If local copies come back, that is the thing to check first.
