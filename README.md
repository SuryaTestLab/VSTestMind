# TestMind — VSCode Extension (Phase 1)
> Record browser interactions → Generate Selenium Java tests — no AI, no API keys

---

## 🚀 Quick Start

### Install & Run in Development
```bash
cd testmind-vscode-p1
npm install
npm run compile
# Press F5 in VSCode → Extension Development Host opens
```

### Build VSIX for installation
```bash
npm run package
# Produces: testmind-1.0.0.vsix

code --install-extension testmind-1.0.0.vsix
```

---

## 📋 How to Use

### 1. Open the Recorder
- Click the **TestMind icon** in the Activity Bar
- Or: `Ctrl+Shift+P` → **TestMind: Open Recorder**

### 2. Launch / Connect Chrome
- Click **Launch Chrome** (auto-opens Chrome with debug port)
- Or click **Connect existing** if Chrome is already running with `--remote-debugging-port=9222`

### 3. Attach a Tab
- Your open Chrome tabs appear — click **Attach** on the one you want to record

### 4. Record
- Click **⏺ Start Recording**
- Interact with the page — every click, type, select appears live in the left panel
- Click **⏹ Stop Recording** when done

### 5. Generate & Save
- Set class name, package, and framework (TestNG / JUnit 5 / JUnit 4)
- Click **✨ Generate Code**
- Click **📄 Open in Editor** — file opens beside the panel
- Click **💾 Save .java** — saves to `src/test/java/<package>/` in your workspace

---

## 📁 Project Structure

```
testmind-vscode-p1/
├── package.json             # Extension manifest
├── tsconfig.json
├── src/
│   ├── extension.ts         # Entry point — commands, IPC, Chrome launcher
│   ├── recorder-panel.ts    # Webview panel lifecycle + HTML
│   ├── cdp-bridge.ts        # Chrome DevTools Protocol client
│   ├── session-store.ts     # In-memory event storage
│   └── codegen.ts           # Selenium Java code generator
└── media/
    ├── panel.css            # Webview styles
    ├── panel.js             # Webview UI controller
    └── icon.svg             # Activity bar icon
```

---

## ⚙️ Settings

| Setting | Default | Description |
|---|---|---|
| `testmind.chromePath` | auto | Path to Chrome binary |
| `testmind.cdpPort` | `9222` | CDP debug port |
| `testmind.outputDir` | `src/test/java` | Where to save generated files |
| `testmind.defaultPackage` | `com.testmind.tests` | Java package name |
| `testmind.defaultFramework` | `testng` | testng / junit5 / junit4 |

---

## 📦 Maven Dependencies

```xml
<!-- Selenium -->
<dependency>
  <groupId>org.seleniumhq.selenium</groupId>
  <artifactId>selenium-java</artifactId>
  <version>4.18.1</version>
</dependency>

<!-- TestNG (if selected) -->
<dependency>
  <groupId>org.testng</groupId>
  <artifactId>testng</artifactId>
  <version>7.9.0</version>
  <scope>test</scope>
</dependency>

<!-- WebDriverManager (optional — auto-downloads chromedriver) -->
<dependency>
  <groupId>io.github.bonigarcia</groupId>
  <artifactId>webdrivermanager</artifactId>
  <version>5.7.0</version>
  <scope>test</scope>
</dependency>
```
