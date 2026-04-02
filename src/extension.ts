// ============================================================
// TestMind Phase 1 — VSCode Extension
// Record browser interactions via CDP → Generate Selenium Java
// No AI, no external API calls, no API keys required
// ============================================================

import * as vscode from 'vscode';
import * as path   from 'path';
import * as fs     from 'fs';
import * as cp     from 'child_process';

import { CDPBridge }    from './cdp-bridge';
import { SessionStore } from './session-store';
import { CodeGen }      from './codegen';
import { RecorderPanel } from './recorder-panel';

// ── Singletons ────────────────────────────────────────────
let panel        : RecorderPanel | undefined;
let cdp          : CDPBridge     = new CDPBridge();
let store        : SessionStore  = new SessionStore();
let chromeProc   : cp.ChildProcess | undefined;

// ============================================================
// ACTIVATE
// ============================================================
export function activate(context: vscode.ExtensionContext) {

  // ── Commands ────────────────────────────────────────────
  context.subscriptions.push(

    vscode.commands.registerCommand('testmind.open', () => {
      openPanel(context);
    }),

    vscode.commands.registerCommand('testmind.launchChrome', () => {
      launchChrome(context);
    }),

  );

  // ── Pipe CDP events → webview ───────────────────────────
  cdp.on('event',       (evt)  => {
    const stored = store.add(evt);
    if (stored) panel?.send({ type: 'evt:new',    event: stored });
  });
  cdp.on('navigate',    (info) => {
    const stored = store.addNavigate(info);
    panel?.send({ type: 'evt:navigate', event: stored });
  });
  cdp.on('connected',   (info) => panel?.send({ type: 'cdp:ok',    info  }));
  cdp.on('disconnected',()     => panel?.send({ type: 'cdp:gone'          }));
  cdp.on('error',       (err)  => panel?.send({ type: 'cdp:err', msg: err.message }));

  // Auto-open panel
  openPanel(context);
}

// ============================================================
// PANEL
// ============================================================
function openPanel(ctx: vscode.ExtensionContext) {
  if (panel) { panel.reveal(); return; }
  panel = new RecorderPanel(ctx, handleMessage);
  panel.onDispose(() => { panel = undefined; });
}

// ============================================================
// MESSAGE HANDLER  (webview → extension)
// ============================================================
async function handleMessage(msg: any, ctx: vscode.ExtensionContext) {
  const cfg = getConfig();

  switch (msg.type) {

    // ── Chrome ──────────────────────────────────────────────
    case 'chrome:launch':
      launchChrome(ctx, msg.url);
      break;

    // ── CDP ──────────────────────────────────────────────────
    case 'cdp:connect': {
      const r = await cdp.connect(msg.port ?? cfg.cdpPort);
      if (!r.ok) panel?.send({ type: 'cdp:err', msg: r.error });
      break;
    }

    case 'cdp:tabs':
      panel?.send({ type: 'tabs:list', tabs: await cdp.listTabs() });
      break;

    case 'cdp:attach':
      await cdp.attachTab(msg.tabId);
      panel?.send({ type: 'tab:attached' });
      break;

    // ── Recording ────────────────────────────────────────────
    case 'rec:start': {
      const r = await cdp.startRecording();
      if (r.ok) {
        store.startSession();
        panel?.send({ type: 'rec:started' });
      } else {
        panel?.send({ type: 'cdp:err', msg: r.error });
      }
      break;
    }

    case 'rec:stop':
      await cdp.stopRecording();
      panel?.send({ type: 'rec:stopped', events: store.getAll() });
      break;

    case 'rec:clear':
      store.clear();
      panel?.send({ type: 'rec:cleared' });
      break;

    // ── Code generation ───────────────────────────────────────
    case 'gen:run': {
      const events = store.getAll();
      if (!events.length) {
        panel?.send({ type: 'gen:err', msg: 'No steps recorded yet.' });
        break;
      }
      const gen  = new CodeGen({ framework: msg.framework ?? cfg.defaultFramework });
      const code = gen.generate(events, {
        className:   msg.className   ?? 'RecordedTest',
        packageName: msg.packageName ?? cfg.defaultPackage,
        baseUrl:     store.baseUrl(),
      });
      panel?.send({ type: 'gen:done', code, steps: events.length });
      break;
    }

    case 'gen:save': {
      await saveFile(msg.code, msg.className ?? 'RecordedTest', ctx);
      break;
    }

    case 'gen:open': {
      // Write to a temp file and open beside the panel
      const tmpDir = ctx.globalStorageUri.fsPath;
      fs.mkdirSync(tmpDir, { recursive: true });
      const tmpFile = path.join(tmpDir, `${msg.className ?? 'RecordedTest'}.java`);
      fs.writeFileSync(tmpFile, msg.code, 'utf-8');
      const doc = await vscode.workspace.openTextDocument(tmpFile);
      vscode.window.showTextDocument(doc, vscode.ViewColumn.Beside);
      break;
    }

    // ── Session ───────────────────────────────────────────────
    case 'session:save': {
      const uri = await vscode.window.showSaveDialog({
        defaultUri: vscode.Uri.file('testmind-session.json'),
        filters: { 'TestMind Session': ['json'] },
      });
      if (uri) {
        fs.writeFileSync(uri.fsPath, JSON.stringify(store.toJSON(), null, 2), 'utf-8');
        vscode.window.showInformationMessage(`Session saved: ${path.basename(uri.fsPath)}`);
      }
      break;
    }

    case 'session:load': {
      const uris = await vscode.window.showOpenDialog({
        canSelectMany: false,
        filters: { 'TestMind Session': ['json'] },
      });
      if (uris?.[0]) {
        const data = JSON.parse(fs.readFileSync(uris[0].fsPath, 'utf-8'));
        store.load(data);
        panel?.send({ type: 'session:loaded', events: store.getAll() });
      }
      break;
    }
  }
}

// ============================================================
// CHROME LAUNCHER
// ============================================================
function launchChrome(ctx: vscode.ExtensionContext, url?: string) {
  const cfg        = getConfig();
  const port       = cfg.cdpPort;
  const chromePath = cfg.chromePath || detectChrome();

  if (!chromePath) {
    vscode.window.showErrorMessage(
      'Chrome not found. Set testmind.chromePath in settings.',
      'Open Settings'
    ).then(a => {
      if (a === 'Open Settings')
        vscode.commands.executeCommand('workbench.action.openSettings', 'testmind.chromePath');
    });
    return;
  }

  chromeProc?.kill();

  const profileDir = path.join(ctx.globalStorageUri.fsPath, 'chrome-profile');
  fs.mkdirSync(profileDir, { recursive: true });

  const args = [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profileDir}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--start-maximized',
    url || 'about:blank',
  ];

  chromeProc = cp.spawn(chromePath, args, { detached: true, stdio: 'ignore' });
  chromeProc.unref();

  // Auto-connect after Chrome starts
  setTimeout(async () => {
    const r = await cdp.connect(port);
    if (!r.ok) {
      vscode.window.showWarningMessage(`TestMind: Could not connect to Chrome on port ${port}`);
    }
  }, 1800);
}

// ============================================================
// SAVE FILE
// ============================================================
async function saveFile(code: string, className: string, ctx: vscode.ExtensionContext) {
  const cfg       = getConfig();
  const wsFolder  = vscode.workspace.workspaceFolders?.[0];

  let defaultUri: vscode.Uri;
  if (wsFolder) {
    const outDir = path.join(
      wsFolder.uri.fsPath,
      cfg.outputDir,
      ...cfg.defaultPackage.split('.')
    );
    fs.mkdirSync(outDir, { recursive: true });
    defaultUri = vscode.Uri.file(path.join(outDir, `${className}.java`));
  } else {
    defaultUri = vscode.Uri.file(`${className}.java`);
  }

  const uri = await vscode.window.showSaveDialog({
    defaultUri,
    filters: { 'Java': ['java'] },
  });
  if (!uri) return;

  fs.writeFileSync(uri.fsPath, code, 'utf-8');

  // Open the saved file
  const doc = await vscode.workspace.openTextDocument(uri);
  vscode.window.showTextDocument(doc, vscode.ViewColumn.Beside);
  vscode.window.showInformationMessage(`✅ Saved: ${path.basename(uri.fsPath)}`);
  panel?.send({ type: 'gen:saved', filePath: uri.fsPath });
}

// ============================================================
// HELPERS
// ============================================================
function getConfig() {
  const c = vscode.workspace.getConfiguration('testmind');
  return {
    chromePath:       c.get<string>('chromePath')        || '',
    cdpPort:          c.get<number>('cdpPort')           ?? 9222,
    outputDir:        c.get<string>('outputDir')         || 'src/test/java',
    defaultPackage:   c.get<string>('defaultPackage')    || 'com.testmind.tests',
    defaultFramework: c.get<string>('defaultFramework')  || 'testng',
  };
}

function detectChrome(): string {
  const p = process.platform;
  const candidates: Record<string, string[]> = {
    darwin: ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
             '/Applications/Chromium.app/Contents/MacOS/Chromium'],
    win32:  ['C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
             'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe'],
    linux:  ['/usr/bin/google-chrome', '/usr/bin/chromium-browser', '/usr/bin/chromium'],
  };
  return (candidates[p] || []).find(f => fs.existsSync(f)) || '';
}

export function deactivate() {
  cdp.disconnect().catch(() => {});
  chromeProc?.kill();
}
