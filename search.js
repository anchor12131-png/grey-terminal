/* Global document search */
(function () {
  "use strict";

  const BLOCK_ELEMENTS = new Set([
    'ADDRESS', 'ARTICLE', 'ASIDE', 'BLOCKQUOTE', 'DD', 'DIV', 'DL', 'DT',
    'FIELDSET', 'FIGCAPTION', 'FIGURE', 'FOOTER', 'FORM', 'H1', 'H2', 'H3',
    'H4', 'H5', 'H6', 'HEADER', 'HR', 'LI', 'MAIN', 'NAV', 'OL', 'P',
    'PRE', 'SECTION', 'TABLE', 'TBODY', 'TD', 'TFOOT', 'TH', 'THEAD', 'TR', 'UL'
  ]);
  const MAX_RESULTS = 30;

  function appendBoundary(state) {
    if (state.text && !state.text.endsWith('\n')) state.text += '\n';
  }

  function extractText(root, includeNodes) {
    const state = { text:'', nodes:[] };
    function visit(node) {
      if (node.nodeType === Node.TEXT_NODE) {
        if (!node.nodeValue) return;
        const start = state.text.length;
        state.text += node.nodeValue;
        if (includeNodes) state.nodes.push({ node, start, end:state.text.length });
        return;
      }
      if (node.nodeType !== Node.ELEMENT_NODE && node.nodeType !== Node.DOCUMENT_FRAGMENT_NODE) return;
      const isBlock = node.nodeType === Node.ELEMENT_NODE && BLOCK_ELEMENTS.has(node.tagName);
      if (isBlock) appendBoundary(state);
      Array.from(node.childNodes).forEach(visit);
      if (isBlock) appendBoundary(state);
    }
    visit(root);
    return state;
  }

  function createIndex(documents) {
    const index = [];
    documents.forEach(doc => {
      const container = document.createElement('div');
      container.innerHTML = doc.html;
      const text = extractText(container, false).text;
      if (text) index.push({ id:doc.id, title:doc.title, text });
    });
    return index;
  }

  function contextFor(text, start, end) {
    const from = Math.max(0, start - 42);
    const to = Math.min(text.length, end + 58);
    return (from ? '…' : '') + text.slice(from, to) + (to < text.length ? '…' : '');
  }

  function findMatches(index, query) {
    const needle = query.toLowerCase();
    const results = [];
    index.some(doc => {
      const text = doc.text.toLowerCase();
      let at = text.indexOf(needle);
      while (at >= 0 && results.length < MAX_RESULTS) {
        results.push({
          id:doc.id,
          title:doc.title,
          text:doc.text,
          start:at,
          end:at + query.length,
          context:contextFor(doc.text, at, at + query.length)
        });
        at = text.indexOf(needle, at + Math.max(query.length, 1));
      }
      return results.length >= MAX_RESULTS;
    });
    return results;
  }

  function clearHighlights(root) {
    root.querySelectorAll('.search-match').forEach(mark => {
      mark.replaceWith(document.createTextNode(mark.textContent));
    });
    root.normalize();
  }

  function highlightMatches(root, query, selectedStart) {
    clearHighlights(root);
    const content = extractText(root, true);
    const needle = query.toLowerCase();
    const lowerText = content.text.toLowerCase();
    const matches = [];
    let at = lowerText.indexOf(needle);
    while (at >= 0) {
      matches.push({ start:at, end:at + query.length });
      at = lowerText.indexOf(needle, at + Math.max(query.length, 1));
    }

    content.nodes.forEach(entry => {
      const ranges = matches.map(match => ({
        start:Math.max(match.start, entry.start) - entry.start,
        end:Math.min(match.end, entry.end) - entry.start,
        matchStart:match.start
      })).filter(range => range.start < range.end);
      if (!ranges.length) return;

      const value = entry.node.nodeValue;
      const fragment = document.createDocumentFragment();
      let cursor = 0;
      ranges.forEach(range => {
        if (range.start > cursor) {
          fragment.appendChild(document.createTextNode(value.slice(cursor, range.start)));
        }
        const mark = document.createElement('mark');
        mark.className = 'search-match';
        mark.dataset.searchOffset = String(range.matchStart);
        mark.textContent = value.slice(range.start, range.end);
        fragment.appendChild(mark);
        cursor = range.end;
      });
      if (cursor < value.length) fragment.appendChild(document.createTextNode(value.slice(cursor)));
      entry.node.replaceWith(fragment);
    });

    const selected = root.querySelector('[data-search-offset="' + selectedStart + '"]');
    if (selected) selected.scrollIntoView({ behavior:'smooth', block:'center' });
  }

  function renderResults(panel, input, results, query) {
    panel.replaceChildren();
    if (!results.length) {
      const empty = document.createElement('div');
      empty.className = 'search-empty';
      empty.textContent = '没有找到匹配内容';
      panel.appendChild(empty);
    } else {
      results.forEach((result, index) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'search-result';
        button.setAttribute('role', 'option');
        button.dataset.resultIndex = String(index);

        const title = document.createElement('span');
        title.className = 'search-result-title';
        const docTitle = document.createElement('span');
        docTitle.textContent = result.title;
        const location = document.createElement('span');
        location.className = 'search-result-loc';
        location.textContent = '文档内容';
        title.append(docTitle, location);

        const context = document.createElement('span');
        context.className = 'search-result-context';
        const needle = query.toLowerCase();
        const contextMatch = result.context.toLowerCase().indexOf(needle);
        const matchedText = document.createElement('mark');
        matchedText.textContent = result.context.slice(contextMatch, contextMatch + query.length);
        context.append(
          document.createTextNode(result.context.slice(0, contextMatch)),
          matchedText,
          document.createTextNode(result.context.slice(contextMatch + query.length))
        );
        button.append(title, context);
        panel.appendChild(button);
      });
    }
    panel.hidden = false;
    input.setAttribute('aria-expanded', 'true');
  }

  // getDocuments returns rendered documents; openDocument returns the mounted document root.
  window.initGlobalSearch = function (options) {
    const input = document.querySelector('#globalSearch');
    const panel = document.querySelector('#searchResults');
    if (!input || !panel) return;

    const index = createIndex(options.getDocuments());
    let results = [];

    input.addEventListener('input', () => {
      const query = input.value.trim();
      if (!query) {
        results = [];
        panel.hidden = true;
        input.setAttribute('aria-expanded', 'false');
        return;
      }
      results = findMatches(index, query);
      renderResults(panel, input, results, query);
    });

    panel.addEventListener('click', event => {
      const button = event.target.closest('.search-result');
      if (!button) return;
      const result = results[Number(button.dataset.resultIndex)];
      if (!result) return;
      panel.hidden = true;
      input.setAttribute('aria-expanded', 'false');
      const root = options.openDocument(result.id);
      if (!root) return;
      highlightMatches(root, input.value.trim(), result.start);
    });

    input.addEventListener('keydown', event => {
      if (event.key === 'Escape') {
        panel.hidden = true;
        input.setAttribute('aria-expanded', 'false');
        input.blur();
      } else if (event.key === 'Enter' && !panel.hidden) {
        const first = panel.querySelector('.search-result');
        if (first) first.click();
      }
    });

    document.addEventListener('click', event => {
      if (!event.target.closest('.global-search')) {
        panel.hidden = true;
        input.setAttribute('aria-expanded', 'false');
      }
    });
  };
})();
