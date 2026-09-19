# PptxGenJS Defaults Map

This project targets the behavior of PptxGenJS, PowerPoint, and its emitted
OOXML rather than browser defaults. The contract is pinned to
`pptxgenjs@4.0.1`.

Values are confirmed from the installed PptxGenJS source, generated OOXML, and
the visual parity fixture. Runtime constants live in `src/defaults.ts`. That
module also contains defaults for renderers that have not been implemented yet.

When PptxGenJS deliberately omits an OOXML attribute, the relevant Office/theme
default is recorded. Options with no PptxGenJS or Office default remain absent
instead of receiving an invented value.

## Presentation and theme

| Property | Default |
|---|---:|
| Layout | `LAYOUT_16x9`, 10in × 5.625in |
| Other layouts | 4:3, 16:10, Wide |
| RTL mode | False |
| Author/company | `PptxGenJS` |
| Title/subject | `PptxGenJS Presentation` |
| Revision | `1` |
| Heading font | Calibri Light |
| Body font | Calibri |
| Language | `en-US` |
| Slide background | White |
| Slide text color | Black |
| Slide hidden | False |
| Slide/table-auto-page margin | 0.5in |

The complete Office theme palette, built-in layout dimensions, units, and
metadata values are available in the machine-readable contract.

## Shared styles

| Area | Default |
|---|---:|
| Fill options when supplied | Solid / 0% transparency |
| Border options when supplied | Solid, `666666`, 1pt |
| Shadow when absent | None |
| Enabled shape shadow | Outer, black, 35%, 3pt blur, 90°, ~1.81pt offset |
| Enabled text glow | White, 75%, 8pt |

## Text boxes

| Property | Observed default | PuppeteerGen behavior |
|---|---:|---|
| Color | `000000` | Implemented |
| Theme body font | Calibri | Implemented with CSS fallbacks |
| Freeform text size | 18pt through the default theme/master | Implemented |
| Horizontal alignment | Left | Implemented |
| Vertical alignment | Middle | Implemented |
| Wrapping | Enabled | Implemented |
| Left/right inset | 0.10in | Implemented |
| Top/bottom inset | 0.05in | Implemented |
| Missing `x`, `y` | 0in, 0in | Implemented |
| Missing `w` | 75% of slide width | Implemented |
| Missing `h` | 0.30in | Implemented |
| Bold/italic/strike | False | Mapped |
| Underline | None | Mapped |
| Language | `en-US` | Mapped |
| Direction | Horizontal | Mapped |
| Fit | None | Mapped |
| Rotation/transparency | 0 | Mapped |

Text `margin` values are points. A scalar applies to all sides. PptxGenJS
4.0.1 emits a four-value text margin as `[left, right, bottom, top]`, although
its type documentation says `[top, right, bottom, left]`. PuppeteerGen mirrors
the emitted behavior for compatibility.

## Tables

| Property | Observed default | PuppeteerGen behavior |
|---|---:|---|
| Position | x=0.5in, y=0.5in | Implemented |
| Width | Slide width minus 0.5in on each side | Implemented |
| Font size | 12pt | Implemented |
| Color | `000000` | Implemented |
| Cell inset | `[0.05, 0.10, 0.05, 0.10]in` TRBL | Implemented |
| Cell borders | None | Implemented |
| Cell vertical alignment | Top | Implemented |
| Unspecified column widths | Evenly distributed | Implemented |
| Auto paging | Disabled | Not implemented |
| Auto-page weights | 0 | Mapped |
| Repeat header | False; one header row when enabled | Mapped |
| `tableToSlides` auto-page | True | Mapped |

Table margins retain a historical dual-unit rule: values below 1 are inches;
values of 1 or greater are points.

## Shapes

| Property | Observed default | PuppeteerGen behavior |
|---|---:|---|
| Position and size | x=1in, y=1in, w=1in, h=1in | Implemented |
| Line when omitted | None | Implemented |
| Supplied line color | `333333` | Implemented |
| Supplied line width | 1pt | Implemented |
| Supplied line dash | Solid | Implemented |
| Supplied fill type/transparency | Solid / 0% | Mapped |
| Alignment | Left | Mapped |
| Rotation/flips | 0 / false | Mapped |
| Arc angle/thickness | `[270, 0]` / 0.5 | Mapped |

## Images and media

| Area | Default |
|---|---:|
| Image position | x=0in, y=0in |
| Image size | 1in × 1in |
| Image transform | Rotation 0; flips/rounding false |
| Image transparency | 0% |
| Image sizing without `sizing` | Stretch to box |
| Media position | x=0in, y=0in |
| Media size | 2in × 2in |
| Media type | Audio |
| Media fallback extension | MP3 |
| Media cover | PptxGenJS built-in play button |

These values are mapped now and will be consumed as image/media compatibility
is expanded.

## Charts

Chart defaults are fully mapped even though chart rendering is pending. The
contract includes:

- Position `x=1`, `y=1`, size `50% × 50%`.
- 12pt body text and 18pt titles.
- Bar direction/grouping, 3D shape, gaps, overlap, and rotations.
- Legend, data-label, axis visibility, and data-table flags.
- Line cap/dash/width, marker shape/size/border, and smoothing.
- Pie angle, doughnut hole size, radar style, and blank-value behavior.
- Chart/plot borders, gridline defaults, format codes, and both complete color
  palettes used by PptxGenJS.

These values deliberately follow runtime normalization where it differs from
the type comments.

## Export

PptxGenJS defaults are recorded as compression disabled, `blob` output, and
`Presentation.pptx`. PuppeteerGen's eventual `write()`/`stream()` compatibility
can translate those semantics to PDF-specific output.

## Other mapped defaults

| Area | Default | Status |
|---|---:|---|
| Bullet indentation | 27pt | Mapped; rendering pending |
| Default bullet character | `•` | Mapped; rendering pending |
| Table/auto-page slide margin | 0.5in | Mapped; auto paging pending |
| Numbered bullet style/start | `arabicPeriod` / 1 | Mapped; rendering pending |

## Verification

Run fast behavioral checks with `bun test`. Run the renderer comparison with
`bun run test:visual`. The visual test renders a shared fixture through both
PptxGenJS and PuppeteerGen and fails when normalized RMSE exceeds the configured
threshold.
