// Bundles src/*.js into the single self-contained dist/index.html
//   npm run build            minified
//   npm run build:readable   unminified, for debugging (same output path, so the server picks it up)
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { transformSync } from 'esbuild';

const here = path.dirname(fileURLToPath(import.meta.url));
// one shared scope: concatenation order matters (top-level code of a file may only use what earlier files define)
const FILES = ['quality.js', 'math.js', 'shaders.js', 'world.js', 'creatures.js', 'camera.js', 'net.js', 'main.js', 'audio.js', 'hud.js', 'boot.js'];
const readable = process.argv.includes('--readable');

let js = FILES.map((f) => `// ---- ${f}\n` + readFileSync(path.join(here, 'src', f), 'utf8')).join('\n');
const tpl = readFileSync(path.join(here, 'template.html'), 'utf8');
// everything runs inside one async function; startup errors are shown on screen
const wrap = (body) => `(async()=>{${body}\n})().catch(e=>{console.error(e);document.body.className='l e';document.getElementById('s').textContent=(e.cause?'':'Failed to start: ')+e.message});`;

let html;
if (readable) {
  html = tpl.replace('/*SCRIPT*/', () => wrap(js));
} else {
  // shrink the WGSL inside /*wgsl*/ template literals, then minify the JS and the page's CSS
  const minWgsl = (s) => s.replace(/\/\/[^\n]*/g, '').replace(/\s+/g, ' ').replace(/ ?([{}()\[\];,:=+\-*\/<>&|!%@]) ?/g, '$1').trim();
  js = js.replace(/\/\*wgsl\*\/`([^`]*)`/g, (_, w) => '`' + minWgsl(w) + '`');
  const code = transformSync(wrap(js), { minify: true, target: 'es2022', legalComments: 'none' }).code.trim();
  const css = (_, s) => '<style>' + transformSync(s, { loader: 'css', minify: true }).code.trim();
  html = tpl.replace(/<style>([^]*?)(?=<\/style>)/, css).replace(/>\s+</g, '><').replace('/*SCRIPT*/', () => code).replace(/<script>\s+/, '<script>').replace(/\s+<\/script>/, '</script>');
}
mkdirSync(path.join(here, 'dist'), { recursive: true });
writeFileSync(path.join(here, 'dist', 'index.html'), html);
const gz = gzipSync(Buffer.from(html), { level: 9 }).length;
console.log(`dist/index.html: ${(html.length / 1024).toFixed(1)} kB${readable ? ' (readable)' : ''}, ${(gz / 1024).toFixed(1)} kB gzipped`);
