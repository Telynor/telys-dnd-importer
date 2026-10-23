# Third-party image recognition components

The implementation of Tely's DND Importer is MIT licensed. Bundled third-party components retain their own licenses.

| Component | Version | License | Upstream |
| --- | --- | --- | --- |
| Tesseract.js browser API and worker | 7.0.0 | Apache-2.0, with bundled dependency notices | https://github.com/naptha/tesseract.js |
| Tesseract.js Core, including Tesseract and Leptonica code | 7.0.0 | Apache-2.0 and upstream dependency licenses | https://github.com/naptha/tesseract.js-core |
| English recognition data, packaged by @tesseract.js-data/eng | 1.0.0 (4.0.0_best_int) | Tesseract data: Apache-2.0; npm package metadata: MIT | https://github.com/naptha/tessdata and https://github.com/tesseract-ocr/tessdata_best |

License text and minified dependency notices are included in `vendor/ocr/`. `vendor/ocr/assets.json` records source URLs, byte sizes and SHA-256 hashes of the unmodified vendored files. Code and language data are loaded from the installed module directory; image recognition does not fetch a CDN or send images to an external service.

The WASM packages contain upstream OCR dependencies, including Leptonica. Leptonica copyright and redistribution terms are available at https://github.com/DanBloomberg/leptonica/blob/master/leptonica-license.txt and are included with this module.
