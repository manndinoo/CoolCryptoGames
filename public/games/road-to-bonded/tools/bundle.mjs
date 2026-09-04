#!/usr/bin/env node
/* Bundles the game into one self-contained HTML fragment/file.
   node tools/bundle.mjs out.html [--fragment]   (--fragment omits doctype/html/head/body wrappers) */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = process.argv[2] || path.join(root, 'dist', 'bonded.html');
const fragment = process.argv.includes('--fragment');
const html = readFileSync(path.join(root, 'index.html'), 'utf8');
const css = readFileSync(path.join(root, 'css', 'style.css'), 'utf8');
const pill = 'data:image/png;base64,' + readFileSync(path.join(root, 'assets', 'pill.png')).toString('base64');
let body = html.slice(html.indexOf('<body>') + 6, html.lastIndexOf('</body>'));
body = body.replace(/<script src="js\/([a-z0-9]+)\.js"><\/script>/g, (_, name) => '<script>\n' + readFileSync(path.join(root, 'js', name + '.js'), 'utf8').replace(/<\/script/g, '<\\/script') + '\n</script>');
body = body.replace(/assets\/pill\.png/g, pill);
const fonts = '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;700&family=JetBrains+Mono:wght@500;700&display=swap" media="print" onload="this.media=\'all\'">';
const icon = (html.match(/<link rel="icon"[^>]*>/) || [''])[0];
const head = '<title>BONDED</title>\n' + icon + '\n' + fonts + '\n<style>\n' + css + '\n</style>\n';
const doc = fragment ? head + body : '<!DOCTYPE html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover">\n<meta name="theme-color" content="#17423d">\n' + head + '</head>\n<body>' + body + '</body>\n</html>\n';
if (/<script src="/.test(body)) throw new Error('bundle still references an external script: ' + body.match(/<script src="[^"]+"/)[0]);
writeFileSync(out, doc);
console.log(`bundled -> ${out} (${Math.round(doc.length / 1024)} KB)`);
