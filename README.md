# WinAppBackup & Driver Suite

A visually stunning, modern, and highly functional Windows desktop utility designed using Windows 11 Fluent and Acrylic aesthetic guidelines. It enables one-click backup and restore pipelines for both applications (Winget and Manual MSI/EXE) and system drivers.

This tool is exceptionally useful when preparing to perform a fresh Windows installation on your PC or laptop.

---

## Key Features

- **📊 Comprehensive App Scanning:** Dual-scans registry keys and Winget indexes to inventory all manual software installations, open-source apps, and standalone browsers (like Vivaldi).
- **💾 True Optional Migration:** Global toggles allow you to choose between backing up the core binaries list only (for a clean "Fresh Install" setup) or zipping all `%APPDATA%` Roaming/Local configuration directories (for complete profile migration).
- **🛡️ Elevated Driver Suite:** Leverages the native Windows `pnputil` device driver management engine to perform bulk exports of active third-party kernel drivers (Wi-Fi, graphics, audio, chipsets) and batch-reinstall them on your fresh OS.
- **⚡ Console Output Logging:** Features a real-time, monospace Cascadia Code console window showing detailed status updates directly from PowerShell and filesystem processes.
- **🔒 Secure Architecture:** Implements standard Electron context isolation and IPC bridge bindings.

---

## Getting Started

### Prerequisites

You need **Node.js** (v16+) and **npm** installed on your system to run the source code.

### Installation

1. Clone or download the repository files.
2. Open your terminal in the directory and run:
   ```bash
   npm install
   ```

### Running the App

To run the app in development mode:
```bash
npm start
```

*Note: You must run the terminal as **Administrator** to enable the System Drivers Backup and Restore features.*

---

## Compiling Standalone Binaries

To compile the application into a portable, zero-install standalone directory and zip archive:
```bash
npm run build
```
The packaged assets will be generated inside the `dist/` directory as `WinAppBackup-win32-x64.zip`. Save this ZIP folder onto a USB drive alongside your backups, and double-click the `WinAppBackup.exe` on your fresh system to recover all apps and drivers!

---

## Visual Aesthetics
- curate obsidian-carbon dark palette matching modern Windows styles.
- Smooth scale triggers and floating radial neon cyan/violet glowing orbs.
- segment-linked checklist sizing indicators.

---

## License

This project is licensed under the MIT License - see the LICENSE file for details.
