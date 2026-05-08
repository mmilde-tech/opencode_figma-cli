import { readFileSync } from 'fs';

const asarPath =
  process.argv[2] ||
  'C:\\\\Users\\\\mmild\\\\AppData\\\\Local\\\\Figma\\\\app-126.3.12\\\\resources\\\\app.asar';

const buf = readFileSync(asarPath);
const s = buf.toString('latin1');

const needle = 'remote-debugging';
let idx = 0;
const hits = [];
while (true) {
  idx = s.indexOf(needle, idx);
  if (idx === -1) break;
  hits.push(idx);
  idx += needle.length;
  if (hits.length > 5000) break;
}

console.log(JSON.stringify({ asarPath, size: buf.length, occurrences: hits.length }, null, 2));

const contextWindow = 80;
for (let i = 0; i < Math.min(40, hits.length); i++) {
  const at = hits[i];
  const start = Math.max(0, at - contextWindow);
  const end = Math.min(s.length, at + needle.length + contextWindow);
  const snippet = s.slice(start, end).replace(/\s+/g, ' ');
  console.log(`\n[${i + 1}/${hits.length}] …${snippet}…`);
}

