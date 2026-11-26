import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

for (const [original, packaged] of [
  ['dist/purify.es.mjs', 'purify.es.mjs'],
  ['LICENSE', 'vendor/DOMPurify-LICENSE.txt'],
  ['LICENSE-MPL', 'vendor/DOMPurify-LICENSE-MPL.txt'],
]) {
  assert.deepEqual(
    await readFile('app/src/main/assets/' + packaged),
    await readFile('node_modules/dompurify/' + original),
    packaged,
  );
}
