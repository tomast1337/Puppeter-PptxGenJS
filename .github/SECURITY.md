# Security policy

## Supported versions

PdfLapas is 0.x and not yet published to npm. Only the latest minor release receives security fixes.

| Version            | Supported |
| ------------------ | --------- |
| latest 0.x minor   | Yes       |
| older 0.x releases | No        |

## Reporting a vulnerability

Report vulnerabilities privately through GitHub's private vulnerability reporting:
[open a security advisory](https://github.com/tomast1337/PdfLapas/security/advisories/new).

Never open a public issue, pull request or discussion for a vulnerability.

Please include:

- the affected package (`@pdflapas/pptxgenjs`, `@pdflapas/puppeteer`, `@pdflapas/wasm`, ...) and version or commit;
- the renderer (Puppeteer or WASM) and runtime (Node, Bun or browser, with version);
- a minimal reproduction: the PptxGenJS calls, input file or model JSON/HTML that triggers it, using synthetic data only;
- the impact you observed or expect (crash, file read, network request, code execution, ...).

## What to expect

PdfLapas is a one-person project, so handling is best effort. You will get an acknowledgement within 7 days, and
updates as the report is triaged and fixed. Please keep the report private until a fix is released.

## Scope

In scope: anything in this repository that lets untrusted input do more than produce a PDF. Untrusted input enters
through:

- options passed to the PptxGenJS-compatible API;
- image paths, URLs, bytes and data URIs (images are resolved before rendering, so the output must not depend on a
  browser base URL or reach the network in ways the caller did not ask for);
- font files;
- component props;
- model JSON and profile HTML given to a renderer, including the WASM renderer.

The Puppeteer backend runs Chromium on the HTML generated from the model, so injection into that HTML is in scope. A
panic in the WASM renderer on bad input is a bug and in scope.

Out of scope: vulnerabilities in Chromium, Puppeteer or other upstream dependencies themselves. Report those to their
projects.
