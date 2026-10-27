import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';
import { PLAYGROUND_HTML } from '../src/ui/playground-html.js';
import { DEMO_HTML } from '../src/demo/demo-html.js';

const require = createRequire(import.meta.url);
const esbuild = require('esbuild');

const outDir = resolve(process.cwd(), 'dist-pages');
mkdirSync(outDir, { recursive: true });

await esbuild.build({
  entryPoints: [resolve(process.cwd(), 'src/ui/browser-playground.ts')],
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: ['es2022'],
  outfile: resolve(outDir, 'playground-bundle.js'),
  alias: {
    'node:sqlite': resolve(process.cwd(), 'src/ui/browser-sqlite-shim.ts'),
    'node:crypto': resolve(process.cwd(), 'src/ui/browser-crypto-shim.ts')
  }
});

await esbuild.build({
  entryPoints: [resolve(process.cwd(), 'src/demo/browser-demo.ts')],
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: ['es2022'],
  outfile: resolve(outDir, 'demo-bundle.js')
});

// Inject playground-bundle.js before the inline UI script so window.fetch handles all /api/playground/* calls in-browser
const staticHtml = PLAYGROUND_HTML.replace(
  '<script>',
  '<script src="./playground-bundle.js"></script>\n  <script>'
);

const staticDemoHtml = DEMO_HTML.replace(
  '<script>',
  '<script src="./demo-bundle.js"></script>\n  <script>'
);

writeFileSync(resolve(outDir, 'index.html'), staticHtml, 'utf8');
writeFileSync(resolve(outDir, 'demo.html'), staticDemoHtml, 'utf8');
writeFileSync(resolve(outDir, '.nojekyll'), '', 'utf8');
console.log('Static GitHub Pages playground built in dist-pages/index.html and dist-pages/demo.html');
