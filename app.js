// ===== Kas Griya Hasanah Sukaasih Dashboard =====
// LIVE data from Google Sheets (published CSV) with 15s auto-refresh.
// Falls back to static data.json if the live source is unreachable.
(function () {
  'use strict';

  // ---- Live data source config (from .env) ----
  const CSV_BASE = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vS110hF-GbNxVaVpeWT4iRhXg7nUTCNSnSiXjf0wAVQEkngXbs_edeHMAtuGT-pCxW7XboV8X6azqKH/pub';
  const GIDS = {
    DB_WARGA: '0',
    DB_IURAN: '874469326',
    DB_JIMPITAN: '289101412',
    DB_RONDA: '1895010945',
    DB_KERJA_BAKTI: '1926286795',
    DB_TUNGGAKAN: '919055302',
    DB_REKAP_PEMASUKAN: '1689879560',
    DB_REKAP_PENGELUARAN: '802104235',
    SUMMARY: '1326760248'
  };
  const REFRESH_MS = 15000; // 15 seconds

  // ---- Global state ----
  let sheets = {};       // { sheetName: [ {colLetter: value}, ... ] }
  let dataLoaded = false;
  let useLive = false;
  let lastUpdated = null;
  let loadError = null;

  // ===== CSV parsing =====
  // Parse a CSV string into rows of objects. Handles quoted fields.
  function parseCSV(text) {
    const rows = [];
    let row = [];
    let field = '';
    let inQuotes = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (inQuotes) {
        if (ch === '"') {
          if (text[i + 1] === '"') { field += '"'; i++; }
          else inQuotes = false;
        } else {
          field += ch;
        }
      } else {
        if (ch === '"') inQuotes = true;
        else if (ch === ',') { row.push(field); field = ''; }
        else if (ch === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
        else if (ch === '\r') { /* ignore */ }
        else field += ch;
      }
    }
    // last field / row if any
    if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row); }
    // Remove trailing empty rows
    while (rows.length && rows[rows.length - 1].every(function (c) { return c.trim() === ''; })) {
      rows.pop();
    }
    return rows;
  }

  // Convert CSV rows (array of arrays) into the {cells:[{col,value}]} structure
  // that the app originally used, mapping header names to column letters.
  function csvRowsToSheet(rows) {
    if (!rows.length) return [];
    const header = (rows[0] || []).map(function (h) { return String(h).trim(); });
    // Map first header row to column letters A, B, C, ...
    const headersToCol = {};
    header.forEach(function (h, idx) {
      if (h === '') return;
      headersToCol[h] = colName(idx);
    });
    const out = [];
    for (let r = 0; r < rows.length; r++) {
      const cells = [];
      const rowArr = rows[r];
      for (let c = 0; c < rowArr.length; c++) {
        const h = header[c];
        if (h === undefined || h === '') continue;
        const letter = headersToCol[h];
        if (letter) {
          cells.push({ col: letter, value: rowArr[c] });
        }
      }
      out.push({ cells: cells });
    }
    return out;
  }

  // Excel-style column letter for a zero-based index (0 -> A, 25 -> Z, 26 -> AA)
  function colName(idx) {
    let s = '';
    idx++;
    while (idx > 0) {
      const rem = (idx - 1) % 26;
      s = String.fromCharCode(65 + rem) + s;
      idx = Math.floor((idx - 1) / 26);
    }
    return s;
  }

  // Convert {cells:[{col,value}]} rows into objects keyed by column letter
  function normalizeRows(rows) {
    return rows.map(function (r) {
      const obj = {};
      (r.cells || []).forEach(function (c) { obj[c.col] = c.value; });
      return obj;
    });
  }

// ===== Data loading =====
  // Google Sheets published CSV redirects (307) and loses CORS headers on the
  // follow, so we route through a CORS proxy when running from a file:// or
  // non-allowed origin. Try direct first, then proxy fallback.
  const PROXIES = [
    function (u) { return 'https://api.allorigins.win/raw?url=' + encodeURIComponent(u); },
    function (u) { return 'https://corsproxy.io/?' + encodeURIComponent(u); }
  ];

  function sheetUrl(name) {
    return CSV_BASE + '?gid=' + GIDS[name] + '&single=true&output=csv';
  }

  async function fetchText(url) {
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return await res.text();
  }

  async function fetchSheet(name) {
    const url = sheetUrl(name);
    // Try direct first
    try {
      return { name: name, rows: parseCSV(await fetchText(url)) };
    } catch (e) {
      // Try each proxy in turn
      for (const prox of PROXIES) {
        try {
          return { name: name, rows: parseCSV(await fetchText(prox(url))) };
        } catch (e2) { /* try next */ }
      }
      throw new Error('Failed to load sheet ' + name);
    }
  }

  // Load static data.json as fallback
  async function loadFallback() {
    const res = await fetch('data.json', { cache: 'no-store' });
    if (!res.ok) throw new Error('Fallback data.json not found');
    const RAW = await res.json();
    const result = {};
    Object.keys(RAW).forEach(function (name) {
      result[name] = RAW[name];
    });
    return result;
  }

  async function refreshData() {
    const names = Object.keys(GIDS);
    try {
      const results = await Promise.all(names.map(fetchSheet));
      const newSheets = {};
      results.forEach(function (r) {
        newSheets[r.name] = normalizeRows(csvRowsToSheet(r.rows));
      });
      sheets = newSheets;
      useLive = true;
      loadError = null;
      lastUpdated = new Date();
      dataLoaded = true;
    } catch (e) {
      // Fallback to static data.json
      try {
        const fb = await loadFallback();
        Object.keys(fb).forEach(function (name) {
          sheets[name] = normalizeRows(fb[name]);
        });
        useLive = false;
        loadError = e && e.message ? e.message : String(e);
        lastUpdated = new Date();
        dataLoaded = true;
      } catch (e2) {
        dataLoaded = false;
        loadError = 'Data tidak dapat dimuat. Periksa koneksi.';
      }
    }
    render();
  }

  // ===== Column letter ordering helper =====
  function colVals(obj) {
    return Object.keys(obj).sort(function (a, b) {
      if (a.length !== b.length) return a.length - b.length;
      return a < b ? -1 : a > b ? 1 : 0;
    });
  }

  // Remove trailing empty rows
  function clean(sheetName) {
    const rows = sheets[sheetName] || [];
    const out = [];
    for (let i = 0; i < rows.length; i++) {
      const cells = colVals(rows[i]).filter(function (k) {
        return rows[i][k] !== '' && rows[i][k] != null;
      });
      if (cells.length) out.push(rows[i]);
    }
    return out;
  }

  // ===== Formatting =====
  const fmtNum = new Intl.NumberFormat('id-ID');
  function formatMoney(v) {
    const n = parseFloat(v);
    if (isNaN(n)) return v;
    return 'Rp ' + fmtNum.format(n);
  }
  function formatCell(v) {
    if (v == null || v === '') return '';
    if (typeof v === 'string' && v.trim() === '') return '';
    const n = parseFloat(v);
    if (!isNaN(n) && String(v).trim() !== '' && /^-?\d+(\.\d+)?$/.test(String(v))) {
      return fmtNum.format(n);
    }
    return v;
  }

  // ===== State =====
  let currentView = 'dashboard';
  let searchQuery = '';
  const pageSize = 15;
  const pageState = {};

  // Sheet metadata (title, icon, which columns to show)
  const META = {
    DB_WARGA: { title: 'Data Warga', icon: '👥', desc: 'Daftar warga' },
    DB_IURAN: { title: 'Data Iuran', icon: '💰', desc: 'Pemasukan iuran bulanan' },
    DB_JIMPITAN: { title: 'Data Jimpitan', icon: '🔄', desc: 'Pemasukan jimpitan' },
    DB_RONDA: { title: 'Data Ronda', icon: '🚨', desc: 'Pemasukan ronda' },
    DB_KERJA_BAKTI: { title: 'Data Kerja Bakti', icon: '🧹', desc: 'Pemasukan kerja bakti' },
    DB_TUNGGAKAN: { title: 'Data Tunggakan', icon: '⏰', desc: 'Daftar tunggakan warga' },
    DB_REKAP_PEMASUKAN: { title: 'Rekap Pemasukan', icon: '📈', desc: 'Rekap pemasukan per warga' },
    DB_REKAP_PENGELUARAN: { title: 'Rekap Pengeluaran', icon: '📉', desc: 'Rekap pengeluaran kas' },
    SUMMARY: { title: 'Summary Keuangan', icon: '🧾', desc: 'Ringkasan keuangan' }
  };

  // ===== DOM refs =====
  const content = document.getElementById('content');
  const pageTitle = document.getElementById('pageTitle');
  const pageSubtitle = document.getElementById('pageSubtitle');
  const nav = document.getElementById('nav');
  const sidebar = document.getElementById('sidebar');
  const overlay = document.getElementById('overlay');
  const menuBtn = document.getElementById('menuBtn');
  const globalSearch = document.getElementById('globalSearch');
  const liveBadge = document.getElementById('liveBadge');

  // ===== Navigation =====
  function setView(view) {
    currentView = view;
    document.querySelectorAll('.nav-item').forEach(function (b) {
      b.classList.toggle('active', b.dataset.view === view);
    });
    sidebar.classList.remove('open');
    overlay.classList.remove('show');
    render();
  }

  nav.addEventListener('click', function (e) {
    const btn = e.target.closest('.nav-item');
    if (btn) setView(btn.dataset.view);
  });

  menuBtn.addEventListener('click', function () {
    sidebar.classList.toggle('open');
    overlay.classList.toggle('show');
  });
  overlay.addEventListener('click', function () {
    sidebar.classList.remove('open');
    overlay.classList.remove('show');
  });

  globalSearch.addEventListener('input', function () {
    searchQuery = this.value.trim().toLowerCase();
    render();
  });

  // ===== Computation helpers =====
  function sumCol(rows, col) {
    return rows.reduce(function (acc, r) {
      const n = parseFloat(r[col]);
      return acc + (isNaN(n) ? 0 : n);
    }, 0);
  }

  function summarize() {
    const income = clean('DB_REKAP_PEMASUKAN');
    const expense = clean('DB_REKAP_PENGELUARAN');
    const warga = clean('DB_WARGA');

    const totalIncome = sumCol(income, 'J');   // TOTAL column
    const totalExpense = sumCol(expense, 'H'); // TOTAL column
    const balance = totalIncome - totalExpense;

    const byMonth = {};
    income.forEach(function (r) {
      const m = r.D || '?';
      byMonth[m] = (byMonth[m] || 0) + (parseFloat(r.J) || 0);
    });
    const expByMonth = {};
    expense.forEach(function (r) {
      const m = r.B || '?';
      expByMonth[m] = (expByMonth[m] || 0) + (parseFloat(r.H) || 0);
    });
    const order = ['JULI', 'AGUSTUS', 'SEPTEMBER', 'OKTOBER', 'NOVEMBER', 'DESEMBER', 'JANUARI', 'FEBRUARI', 'MARET', 'APRIL', 'MEI', 'JUNI'];

    const incomeRows = order.filter(function (m) { return byMonth[m]; }).map(function (m) {
      return { month: m, value: byMonth[m] };
    });
    const expRows = order.filter(function (m) { return expByMonth[m]; }).map(function (m) {
      return { month: m, value: expByMonth[m] };
    });

    const activeWarga = warga.filter(function (r) {
      return (r.B !== 'KOSONG' && r.C && r.C.trim() !== '' && r.C !== 'KOSONG');
    }).length;

    return {
      totalIncome: totalIncome,
      totalExpense: totalExpense,
      balance: balance,
      incomeRows: incomeRows,
      expRows: expRows,
      wargaCount: warga.length,
      activeWarga: activeWarga
    };
  }

  // ===== Render Dashboard =====
  function renderDashboard() {
    const s = summarize();
    const maxIncome = Math.max.apply(null, s.incomeRows.map(function (r) { return r.value; }).concat([1]));
    const maxExp = Math.max.apply(null, s.expRows.map(function (r) { return r.value; }).concat([1]));

    let html = '';
    html += '<div class="kpi-grid">';
    html += '<div class="kpi-card"><div class="kpi-ico blue">💵</div><div class="kpi-info"><div class="kpi-label">Total Pemasukan</div><div class="kpi-value">' + formatMoney(s.totalIncome) + '</div><div class="kpi-sub">Rekap pemasukan</div></div></div>';
    html += '<div class="kpi-card"><div class="kpi-ico red">💸</div><div class="kpi-info"><div class="kpi-label">Total Pengeluaran</div><div class="kpi-value">' + formatMoney(s.totalExpense) + '</div><div class="kpi-sub">Rekap pengeluaran</div></div></div>';
    html += '<div class="kpi-card"><div class="kpi-ico green">🏦</div><div class="kpi-info"><div class="kpi-label">Saldo Kas</div><div class="kpi-value">' + formatMoney(s.balance) + '</div><div class="kpi-sub">Pemasukan - Pengeluaran</div></div></div>';
    html += '<div class="kpi-card"><div class="kpi-ico amber">👥</div><div class="kpi-info"><div class="kpi-label">Warga Terdaftar</div><div class="kpi-value">' + fmtNum.format(s.wargaCount) + '</div><div class="kpi-sub">' + fmtNum.format(s.activeWarga) + ' aktif</div></div></div>';
    html += '</div>';

    // Charts
    html += '<div class="charts-row">';
    html += '<div class="chart-card"><h3>Pemasukan per Bulan</h3>';
    s.incomeRows.forEach(function (r) {
      const pct = (r.value / maxIncome) * 100;
      html += '<div class="bar-row"><div class="bar-label">' + r.month + '</div><div class="bar-track"><div class="bar-fill" style="width:' + pct + '%;background:var(--primary)"></div></div><div class="bar-val">' + formatMoney(r.value) + '</div></div>';
    });
    if (!s.incomeRows.length) html += '<div class="empty">Belum ada data</div>';
    html += '</div>';

    html += '<div class="chart-card"><h3>Pengeluaran per Bulan</h3>';
    s.expRows.forEach(function (r) {
      const pct = (r.value / maxExp) * 100;
      html += '<div class="bar-row"><div class="bar-label">' + r.month + '</div><div class="bar-track"><div class="bar-fill" style="width:' + pct + '%;background:var(--danger)"></div></div><div class="bar-val">' + formatMoney(r.value) + '</div></div>';
    });
    if (!s.expRows.length) html += '<div class="empty">Belum ada data</div>';
    html += '</div>';
    html += '</div>';

    // Summary cards quick links
    html += '<div class="summary-grid">';
    Object.keys(META).forEach(function (key) {
      const meta = META[key];
      const rows = clean(key);
      const count = rows.length ? rows.length - 1 : 0;
      html += '<div class="summary-card" style="cursor:pointer" onclick="document.querySelector(\'.nav-item[data-view=' + key + ']\').click()">';
      html += '<div style="font-size:28px">' + meta.icon + '</div>';
      html += '<div class="s-label" style="margin-top:8px">' + meta.title + '</div>';
      html += '<div class="s-value">' + fmtNum.format(count) + '</div>';
      html += '</div>';
    });
    html += '</div>';

    content.innerHTML = html;
  }

  // ===== Render a data table =====
  function renderSheetTable(name) {
    const meta = META[name];
    const data = clean(name);
    const headerRow = data[0] || {};
    const dataRows = data.slice(1);

    const headerCols = colVals(headerRow).filter(function (c) {
      return String(headerRow[c]).trim() !== '';
    });

    const allCols = [];
    headerCols.forEach(function (c) { if (allCols.indexOf(c) === -1) allCols.push(c); });
    dataRows.forEach(function (r) {
      colVals(r).forEach(function (c) {
        if (allCols.indexOf(c) === -1) allCols.push(c);
      });
    });

    const filtered = dataRows.filter(function (r) {
      if (!searchQuery) return true;
      return allCols.some(function (c) {
        return String(r[c] || '').toLowerCase().indexOf(searchQuery) !== -1;
      });
    });

    if (!pageState[name]) pageState[name] = 1;
    if (pageState[name] > Math.ceil(filtered.length / pageSize)) pageState[name] = 1;
    const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
    const currentPage = pageState[name];
    const start = (currentPage - 1) * pageSize;
    const pageRows = filtered.slice(start, start + pageSize);

    let html = '';
    html += '<div class="table-card">';
    html += '<div class="table-header">';
    html += '<div><h3>' + meta.icon + ' ' + meta.title + '</h3><div class="table-count">' + fmtNum.format(filtered.length) + ' baris</div></div>';
    html += '<div class="table-controls"><input type="text" placeholder="Cari... " value="" class="table-search"><select class="page-sel"></select></div>';
    html += '</div>';

    if (pageRows.length === 0) {
      html += '<div class="empty"><div class="big">🔍</div>Tidak ada data ditemukan</div>';
    } else {
      html += '<div class="table-wrap"><table><thead><tr>';
      allCols.forEach(function (c) {
        html += '<th>' + headerRow[c] + '</th>';
      });
      html += '</tr></thead><tbody>';
      pageRows.forEach(function (r) {
        html += '<tr>';
        allCols.forEach(function (c) {
          const v = r[c];
          const isNum = !isNaN(parseFloat(v)) && /^-?\d+(\.\d+)?$/.test(String(v));
          html += '<td class="' + (isNum ? 'num' : '') + '">' + formatCell(v) + '</td>';
        });
        html += '</tr>';
      });
      html += '</tbody></table></div>';
    }

    html += '<div class="table-footer"><span class="table-count">Menampilkan ' + fmtNum.format(start + 1) + '–' + fmtNum.format(Math.min(start + pageSize, filtered.length)) + ' dari ' + fmtNum.format(filtered.length) + '</span>';
    html += '<div class="pagination">';
    html += '<button data-pg="prev" ' + (currentPage === 1 ? 'disabled' : '') + '>‹</button>';
    let pgStart = Math.max(1, currentPage - 2);
    let pgEnd = Math.min(totalPages, pgStart + 4);
    pgStart = Math.max(1, pgEnd - 4);
    for (let i = pgStart; i <= pgEnd; i++) {
      html += '<button data-pg="' + i + '" class="' + (i === currentPage ? 'active' : '') + '">' + i + '</button>';
    }
    html += '<button data-pg="next" ' + (currentPage === totalPages ? 'disabled' : '') + '>›</button>';
    html += '</div></div>';
    html += '</div>';

    content.innerHTML = html;

    const pgWrap = content.querySelector('.pagination');
    if (pgWrap) {
      pgWrap.addEventListener('click', function (e) {
        const btn = e.target.closest('button');
        if (!btn || btn.disabled) return;
        const pg = btn.dataset.pg;
        if (pg === 'prev') pageState[name] = Math.max(1, currentPage - 1);
        else if (pg === 'next') pageState[name] = Math.min(totalPages, currentPage + 1);
        else pageState[name] = parseInt(pg, 10);
        render();
      });
    }
    const tSearch = content.querySelector('.table-search');
    if (tSearch) {
      tSearch.addEventListener('input', function () {
        searchQuery = this.value.trim().toLowerCase();
        pageState[name] = 1;
        render();
      });
    }
  }

  // ===== Summary view =====
  function renderSummary() {
    const s = summarize();
    const summaryRows = clean('SUMMARY');
    const headerRow = summaryRows[0] || {};

    let html = '';
    html += '<div class="kpi-grid">';
    html += '<div class="kpi-card"><div class="kpi-ico green">🏦</div><div class="kpi-info"><div class="kpi-label">Saldo</div><div class="kpi-value">' + formatMoney(s.balance) + '</div></div></div>';
    html += '<div class="kpi-card"><div class="kpi-ico blue">💵</div><div class="kpi-info"><div class="kpi-label">Pemasukan</div><div class="kpi-value">' + formatMoney(s.totalIncome) + '</div></div></div>';
    html += '<div class="kpi-card"><div class="kpi-ico red">💸</div><div class="kpi-info"><div class="kpi-label">Pengeluaran</div><div class="kpi-value">' + formatMoney(s.totalExpense) + '</div></div></div>';
    html += '</div>';

    html += '<div class="table-card"><div class="table-header"><div><h3>🧾 Summary Detail</h3></div></div><div class="table-wrap"><table><thead><tr>';
    colVals(headerRow).forEach(function (c) { html += '<th>' + headerRow[c] + '</th>'; });
    html += '</tr></thead><tbody>';
    summaryRows.slice(1).forEach(function (r) {
      html += '<tr>';
      colVals(headerRow).forEach(function (c) { html += '<td>' + formatCell(r[c]) + '</td>'; });
      html += '</tr>';
    });
    html += '</tbody></table></div></div>';

    content.innerHTML = html;
  }

  // ===== Render dispatcher =====
  function render() {
    if (!dataLoaded) {
      pageTitle.textContent = 'Memuat...';
      pageSubtitle.textContent = 'Mengambil data dari Google Sheets...';
      content.innerHTML = '<div class="empty"><div class="big">⏳</div>Memuat data live...</div>';
      return;
    }
    pageTitle.textContent = currentView === 'dashboard' ? 'Dashboard' : META[currentView].title;
    pageSubtitle.textContent = currentView === 'dashboard' ? 'Ringkasan keuangan kas warga' : META[currentView].desc;

    if (currentView === 'dashboard') renderDashboard();
    else if (currentView === 'SUMMARY') renderSummary();
    else renderSheetTable(currentView);

    // Update live badge
    if (liveBadge) {
      if (useLive) {
        liveBadge.textContent = '● LIVE';
        liveBadge.className = 'live-badge on';
        liveBadge.title = 'Data live dari Google Sheets. Terakhir: ' + (lastUpdated ? lastUpdated.toLocaleTimeString('id-ID') : '');
      } else {
        liveBadge.textContent = '● CADANGAN';
        liveBadge.className = 'live-badge off';
        liveBadge.title = 'Sumber live tidak tersedia, memakai data cadangan. ' + (loadError || '');
      }
    }
  }

  // ===== Init =====
  refreshData();
  setInterval(refreshData, REFRESH_MS);
})();
