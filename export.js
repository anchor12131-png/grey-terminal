/* export.js
 * 本地角色档案导出；仅读取角色历史版本计算差异，不上传生成文件。
 */
(function () {
  'use strict';

  function displayValue(value) {
    if (value == null || value === '') return '未填写';
    if (typeof value === 'boolean') return value ? '是' : '否';
    return String(value);
  }

  function contentLabel(key) {
    const labels = {
      personName: '人物名称',
      gender: '性别',
      version: '版本',
      background: '背景',
      appearance: '外貌',
      personality: '性格',
      history: '经历',
      ability: '能力',
      abilities: '能力',
      notes: '备注'
    };
    return labels[key] || String(key).replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ');
  }

  function normalizeContent(content) {
    if (typeof content !== 'string') return content;
    try { return JSON.parse(content); } catch (_) { return content; }
  }

  function formatTime(value) {
    const date = value ? new Date(value) : new Date();
    if (Number.isNaN(date.getTime())) return String(value || '');
    return new Intl.DateTimeFormat('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false
    }).format(date);
  }

  function safeFilename(value) {
    const name = String(value || '未命名角色')
      .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_')
      .replace(/[. ]+$/g, '')
      .trim();
    return name || '未命名角色';
  }

  function parseContent(content) {
    const normalized = normalizeContent(content);
    if (normalized && typeof normalized === 'object' && !Array.isArray(normalized)) return normalized;
    return { content: normalized };
  }

  function comparableGender(value) {
    return typeof value === 'string' && !value.trim() ? null : value;
  }

  async function checkDiff(currentData) {
    const data = currentData || {};
    const fields = parseContent(data.content);
    const personName = typeof fields.personName === 'string' ? fields.personName.trim() : '';
    if (!personName) return {};
    if (!window.GreySupabase) throw new Error('Supabase 客户端未初始化，不能检查历史版本。');

    let query = window.GreySupabase
      .from('characters')
      .select('content')
      .eq('content->>personName', personName)
      .in('status', ['pending', 'approved'])
      .order('updated_at', { ascending: false });
    if (data.id != null) query = query.neq('id', data.id);
    if (data.updated_at) query = query.lt('updated_at', data.updated_at);
    const { data: previous, error } = await query.limit(1).maybeSingle();
    if (error) throw error;
    if (!previous) return {};

    const previousFields = parseContent(previous.content);
    return JSON.stringify(comparableGender(fields.gender)) !==
      JSON.stringify(comparableGender(previousFields.gender))
      ? { gender: true }
      : {};
  }

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function htmlValue(value) {
    if (value == null || value === '') return '<span class="empty">未填写</span>';
    if (Array.isArray(value)) {
      return '<ul>' + (value.length
        ? value.map((entry) => '<li>' + htmlValue(entry) + '</li>').join('')
        : '<li>未填写</li>') + '</ul>';
    }
    if (typeof value === 'object') {
      const entries = Object.keys(value);
      if (!entries.length) return '<span class="empty">未填写</span>';
      return '<table class="nested">' + entries.map((key) =>
        '<tr><th>' + escapeHtml(contentLabel(key)) + '</th><td>' + htmlValue(value[key]) + '</td></tr>'
      ).join('') + '</table>';
    }
    return escapeHtml(displayValue(value));
  }

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.style.display = 'none';
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function exportAsWord(characterData) {
    const data = characterData || {};
    const diff = await checkDiff(data);
    const name = safeFilename(data.name);
    const fields = parseContent(data.content);
    const rows = Object.keys(fields).map((key) => {
      const badge = diff[key]
        ? '<span style="color:#e6a23c;border:1px solid #e6a23c;padding:2px 4px;font-size:10pt;margin-left:8px;">[有改动]</span>'
        : '';
      return '<tr><th>' + escapeHtml(contentLabel(key)) + '</th><td>' +
        htmlValue(fields[key]) + badge + '</td></tr>';
    }).join('');
    const html = '<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8">' +
      '<title>' + escapeHtml(name) + '</title><style>' +
      'body{font-family:"Microsoft YaHei",SimSun,sans-serif;color:#111;line-height:1.75;margin:36px}' +
      'h1{font-size:24pt;border-bottom:2px solid #222;padding-bottom:12px}' +
      'h2{font-size:15pt;margin-top:28px;border-bottom:1px solid #888;padding-bottom:6px}' +
      '.meta{color:#444;margin:6px 0}.record{margin:20px 0 30px}' +
      'table{width:100%;border-collapse:collapse}.record>tbody>tr>th,.record>tbody>tr>td,' +
      '.nested th,.nested td{border:1px solid #aaa;padding:8px 10px;text-align:left;vertical-align:top}' +
      '.record>tbody>tr>th{width:22%;background:#f1f1f1}.nested{margin:4px 0}' +
      'ul{margin:0;padding-left:22px}.empty{color:#777}' +
      '</style></head><body><main>' +
      '<div class="meta">灰星终端 · 角色档案</div>' +
      '<h1>' + escapeHtml(data.displayName || data.name || '未命名角色') + '</h1>' +
      '<p class="meta">角色名称：' + escapeHtml(data.name || '未命名角色') + '</p>' +
      '<p class="meta">档案状态：' + escapeHtml(data.status || '待提交审核') + '</p>' +
      '<p class="meta">生成时间：' + escapeHtml(formatTime(data.generatedAt)) + '</p>' +
      '<section><h2>角色资料</h2><table class="record"><tbody>' +
      (rows || '<tr><td>暂无角色内容</td></tr>') +
      '</tbody></table></section></main></body></html>';
    const blob = new Blob(['\ufeff' + html], { type: 'application/msword' });
    downloadBlob(blob, '角色档案-' + name + '.doc');
  }

  function createMockValue(value) {
    if (Array.isArray(value)) {
      const list = document.createElement('ul');
      list.className = 'export-value-list';
      (value.length ? value : ['未填写']).forEach((entry) => {
        const item = document.createElement('li');
        item.appendChild(createMockValue(entry));
        list.appendChild(item);
      });
      return list;
    }
    if (value && typeof value === 'object') {
      const group = document.createElement('div');
      group.className = 'export-value-group';
      const keys = Object.keys(value);
      if (!keys.length) {
        group.textContent = '未填写';
      } else {
        keys.forEach((key) => {
          const row = document.createElement('div');
          row.className = 'export-nested-field';
          const label = document.createElement('span');
          label.className = 'export-nested-label';
          label.textContent = contentLabel(key);
          row.appendChild(label);
          row.appendChild(createMockValue(value[key]));
          group.appendChild(row);
        });
      }
      return group;
    }
    const text = document.createElement('span');
    text.textContent = displayValue(value);
    return text;
  }

  function updateImageTemplate(data, diff) {
    const card = document.getElementById('export-card-mock');
    if (!card) throw new Error('图片档案模板不存在。');
    card.querySelector('[data-export-name]').textContent = data.name || '未命名角色';
    card.querySelector('[data-export-status]').textContent = data.status || '待提交审核';
    const generated = card.querySelector('[data-export-generated]');
    generated.textContent = formatTime(data.generatedAt);
    generated.dateTime = data.generatedAt || '';

    const fieldsContainer = card.querySelector('[data-export-fields]');
    fieldsContainer.replaceChildren();
    const fields = parseContent(data.content);
    Object.keys(fields).forEach((key) => {
      const field = document.createElement('div');
      field.className = 'export-card-field';
      const label = document.createElement('div');
      label.className = 'export-card-label';
      label.textContent = contentLabel(key);
      field.appendChild(label);
      field.appendChild(createMockValue(fields[key]));
      if (diff[key]) {
        const badge = document.createElement('span');
        badge.style.cssText = 'color:#e6a23c;font-size:12px;border:1px solid #e6a23c;padding:0 4px;margin-left:8px;border-radius:2px;';
        badge.textContent = '[有改动]';
        field.appendChild(badge);
      }
      fieldsContainer.appendChild(field);
    });
    if (!fieldsContainer.childElementCount) {
      fieldsContainer.textContent = '暂无角色内容';
    }
    return card;
  }

  async function exportAsImage(characterData) {
    if (typeof window.html2canvas !== 'function') {
      throw new Error('图片生成组件未加载，请检查网络后刷新页面。');
    }
    const data = characterData || {};
    const diff = await checkDiff(data);
    const card = updateImageTemplate(data, diff);
    if (document.fonts && document.fonts.ready) await document.fonts.ready;
    const canvas = await window.html2canvas(card, {
      backgroundColor: '#080b0e',
      scale: 2,
      useCORS: false,
      logging: false,
      windowWidth: Math.max(window.innerWidth, card.scrollWidth),
      windowHeight: Math.max(window.innerHeight, card.scrollHeight + 40),
      scrollX: 0,
      scrollY: 0,
      onclone: (clonedDocument) => {
        const clonedCard = clonedDocument.getElementById('export-card-mock');
        if (!clonedCard) return;
        clonedCard.style.position = 'absolute';
        clonedCard.style.left = '0';
        clonedCard.style.top = '0';
        clonedCard.style.transform = 'none';
        clonedCard.style.zIndex = '1';
      }
    });
    try {
      const imageUrl = canvas.toDataURL('image/png');
      const link = document.createElement('a');
      link.href = imageUrl;
      link.download = '角色档案-' + safeFilename(data.name) + '.png';
      link.style.display = 'none';
      document.body.appendChild(link);
      link.click();
      link.remove();
    } finally {
      canvas.width = 0;
      canvas.height = 0;
    }
  }

  window.GreyArchiveExport = {
    exportAsImage: exportAsImage,
    exportAsWord: exportAsWord
  };
})();
