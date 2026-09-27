/* Generate local, synthetic ZIP fixtures. Run: node fixtures/generate.cjs */
const fs = require('node:fs');
const path = require('node:path');
const JSZip = require('../vendor/jszip.min.js');
const definitions = require('./definitions.js');
(async () => {
  for (const [name, files] of Object.entries(definitions)) {
    const zip = new JSZip();
    for (const [filename, content] of Object.entries(files)) zip.file(filename, content, {date:new Date('2026-01-01T00:00:00Z')});
    const bytes = await zip.generateAsync({type:'nodebuffer', compression:'DEFLATE'});
    const target = path.join(__dirname, `synthetic-${name}.zip`);
    fs.writeFileSync(target, bytes);
    process.stdout.write(`${path.basename(target)} ${bytes.length} bytes\n`);
  }
})().catch(error => {process.stderr.write(`${error.message}\n`);process.exitCode=1;});
