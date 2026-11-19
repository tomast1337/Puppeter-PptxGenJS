# PptxGenJS Defaults Map

This project targets the behavior of PptxGenJS, PowerPoint, and its emitted
OOXML rather than browser defaults. The contract is pinned to
`pptxgenjs@4.0.1`.

Values are confirmed from the installed PptxGenJS source, generated OOXML, and
the visual parity fixture. Runtime constants live in `packages/pptxgenjs/src/defaults.ts`. That
module also contains defaults for renderers that have not been implemented yet.

When PptxGenJS deliberately omits an OOXML attribute, the relevant Office/theme
default is recorded. Options with no PptxGenJS or Office default remain absent
instead of receiving an invented value.

## Presentation and theme

| Property                     |                       Default |
| ---------------------------- | ----------------------------: |
| Layout                       | `LAYOUT_16x9`, 10in × 5.625in |
| Other layouts                |              4:3, 16:10, Wide |
| RTL mode                     |                         False |
| Document properties          |                          None |
| Heading font                 |                 Calibri Light |
| Body font                    |                       Calibri |
| Language                     |                       `en-US` |
| Slide background             |                         White |
| Slide text color             |                         Black |
| Slide hidden                 |                         False |
| Slide/table-auto-page margin |                         0.5in |

The complete Office theme palette, built-in layout dimensions and units are
available in the machine-readable contract.

Document properties (`title`, `author`, `subject`, `company`, `revision`) have
no default: PptxGenJS writes `PptxGenJS Presentation`, `PptxGenJS` and revision
`1` when they are unset, which brands the file rather than describes it, so
PdfLapas writes only the values a deck sets and an unset one reads `""`.

`pres.layout` selects LAYOUT_4x3 (10in × 7.5in), LAYOUT_16x9, LAYOUT_16x10 (10in × 6.25in),
LAYOUT_WIDE (13⅓in × 7.5in) or a `defineLayout()` name, and an unknown name throws `UNKNOWN-LAYOUT`
as in PptxGenJS. The page size is the one set last; a slide's percentage positions use the size it
was added under, as PptxGenJS resolves them against that slide's layout.

A length number below 100 is inches and any other number is EMU (914400 per inch), as PptxGenJS 4.0.1
reads it, so `x: 914400` is one inch. Positions and sizes (`x`, `y`, `w`, `h`, image `sizing`, custGeom
points, `slideNumber`) go through its getSmartParseNumber, which reads 100 itself as EMU, a numeric string
as its number, `"50%"` as a share of the slide and any other string as 0. Table `colW` and `rowH`, tab stop
positions, the deprecated `inset` and inch cell margins go through its inch2Emu, which reads 100 as inches
and only a number above it as EMU. Two table quirks follow: `h: 100` is a 100 EMU frame whose rows share
100 inches, and a scalar `colW` whose floored total reaches 20 is EMU (`colW: 7` over 3 columns is three
7 EMU columns). Points options (text `margin`, line widths, shadows, borders) have no such rule.

`pres.theme.bodyFontFace` replaces Calibri as the font of text boxes, shape text, table cells and
chart legends that set no `fontFace`: PptxGenJS writes it as the theme's minor font, which their
runs inherit. `headFontFace` only reaches title placeholders, which need `defineSlideMaster()`.

Where the Microsoft Office fonts are not installed, install their metric-compatible equivalents so
text wraps as in PowerPoint: Carlito for Calibri, Caladea for Cambria, and Liberation Sans, Serif
and Mono for Arial, Times New Roman and Courier New (Debian and Ubuntu: `fonts-crosextra-carlito`,
`fonts-crosextra-caladea`, `fonts-liberation`). Puppeteer reaches them through fontconfig and the
print step's fallback list, the WASM renderer through its alias table.
Without Carlito, Calibri falls back to Noto Sans, whose glyphs are about 16% wider, so lines break
in other places.
`pres.rtlMode` writes `rtl="1"` on `<p:presentation>`, which orients PowerPoint's editing views;
LibreOffice renders the same slides with or without it, so it changes nothing in the PDF.

A hidden slide is left out of the PDF, as PowerPoint and LibreOffice export it. The other slides
keep their numbers: a slide link jumps to the page that shows its target, and none is written for
a hidden target. LibreOffice 26.2 sends a link to slide N to page N whatever is hidden before it,
one page late per hidden slide; PdfLapas does not copy that.

A background picture (`slide.background = { path | data }`) is stretched over the whole slide,
under every object, as PptxGenJS's `<a:stretch><a:fillRect/>` asks. PptxGenJS writes the picture
alone, so a transparent part shows white, as in LibreOffice, not the color. As in PptxGenJS
4.0.1, a picture stays when a later `background` has only a color,
`background.src` is ignored, and the deprecated `bkgd = { path | data | src }` adds its picture
only when `background` is set afterwards.

### Slide numbers

`slide.slideNumber` prints the slide's position in the deck, hidden slides counted (LibreOffice
prints the same), in a text box drawn after every other object.

| Property              |                                     Default |
| --------------------- | ------------------------------------------: |
| Size (`w`, `h`)       |     800000 × 300000 EMU (0.875in × 0.328in) |
| Alignment, bold       |             The slide's own; left, not bold |
| Font size             | `fontSize`, 12pt with a font or color, 18pt |
| Color, font           |                  Black, the theme body font |
| Vertical alignment    |                                         Top |
| Insets (`margin`, pt) |         0.1in left/right, 0.05in top/bottom |

PptxGenJS writes the `slideNumber` set last on any slide to the master and default layout, and a
slide's number inherits from it what its own props leave unset: font size (unless its own
`fontFace`, `fontSize` or `color` writes one, `fontSize || 12`), color, font, `valign` and
`margin`. An array `margin` is `[top, right, bottom, left]` here, unlike text boxes. PptxGenJS
reads no other text option of a slide number.

## Shared styles

| Area                         |                                                            Default |
| ---------------------------- | -----------------------------------------------------------------: |
| Fill options when supplied   |                                            Solid / 0% transparency |
| Border options when supplied |                                               Solid, `666666`, 1pt |
| Shadow when absent           |                                                               None |
| Enabled object shadow        | Outer, black, 75%, 8pt blur, 270°, 4pt offset (0 also takes these) |
| Enabled text glow            |                                                    White, 75%, 8pt |

## Text boxes

| Property              |                      Observed default | PuppeteerGen behavior          |
| --------------------- | ------------------------------------: | ------------------------------ |
| Color                 |                              `000000` | Implemented                    |
| Theme body font       |                               Calibri | Implemented with CSS fallbacks |
| Freeform text size    | 18pt through the default theme/master | Implemented                    |
| Horizontal alignment  |                                  Left | Implemented                    |
| Vertical alignment    |                                Middle | Implemented                    |
| Wrapping              |                               Enabled | Implemented                    |
| Left/right inset      |                                0.10in | Implemented                    |
| Top/bottom inset      |                                0.05in | Implemented                    |
| Missing `x`, `y`      |                              0in, 0in | Implemented                    |
| Missing `w`           |                    75% of slide width | Implemented                    |
| Missing `h`           |                0in (PptxGenJS cy="0") | Implemented                    |
| Bold/italic/strike    |                                 False | Mapped                         |
| Underline             |                                  None | Mapped                         |
| Language              |                               `en-US` | Mapped                         |
| Direction             |                            Horizontal | Mapped                         |
| Fit                   |                                  None | Mapped                         |
| Rotation/transparency |                                     0 | Mapped                         |
| Outline without width |       Hairline (`<a:ln>` without `w`) | 0.75pt (one CSS px)            |
| Kerning               |    From 12pt, none with `charSpacing` | PowerPoint target (see below)  |
| Kerning font support  |   Version 0 `kern`, else GPOS present | PowerPoint target (see below)  |
| Run `shadow`          |      Not written (only run `glow` is) | Ignored, as PptxGenJS          |

Text `margin` values are points. A scalar applies to all sides. PptxGenJS
4.0.1 emits a four-value text margin as `[left, right, bottom, top]`, although
its type documentation says `[top, right, bottom, left]`. PuppeteerGen mirrors
the emitted behavior for compatibility. The deprecated `inset` is in inches (EMU above 100)
and sets all four sides; any `margin`, `0` included, replaces it.

PptxGenJS writes `kern="1200"` on the default text style and `kern="0"` on a
run with `charSpacing`. PowerPoint reads both, so the PowerPoint target draws
text under 12pt, and text with `charSpacing`, without the font's pair
kerning; LibreOffice kerns every run, and so does the LibreOffice target.

PowerPoint pair-kerns only a font it reads pair kerning from. Measured
against its PDF export of synthetic decks and real decks: a font with a `kern`
table is kerned from that table alone, so Arial and Calibri (a
Microsoft-format, version 0 `kern` table) are kerned from 12pt, while a font
whose only kerning is an Apple-format `kern` table plus GPOS is not kerned at
any size (its 12 and 18pt lines come out 6 to 7% wider on kerning-heavy text).
A font with no `kern` table is kerned from GPOS: an OpenType font whose only
kerning is GPOS is kerned from 12pt, its pairs as wide as the browser's GPOS
kerning. The PowerPoint target leaves a face unkerned when its metrics say
`pairKerning: false` (the `fontMetrics` option, else `resolveFontMetrics`,
which reads the installed font's `kern` and GPOS tables on Node, else
`FONT_WIN_METRICS`, which says `true` for Arial and Calibri); a face none of
them knows is kerned from 12pt.

PowerPoint lays text out with each glyph's advance width (its `hmtx` advance
times the font size over `unitsPerEm`) rounded to the nearest 0.125pt, 1/576
in, spaces included, then puts word starts on a 1/600 in grid. Measured
against its PDF export of synthetic decks (Arial and Calibri, 8 to 12pt,
regular and bold, lines about 700pt long), the rounded advances fit its word
starts with a residual of 0.07 to 0.25pt (sd), the natural ones 0.2 to 1.2pt;
on a long line the difference reaches about 0.5%, which moves line breaks.
Pair kerning from 12pt still applies; whether PowerPoint rounds kerning values
too was not measured, so they stay as they are. The PowerPoint target adds the
rounding of a run's advances, spread evenly over its characters, to its
`letter-spacing` (`RENDERING_TARGETS.powerpoint.advanceGridPt`), from the
advances of the face, weight and style `resolveGlyphAdvances` finds (on Node by
default the installed font). A run in a face it does not find keeps the natural
advances, as does every run of the LibreOffice target. Word starts inside a run
can be off the grid by up to 0.2 to 0.5pt (the run's end is exact), and the
1/600 in word-start grid and PowerPoint's hinted glyph widths inside a word are
not reproduced.

PowerPoint puts each baseline on a 1/600 in (0.12pt) grid. Measured against its
PDF export of synthetic decks (one line of Arial, 6 to 18pt, in text boxes and
one-cell tables, top anchored), the first baseline below the top inset is the
line box's rounded to the nearest 0.12pt, all 20 sizes and places within
0.012pt: 12pt in a text box 11.325pt becomes 11.28, 18pt 16.988 becomes 17.04.
The PowerPoint target rounds every baseline it writes (`data-line-baseline`,
`data-mark-baseline`, `data-break-baseline`) the same way
(`RENDERING_TARGETS.powerpoint.baselineGridPerInch`); the LibreOffice target
does not. The grid is the page's, and the target rounds the baseline below its
line's top, so the two agree while the line top is on the grid: a box `y` and
inset in whole hundredths of an inch, sizes in whole tenths of a point, and
paragraph spacing in multiples of 0.72pt keep it there.

Two paragraphs are `paraSpaceAfter` of the first plus `paraSpaceBefore` of the
second apart in PowerPoint, and the PowerPoint target adds them the same way.
The LibreOffice target keeps only the larger of the two, as CSS margins collapse.
PowerPoint also leaves out the first paragraph's `paraSpaceBefore`, and so does
the PowerPoint target, in every anchor and in table cells (measured on
top-anchored text boxes only); the LibreOffice target keeps it.

PptxGenJS writes `paraSpaceBefore`, `paraSpaceAfter` and `lineSpacing` as
`<a:spcPts>` in hundredths of a point. PowerPoint rounds each of them half-up
to whole points, and so does the PowerPoint target, in text boxes, shapes and
table cells: `paraSpaceAfter: 0.49` adds nothing, `0.5` adds 1pt, `2.5` 3pt,
a space after of 0.5 followed by a space before of 0.5 adds 2pt, and
`lineSpacing: 12.5` gives a 13pt line. `lineSpacingMultiple` is not rounded.
The LibreOffice target keeps the values as given.

PptxGenJS writes `superscript` as `baseline="30000"` and `subscript` as
`baseline="-40000"`: the run's baseline moves by 30% or 40% of its font size.
PowerPoint draws the run at 2/3 of that size (24pt at 15.96pt) and counts it
in its line at the reduced size, and so does the PowerPoint target;
LibreOffice draws it at 58%, and so does the LibreOffice target. On the
PowerPoint target the paragraph mark keeps the last run's full size: a
paragraph whose only run is a 24pt superscript is a 28.8pt line, and the empty
paragraph after a superscript run ending in "\n" a full line of its size.
A custom `baseline` wins over both and is written as
`baseline="Math.round(baseline * 50)"`, in thousandths of a percent of the font
size: `baseline: 600` moves the run 30% of its size, so 6pt at 20pt and 12pt at
40pt. It is drawn as a superscript or subscript, at the same reduced size;
LibreOffice's PDF export shows both at 20pt and 40pt.

A text option set to `null` is unset, as in PptxGenJS, which reads options by
truthiness: a run's `null` takes the box's value, and a box's the default.
PptxGenJS's `addText` itself writes `lineSpacing: null` and
`lineSpacingMultiple: null` into the options object it is given, and copies
them onto each run, so options reused after a PptxGenJS pass keep single
spacing.

With explicit line spacing (`lineSpacing`, or a `lineSpacingMultiple` other
than 1), PowerPoint puts each line's baseline at 0.75 of the line height,
whatever the font and size, and so does the PowerPoint target. The LibreOffice
target keeps LibreOffice's baseline, 0.2em above the line's bottom.

With single spacing, PowerPoint makes each line 1.2x its largest run's size
and splits each run's 1.2x between ascent and descent in its font's OS/2
`usWinAscent` : `usWinDescent`, read from the installed font the face resolves
to. The PowerPoint target takes a face's values from the `fontMetrics`
constructor option, else from `resolveFontMetrics` (on Node by default the
installed font fontconfig resolves the face to, when its family is the face),
else from `FONT_WIN_METRICS` (Arial, Calibri, Cambria, Courier New, Times New
Roman). A face in none keeps the font-independent baseline, 1em below the line
top, which the LibreOffice target uses for every face.

A run that starts with "\n" makes PptxGenJS write an empty paragraph without
a run before it. PowerPoint and LibreOffice draw no bullet or number on such a
paragraph, and neither target does. PowerPoint numbers only paragraphs with
text: an empty numbered paragraph keeps the current number without advancing
it, and so does the PowerPoint target. LibreOffice restarts the numbering
after a numbered paragraph without a run, and so does the LibreOffice target.

Text is never clipped to its box: what does not fit is drawn past it from the
anchor, as in PowerPoint and LibreOffice. A box shorter than its top and bottom
insets, such as one without `h`, has its text area collapsed onto the box's
vertical midline, so middle text is centred on it, top text hangs below it and
bottom text sits above it.

A text box's `rectRadius` is the `roundRect` corner in inches, capped at half
the shorter side. PptxGenJS writes the corner only for a truthy value, so `0`
keeps the preset's corner of 1/6 of the shorter side. The text box itself
stays square: the radius never clips the text.

A text outline comes from the `line` object only. PptxGenJS 4.0.1 reads a
string `line` and the deprecated `lineSize`, `lineDash`, `lineHead` and
`lineTail` only for `shape: "line"`, so on any other text they draw nothing.

## Tables

| Property                  |                     Observed default | PuppeteerGen behavior |
| ------------------------- | -----------------------------------: | --------------------- |
| Position                  |                     x=0.5in, y=0.5in | Implemented           |
| Width                     | Slide width minus 0.5in on each side | Implemented           |
| Font size                 |                                 12pt | Implemented           |
| Color                     |                             `000000` | Implemented           |
| Cell inset                |    `[0.05, 0.10, 0.05, 0.10]in` TRBL | Implemented           |
| Cell borders              |                                 None | Implemented           |
| Cell vertical alignment   |                                  Top | Implemented           |
| Unspecified column widths |                   Evenly distributed | Implemented           |
| Auto paging               |                             Disabled | Not implemented       |
| Auto-page weights         |                                    0 | Mapped                |
| Repeat header             |   False; one header row when enabled | Mapped                |
| `tableToSlides` auto-page |                                 True | Mapped                |

Table margins retain a historical dual-unit rule: values below 1 are inches;
values of 1 or greater are points.

A table is as tall as its rows. PptxGenJS 4.0.1 writes each `<a:tr h>` from
`rowH`, or from `h` divided by the row count when `rowH` is missing; with `rowH`,
`h` only becomes the frame's `cy`, which PowerPoint and LibreOffice ignore, so
`rowH: 0.3, h: 2` on three rows draws a 0.9in table. Every row height is a
minimum that grows to the row's text.

A row without a height (PptxGenJS writes `<a:tr h="0">`, as on autoPage and
`tableToSlides` pages) sizes to its tallest cell. LibreOffice makes it 1/100 mm
taller than that cell's text and margins (svx `Cell::getMinimumHeight` returns
`GetTextHeight()+1` in its 1/100 mm model units), so a 4.8 + 19.2 + 4.8 px row is
28.838 px, not 28.8; the LibreOffice target does the same, and the cell's anchor
places the text in that extra space. The PowerPoint target adds nothing.

The column count is the first row's cells, each counted by its `colspan`, whatever `colW` or `w`
say. A later row with more cells than that is cut: PptxGenJS 4.0.1 writes every cell, but PowerPoint
draws only the cells that start inside the grid, and the rest take no text, border or height. PdfLapas
drops them when it normalizes the table, so neither the HTML nor a renderer sees them, and does not
warn, since PptxGenJS and PowerPoint accept such rows. A cell starts in the first column of its row
not taken by a `rowspan` above, and a `colspan` that crosses the last column is cut at it (not
checked against PowerPoint). A row with fewer cells than columns is drawn as it is.

`autoPage` splits rows as PptxGenJS 4.0.1 does, which reads margins differently from the drawn
cell: the unit comes from the cell's own `margin` array only, so a table-level `margin` on a cell
without one counts as inches whatever its size (`margin: 1` is drawn as 1pt but paginated as 1in).
When the first row's margins and one line do not fit below the table `y`, PptxGenJS throws
`addTable: Array expected!`; PuppeteerGen throws too, with an error that names the cause. Give
point margins per cell (`options.margin: [6, 4, 6, 4]`) or a table-level margin below 1.

It also counts lines as PptxGenJS does: each rich-text run starts a line, a run without a line
feed is trimmed first, a run whose `text` is not a string counts no line, and a first word longer
than the line adds an empty line before it. Column widths are read at the cell's index, not its
column, and a cell with any `colspan` gets every width from there to the table's right edge.

Every autoPage and `tableToSlides` row, split or not, is drawn from those parsed words, as PptxGenJS
writes them: single-line runs trimmed and run together (`"Hello " + "world"` reads `Helloworld`),
non-string runs dropped, and a cell's wrapped lines kept in one paragraph. A later row that is not an
array throws an error naming the row; PptxGenJS logs it and writes a row without cells, which fails
only when the file is opened or converted.

`tableToSlides` takes each cell's computed font size. Under jsdom a cell has none: PptxGenJS 4.0.1
writes its run without `sz`, so PowerPoint draws the deck default, 18pt (`<a:defRPr sz="1800">` on
`lvl1pPr` of `p:defaultTextStyle` in presentation.xml and of the master's `p:otherStyle`; the table
style sets no size). PuppeteerGen draws 18pt too; pagination still counts such a cell at 12pt, as
PptxGenJS does.

Cells and runs inherit as in PptxGenJS: any falsy option (`false`, `""`, `null`, but not `0`) is
filled from the table or the cell, so `bold: false` in a bold table is bold. A cell's text is kept
only when truthy: `{ text: 0 }`, `{ text: false }` and `{ text: true }` are empty cells (a plain
`0` cell still shows `0`).

## Shapes

| Property                        |                                             Observed default | PuppeteerGen behavior |
| ------------------------------- | -----------------------------------------------------------: | --------------------- |
| Position and size               |                                   x=1in, y=1in, w=1in, h=1in | Implemented           |
| Line when omitted               |                                                         None | Implemented           |
| Supplied line color             |                                                     `333333` | Implemented           |
| Supplied line width             |                                                          1pt | Implemented           |
| Supplied line dash              |                                                        Solid | Implemented           |
| Line head size (no `w`/`len`)   | Medium: 3 line widths (3.5 for `arrow`), from at least 0.7mm | Implemented           |
| Supplied fill type/transparency |                                                   Solid / 0% | Mapped                |
| Alignment                       |                                                         Left | Mapped                |
| Rotation/flips                  |                                                    0 / false | Mapped                |
| Arc angle/thickness             |                                             `[270, 0]` / 0.5 | Mapped                |

## Images and media

| Area                          |                          Default |
| ----------------------------- | -------------------------------: |
| Image position                |                     x=0in, y=0in |
| Image size                    |                        1in × 1in |
| Image transform               | Rotation 0; flips/rounding false |
| Image transparency            |                               0% |
| Image sizing without `sizing` |                   Stretch to box |
| Media position                |                     x=0in, y=0in |
| Media size                    |                        2in × 2in |
| Media type                    |                            Audio |
| Media fallback extension      |                              MP3 |
| Media cover                   |   PptxGenJS built-in play button |

These values are mapped now and will be consumed as image/media compatibility
is expanded.

## Charts

Chart defaults are fully mapped even though chart rendering is pending. The
contract includes:

- Position `x=1`, `y=1`, size `50% × 50%`.
- Automatic plot area (PptxGenJS writes `<c:layout/>`): 2% of the chart height between the edge, the
  legend and the axis labels, plus a 1.2em line per legend and label row, as LibreOffice lays it out.
- 12pt axis labels, 18pt titles, and 10pt value-axis titles and legend, which PptxGenJS writes without
  a size, so Office draws its 10pt chart text default.
- Arial for the title, axis titles, axis labels and data labels, which PptxGenJS writes as
  `<a:latin typeface="Arial">` when no font option is set; the legend, which PptxGenJS writes
  without a font, uses the theme body font (Calibri), as LibreOffice draws it. Without Microsoft
  fonts, Arial resolves to the metric-compatible Liberation Sans: through fontconfig in Chromium
  and LibreOffice, and through the WASM renderer's alias table.
- Bar direction/grouping, 3D shape, gaps, overlap, and rotations.
- Legend, data-label, axis visibility, and data-table flags.
- Legend keys: a bar, area or pie entry is a filled square at 0.6 of the legend font size (8px at
  10pt), as Office and LibreOffice draw it; a line entry shows its line and marker.
- Line cap/dash/width, marker shape/size/border, and smoothing.
- Outside major tick marks on the category axis, which PptxGenJS writes on every chart but scatter.
- Pie angle, doughnut hole size, radar style, and blank-value behavior.
- bar3D view: `rotX` 30, `rotY` 30 and perspective 30 (a 15° field of view) project the box, with one
  slot per category and per series, centered with 12.5% of the chart width on each side.
- Chart/plot borders, gridline defaults, format codes, and both complete color
  palettes used by PptxGenJS.

These values deliberately follow runtime normalization where it differs from
the type comments.

## Export

PptxGenJS defaults are recorded as compression disabled, `blob` output, and
`Presentation.pptx`. PuppeteerGen's `write()` defaults to a `blob` of the PDF,
`stream()` returns a Node `Buffer`, and `compression` is accepted but ignored
because it only selects zip DEFLATE vs STORE. `writeFile()` has no default file
name: it requires `fileName`, replaces a trailing `.pptx` with `.pdf` and
appends `.pdf` to any other name that does not end in it.

## Other mapped defaults

| Area                         |            Default | Status                      |
| ---------------------------- | -----------------: | --------------------------- |
| Bullet indentation           |               27pt | Mapped; rendering pending   |
| Default bullet character     |                `•` | Mapped; rendering pending   |
| Table/auto-page slide margin |              0.5in | Mapped; auto paging pending |
| Numbered bullet style/start  | `arabicPeriod` / 1 | Mapped; rendering pending   |

## Verification

Run fast behavioral checks with `bun test`. Run the renderer comparison with
`bun run test:visual`. The visual test renders a shared fixture through both
PptxGenJS and PuppeteerGen and fails when normalized RMSE exceeds the configured
threshold.
