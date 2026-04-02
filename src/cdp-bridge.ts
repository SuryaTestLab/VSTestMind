// ============================================================
// TestMind Phase 1 — CDP Bridge
// WebSocket connection to Chrome DevTools Protocol
// Injects the recorder script, captures DOM events
// ============================================================

import { EventEmitter } from 'events';
import * as http        from 'http';

const CDP = require('chrome-remote-interface');

export class CDPBridge extends EventEmitter {

  private client   : any    = null;
  private isRec    : boolean = false;
  private startTime: number  = 0;
  private port     : number  = 9222;

  // ── Connect to Chrome ─────────────────────────────────────
  async connect(port = 9222): Promise<{ ok: boolean; error?: string; browser?: string; tabCount?: number; port?: number }> {
    this.port = port;

    const tabs = await this._get(`http://localhost:${port}/json`);
    if (!tabs) {
      return {
        ok: false,
        error: `Cannot reach Chrome on port ${port}.\n\nLaunch Chrome first via the "🚀 Launch Chrome" button, or run:\n\nchrome --remote-debugging-port=${port}`,
      };
    }

    const info = await this._get(`http://localhost:${port}/json/version`);
    this.emit('connected', { port, browser: info?.Browser || 'Chrome', tabCount: tabs.length });
    return { ok: true, port, browser: info?.Browser, tabCount: tabs.length };
  }

  async disconnect(): Promise<void> {
    if (this.client) {
      await this.client.close().catch(() => {});
      this.client = null;
    }
    this.isRec = false;
    this.emit('disconnected');
  }

  // ── List open tabs ────────────────────────────────────────
  async listTabs(): Promise<{ id: string; title: string; url: string; favicon: string }[]> {
    const all = await this._get(`http://localhost:${this.port}/json`);
    if (!all) return [];
    return all
      .filter((t: any) => t.type === 'page' && !t.url.startsWith('devtools://'))
      .map((t: any) => ({
        id:      t.id,
        title:   t.title   || 'Untitled',
        url:     t.url     || '',
        favicon: t.faviconUrl || '',
      }));
  }

  // ── Attach to a tab ───────────────────────────────────────
  async attachTab(tabId: string): Promise<void> {
    if (this.client) await this.client.close().catch(() => {});

    this.client = await CDP({ port: this.port, target: tabId });

    const { Runtime, Page } = this.client;
    await Runtime.enable();
    await Page.enable();

    // Expose binding — recorder calls this to send events back
    await Runtime.addBinding({ name: '__tmEvent' });

    // Receive events from injected recorder
    Runtime.bindingCalled(({ name, payload }: any) => {
      if (name !== '__tmEvent' || !this.isRec) return;
      try {
        const evt = JSON.parse(payload);
        evt.id      = `e_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`;
        evt.elapsed = Date.now() - this.startTime;
        this.emit('event', evt);
      } catch {}
    });

    // Re-inject recorder after navigation (page reload wipes scripts)
    Page.loadEventFired(async () => {
      if (this.isRec) await this._inject().catch(() => {});
    });

    // Track navigations
    Page.frameNavigated(async ({ frame }: any) => {
      if (frame.parentId || !this.isRec) return;
      const r = await Runtime.evaluate({ expression: 'document.title' })
                              .catch(() => ({ result: { value: '' } }));
      this.emit('navigate', { url: frame.url, title: r.result?.value || '' });
    });
  }

  // ── Start / Stop recording ────────────────────────────────
  async startRecording(): Promise<{ ok: boolean; error?: string }> {
    if (!this.client) return { ok: false, error: 'No tab attached. Connect and select a tab first.' };
    this.isRec     = true;
    this.startTime = Date.now();
    await this._inject();
    return { ok: true };
  }

  async stopRecording(): Promise<void> {
    this.isRec = false;
    await this.client?.Runtime.evaluate({ expression: 'window.__tmStop?.()' }).catch(() => {});
  }

  // ── Inject recorder script into page ─────────────────────
  private async _inject(): Promise<void> {
    if (!this.client) return;
    await this.client.Runtime.evaluate({ expression: RECORDER_SCRIPT, awaitPromise: false });
  }

  // ── HTTP helper ───────────────────────────────────────────
  private _get(url: string): Promise<any> {
    return new Promise(resolve => {
      http.get(url, res => {
        let b = '';
        res.on('data', d => b += d);
        res.on('end', () => { try { resolve(JSON.parse(b)); } catch { resolve(null); } });
      }).on('error', () => resolve(null));
    });
  }
}

// ============================================================
// RECORDER SCRIPT
// Injected into Chrome via CDP Runtime.evaluate
// Captures DOM events and sends them back via __tmEvent binding
// ============================================================
const RECORDER_SCRIPT = `(function () {
  if (window.__tmActive) return;
  window.__tmActive = true;

  /* ── Recording banner ── */
  const banner = document.createElement('div');
  banner.id = '__tm_banner__';
  banner.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:2147483647;background:rgba(239,68,68,.92);color:#fff;font:700 12px/-apple-system,sans-serif;padding:6px 16px;display:flex;align-items:center;gap:7px;pointer-events:none;';
  banner.innerHTML = '<span style="width:8px;height:8px;background:#fff;border-radius:50%;animation:__tm_p 1s infinite;flex-shrink:0;display:inline-block"></span><span>TestMind — Recording</span>';

  const style = document.createElement('style');
  style.textContent = '@keyframes __tm_p{0%,100%{opacity:1}50%{opacity:.3}}';

  /* ── Hover highlight box ── */
  const hl = document.createElement('div');
  hl.id = '__tm_hl__';
  hl.style.cssText = 'position:fixed;pointer-events:none;z-index:2147483646;border:2px solid #00d4ff;border-radius:3px;background:rgba(0,212,255,.05);transition:top .08s,left .08s,width .08s,height .08s;display:none;';

  document.head?.appendChild(style);
  document.documentElement.appendChild(banner);
  document.documentElement.appendChild(hl);

  function own(el) { return el?.closest?.('#__tm_banner__,#__tm_hl__'); }

  /* ── Hover highlight ── */
  document.addEventListener('mouseover', e => {
    if (own(e.target)) return;
    const r = e.target.getBoundingClientRect();
    if (!r.width || !r.height) return;
    Object.assign(hl.style, { display:'block', top:(r.top-2)+'px', left:(r.left-2)+'px', width:r.width+'px', height:r.height+'px' });
  }, true);

  /* ── Send event ── */
  function send(data) {
    try { window.__tmEvent(JSON.stringify({ ...data, url: location.href, timestamp: Date.now() })); }
    catch (e) {}
  }

  /* ── Selector engine — 6 strategies ranked by resilience ── */
  function selectors(el) {
    if (!el || el === document.body) return null;
    const all = [];

    /* 1. data-testid / data-cy / data-qa */
    for (const a of ['data-testid','data-cy','data-qa','data-test','data-automation-id']) {
      const v = el.getAttribute(a);
      if (v) { all.push({ type:'testId',      value:'['+a+'="'+v+'"]',                          score:98 }); break; }
    }
    /* 2. aria-label */
    const al = el.getAttribute('aria-label');
    if (al) all.push({ type:'ariaLabel',  value:'[aria-label="'+al.replace(/"/g,'\\\\"')+'"]',  score:93 });
    /* 3. id */
    if (el.id && document.querySelectorAll('#'+CSS.escape(el.id)).length === 1)
      all.push({ type:'id',           value:'#'+el.id,                                          score:88 });
    /* 4. name */
    const nm = el.getAttribute('name');
    if (nm && document.querySelectorAll('[name="'+nm+'"]').length === 1)
      all.push({ type:'name',          value:'[name="'+nm+'"]',                                 score:83 });
    /* 5. placeholder */
    const ph = el.getAttribute('placeholder');
    if (ph) all.push({ type:'placeholder', value:'[placeholder="'+ph.replace(/"/g,'\\\\"')+'"]',score:78 });
    /* 6. CSS path */
    all.push({ type:'css', value: cssPath(el), score: 65 });

    all.sort((a, b) => b.score - a.score);
    return { best: all[0] || null, all, primary: all[0]?.value || cssPath(el) };
  }

  function cssPath(el) {
    const parts = [];
    let cur = el;
    while (cur && cur !== document.body && cur.nodeType === 1) {
      let seg = cur.tagName.toLowerCase();
      if (cur.id) { parts.unshift('#' + cur.id); break; }
      const par = cur.parentElement;
      if (par) {
        const sibs = Array.from(par.children).filter(c => c.tagName === cur.tagName);
        if (sibs.length > 1) seg += ':nth-of-type(' + (sibs.indexOf(cur) + 1) + ')';
      }
      parts.unshift(seg);
      cur = cur.parentElement;
      if (parts.length > 5) break;
      try { if (document.querySelectorAll(parts.join(' > ')).length === 1) break; } catch { break; }
    }
    return parts.join(' > ');
  }

  function elInfo(el) {
    if (!el) return {};
    const r = el.getBoundingClientRect();
    return {
      tagName:     el.tagName?.toLowerCase(),
      type:        el.type     || null,
      placeholder: el.placeholder || null,
      innerText:   el.innerText?.trim().slice(0, 80) || null,
      value:       el.type === 'password' ? '***' : (el.value || null),
      href:        el.href     || null,
      ariaLabel:   el.getAttribute('aria-label') || null,
      className:   el.className || null,
      rect: { top: Math.round(r.top), left: Math.round(r.left), width: Math.round(r.width), height: Math.round(r.height) },
    };
  }

  /* ── Listeners ── */
  document.addEventListener('click',    e => { if (!own(e.target)) send({ type:'click',      selectors:selectors(e.target), elementInfo:elInfo(e.target) }); },             true);
  document.addEventListener('dblclick', e => { if (!own(e.target)) send({ type:'doubleClick',selectors:selectors(e.target), elementInfo:elInfo(e.target) }); },             true);
  document.addEventListener('input',    e => {
    if (own(e.target)) return;
    const el = e.target;
    if (!['INPUT','TEXTAREA'].includes(el.tagName) && !el.isContentEditable) return;
    send({ type:'input', selectors:selectors(el), elementInfo:elInfo(el), value: el.type==='password'?'***MASKED***':el.value, isPassword: el.type==='password' });
  }, true);
  document.addEventListener('change', e => {
    if (own(e.target)) return;
    const el = e.target;
    if (el.tagName === 'SELECT')
      send({ type:'select', selectors:selectors(el), elementInfo:elInfo(el), value:el.value, selectedText:el.options[el.selectedIndex]?.text });
    else if (el.type === 'checkbox' || el.type === 'radio')
      send({ type: el.type==='checkbox'?'check':'radio', selectors:selectors(el), elementInfo:elInfo(el), checked:el.checked, value:el.value });
  }, true);
  document.addEventListener('keydown', e => {
    if (own(e.target)) return;
    const special = ['Enter','Tab','Escape','ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Backspace','Delete','F5','F12'];
    if (special.includes(e.key) || e.ctrlKey || e.metaKey)
      send({ type:'keyPress', selectors:selectors(e.target), key:e.key, ctrlKey:e.ctrlKey, metaKey:e.metaKey, altKey:e.altKey, shiftKey:e.shiftKey });
  }, true);
  let _st = null;
  document.addEventListener('scroll', () => {
    clearTimeout(_st);
    _st = setTimeout(() => send({ type:'scroll', scrollX:window.scrollX, scrollY:window.scrollY }), 500);
  }, { capture:true, passive:true });
  document.addEventListener('submit', e => { if (!own(e.target)) send({ type:'formSubmit', selectors:selectors(e.target), elementInfo:elInfo(e.target) }); }, true);

  /* ── Stop ── */
  window.__tmStop = () => {
    banner.remove(); hl.remove(); style.remove();
    window.__tmActive = false;
  };
})();`;
