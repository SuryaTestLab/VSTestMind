// ============================================================
// TestMind Phase 1 — Recorder Webview Panel
// Creates and manages the VSCode webview panel
// ============================================================

import * as vscode from 'vscode';
import * as path   from 'path';
import * as fs     from 'fs';

type MessageHandler = (msg: any, ctx: vscode.ExtensionContext) => void;

export class RecorderPanel {
  private _panel  : vscode.WebviewPanel;
  private _ctx    : vscode.ExtensionContext;
  private _handler: MessageHandler;
  private _onDispose?: () => void;

  constructor(ctx: vscode.ExtensionContext, handler: MessageHandler) {
    this._ctx     = ctx;
    this._handler = handler;

    this._panel = vscode.window.createWebviewPanel(
      'testmind.recorder',
      'TestMind Recorder',
      vscode.ViewColumn.One,
      {
        enableScripts:           true,
        retainContextWhenHidden: true,
        localResourceRoots: [
          vscode.Uri.file(path.join(ctx.extensionPath, 'media')),
        ],
      }
    );

    // Set tab icon
    const iconUri = vscode.Uri.file(path.join(ctx.extensionPath, 'media', 'icon.svg'));
    this._panel.iconPath = { light: iconUri, dark: iconUri };

    // Load HTML content
    this._panel.webview.html = this._html();

    // Route messages from webview → extension
    this._panel.webview.onDidReceiveMessage(msg => this._handler(msg, this._ctx));

    this._panel.onDidDispose(() => this._onDispose?.());
  }

  reveal()                    { this._panel.reveal(vscode.ViewColumn.One); }
  send(msg: any)              { this._panel.webview.postMessage(msg); }
  onDispose(fn: () => void)   { this._onDispose = fn; }

  private _html(): string {
    const mediaPath = path.join(this._ctx.extensionPath, 'media');
    const css = fs.readFileSync(path.join(mediaPath, 'panel.css'), 'utf-8');
    const js  = fs.readFileSync(path.join(mediaPath, 'panel.js'),  'utf-8');
    const nonce = Array.from({ length: 32 }, () => 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'[Math.floor(Math.random() * 62)]).join('');

    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy"
  content="default-src 'none';
           style-src  'unsafe-inline' https://fonts.googleapis.com;
           font-src   https://fonts.gstatic.com;
           script-src 'nonce-${nonce}';">
<meta name="viewport" content="width=device-width, initial-scale=1">
<link href="https://fonts.googleapis.com/css2?family=Syne:wght@400;600;700;800&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
<title>TestMind</title>
<style>${css}</style>
</head>
<body>
${PANEL_HTML}
<script nonce="${nonce}">${js}</script>
</body>
</html>`;
  }
}

// ── Panel HTML structure ──────────────────────────────────
const PANEL_HTML = `
<div class="app">

  <!-- Header -->
  <div class="topbar">
    <span class="logo">TestMind</span>
    <span class="logo-sub">RECORDER</span>
    <div class="conn-pill" id="connPill">
      <span class="cdot" id="cdot"></span>
      <span id="connTxt">Not connected</span>
    </div>
    <div style="flex:1"></div>
    <button class="btn ghost sm" id="btnSaveSession">💾 Save</button>
    <button class="btn ghost sm" id="btnLoadSession">📂 Load</button>
  </div>

  <!-- Two-column layout -->
  <div class="layout">

    <!-- LEFT: Steps + Controls -->
    <div class="left-col">

      <!-- Chrome launcher -->
      <section class="card">
        <div class="card-hd">🚀 Browser Connection</div>
        <div class="launch-row">
          <input id="urlInput" class="inp flex1" type="text" placeholder="https://your-app.com" value="">
          <button class="btn primary" id="btnLaunch">Launch Chrome</button>
        </div>
        <div class="port-row">
          <span class="lbl">Port</span>
          <input id="portInput" class="inp w80" type="number" value="9222">
          <button class="btn ghost sm" id="btnConnect">Connect existing</button>
          <button class="btn ghost sm" id="btnTabs">↻ Tabs</button>
        </div>
        <div class="err" id="errBox" style="display:none"></div>
      </section>

      <!-- Tab picker -->
      <section class="card" id="tabsCard" style="display:none">
        <div class="card-hd">🗂 Select Tab <span class="dim">(click Attach)</span></div>
        <div class="tabs-list" id="tabsList"></div>
      </section>

      <!-- Recording controls + live steps -->
      <section class="card" id="recCard" style="display:none">
        <div class="card-hd">
          ⏺ Recording
          <div class="rec-pill" id="recPill" style="display:none"><span class="rdot"></span> <span id="recTime">0:00</span></div>
          <span style="margin-left:auto;font-size:11px" id="stepCount" class="dim">0 steps</span>
        </div>
        <div class="rec-bar">
          <button class="btn primary" id="btnRec">⏺ Start Recording</button>
          <button class="btn ghost"   id="btnClear">🗑 Clear</button>
        </div>
        <div class="steps-list" id="stepsList">
          <div class="empty"><div class="ei">⏺</div><p>Click Start Recording, then interact with the browser</p></div>
        </div>
      </section>

    </div>

    <!-- RIGHT: Code generator -->
    <div class="right-col">
      <section class="card full-h">
        <div class="card-hd">☕ Selenium Java</div>

        <!-- Options -->
        <div class="gen-opts">
          <div class="opt-row">
            <span class="lbl">Class name</span>
            <input id="genClass" class="inp flex1" type="text" value="RecordedTest">
          </div>
          <div class="opt-row">
            <span class="lbl">Package</span>
            <input id="genPkg" class="inp flex1" type="text" value="com.testmind.tests">
          </div>
          <div class="opt-row">
            <span class="lbl">Framework</span>
            <select id="genFw" class="inp">
              <option value="testng">TestNG</option>
              <option value="junit5">JUnit 5</option>
              <option value="junit4">JUnit 4</option>
            </select>
            <span class="lbl" style="margin-left:8px">Wait (s)</span>
            <input id="genWait" class="inp w60" type="number" value="10" min="1" max="60">
          </div>
        </div>

        <!-- Action buttons -->
        <div class="gen-actions">
          <button class="btn primary" id="btnGen">✨ Generate Code</button>
          <button class="btn ghost"   id="btnOpenEditor" disabled>📄 Open in Editor</button>
          <button class="btn ghost"   id="btnSaveJava"   disabled>💾 Save .java</button>
          <button class="btn ghost"   id="btnCopyCode"   disabled>📋 Copy</button>
        </div>

        <!-- Code display -->
        <div class="code-toolbar">
          <span class="lang-tag">JAVA</span>
          <span id="codeInfo" class="dim"></span>
        </div>
        <pre class="code-area" id="codeArea"><span class="cm">// Click "Generate Code" after recording steps</span></pre>

      </section>
    </div>

  </div>
</div>
`;
