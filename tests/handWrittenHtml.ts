/** Minimal hand-written profile v1 documents (docs/HTML_PROFILE.md): only what the completion step cannot default. */

export const PIXEL_PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";

export const HAND_WRITTEN_OBJECTS = {
    text: `<div class="slide-element slide-text" data-object-name="Title" style="left: 96px; top: 48px; width: 768px; height: 96px;">
      <div class="text-content">
        <div class="text-paragraph"><span class="text-run" style="font-size: 48px; font-weight: bold;">Hand-written</span></div>
      </div>
    </div>`,
    shape: `<div class="slide-element slide-shape" data-object-name="Box" data-shape="rect" style="left: 96px; top: 192px; width: 192px; height: 96px;">
      <svg class="shape-svg" viewBox="0 0 192 96" width="100%" height="100%" preserveAspectRatio="none">
        <defs></defs>
        <rect class="shape-geometry" x="0" y="0" width="192" height="96" rx="0" ry="0" fill="#4472C4" stroke="none" stroke-width="0"></rect>
      </svg>
    </div>`,
    image: `<div class="slide-element slide-image" data-object-name="Pixel" style="left: 384px; top: 192px; width: 96px; height: 96px;">
      <div class="slide-image-frame" style="width: 100%; height: 100%; overflow: hidden;">
        <img class="slide-image-content" src="${PIXEL_PNG}" style="display: block; width: 100%; height: 100%;" />
      </div>
    </div>`,
    table: `<div class="slide-element slide-table-container" data-object-name="Grid" style="left: 576px; top: 192px; width: 288px;">
      <table class="slide-table" style="width: 288px; table-layout: fixed; border-collapse: collapse;">
        <colgroup><col style="width: 144px;"><col style="width: 144px;"></colgroup>
        <tr>
          <td style="border-bottom: 1px solid #000000;"><div class="table-cell-text"><div class="text-content"><div class="text-paragraph"><span class="text-run">A</span></div></div></div></td>
          <td><div class="table-cell-text"><div class="text-content"><div class="text-paragraph"><a class="text-run" href="https://example.com">B</a></div></div></div></td>
        </tr>
      </table>
    </div>`,
} as const;

/** One slide holding `objects`; `head` replaces the default head content. */
export function handWrittenDocument(objects: string, head = `<meta name="pdfdeck-profile" content="1">`): string {
    return `<html>
<head>
  ${head}
</head>
<body>
  <div class="slide-container">
    ${objects}
  </div>
</body>
</html>`;
}
