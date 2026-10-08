// Markdown → HTML for reading agent docs (shotlist) in the studio. Small on purpose: the block
// shapes our docs use (headings, paragraphs, lists with one level of nesting, tables, quotes, rules).
// Every piece of text goes through brief.mjs `inline`, which escapes HTML first, so file content
// can never inject markup.
import { inline } from './brief.mjs';

const cells = (line) => line.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
const isRule = (line) => /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/.test(line) && line.includes('-');
const listItem = (line) => line.match(/^(\s*)([-*+]|\d+[.)])\s+(.*)$/);

export function renderMarkdown(md) {
  const lines = String(md).replace(/\r\n/g, '\n').split('\n');
  const out = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }

    let m;
    if ((m = line.match(/^(#{1,6})\s+(.*?)\s*#*\s*$/))) {
      const n = Math.min(m[1].length + 1, 6);           // h1 in the doc → h2 in the page
      out.push(`<h${n}>${inline(m[2])}</h${n}>`); i++; continue;
    }
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) { out.push('<hr>'); i++; continue; }

    if (line.trim().startsWith('|') && i + 1 < lines.length && isRule(lines[i + 1])) {
      const head = cells(line);
      i += 2;
      const rows = [];
      while (i < lines.length && lines[i].trim().startsWith('|')) rows.push(cells(lines[i++]));
      out.push('<div class="md-table"><table><thead><tr>' + head.map((c) => `<th>${inline(c)}</th>`).join('')
        + '</tr></thead><tbody>' + rows.map((r) => '<tr>' + head.map((_, k) => `<td>${inline(r[k] ?? '')}</td>`).join('') + '</tr>').join('')
        + '</tbody></table></div>');
      continue;
    }

    if (line.startsWith('>')) {
      const q = [];
      while (i < lines.length && lines[i].startsWith('>')) q.push(lines[i++].replace(/^>\s?/, ''));
      out.push(`<blockquote>${renderMarkdown(q.join('\n'))}</blockquote>`);
      continue;
    }

    if (listItem(line)) {
      // Items at the first item's indent; deeper items and continuation lines nest under the current item.
      const base = listItem(line)[1].length, ordered = /\d/.test(listItem(line)[2]);
      const items = [];
      while (i < lines.length && lines[i].trim()) {
        const li = listItem(lines[i]);
        if (li && li[1].length <= base) items.push([li[3]]);
        else items.at(-1).push(lines[i].replace(new RegExp(`^\\s{0,${base + 2}}`), ''));
        i++;
      }
      const tag = ordered ? 'ol' : 'ul';
      out.push(`<${tag}>` + items.map(([first, ...rest]) => {
        const sub = rest.length && listItem(rest[0]) ? renderMarkdown(rest.join('\n')) : rest.length ? ' ' + inline(rest.join(' ')) : '';
        return `<li>${inline(first)}${sub}</li>`;
      }).join('') + `</${tag}>`);
      continue;
    }

    const p = [line.trim()];   // a line no block claimed (e.g. a lone `|`) still starts a paragraph
    i++;
    while (i < lines.length && lines[i].trim() && !/^(#{1,6}\s|>|\s*\|)/.test(lines[i]) && !listItem(lines[i])) p.push(lines[i++].trim());
    out.push(`<p>${inline(p.join(' '))}</p>`);
  }
  return out.join('\n');
}
