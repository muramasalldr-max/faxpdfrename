window.PDF_RENAME_RULES = [
  {
    id: 'invoice-acme',
    label: 'Acme請求書',
    match: {
      filenameIncludes: ['invoice', '請求'],
      textIncludes: ['acme corporation', '請求書'],
      metadataIncludes: ['invoice']
    },
    extract: {
      customer: {
        fromText: /(?:Acme Corporation|株式会社アクメ)/i,
        value: 'Acme'
      },
      docType: {
        fromText: /請求書|invoice/i,
        value: '請求書'
      },
      date: {
        patterns: [
          /(?:発行日|請求日|Invoice Date)[:：\s]*([12]\d{3}[\/-]\d{1,2}[\/-]\d{1,2})/i,
          /([12]\d{3}年\d{1,2}月\d{1,2}日)/
        ]
      },
      invoiceNo: {
        patterns: [
          /(?:請求書番号|Invoice No\.?|Invoice #)[:：\s]*([A-Z0-9\-]+)/i
        ]
      }
    },
    template: '{date}_{customer}_{docType}_{invoiceNo}.pdf'
  },
  {
    id: 'statement-sample',
    label: 'Sample商会納品書',
    match: {
      filenameIncludes: ['statement', 'delivery', '納品'],
      textIncludes: ['sample商会', '納品書'],
      metadataIncludes: ['delivery']
    },
    extract: {
      customer: {
        fromText: /(?:Sample商会|サンプル商会)/i,
        value: 'Sample商会'
      },
      docType: {
        fromText: /納品書|delivery statement/i,
        value: '納品書'
      },
      date: {
        patterns: [
          /(?:納品日|Date)[:：\s]*([12]\d{3}[\/-]\d{1,2}[\/-]\d{1,2})/i,
          /([12]\d{3}年\d{1,2}月\d{1,2}日)/
        ]
      },
      invoiceNo: {
        patterns: [
          /(?:伝票番号|Reference No\.?|No\.)[:：\s]*([A-Z0-9\-]+)/i
        ]
      }
    },
    template: '{date}_{customer}_{docType}_{invoiceNo}.pdf'
  }
];

window.PDF_RENAME_DEFAULTS = {
  fallbackCustomer: '未判定顧客',
  fallbackDocType: '未判定書類',
  fallbackDate: '日付不明',
  fallbackInvoiceNo: 'NO-NUMBER',
  maxFilenameLength: 120,
  invalidFilenameChars: /[\\/:*?"<>|]/g
};
