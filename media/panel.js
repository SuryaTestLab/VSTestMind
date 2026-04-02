// ============================================================
// TestMind Phase 1 — Webview Panel Controller
// Runs inside VSCode webview. Talks to extension via postMessage.
// ============================================================

/* eslint-disable */
const vscode = acquireVsCodeApi();

// ── State ─────────────────────────────────────────────────
let events      = [];
let genCode     = '';
let isRecording = false;
let recTimer    = null;
let recStart    = 0;

// ── Event meta ────────────────────────────────────────────
const META = {
  navigate:    { label:'Navigate',     icon:'🌐', cls:'ic-nav' },
  click:       { label:'Click',        icon:'🖱',  cls:'ic-clk' },
  doubleClick: { label:'Dbl Click',    icon:'🖱',  cls:'ic-clk' },
  input:       { label:'Type',         icon:'⌨',  cls:'ic-typ' },
  select:      { label:'Select',       icon:'▼',   cls:'ic-sel' },
  check:       { label:'Check',        icon:'☑',   cls:'ic-nav' },
  radio:       { label:'Radio',        icon:'⦿',   cls:'ic-nav' },
  keyPress:    { label:'Key',          icon:'⌨',  cls:'ic-key' },
  scroll:      { label:'Scroll',       icon:'↕',   cls:'ic-scr' },
  formSubmit:  { label:'Submit',       icon:'📤',  cls:'ic-frm' },
};

// ============================================================
// INIT
// ============================================================
document.addEventListener('DOMContentLoaded', () => {
  wireButtons();
});

function wireButtons() {
  // Browser
  $('btnLaunch').onclick  = () => post({ type:'chrome:launch', url: $('urlInput').value.trim() || 'about:blank' });
  $('btnConnect').onclick = () => post({ type:'cdp:connect',   port: +$('portInput').value || 9222 });
  $('btnTabs').onclick    = () => post({ type:'cdp:tabs' });

  // Recording
  $('btnRec').onclick   = toggleRec;
  $('btnClear').onclick = clearSteps;

  // Code gen
  $('btnGen').onclick        = generate;
  $('btnOpenEditor').onclick = () => post({ type:'gen:open',  code: genCode, className: $('genClass').value || 'RecordedTest' });
  $('btnSaveJava').onclick   = () => post({ type:'gen:save',  code: genCode, className: $('genClass').value || 'RecordedTest' });
  $('btnCopyCode').onclick   = copyCode;

  // Session
  $('btnSaveSession').onclick = () => post({ type:'session:save' });
  $('btnLoadSession').onclick = () => post({ type:'session:load' });
}

// ============================================================
// MESSAGES FROM EXTENSION
// ============================================================
window.addEventListener('message', ({ data: msg }) => {
  switch (msg.type) {

    case 'cdp:ok':
      $('cdot').classList.add('on');
      $('connTxt').textContent = `${msg.info?.browser || 'Chrome'} · port ${msg.info?.port || ''}`;
      $('errBox').style.display = 'none';
      $('tabsCard').style.display = 'block';
      post({ type: 'cdp:tabs' });
      break;

    case 'cdp:gone':
      $('cdot').classList.remove('on');
      $('connTxt').textContent = 'Not connected';
      $('tabsCard').style.display = 'none';
      $('recCard').style.display  = 'none';
      break;

    case 'cdp:err':
      showErr(msg.msg);
      break;

    case 'tabs:list':
      renderTabs(msg.tabs || []);
      break;

    case 'tab:attached':
      $('recCard').style.display = 'block';
      break;

    case 'rec:started':
      isRecording = true;
      recStart    = Date.now();
      events      = [];
      $('stepsList').innerHTML = '<div class="empty"><div class="ei">⏺</div><p>Interact with Chrome — steps appear here</p></div>';
      $('btnRec').textContent  = '⏹ Stop Recording';
      $('btnRec').classList.add('recording');
      $('btnRec').classList.remove('primary');
      $('recPill').style.display = 'flex';
      recTimer = setInterval(() => {
        const s = Math.floor((Date.now() - recStart) / 1000);
        $('recTime').textContent = pad(Math.floor(s/60)) + ':' + pad(s%60);
      }, 1000);
      break;

    case 'rec:stopped':
      isRecording = false;
      clearInterval(recTimer);
      $('btnRec').textContent  = '⏺ Start Recording';
      $('btnRec').classList.remove('recording');
      $('btnRec').classList.add('primary');
      $('recPill').style.display = 'none';
      if (msg.events) { events = msg.events; rerenderSteps(); }
      updateCount();
      break;

    case 'rec:cleared':
      events = [];
      $('stepsList').innerHTML = '<div class="empty"><div class="ei">⏺</div><p>Click Start Recording, then interact with the browser</p></div>';
      updateCount();
      break;

    case 'evt:new':
    case 'evt:navigate': {
      const e = msg.event;
      // Collapse input events in-place
      if (e.type === 'input' && events.length) {
        const last = events[events.length - 1];
        if (last.type === 'input' && last.selectors?.primary === e.selectors?.primary) {
          events[events.length - 1] = e;
          updateLastRow(e);
          return;
        }
      }
      events.push(e);
      appendRow(e, events.length);
      updateCount();
      break;
    }

    case 'gen:done':
      genCode = msg.code;
      renderCode(msg.code, msg.steps);
      $('btnOpenEditor').disabled = false;
      $('btnSaveJava').disabled   = false;
      $('btnCopyCode').disabled   = false;
      break;

    case 'gen:err':
      alert(msg.msg);
      break;

    case 'gen:saved':
      $('codeInfo').textContent = '✅ Saved: ' + (msg.filePath || '');
      break;

    case 'session:loaded':
      events = msg.events || [];
      rerenderSteps();
      updateCount();
      break;
  }
});

// ============================================================
// ACTIONS
// ============================================================
function toggleRec() {
  if (isRecording) post({ type: 'rec:stop' });
  else             post({ type: 'rec:start' });
}

function clearSteps() {
  if (events.length && !confirm('Clear all recorded steps?')) return;
  post({ type: 'rec:clear' });
}

function generate() {
  if (!events.length) { alert('No steps recorded yet.'); return; }
  post({
    type:        'gen:run',
    framework:   $('genFw').value,
    className:   $('genClass').value || 'RecordedTest',
    packageName: $('genPkg').value   || 'com.testmind.tests',
    waitSec:     +$('genWait').value || 10,
  });
}

function copyCode() {
  if (!genCode) return;
  const ta = document.createElement('textarea');
  ta.value = genCode;
  ta.style.cssText = 'position:fixed;opacity:0';
  document.body.appendChild(ta);
  ta.select();
  document.execCommand('copy');
  ta.remove();
  const btn = $('btnCopyCode');
  btn.textContent = '✓ Copied!';
  setTimeout(() => btn.textContent = '📋 Copy', 1800);
}

// ============================================================
// RENDERING
// ============================================================
function renderTabs(tabs) {
  const list = $('tabsList');
  list.innerHTML = '';

  if (!tabs.length) {
    list.innerHTML = '<div style="padding:10px;color:var(--muted);font-size:12px">No open tabs found. Open a page in Chrome first.</div>';
    return;
  }

  tabs.forEach(tab => {
    const row = document.createElement('div');
    row.className = 'tab-row';
    row.innerHTML = `
      <div style="flex:1;min-width:0">
        <div class="tab-title">${esc(tab.title || 'Untitled')}</div>
        <div class="tab-url">${esc(tab.url || '')}</div>
      </div>
      <button class="btn ghost sm">Attach</button>
    `;
    row.querySelector('button').onclick = e => {
      e.stopPropagation();
      document.querySelectorAll('.tab-row').forEach(r => r.classList.remove('sel'));
      row.classList.add('sel');
      post({ type: 'cdp:attach', tabId: tab.id });
    };
    list.appendChild(row);
  });
}

function appendRow(evt, num) {
  const list = $('stepsList');
  const empty = list.querySelector('.empty');
  if (empty) empty.remove();

  const m = META[evt.type] || { label: evt.type, icon:'•', cls:'' };
  const detail  = getDetail(evt);
  const selVal  = evt.selectors?.best?.value || '';
  const selType = evt.selectors?.best?.type  || '';
  const elapsed = evt.elapsed ? `+${(evt.elapsed/1000).toFixed(1)}s` : '';

  const row = document.createElement('div');
  row.className = 'step-row';
  row.dataset.id = evt.id;
  row.innerHTML = `
    <div class="sn">${num}</div>
    <div class="si ${m.cls}">${m.icon}</div>
    <div class="sb">
      <div class="sa">${m.label}</div>
      <div class="sd">${esc(detail)}</div>
      ${selVal ? `<div class="ss">[${selType}] ${esc(selVal.slice(0,55))}${selVal.length>55?'…':''}</div>` : ''}
    </div>
    <div class="st">${elapsed}</div>
  `;
  list.appendChild(row);
  list.scrollTop = list.scrollHeight;
}

function updateLastRow(evt) {
  const row = $('stepsList').querySelector(`[data-id="${evt.id}"]`);
  if (row) {
    const sd = row.querySelector('.sd');
    if (sd) sd.textContent = esc(getDetail(evt));
  }
}

function rerenderSteps() {
  $('stepsList').innerHTML = '';
  events.forEach((evt, i) => appendRow(evt, i + 1));
}

function renderCode(code, steps) {
  const area = $('codeArea');
  // Simple syntax highlighting
  area.innerHTML = code
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/\b(import|public|private|class|void|new|return|if|for|while|try|catch|static|final)\b/g,'<span class="kw">$1</span>')
    .replace(/(@\w+)/g,'<span class="ann">$1</span>')
    .replace(/"([^"\\]|\\.)*"/g,'<span class="str">$&</span>')
    .replace(/(\/\/[^\n]*)/g,'<span class="cm">$1</span>');
  $('codeInfo').textContent = `${code.split('\n').length} lines · ${steps} steps`;
}

function updateCount() {
  $('stepCount').textContent = `${events.length} step${events.length !== 1 ? 's' : ''}`;
}

function showErr(msg) {
  const el = $('errBox');
  el.textContent    = msg;
  el.style.display  = 'block';
}

// ── Helpers ───────────────────────────────────────────────
function getDetail(evt) {
  const info = evt.elementInfo || {};
  switch (evt.type) {
    case 'navigate':    return evt.url?.slice(0,60) || '';
    case 'click':       return info.innerText?.slice(0,40) || info.tagName || '';
    case 'doubleClick': return info.innerText?.slice(0,40) || '';
    case 'input':       return evt.isPassword ? '••••••••' : `"${(evt.value||'').slice(0,40)}"`;
    case 'select':      return `"${evt.selectedText || evt.value || ''}"`;
    case 'check':       return `${evt.checked ? '☑' : '☐'} ${info.innerText || ''}`;
    case 'keyPress':    return `${evt.ctrlKey?'Ctrl+':''}${evt.metaKey?'⌘':''}${evt.key}`;
    case 'scroll':      return `(${evt.scrollX||0}, ${evt.scrollY||0})`;
    case 'formSubmit':  return info.id || 'form';
    default:            return '';
  }
}

function post(msg) { vscode.postMessage(msg); }
function $(id)     { return document.getElementById(id); }
function pad(n)    { return String(n).padStart(2, '0'); }
function esc(s)    { return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
