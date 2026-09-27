# QTI Pocket Check

A small, read-only browser preflight for QTI ZIP packages. Free, no account, no server processing. This tool was developed with AI assistance; it does not certify QTI conformance or guarantee an LMS import.

## Use

1. Keep this folder together and open `index.html` in a current Edge, Chrome, Firefox, or Safari browser.
2. Try **Clean package** or **Package with issues**. These contain only synthetic examples created for this project.
3. Select a ZIP. Review the item inventory and findings.
4. Optionally download the JSON report. It contains names, IDs and diagnostics, not question text. Names and IDs can still identify confidential course material; review before sharing.

No file is changed. No connection to Canvas or another LMS is made. There are no remote scripts, analytics or content uploads. A restrictive Content Security Policy blocks outgoing connections; all scripts and styles are included locally. On a hosted copy, your browser still requests the page and its static assets from that host; ZIP processing is local.

## Checks and limits

- Locate exact `imsmanifest.xml` entries, including manifests under a wrapper folder.
- Resolve local `resource` and `file` references relative to the manifest folder, case-sensitively. Remote/non-file URLs, fragment-only references and references affected by `xml:base` are not checked.
- Identify QTI 1.x / 1.2-style XML and QTI 2.x item/test XML. The namespace, when present, helps identify the version; unnamespaced legacy XML is not claimed to be an exact QTI release.
- Count item definitions separately from QTI 2.x item references. Counts are not deduplicated bank totals. Only `.xml` and `.qti` entries are parsed (including `.xml.qti`).
- Flag QTI 1.x `response_lid` elements without a nonempty `rcardinality` attribute. QTI 1.2 allows omission and defines a default of `Single`; the finding is a compatibility notice about some importers, not a QTI standard violation or a recommendation to guess an answer mode. Consult the exporter or LMS documentation.
- Maximum compressed ZIP: 25 MiB; declared uncompressed total: 100 MiB; entries: 1,000; read XML output: 8 MiB each. XML reads are streamed and capped. Images and other attachments are not decompressed.
- ZIP64, spanning, encryption, unusual compression, unsafe paths, DTD/entity declarations and malformed XML are rejected. The tool intentionally does not fetch schemas or external resources.
- Up to 1,000 diagnostics and the first 200 item IDs per file are included. Truncation and failed XML reads are disclosed; item counts may then be incomplete.

Not included: full schema validation, automatic repairs, question-type inference, answer correctness, accessibility checking, remote-link testing, archive-wide CRC checking or any LMS-specific import guarantee.

## Synthetic fixtures

With Node.js installed, run `node fixtures/generate.cjs` to write five synthetic ZIP files under `fixtures/`.

Expected results:

- `synthetic-good.zip`: one QTI 1.2-namespace item, no errors or warnings.
- `synthetic-bad.zip`: one item, a missing `missing-image.png` reference and a missing-cardinality warning.
- `synthetic-nested.zip`: one QTI 2.1 item; nested-manifest warning.
- `synthetic-entity.zip`: XML declaration rejected; no entity expansion.
- `synthetic-malformed.zip`: unreadable XML reported without echoing source content.

For local UI testing, `window.QTIPocketCheck.runSynthetic('good')` runs a synthetic check; `getReport()` returns a copied diagnostic report, and `isRunning()` reports activity. This interface never exposes uploaded file objects, XML documents, or question text.

## Licensing

Original code and synthetic fixtures: MIT; see `LICENSE`.
Bundled JSZip is used under its MIT option. Its copyright and full license are preserved in `vendor/JSZIP-LICENSE.txt`. No competing product code is included.

Public feedback: `https://github.com/xtddxsh1/qti-pocket-check/issues`. Please do not post confidential exams or copyrighted publisher packages to a public issue.

## Field test and possible batch edition

The single-package tool is free and MIT-licensed. A proposed batch edition would check multiple chapter ZIPs and combine the findings. We are testing whether that workflow is worth **US$5 once**. It is not built or for sale; no payment or payment details are accepted. Please describe your real workflow and nonbinding interest in a [field-test issue](https://github.com/xtddxsh1/qti-pocket-check/issues/new?template=field-test.yml), or email xt20208022@gmail.com. Synthetic demo use is not evidence of success on a real package.

## Why these checks?

Teachers have reported [imports that produce no questions](https://community.instructure.com/en/discussion/639509/import-qti-file-to-new-item-bank-doesnt-work) and [a compatibility issue involving cardinality](https://community.instructure.com/en/discussion/607765/new-quizzes-qti-import-not-working-try-this). These reports do not mean every import failure is diagnosable here. QTI 1.2 allows cardinality omission; see the [official XML binding](https://www.imsglobal.org/question/qtiv1p2/imsqti_asi_bindv1p2.html). Manifest reference handling follows a deliberately small subset of [IMS Content Packaging](https://www.imsglobal.org/content/packaging/cpv1p1p4/imscp_bindv1p1p4.html). The checker is not affiliated with Instructure or 1EdTech.
