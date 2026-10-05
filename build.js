/* ═══════════════════════════════════════════════
   灰星终端 · 构建脚本
   把 docs/*.md 合成 data.js
   用法：在 grey-terminal 目录下敲  node build.js
   ═══════════════════════════════════════════════ */

const fs   = require('fs');
const path = require('path');

const ROOT      = __dirname;
const DOCS_DIR  = path.join(ROOT, 'docs');
const NAV_FILE  = path.join(ROOT, 'nav.js');
const TERM_FILE = path.join(ROOT, 'terms.js');
const OUT_FILE  = path.join(ROOT, 'data.js');

/* ─────────── 1. 读 front-matter ─────────── */
function parseFrontMatter(text){
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!m) return { meta:{}, body:text };
  const meta = {};
  m[1].split(/\r?\n/).forEach(line => {
    const mm = line.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*:\s*(.*)$/);
    if (mm) meta[mm[1]] = mm[2].trim();
  });
  return { meta, body:m[2] };
}

/* ─────────── 2. Markdown → sections ─────────── */
function parseMarkdown(body){
  const lines = body.split(/\r?\n/);
  const sections = [];
  let i = 0;

  function readBlock(){
    /* 跳过空行 */
    while (i < lines.length && !lines[i].trim()) i++;
    if (i >= lines.length) return null;
    const line = lines[i];
    /* h3 */
    if (line.startsWith('## ')){
      const v = line.slice(3).trim();
      i++;
      return { t:'h3', v };
    }
    /* 引用块 */
    if (line.startsWith('> ')){
      const buf = [];
      while (i < lines.length && lines[i].startsWith('> ')){
        buf.push(lines[i].slice(2));
        i++;
      }
      let source = '';
      let content = buf.join(' ').trim();
      const sm = content.match(/^(.*?)\s*---\s*(.+)$/);
      if (sm){ content = sm[1].trim(); source = sm[2].trim(); }
      return { t:'quote', v:content, m:source };
    }
    /* 列表 */
    if (line.startsWith('- ')){
      const v = [];
      while (i < lines.length && lines[i].startsWith('- ')){
        v.push(lines[i].slice(2).trim());
        i++;
      }
      return { t:'list', v };
    }
    /* 表格（键值对，用 | 分隔） */
    if (line.trim().startsWith('|')){
      const v = [];
      while (i < lines.length && lines[i].trim().startsWith('|')){
        const cells = lines[i].split('|').map(s => s.trim()).filter(Boolean);
        if (cells.length >= 2) v.push([cells[0], cells[1]]);
        i++;
      }
      return { t:'meta', v };
    }
    /* 特殊指令：@link: 文字 => 目标id */
    if (line.startsWith('@link:')){
      const body2 = line.slice(6).trim();
      const mm = body2.match(/^(.+?)\s*=>\s*(\S+)$/);
      i++;
      if (mm) return { t:'link', v:mm[1].trim(), id:mm[2].trim() };
      return null;
    }
    /* 特殊指令：@sub: 目标id */
    if (line.startsWith('@sub:')){
      const id = line.slice(5).trim();
      i++;
      return { t:'sub', id };
    }
    /* 特殊指令：@warn: 内容 */
    if (line.startsWith('@warn:')){
      const v = line.slice(6).trim();
      i++;
      return { t:'warn', v };
    }
    /* 特殊指令：@alert: 内容 */
    if (line.startsWith('@alert:')){
      const v = line.slice(7).trim();
      i++;
      return { t:'alert', v };
    }
    /* 普通段落：连续非空、非特殊标记的行合并 */
    const buf = [];
    while (
      i < lines.length &&
      lines[i].trim() &&
      !lines[i].startsWith('## ') &&
      !lines[i].startsWith('> ') &&
      !lines[i].startsWith('- ') &&
      !lines[i].trim().startsWith('|') &&
      !lines[i].startsWith('@link:') &&
      !lines[i].startsWith('@sub:') &&
      !lines[i].startsWith('@warn:') &&
      !lines[i].startsWith('@alert:')
    ){
      buf.push(lines[i].trim());
      i++;
    }
    if (!buf.length) return null;
    return { t:'p', v:buf.join(' ') };
  }

  let s;
  while ((s = readBlock())) sections.push(s);
  return sections;
}

/* ─────────── 3. 读一个 .md 文件 ─────────── */
function readDoc(file){
  const text = fs.readFileSync(file, 'utf8');
  const { meta, body } = parseFrontMatter(text);
  if (!meta.id) return null;

  const doc = {
    title:    meta.title    || meta.id,
    subtitle: meta.subtitle || '',
    cls:      meta.cls      || 'int',
    authority:meta.authority|| '',
    rev:      meta.rev      || '',
    revDate:  meta.revDate  || '',
    revBy:    meta.revBy    || '',
    revReason:meta.revReason|| '',
    sections: parseMarkdown(body)
  };
  return { id: meta.id, doc };
}

/* ─────────── 4. 生成 data.js ─────────── */
function build(){
  /* 4.1 扫描 docs/ */
  if (!fs.existsSync(DOCS_DIR)){
    console.error('❌ 找不到 docs/ 目录');
    process.exit(1);
  }
  const files = fs.readdirSync(DOCS_DIR)
    .filter(f => f.endsWith('.md'))
    .map(f => path.join(DOCS_DIR, f));

  const docs = {};
  files.forEach(f => {
    const r = readDoc(f);
    if (r) docs[r.id] = r.doc;
  });
  console.log(`📄 读取 ${Object.keys(docs).length} 篇文档`);

  /* 4.2 读 nav.js 和 terms.js（作为裸文本嵌入） */
  if (!fs.existsSync(NAV_FILE)){
    console.error('❌ 找不到 nav.js');
    process.exit(1);
  }
  const navText  = fs.readFileSync(NAV_FILE,  'utf8');
  const termText = fs.existsSync(TERM_FILE)
    ? fs.readFileSync(TERM_FILE, 'utf8')
    : 'const TERMS = {};';

  /* 4.3 组装 */
  const out = [];
  out.push('/* ═══════════════════════════════════════════════');
  out.push('   灰星内部终端 · 数据层');
  out.push('   ⚠️  此文件由 build.js 自动生成，请勿手动编辑');
  out.push('   修改内容请编辑 docs/*.md，然后运行 node build.js');
  out.push('   ═══════════════════════════════════════════════ */');
  out.push('');
  out.push('/* ── 术语表 ── */');
  out.push(termText.trim());
  out.push('');
  out.push('/* ── 导航结构 ── */');
  out.push(navText.trim());
  out.push('');
  out.push('/* ── 文档内容 ── */');
  out.push('const DOCS = ' + JSON.stringify(docs, null, 2) + ';');
  out.push('');

  fs.writeFileSync(OUT_FILE, out.join('\n'), 'utf8');
  console.log(`✅ 已生成 data.js（${Object.keys(docs).length} 篇文档）`);
}

build();