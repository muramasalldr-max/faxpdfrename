(() => {
  const PDF_JS_VERSION = '3.11.174';
  const PDF_JS_CDN_BASE = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${PDF_JS_VERSION}`;
  const fileInput = document.getElementById('fileInput');
  const selectButton = document.getElementById('selectButton');
  const dropZone = document.getElementById('dropZone');
  const resultsBody = document.getElementById('resultsBody');
  const statusMessage = document.getElementById('statusMessage');
  const downloadZipButton = document.getElementById('downloadZipButton');
  const fileCount = document.getElementById('fileCount');
  const matchedCount = document.getElementById('matchedCount');
  const warningCount = document.getElementById('warningCount');

  const appState = {
    results: [],
    filenameCounter: new Map()
  };

  const pdfjsLib = window['pdfjs-dist/build/pdf'] || window.pdfjsLib;
  if (pdfjsLib) {
    pdfjsLib.GlobalWorkerOptions.workerSrc = `${PDF_JS_CDN_BASE}/pdf.worker.min.js`;
  }

  selectButton.addEventListener('click', () => fileInput.click());
  dropZone.addEventListener('click', () => fileInput.click());
  dropZone.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      fileInput.click();
    }
  });
  fileInput.addEventListener('change', (event) => handleFiles(event.target.files));

  ['dragenter', 'dragover'].forEach((eventName) => {
    dropZone.addEventListener(eventName, (event) => {
      event.preventDefault();
      dropZone.classList.add('is-dragover');
    });
  });

  ['dragleave', 'drop'].forEach((eventName) => {
    dropZone.addEventListener(eventName, (event) => {
      event.preventDefault();
      dropZone.classList.remove('is-dragover');
    });
  });

  dropZone.addEventListener('drop', (event) => {
    const droppedFiles = [...event.dataTransfer.files].filter(
      (file) => file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')
    );
    handleFiles(droppedFiles);
  });

  downloadZipButton.addEventListener('click', downloadZip);

  async function handleFiles(fileList) {
    const files = [...fileList].filter(
      (file) => file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')
    );
    fileInput.value = '';

    if (!files.length) {
      setStatus('PDFファイルのみ追加できます。', 'warning');
      return;
    }

    if (!pdfjsLib || typeof JSZip === 'undefined') {
      setStatus(
        '必要なライブラリの読込に失敗しました。GitHub Pages の配信内容と CDN パスを確認してください。',
        'error'
      );
      return;
    }

    setStatus(`${files.length}件のPDFを解析中です...`, 'info');
    downloadZipButton.disabled = true;
    appState.results = [];
    appState.filenameCounter = new Map();
    renderResults();

    const parsedResults = [];
    for (const file of files) {
      parsedResults.push(await parsePdfFile(file));
    }

    appState.results = ensureUniqueFilenames(parsedResults);
    renderResults();

    const successCount = appState.results.filter((item) => item.status === 'success').length;
    const warningItems = appState.results.filter((item) => item.status !== 'success').length;
    setStatus(
      `${appState.results.length}件のPDFを処理しました。判定成功 ${successCount}件 / 要確認 ${warningItems}件。`,
      successCount ? 'success' : 'warning'
    );
    downloadZipButton.disabled = !appState.results.length;
  }

  async function parsePdfFile(file) {
    const result = {
      file,
      originalName: file.name,
      extracted: {
        customer: '',
        docType: '',
        date: '',
        invoiceNo: ''
      },
      newFilename: '',
      status: 'warning',
      messages: [],
      matchedRuleId: '',
      metadata: {},
      textContent: ''
    };

    try {
      const buffer = await file.arrayBuffer();
      const pdf = await pdfjsLib.getDocument({ data: buffer }).promise;
      const metadata = await readMetadata(pdf);
      const textContent = await readTextContent(pdf);
      result.metadata = metadata;
      result.textContent = textContent;

      const evaluation = evaluateRules({
        filename: file.name,
        metadata,
        textContent
      });

      result.extracted = evaluation.extracted;
      result.newFilename = buildFilename(evaluation.extracted, evaluation.template);
      result.status = evaluation.status;
      result.messages = evaluation.messages;
      result.matchedRuleId = evaluation.matchedRuleId;
    } catch (error) {
      result.status = 'error';
      result.messages.push(`PDF解析に失敗しました: ${error.message}`);
      result.extracted.customer = window.PDF_RENAME_DEFAULTS.fallbackCustomer;
      result.extracted.docType = window.PDF_RENAME_DEFAULTS.fallbackDocType;
      result.extracted.date = window.PDF_RENAME_DEFAULTS.fallbackDate;
      result.extracted.invoiceNo = window.PDF_RENAME_DEFAULTS.fallbackInvoiceNo;
      result.newFilename = buildFilename(result.extracted, '{date}_{customer}_{docType}_{invoiceNo}.pdf');
    }

    return result;
  }

  async function readMetadata(pdf) {
    try {
      const metadataResponse = await pdf.getMetadata();
      const info = metadataResponse.info || {};
      const metadata = metadataResponse.metadata ? metadataResponse.metadata.getAll() : {};
      return { ...info, ...metadata };
    } catch (_error) {
      return {};
    }
  }

  async function readTextContent(pdf) {
    const pages = [];
    const maxPages = Math.min(pdf.numPages, 5);

    for (let pageNumber = 1; pageNumber <= maxPages; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      const content = await page.getTextContent();
      const pageText = content.items.map((item) => item.str).join(' ');
      pages.push(pageText);
    }

    return pages.join('\n').replace(/\s+/g, ' ').trim();
  }

  function evaluateRules({ filename, metadata, textContent }) {
    const normalizedFilename = filename.toLowerCase();
    const metadataText = JSON.stringify(metadata).toLowerCase();
    const normalizedText = textContent.toLowerCase();
    const matchedRule = (window.PDF_RENAME_RULES || []).find((rule) =>
      isRuleMatched(rule, normalizedFilename, metadataText, normalizedText)
    );

    if (!matchedRule) {
      const fallback = buildFallbackExtracted(filename, textContent);
      return {
        extracted: fallback,
        template: '{date}_{customer}_{docType}_{invoiceNo}.pdf',
        status: 'warning',
        matchedRuleId: '',
        messages: ['判定ルールに一致しなかったため未判定です。必要に応じてルールを追加してください。']
      };
    }

    const extracted = extractFields(matchedRule, textContent, filename);
    const messages = [];
    const missingFields = Object.entries(extracted)
      .filter(([, value]) => !value || String(value).includes('未判定') || String(value).includes('不明'))
      .map(([key]) => key);

    const status = missingFields.length ? 'warning' : 'success';
    if (missingFields.length) {
      messages.push(`一部抽出に失敗しました: ${missingFields.join(', ')}`);
    } else {
      messages.push(`ルール「${matchedRule.label}」を適用しました。`);
    }

    return {
      extracted,
      template: matchedRule.template,
      status,
      matchedRuleId: matchedRule.id,
      messages
    };
  }

  function isRuleMatched(rule, filename, metadataText, textContent) {
    const filenameMatched = matchesIncludes(rule.match.filenameIncludes, filename);
    const textMatched = matchesIncludes(rule.match.textIncludes, textContent);
    const metadataMatched = matchesIncludes(rule.match.metadataIncludes, metadataText);

    return filenameMatched || textMatched || metadataMatched;
  }

  function matchesIncludes(keywords = [], target = '') {
    return keywords.some((keyword) => target.includes(String(keyword).toLowerCase()));
  }

  function extractFields(rule, textContent, filename) {
    const defaults = window.PDF_RENAME_DEFAULTS;
    const extracted = {
      customer: extractValue(rule.extract.customer, textContent) || inferCustomerFromFilename(filename) || defaults.fallbackCustomer,
      docType: extractValue(rule.extract.docType, textContent) || inferDocTypeFromFilename(filename) || defaults.fallbackDocType,
      date: extractPatternValue(rule.extract.date, textContent) || normalizeDateString(inferDateFromText(textContent)) || defaults.fallbackDate,
      invoiceNo: extractPatternValue(rule.extract.invoiceNo, textContent) || defaults.fallbackInvoiceNo
    };

    extracted.date = normalizeDateString(extracted.date) || defaults.fallbackDate;
    return extracted;
  }

  function extractValue(definition, textContent) {
    if (!definition) return '';
    if (definition.fromText && definition.fromText.test(textContent)) {
      return definition.value || '';
    }
    return definition.value || '';
  }

  function extractPatternValue(definition, textContent) {
    if (!definition || !definition.patterns) return '';

    for (const pattern of definition.patterns) {
      const match = textContent.match(pattern);
      if (match && match[1]) {
        return match[1].trim();
      }
    }

    return '';
  }

  function inferCustomerFromFilename(filename) {
    const basename = filename.replace(/\.pdf$/i, '');
    const token = basename.split(/[_\-\s]/).find((part) => /[ぁ-んァ-ヶ一-龠a-zA-Z]/.test(part));
    return token || '';
  }

  function inferDocTypeFromFilename(filename) {
    if (/invoice|請求/i.test(filename)) return '請求書';
    if (/delivery|statement|納品/i.test(filename)) return '納品書';
    return '';
  }

  function inferDateFromText(textContent) {
    const patterns = [
      /([12]\d{3}[\/-]\d{1,2}[\/-]\d{1,2})/,
      /([12]\d{3}年\d{1,2}月\d{1,2}日)/
    ];

    for (const pattern of patterns) {
      const match = textContent.match(pattern);
      if (match && match[1]) {
        return match[1];
      }
    }

    return '';
  }

  function buildFallbackExtracted(filename, textContent) {
    const defaults = window.PDF_RENAME_DEFAULTS;
    return {
      customer: inferCustomerFromFilename(filename) || defaults.fallbackCustomer,
      docType: inferDocTypeFromFilename(filename) || defaults.fallbackDocType,
      date: normalizeDateString(inferDateFromText(textContent)) || defaults.fallbackDate,
      invoiceNo: defaults.fallbackInvoiceNo
    };
  }

  function buildFilename(extracted, template) {
    const values = {
      date: extracted.date,
      customer: extracted.customer,
      docType: extracted.docType,
      invoiceNo: extracted.invoiceNo
    };

    let filename = template.replace(/\{(date|customer|docType|invoiceNo)\}/g, (_, key) => values[key] || '');
    filename = sanitizeFilename(filename);
    return trimFilenameLength(filename);
  }

  function sanitizeFilename(filename) {
    const defaults = window.PDF_RENAME_DEFAULTS;
    const [stem, extension = 'pdf'] = splitExtension(filename);
    const safeStem = stem
      .replace(defaults.invalidFilenameChars, '_')
      .replace(/\s+/g, '_')
      .replace(/_+/g, '_')
      .replace(/^_+|_+$/g, '');

    return `${safeStem || 'renamed_file'}.${extension}`;
  }

  function trimFilenameLength(filename) {
    const defaults = window.PDF_RENAME_DEFAULTS;
    const [stem, extension] = splitExtension(filename);
    const maxStemLength = Math.max(10, defaults.maxFilenameLength - extension.length - 1);

    if (stem.length <= maxStemLength) {
      return filename;
    }

    return `${stem.slice(0, maxStemLength)}.${extension}`;
  }

  function splitExtension(filename) {
    const lastDotIndex = filename.lastIndexOf('.');
    if (lastDotIndex < 0) {
      return [filename, 'pdf'];
    }
    return [filename.slice(0, lastDotIndex), filename.slice(lastDotIndex + 1)];
  }

  function ensureUniqueFilenames(results) {
    const seen = new Map();

    return results.map((item) => {
      const uniqueName = createUniqueFilename(item.newFilename, seen);
      if (uniqueName !== item.newFilename) {
        item.messages.push('同名ファイルを検知したため連番を付与しました。');
        if (item.status === 'success') {
          item.status = 'warning';
        }
      }
      return { ...item, newFilename: uniqueName };
    });
  }

  function createUniqueFilename(filename, seen) {
    const key = filename.toLowerCase();
    if (!seen.has(key)) {
      seen.set(key, 1);
      return filename;
    }

    const nextCount = seen.get(key) + 1;
    seen.set(key, nextCount);
    const [stem, extension] = splitExtension(filename);
    return `${stem}_${nextCount}.${extension}`;
  }

  function normalizeDateString(value) {
    if (!value) return '';
    const normalized = value
      .replace(/年/g, '-')
      .replace(/月/g, '-')
      .replace(/日/g, '')
      .replace(/\//g, '-')
      .trim();

    const match = normalized.match(/([12]\d{3})-(\d{1,2})-(\d{1,2})/);
    if (!match) return value;

    const [, year, month, day] = match;
    return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
  }

  function renderResults() {
    fileCount.textContent = String(appState.results.length);
    matchedCount.textContent = String(appState.results.filter((item) => item.status === 'success').length);
    warningCount.textContent = String(appState.results.filter((item) => item.status !== 'success').length);

    if (!appState.results.length) {
      resultsBody.innerHTML = `
        <tr class="empty-row">
          <td colspan="7">まだPDFが追加されていません。</td>
        </tr>
      `;
      return;
    }

    resultsBody.innerHTML = appState.results
      .map(
        (item) => `
          <tr>
            <td>${buildStatusBadge(item.status)}</td>
            <td>
              <span class="filename">${escapeHtml(item.originalName)}</span>
              ${item.matchedRuleId ? `<span class="subtext">ルール: ${escapeHtml(item.matchedRuleId)}</span>` : ''}
            </td>
            <td><span class="filename">${escapeHtml(item.newFilename)}</span></td>
            <td>${escapeHtml(item.extracted.customer)}</td>
            <td>${escapeHtml(item.extracted.docType)}</td>
            <td>${escapeHtml(item.extracted.date)}</td>
            <td>
              <ul class="message-list">
                ${item.messages.map((message) => `<li>${escapeHtml(message)}</li>`).join('')}
              </ul>
            </td>
          </tr>
        `
      )
      .join('');
  }

  function buildStatusBadge(status) {
    if (status === 'success') {
      return '<span class="badge badge-success">判定成功</span>';
    }
    if (status === 'error') {
      return '<span class="badge badge-danger">エラー</span>';
    }
    return '<span class="badge badge-warning">要確認</span>';
  }

  function setStatus(message, tone) {
    statusMessage.textContent = message;
    statusMessage.dataset.tone = tone;
  }

  async function downloadZip() {
    if (!appState.results.length) return;

    setStatus('ZIPファイルを生成しています...', 'info');

    try {
      const zip = new JSZip();
      appState.results.forEach((item) => zip.file(item.newFilename, item.file));
      const blob = await zip.generateAsync({ type: 'blob' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `renamed-pdfs-${createTimestamp()}.zip`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      setStatus('ZIPファイルをダウンロードしました。', 'success');
    } catch (error) {
      setStatus(`ZIP生成に失敗しました: ${error.message}`, 'error');
    }
  }

  function createTimestamp() {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const date = String(now.getDate()).padStart(2, '0');
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    return `${year}${month}${date}-${hours}${minutes}`;
  }

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }
})();
