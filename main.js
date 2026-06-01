const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs-extra');
const { exec } = require('child_process');
const os = require('os');
const archiver = require('archiver');
const extract = require('extract-zip');

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1040,
    height: 750,
    minWidth: 800,
    minHeight: 600,
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: '#0d1117',
      symbolColor: '#c9d1d9',
      height: 40
    },
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    },
    backgroundColor: '#0d1117',
    show: false
  });

  mainWindow.loadFile('index.html');
  
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });
}

app.whenReady().then(() => {
  createWindow();

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', function () {
  if (process.platform !== 'darwin') app.quit();
});

// Helper: Run PowerShell command
function runPowerShell(cmd) {
  return new Promise((resolve, reject) => {
    // Run powershell with bypassed execution policy
    exec(`powershell -NoProfile -ExecutionPolicy Bypass -Command "${cmd.replace(/"/g, '\\"')}"`, 
      { maxBuffer: 100 * 1024 * 1024 }, 
      (err, stdout, stderr) => {
        if (err) {
          reject(err || stderr);
        } else {
          resolve(stdout);
        }
      }
    );
  });
}

// Helper: Verify if process runs with Administrator rights
function checkIsAdmin() {
  return new Promise((resolve) => {
    exec('net session', (err) => {
      resolve(!err);
    });
  });
}

// Helper: Get folder size recursively in bytes
async function getFolderSize(dir) {
  let size = 0;
  try {
    const files = await fs.readdir(dir);
    for (const file of files) {
      const filePath = path.join(dir, file);
      const stats = await fs.stat(filePath);
      if (stats.isDirectory()) {
        size += await getFolderSize(filePath);
      } else {
        size += stats.size;
      }
    }
  } catch (e) {
    // Ignore permissions errors and missing files
  }
  return size;
}

// Predefined known apps to AppData configurations mapping
const KNOWN_APPS_MAP = {
  '7zip.7zip': { roaming: '7-Zip' },
  'Notepad++.Notepad++': { roaming: 'Notepad++' },
  'VideoLAN.VLC': { roaming: 'vlc' },
  'SumatraPDF.SumatraPDF': { roaming: 'SumatraPDF' },
  'Telegram.TelegramDesktop': { roaming: 'Telegram Desktop' },
  'Brave.Brave': { local: 'BraveSoftware/Brave-Browser' },
  'Google.Chrome': { local: 'Google/Chrome' },
  'Waterfox.Waterfox': { roaming: 'Waterfox' },
  'Opera.Opera': { roaming: 'Opera Software/Opera Stable', local: 'Opera Software/Opera Stable' },
  'SoftDeluxe.FreeDownloadManager': { roaming: 'Free Download Manager' },
  '5rahim.Seanime': { roaming: 'seanime', local: 'seanime' }
};

// IPC Log Utility
function sendLog(msg) {
  if (mainWindow) {
    mainWindow.webContents.send('log-message', `[${new Date().toLocaleTimeString()}] ${msg}`);
  }
}

// IPC Progress Utility
function sendProgress(percent) {
  if (mainWindow) {
    mainWindow.webContents.send('progress', percent);
  }
}

// Clean app name to look for matches in AppData folders
function cleanAppName(name) {
  return name.replace(/\([^)]*\)/g, '') // remove parentheses like (64-bit)
             .replace(/version.*/i, '') // remove versions
             .replace(/[\d.]+/g, '') // remove numbers
             .trim();
}

// Administrator check IPC Handler
ipcMain.handle('check-admin', async () => {
  const admin = await checkIsAdmin();
  sendLog(`Administrator privileges verification: ${admin ? 'GRANTED' : 'DENIED'}`);
  return admin;
});

// Scan System IPC Handler
ipcMain.handle('scan-system', async () => {
  sendLog('Starting comprehensive system scan...');
  
  const roamingBase = process.env.APPDATA;
  const localBase = process.env.LOCALAPPDATA;
  
  const results = [];
  
  // 1. Export winget packages to a temporary file
  const tempExportPath = path.join(os.tmpdir(), `winget_temp_${Date.now()}.json`);
  let wingetPackages = [];
  
  try {
    sendLog('Querying Windows Package Manager (winget)...');
    await runPowerShell(`winget export -o "${tempExportPath}" --accept-source-agreements`);
    if (await fs.pathExists(tempExportPath)) {
      const exportJson = await fs.readJson(tempExportPath);
      
      if (exportJson.Sources) {
        for (const source of exportJson.Sources) {
          const sourceName = source.SourceDetails ? source.SourceDetails.Name : 'unknown';
          if (source.Packages) {
            for (const pkg of source.Packages) {
              wingetPackages.push({
                id: pkg.PackageIdentifier,
                version: pkg.PackageVersion || '',
                source: sourceName
              });
            }
          }
        }
      }
      await fs.remove(tempExportPath);
    }
    sendLog(`Discovered ${wingetPackages.length} winget-compatible packages.`);
  } catch (err) {
    sendLog(`Warning: winget list export failed or is not available. Error: ${err.message || err}`);
  }
  
  // 2. Query Windows Registry for ALL installed apps (MSI/EXE) using robust forward-slashes
  let registryApps = [];
  try {
    sendLog('Scanning Windows Registry for installed applications...');
    const registryCmd = 'Get-ItemProperty HKLM:/Software/Microsoft/Windows/CurrentVersion/Uninstall/*, HKLM:/Software/Wow6432Node/Microsoft/Windows/CurrentVersion/Uninstall/*, HKCU:/Software/Microsoft/Windows/CurrentVersion/Uninstall/* | Where-Object { $_.DisplayName -ne $null } | Select-Object DisplayName, DisplayVersion, Publisher, InstallLocation, PSChildName | ConvertTo-Json';
    const registryOutput = await runPowerShell(registryCmd);
    if (registryOutput.trim()) {
      registryApps = JSON.parse(registryOutput);
      if (!Array.isArray(registryApps)) {
        registryApps = [registryApps];
      }
    }
    sendLog(`Discovered ${registryApps.length} entries in Registry.`);
  } catch (err) {
    sendLog(`Error reading Windows registry: ${err.message || err}`);
  }
  
  // 3. Merge & Deduplicate lists, scan for AppData folders
  sendLog('Analyzing installed apps and matching settings directories...');
  
  const mergedApps = new Map();
  
  // Add Registry Apps first
  for (const app of registryApps) {
    if (!app.DisplayName) continue;
    const name = app.DisplayName.trim();
    mergedApps.set(name.toLowerCase(), {
      name: name,
      version: app.DisplayVersion || '',
      publisher: app.Publisher || '',
      id: app.PSChildName || '',
      isWinget: false,
      wingetId: null,
      installPath: app.InstallLocation || '',
      settingsFolders: []
    });
  }
  
  // Overlay Winget Apps to identify compatibility and proper IDs
  for (const wp of wingetPackages) {
    const parts = wp.id.split('.');
    const cleanIdName = parts[parts.length - 1].toLowerCase();
    
    let matched = false;
    
    for (const [key, value] of mergedApps.entries()) {
      const cleanRegName = cleanAppName(value.name).toLowerCase();
      if (key.includes(wp.id.toLowerCase()) || 
          wp.id.toLowerCase().includes(key) ||
          cleanRegName.includes(cleanIdName) || 
          cleanIdName.includes(cleanRegName)) {
        value.isWinget = true;
        value.wingetId = wp.id;
        value.source = wp.source;
        if (!value.version && wp.version) value.version = wp.version;
        matched = true;
        break;
      }
    }
    
    if (!matched) {
      // Add as unique winget app
      const idParts = wp.id.split('.');
      const display = idParts.map(p => p.charAt(0).toUpperCase() + p.slice(1)).join(' ');
      mergedApps.set(wp.id.toLowerCase(), {
        name: display,
        version: wp.version,
        publisher: idParts[0],
        id: wp.id,
        isWinget: true,
        wingetId: wp.id,
        source: wp.source,
        installPath: '',
        settingsFolders: []
      });
    }
  }
  
  // 4. Scan AppData settings for matched folders
  for (const [key, app] of mergedApps.entries()) {
    const settings = [];
    
    const known = KNOWN_APPS_MAP[app.wingetId];
    
    if (known) {
      if (known.roaming) {
        const fullPath = path.join(roamingBase, known.roaming);
        if (await fs.pathExists(fullPath)) {
          const size = await getFolderSize(fullPath);
          settings.push({ type: 'Roaming', relativePath: known.roaming, fullPath, size });
        }
      }
      if (known.local) {
        const fullPath = path.join(localBase, known.local);
        if (await fs.pathExists(fullPath)) {
          const size = await getFolderSize(fullPath);
          settings.push({ type: 'Local', relativePath: known.local, fullPath, size });
        }
      }
    } else {
      const cleaned = cleanAppName(app.name).toLowerCase();
      const parts = (app.wingetId || app.id || '').split('.');
      const shortIdName = parts[parts.length - 1].toLowerCase();
      
      const checkFolderMatch = async (baseDir, type) => {
        try {
          const folders = await fs.readdir(baseDir);
          for (const folder of folders) {
            const folderLow = folder.toLowerCase();
            if (folderLow === cleaned || 
                folderLow === shortIdName ||
                (cleaned.length > 3 && folderLow.includes(cleaned)) ||
                (shortIdName.length > 3 && folderLow.includes(shortIdName))) {
              const fullPath = path.join(baseDir, folder);
              const stats = await fs.stat(fullPath);
              if (stats.isDirectory()) {
                const size = await getFolderSize(fullPath);
                settings.push({ type, relativePath: folder, fullPath, size });
              }
            }
          }
        } catch (e) {}
      };
      
      await checkFolderMatch(roamingBase, 'Roaming');
      await checkFolderMatch(localBase, 'Local');
    }
    
    app.settingsFolders = settings;
    results.push(app);
  }
  
  results.sort((a, b) => {
    const aHasSettings = a.settingsFolders.length > 0 ? 1 : 0;
    const bHasSettings = b.settingsFolders.length > 0 ? 1 : 0;
    if (aHasSettings !== bHasSettings) return bHasSettings - aHasSettings;
    return a.name.localeCompare(b.name);
  });
  
  sendLog(`Scan finished! Discovered ${results.length} total applications.`);
  return results;
});

// Select Directory Dialog Handler
ipcMain.handle('select-directory', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory', 'createDirectory']
  });
  if (result.canceled) return null;
  return result.filePaths[0];
});

// Select File Dialog Handler
ipcMain.handle('select-file', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile'],
    filters: [
      { name: 'Windows App Backup (*.wabak)', extensions: ['wabak', 'zip'] },
      { name: 'All Files', extensions: ['*'] }
    ]
  });
  if (result.canceled) return null;
  return result.filePaths[0];
});

// Create Backup Archive IPC Handler
ipcMain.handle('create-backup', async (event, config) => {
  const { selectedApps, exportDir, backupSettings } = config;
  sendLog(`Initiating backup creation at: ${exportDir}`);
  sendProgress(5);
  
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const tempDir = path.join(os.tmpdir(), `wabak_build_${timestamp}`);
  const finalZipPath = path.join(exportDir, `WABackup_${timestamp}.wabak`);
  
  try {
    await fs.ensureDir(tempDir);
    await fs.ensureDir(path.join(tempDir, 'settings'));
    
    sendLog('Structuring backup manifest...');
    
    // 1. Generate dynamic winget import JSON structure
    const wingetApps = selectedApps.filter(app => app.isWinget);
    const wingetImport = {
      "$schema": "https://aka.ms/winget-packages.schema.2.0.json",
      "CreationDate": new Date().toISOString(),
      "Sources": [
        {
          "Packages": wingetApps.map(app => ({
            "PackageIdentifier": app.wingetId,
            "PackageVersion": app.version || ""
          })),
          "SourceDetails": {
            "Argument": "https://cdn.winget.microsoft.com/cache",
            "Identifier": "Microsoft.Winget.Source_8wekyb3d8bbwe",
            "Name": "winget",
            "Type": "Microsoft.PreIndexed.Package"
          }
        }
      ],
      "WinGetVersion": "1.28.240"
    };
    
    await fs.writeJson(path.join(tempDir, 'winget_import.json'), wingetImport, { spaces: 2 });
    sendLog(`Exported package list with ${wingetApps.length} applications.`);
    sendProgress(20);
    
    // 2. Backup selected AppData settings directories
    const settingsManifest = [];
    let progressStep = 60 / Math.max(1, selectedApps.length);
    let currentProgress = 20;
    
    if (backupSettings) {
      for (const app of selectedApps) {
        if (app.settingsFolders && app.settingsFolders.length > 0) {
          sendLog(`Processing settings for: ${app.name}`);
          
          for (const folder of app.settingsFolders) {
            const cleanId = (app.wingetId || app.id || app.name).replace(/[^a-zA-Z0-9.-]/g, '_');
            const archiveName = `${cleanId}_${folder.type.toLowerCase()}.zip`;
            const archivePath = path.join(tempDir, 'settings', archiveName);
            
            sendLog(`Archiving ${folder.type} folder for ${app.name}...`);
            
            await new Promise((resolve, reject) => {
              const output = fs.createWriteStream(archivePath);
              const archive = archiver('zip', { zlib: { level: 9 } });
              
              output.on('close', resolve);
              archive.on('error', reject);
              
              archive.pipe(output);
              archive.directory(folder.fullPath, false);
              archive.finalize();
            });
            
            settingsManifest.push({
              appId: app.wingetId || app.id,
              appName: app.name,
              type: folder.type,
              originalPath: folder.fullPath,
              archiveName: archiveName
            });
          }
        }
        currentProgress += progressStep;
        sendProgress(Math.min(80, Math.round(currentProgress)));
      }
    } else {
      sendLog('AppData settings backup bypassed. Building clean fresh-install package.');
    }
    
    // 3. Create backup manifest
    const backupManifest = {
      computerName: os.hostname(),
      userName: os.userInfo().username,
      date: new Date().toISOString(),
      osPlatform: os.platform(),
      osRelease: os.release(),
      appsCount: selectedApps.length,
      wingetAppsCount: wingetApps.length,
      settingsCount: settingsManifest.length,
      apps: selectedApps.map(app => ({
        name: app.name,
        id: app.id,
        wingetId: app.wingetId,
        isWinget: app.isWinget,
        version: app.version
      })),
      settings: settingsManifest
    };
    
    await fs.writeJson(path.join(tempDir, 'backup_manifest.json'), backupManifest, { spaces: 2 });
    sendProgress(85);
    
    // 4. Zip the entire temporary build folder into the final .wabak file
    sendLog('Packaging everything into a single .wabak archive...');
    await new Promise((resolve, reject) => {
      const output = fs.createWriteStream(finalZipPath);
      const archive = archiver('zip', { zlib: { level: 9 } });
      
      output.on('close', resolve);
      archive.on('error', reject);
      
      archive.pipe(output);
      archive.directory(tempDir, false);
      archive.finalize();
    });
    
    await fs.remove(tempDir);
    
    sendLog(`Backup successfully created! Saved to: ${finalZipPath}`);
    sendProgress(100);
    return { success: true, path: finalZipPath, manifest: backupManifest };
  } catch (err) {
    sendLog(`Error creating backup: ${err.message || err}`);
    sendProgress(0);
    try {
      await fs.remove(tempDir);
    } catch (e) {}
    return { success: false, error: err.message || err };
  }
});

// Restore Backup IPC Handler
ipcMain.handle('restore-backup', async (event, filePath) => {
  sendLog(`Initiating restore from backup archive: ${filePath}`);
  sendProgress(5);
  
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const tempExtractDir = path.join(os.tmpdir(), `wabak_extract_${timestamp}`);
  
  try {
    await fs.ensureDir(tempExtractDir);
    
    sendLog('Unpacking backup archive...');
    await extract(filePath, { dir: tempExtractDir });
    sendProgress(25);
    
    const manifestPath = path.join(tempExtractDir, 'backup_manifest.json');
    if (!(await fs.pathExists(manifestPath))) {
      throw new Error('Invalid backup archive: missing backup_manifest.json');
    }
    const manifest = await fs.readJson(manifestPath);
    sendLog(`Verified backup created on ${new Date(manifest.date).toLocaleDateString()} from PC "${manifest.computerName}"`);
    
    const wingetImportPath = path.join(tempExtractDir, 'winget_import.json');
    if (await fs.pathExists(wingetImportPath) && manifest.wingetAppsCount > 0) {
      sendLog(`Reinstalling ${manifest.wingetAppsCount} applications via Windows Package Manager...`);
      sendLog('Running winget import (this may take a few minutes)...');
      
      try {
        const wingetCmd = `winget import -i "${wingetImportPath}" --accept-package-agreements --accept-source-agreements`;
        const wingetOutput = await runPowerShell(wingetCmd);
        sendLog('Winget import completed. Output details:');
        sendLog(wingetOutput);
      } catch (wingetErr) {
        sendLog(`Warning during winget installation: ${wingetErr.message || wingetErr}`);
        sendLog('Proceeding with settings restoration anyway...');
      }
    } else {
      sendLog('No winget applications to install.');
    }
    sendProgress(70);
    
    if (manifest.settings && manifest.settings.length > 0) {
      sendLog(`Restoring configurations and settings for ${manifest.settings.length} folders...`);
      
      for (const setting of manifest.settings) {
        const settingZipPath = path.join(tempExtractDir, 'settings', setting.archiveName);
        
        if (await fs.pathExists(settingZipPath)) {
          let destPath = setting.originalPath;
          
          if (setting.type === 'Roaming') {
            destPath = path.join(process.env.APPDATA, destPath.split(path.join('AppData', 'Roaming'))[1]);
          } else if (setting.type === 'Local') {
            destPath = path.join(process.env.LOCALAPPDATA, destPath.split(path.join('AppData', 'Local'))[1]);
          }
          
          sendLog(`Restoring settings for ${setting.appName} to ${destPath}...`);
          
          if (await fs.pathExists(destPath)) {
            const backupPath = `${destPath}_bak_${timestamp}`;
            sendLog(`Existing directory found. Renaming original to: ${path.basename(backupPath)}`);
            await fs.move(destPath, backupPath);
          }
          
          await fs.ensureDir(destPath);
          await extract(settingZipPath, { dir: destPath });
        } else {
          sendLog(`Warning: Settings file missing for ${setting.appName}: ${setting.archiveName}`);
        }
      }
    }
    
    await fs.remove(tempExtractDir);
    
    sendLog('Restore operation successfully completed!');
    sendProgress(100);
    return { success: true, manifest };
  } catch (err) {
    sendLog(`Error during restoration: ${err.message || err}`);
    sendProgress(0);
    try {
      await fs.remove(tempExtractDir);
    } catch (e) {}
    return { success: false, error: err.message || err };
  }
});

// Windows Drivers Backup IPC Handler (Requires Admin)
ipcMain.handle('backup-drivers', async (event, dirPath) => {
  sendLog(`Initiating system drivers backup. Output directory: ${dirPath}`);
  sendProgress(5);
  
  try {
    const admin = await checkIsAdmin();
    if (!admin) {
      throw new Error('Access Denied. System driver backup requires Administrator rights.');
    }
    
    await fs.ensureDir(dirPath);
    sendLog('Analyzing active kernel drivers... Running pnputil export command (this may take 1-2 minutes)...');
    sendProgress(20);
    
    const pnpCmd = `pnputil /export-driver * "${dirPath}"`;
    const output = await runPowerShell(pnpCmd);
    
    sendLog('pnputil export operation finished. Output log details:');
    sendLog(output);
    sendProgress(100);
    
    return { success: true, output };
  } catch (err) {
    sendLog(`Driver Backup Failed: ${err.message || err}`);
    sendProgress(0);
    return { success: false, error: err.message || err };
  }
});

// Windows Drivers Restore IPC Handler (Requires Admin)
ipcMain.handle('restore-drivers', async (event, dirPath) => {
  sendLog(`Initiating system drivers restoration from: ${dirPath}`);
  sendProgress(5);
  
  try {
    const admin = await checkIsAdmin();
    if (!admin) {
      throw new Error('Access Denied. System driver restoration requires Administrator rights.');
    }
    
    if (!(await fs.pathExists(dirPath))) {
      throw new Error('Specified drivers directory does not exist.');
    }
    
    sendLog('Reading INF driver definitions... Running pnputil batch installation...');
    sendProgress(30);
    
    const pnpCmd = `pnputil /add-driver "${path.join(dirPath, '*.inf')}" /subdirs /install`;
    const output = await runPowerShell(pnpCmd);
    
    sendLog('pnputil restore operation finished. Output log details:');
    sendLog(output);
    sendProgress(100);
    
    return { success: true, output };
  } catch (err) {
    sendLog(`Driver Restore Failed: ${err.message || err}`);
    sendProgress(0);
    return { success: false, error: err.message || err };
  }
});
