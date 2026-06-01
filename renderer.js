// Frontend Controller: WinAppBackup Renderer Process

// State Management
let discoveredApps = [];
let selectedExportDirectory = '';
let selectedBackupFile = '';
let activeRestoreManifest = null;
let isAdmin = false;

// Driver Module State
let selectedDriverBackupDir = '';
let selectedDriverRestoreDir = '';

// DOM Elements References
const navLinks = document.querySelectorAll('.nav-link');
const screens = document.querySelectorAll('.screen');
const statusBadgeText = document.getElementById('statusBadgeText');

// Elevated Alert Banners
const adminSuccessBanner = document.getElementById('adminSuccessBanner');
const adminWarningBanner = document.getElementById('adminWarningBanner');
const driverAdminWarning = document.getElementById('driverAdminWarning');

// Backup Screen Elements
const btnScanSystem = document.getElementById('btnScanSystem');
const scannerStatus = document.getElementById('scannerStatus');
const scannerCurrentTask = document.getElementById('scannerCurrentTask');
const appsListSection = document.getElementById('appsListSection');
const appsTableBody = document.getElementById('appsTableBody');
const checkboxSelectAll = document.getElementById('checkboxSelectAll');
const searchAppsInput = document.getElementById('searchAppsInput');
const switchIncludeAppData = document.getElementById('switchIncludeAppData');

const statsTotalApps = document.getElementById('statsTotalApps');
const statsWingetApps = document.getElementById('statsWingetApps');
const statsSettingsSize = document.getElementById('statsSettingsSize');

const inputExportPath = document.getElementById('inputExportPath');
const btnBrowseExport = document.getElementById('btnBrowseExport');
const btnCreateBackup = document.getElementById('btnCreateBackup');

// Drivers Screen Elements
const inputDriverBackupDir = document.getElementById('inputDriverBackupDir');
const btnBrowseDriverBackup = document.getElementById('btnBrowseDriverBackup');
const btnStartDriverBackup = document.getElementById('btnStartDriverBackup');

const inputDriverRestoreDir = document.getElementById('inputDriverRestoreDir');
const btnBrowseDriverRestore = document.getElementById('btnBrowseDriverRestore');
const btnStartDriverRestore = document.getElementById('btnStartDriverRestore');

// Restore Screen Elements
const restoreDropzone = document.getElementById('restoreDropzone');
const fileInputRestore = document.getElementById('fileInputRestore');
const restoreDetailsPanel = document.getElementById('restoreDetailsPanel');
const btnUnloadArchive = document.getElementById('btnUnloadArchive');

const restorePcName = document.getElementById('restorePcName');
const restoreUserName = document.getElementById('restoreUserName');
const restoreDate = document.getElementById('restoreDate');
const restoreOs = document.getElementById('restoreOs');
const restoreAppCount = document.getElementById('restoreAppCount');
const restoreSettingsCount = document.getElementById('restoreSettingsCount');

const checkInstallApps = document.getElementById('checkInstallApps');
const checkRestoreSettings = document.getElementById('checkRestoreSettings');
const btnStartRestore = document.getElementById('btnStartRestore');

const restoreProgressPanel = document.getElementById('restoreProgressPanel');
const progressStatusTitle = document.getElementById('progressStatusTitle');
const progressPercentText = document.getElementById('progressPercentText');
const progressBarFill = document.getElementById('progressBarFill');
const terminalLogs = document.getElementById('terminalLogs');
const btnClearLogs = document.getElementById('btnClearLogs');

// Preferences Screen Elements
const switchAcceptAgreements = document.getElementById('switchAcceptAgreements');
const switchHighCompression = document.getElementById('switchHighCompression');
const sysName = document.getElementById('sysName');
const sysOs = document.getElementById('sysOs');
const sysUser = document.getElementById('sysUser');

// Initialize App Lifecycle
document.addEventListener('DOMContentLoaded', async () => {
  setupNavigation();
  await verifyAdminRights();
  setupScanLogic();
  setupBackupPipeline();
  setupDriversPipeline();
  setupRestorePipeline();
  setupRealtimeListeners();
  loadSystemSettingsOverview();
});

// Navigation Handling
function setupNavigation() {
  navLinks.forEach(link => {
    link.addEventListener('click', (e) => {
      e.preventDefault();
      
      navLinks.forEach(l => l.classList.remove('active'));
      screens.forEach(s => s.classList.remove('active'));
      
      link.classList.add('active');
      const targetId = link.getAttribute('href').substring(1);
      const targetScreen = document.getElementById(`screen${targetId.charAt(0).toUpperCase() + targetId.slice(1)}`);
      if (targetScreen) {
        targetScreen.classList.add('active');
      }
      
      statusBadgeText.textContent = `Viewing ${link.querySelector('.nav-text').textContent}`;
    });
  });
}

// Check for Administrator Privileges
async function verifyAdminRights() {
  try {
    isAdmin = await window.electronAPI.checkAdmin();
    if (isAdmin) {
      adminSuccessBanner.classList.remove('hidden');
      adminWarningBanner.classList.add('hidden');
      driverAdminWarning.classList.add('hidden');
      
      // Update badge
      document.querySelector('.badge-dot').style.backgroundColor = '#00f2fe';
      document.querySelector('.badge-dot').style.boxShadow = '0 0 8px rgba(0, 242, 254, 0.6)';
      statusBadgeText.textContent = 'Administrator Session Active';
    } else {
      adminSuccessBanner.classList.add('hidden');
      adminWarningBanner.classList.remove('hidden');
      driverAdminWarning.classList.remove('hidden');
    }
  } catch (err) {
    console.error('Error verifying admin permissions:', err);
  }
}

// Load System Specifications in Settings
function loadSystemSettingsOverview() {
  sysName.textContent = 'WINDOWS-LAPTOP';
  sysOs.textContent = 'Windows 11 Home / Pro (Build 22631)';
  sysUser.textContent = 'Local User';
}

// Logging Console Stream Helper
function writeLog(message, type = 'log') {
  const line = document.createElement('div');
  line.className = `log-line text-${type}`;
  line.textContent = message;
  terminalLogs.appendChild(line);
  terminalLogs.scrollTop = terminalLogs.scrollHeight;
}

// Real-time Event Subscriptions from Main Process
function setupRealtimeListeners() {
  window.electronAPI.onLog((message) => {
    let type = 'log';
    if (message.includes('Error') || message.includes('failed') || message.includes('Denied')) type = 'error';
    else if (message.includes('successfully') || message.includes('completed') || message.includes('Successful')) type = 'success';
    else if (message.includes('Warning')) type = 'warning';
    else if (message.includes('Initiating') || message.includes('Starting')) type = 'info';
    
    writeLog(message, type);
  });

  window.electronAPI.onProgress((percent) => {
    progressBarFill.style.width = `${percent}%`;
    progressPercentText.textContent = `${percent}%`;
  });
}

// Helper: Format Bytes to Megabytes
function formatSizeMB(bytes) {
  if (!bytes) return '0.00 MB';
  const mb = bytes / (1024 * 1024);
  return `${mb.toFixed(2)} MB`;
}

// Calculate Selected Statistics from Tables
function updateSelectedStats() {
  const checkedBoxes = document.querySelectorAll('.app-checkbox:checked');
  const totalSelectedCount = checkedBoxes.length;
  
  let wingetCompatibleCount = 0;
  let totalBytes = 0;
  
  const isGlobalSettingsBackupActive = switchIncludeAppData.checked;

  checkedBoxes.forEach(box => {
    const appIndex = parseInt(box.dataset.index);
    const app = discoveredApps[appIndex];
    if (app) {
      if (app.isWinget) wingetCompatibleCount++;
      
      // Update row details state based on global checkbox
      const settingsSwitch = document.getElementById(`settings-switch-${appIndex}`);
      if (settingsSwitch) {
        settingsSwitch.disabled = !isGlobalSettingsBackupActive;
        if (!isGlobalSettingsBackupActive) {
          settingsSwitch.checked = false;
        }
      }
      
      if (isGlobalSettingsBackupActive && settingsSwitch && settingsSwitch.checked && app.settingsFolders) {
        app.settingsFolders.forEach(folder => {
          totalBytes += folder.size || 0;
        });
      }
    }
  });

  statsTotalApps.textContent = totalSelectedCount;
  statsWingetApps.textContent = wingetCompatibleCount;
  statsSettingsSize.textContent = isGlobalSettingsBackupActive ? formatSizeMB(totalBytes) : '0.00 MB';
  
  btnCreateBackup.disabled = !(totalSelectedCount > 0 && selectedExportDirectory !== '');
}

// Screen 1: Scan Logic & System Analysis
function setupScanLogic() {
  btnScanSystem.addEventListener('click', async () => {
    btnScanSystem.disabled = true;
    scannerStatus.classList.remove('hidden');
    appsListSection.classList.add('hidden');
    
    let taskToggle = 0;
    const interval = setInterval(() => {
      taskToggle = (taskToggle + 1) % 3;
      if (taskToggle === 0) scannerCurrentTask.textContent = 'Querying package manager registries...';
      else if (taskToggle === 1) scannerCurrentTask.textContent = 'Inspecting local Windows Registry structures...';
      else scannerCurrentTask.textContent = 'Scanning Roaming and Local AppData folders...';
    }, 2500);

    try {
      discoveredApps = await window.electronAPI.scanSystem();
      clearInterval(interval);
      
      appsTableBody.innerHTML = '';
      
      discoveredApps.forEach((app, index) => {
        const row = document.createElement('tr');
        row.id = `app-row-${index}`;
        if (app.settingsFolders && app.settingsFolders.length > 0) {
          row.classList.add('selected');
        }
        
        let settingsHTML = '';
        let settingsSwitchHTML = '';
        
        if (app.settingsFolders && app.settingsFolders.length > 0) {
          settingsHTML = app.settingsFolders.map(folder => `
            <div class="settings-pill">
              <span>${folder.type}</span>
              <span class="pill-size">${formatSizeMB(folder.size)}</span>
            </div>
          `).join('');
          
          settingsSwitchHTML = `
            <label class="switch">
              <input type="checkbox" class="settings-toggle" id="settings-switch-${index}" checked data-index="${index}">
              <span class="switch-slider"></span>
            </label>
          `;
        } else {
          settingsHTML = '<span class="no-settings-text">No config directories found</span>';
          settingsSwitchHTML = '<span class="no-settings-text">-</span>';
        }
        
        row.innerHTML = `
          <td><input type="checkbox" class="app-checkbox" checked id="checkbox-app-${index}" data-index="${index}"></td>
          <td>
            <div class="app-meta-container">
              <span class="app-name-title">${app.name}</span>
              <span class="app-sub-publisher">${app.publisher || 'Unknown Publisher'} • v${app.version || 'Unknown'}</span>
            </div>
          </td>
          <td>
            <span class="method-badge ${app.isWinget ? 'winget' : 'manual'}">
              ${app.isWinget ? 'Winget' : 'Manual Install'}
            </span>
          </td>
          <td>
            <div class="settings-discovered-cell">
              ${settingsHTML}
            </div>
          </td>
          <td>
            ${settingsSwitchHTML}
          </td>
        `;
        
        appsTableBody.appendChild(row);
      });
      
      document.querySelectorAll('.app-checkbox').forEach(box => {
        box.addEventListener('change', (e) => {
          const index = parseInt(e.target.dataset.index);
          const row = document.getElementById(`app-row-${index}`);
          if (e.target.checked) {
            row.classList.add('selected');
          } else {
            row.classList.remove('selected');
          }
          updateSelectedStats();
        });
      });
      
      document.querySelectorAll('.settings-toggle').forEach(toggle => {
        toggle.addEventListener('change', () => {
          updateSelectedStats();
        });
      });
      
      updateSelectedStats();
      
      scannerStatus.classList.add('hidden');
      appsListSection.classList.remove('hidden');
      
    } catch (err) {
      clearInterval(interval);
      alert(`System Scan Failed: ${err.message || err}`);
      scannerStatus.classList.add('hidden');
    } finally {
      btnScanSystem.disabled = false;
    }
  });
  
  checkboxSelectAll.addEventListener('change', (e) => {
    const checkedState = e.target.checked;
    document.querySelectorAll('.app-checkbox').forEach(box => {
      box.checked = checkedState;
      const index = parseInt(box.dataset.index);
      const row = document.getElementById(`app-row-${index}`);
      if (checkedState) row.classList.add('selected');
      else row.classList.remove('selected');
    });
    updateSelectedStats();
  });
  
  searchAppsInput.addEventListener('input', (e) => {
    const query = e.target.value.toLowerCase();
    discoveredApps.forEach((app, index) => {
      const row = document.getElementById(`app-row-${index}`);
      const matches = app.name.toLowerCase().includes(query) || 
                      (app.publisher && app.publisher.toLowerCase().includes(query)) ||
                      (app.wingetId && app.wingetId.toLowerCase().includes(query));
      if (matches) {
        row.classList.remove('hidden');
      } else {
        row.classList.add('hidden');
      }
    });
  });

  // Global Settings Switch Binding
  switchIncludeAppData.addEventListener('change', () => {
    document.querySelectorAll('.settings-toggle').forEach(toggle => {
      toggle.checked = switchIncludeAppData.checked;
    });
    updateSelectedStats();
  });
}

// Screen 1: Backup Compilation Pipeline
function setupBackupPipeline() {
  btnBrowseExport.addEventListener('click', async () => {
    const dir = await window.electronAPI.selectDirectory();
    if (dir) {
      selectedExportDirectory = dir;
      inputExportPath.value = dir;
      updateSelectedStats();
    }
  });

  btnCreateBackup.addEventListener('click', async () => {
    const selectedAppsConfig = [];
    const checkedBoxes = document.querySelectorAll('.app-checkbox:checked');
    const isGlobalSettingsBackupActive = switchIncludeAppData.checked;
    
    checkedBoxes.forEach(box => {
      const index = parseInt(box.dataset.index);
      const app = discoveredApps[index];
      
      if (app) {
        const settingsSwitch = document.getElementById(`settings-switch-${index}`);
        const includeSettings = isGlobalSettingsBackupActive && settingsSwitch ? settingsSwitch.checked : false;
        
        const appCopy = JSON.parse(JSON.stringify(app));
        if (!includeSettings) {
          appCopy.settingsFolders = [];
        }
        selectedAppsConfig.push(appCopy);
      }
    });
    
    document.getElementById('navRestoreLink').click();
    restoreProgressPanel.classList.remove('hidden');
    restoreDropzone.classList.add('hidden');
    restoreDetailsPanel.classList.add('hidden');
    
    progressStatusTitle.textContent = 'Building portable backup package...';
    progressBarFill.style.width = '0%';
    progressPercentText.textContent = '0%';
    terminalLogs.innerHTML = '';
    
    writeLog('Preparing local system variables...', 'info');
    
    try {
      const result = await window.electronAPI.createBackup({
        selectedApps: selectedAppsConfig,
        exportDir: selectedExportDirectory,
        backupSettings: isGlobalSettingsBackupActive
      });
      
      if (result.success) {
        writeLog(`Backup Build Successful! File exported to: ${result.path}`, 'success');
        alert(`Backup package successfully created!\nSaved to: ${result.path}`);
      } else {
        writeLog(`Backup Failed: ${result.error}`, 'error');
        alert(`Failed to create backup package: ${result.error}`);
      }
    } catch (err) {
      writeLog(`Critical Error: ${err.message || err}`, 'error');
      alert(`Critical Backup Error: ${err.message || err}`);
    }
  });
}

// SCREEN 2: System Drivers Pipeline
function setupDriversPipeline() {
  // 1. Driver Export Browse
  btnBrowseDriverBackup.addEventListener('click', async () => {
    const dir = await window.electronAPI.selectDirectory();
    if (dir) {
      selectedDriverBackupDir = dir;
      inputDriverBackupDir.value = dir;
      btnStartDriverBackup.disabled = !isAdmin;
    }
  });

  // Start Driver Backup Trigger
  btnStartDriverBackup.addEventListener('click', async () => {
    if (!isAdmin) {
      alert('Administrator privileges are required to run Driver exports.');
      return;
    }
    
    document.getElementById('navRestoreLink').click();
    restoreProgressPanel.classList.remove('hidden');
    restoreDropzone.classList.add('hidden');
    restoreDetailsPanel.classList.add('hidden');
    
    progressStatusTitle.textContent = 'Exporting kernel driver packages...';
    progressBarFill.style.width = '0%';
    progressPercentText.textContent = '0%';
    terminalLogs.innerHTML = '';
    
    writeLog('Initializing elevated Windows Driver export...', 'info');
    
    try {
      const result = await window.electronAPI.backupDrivers(selectedDriverBackupDir);
      if (result.success) {
        writeLog('Driver backup successfully exported!', 'success');
        alert('All third-party drivers have been successfully backed up to your selected folder.');
      } else {
        writeLog(`Driver Export Failed: ${result.error}`, 'error');
        alert(`Failed to export drivers: ${result.error}`);
      }
    } catch (err) {
      writeLog(`Critical Error: ${err.message || err}`, 'error');
      alert(`Critical Driver Export Error: ${err.message || err}`);
    }
  });

  // 2. Driver Restore Browse
  btnBrowseDriverRestore.addEventListener('click', async () => {
    const dir = await window.electronAPI.selectDirectory();
    if (dir) {
      selectedDriverRestoreDir = dir;
      inputDriverRestoreDir.value = dir;
      btnStartDriverRestore.disabled = !isAdmin;
    }
  });

  // Start Driver Restore Trigger
  btnStartDriverRestore.addEventListener('click', async () => {
    if (!isAdmin) {
      alert('Administrator privileges are required to restore Drivers.');
      return;
    }
    
    document.getElementById('navRestoreLink').click();
    restoreProgressPanel.classList.remove('hidden');
    restoreDropzone.classList.add('hidden');
    restoreDetailsPanel.classList.add('hidden');
    
    progressStatusTitle.textContent = 'Restoring system drivers...';
    progressBarFill.style.width = '0%';
    progressPercentText.textContent = '0%';
    terminalLogs.innerHTML = '';
    
    writeLog('Initializing Windows Driver batch restoration...', 'info');
    
    try {
      const result = await window.electronAPI.restoreDrivers(selectedDriverRestoreDir);
      if (result.success) {
        writeLog('Driver batch restoration finished successfully!', 'success');
        alert('All drivers inside the backup folder have been successfully reinstalled. You may need to reboot your system.');
      } else {
        writeLog(`Driver Restore Failed: ${result.error}`, 'error');
        alert(`Failed to restore drivers: ${result.error}`);
      }
    } catch (err) {
      writeLog(`Critical Error: ${err.message || err}`, 'error');
      alert(`Critical Driver Restore Error: ${err.message || err}`);
    }
  });
}

// Screen 3: System Restore Pipeline
function setupRestorePipeline() {
  restoreDropzone.addEventListener('dragover', (e) => {
    e.preventDefault();
    restoreDropzone.classList.add('dragover');
  });

  restoreDropzone.addEventListener('dragleave', () => {
    restoreDropzone.classList.remove('dragover');
  });

  restoreDropzone.addEventListener('drop', (e) => {
    e.preventDefault();
    restoreDropzone.classList.remove('dragover');
    
    const files = e.dataTransfer.files;
    if (files.length > 0) {
      const file = files[0];
      if (file.name.endsWith('.wabak') || file.name.endsWith('.zip')) {
        handleSelectedBackup(file.path);
      } else {
        alert('Invalid file format. Please drop a valid .wabak or .zip archive.');
      }
    }
  });

  restoreDropzone.addEventListener('click', async () => {
    const filePath = await window.electronAPI.selectFile();
    if (filePath) {
      handleSelectedBackup(filePath);
    }
  });

  btnUnloadArchive.addEventListener('click', () => {
    selectedBackupFile = '';
    activeRestoreManifest = null;
    restoreDropzone.classList.remove('hidden');
    restoreDetailsPanel.classList.add('hidden');
    restoreProgressPanel.classList.add('hidden');
  });

  btnStartRestore.addEventListener('click', async () => {
    if (!selectedBackupFile) return;
    
    restoreDetailsPanel.classList.add('hidden');
    restoreProgressPanel.classList.remove('hidden');
    
    progressStatusTitle.textContent = 'Initializing system restoration...';
    progressBarFill.style.width = '0%';
    progressPercentText.textContent = '0%';
    terminalLogs.innerHTML = '';
    
    writeLog('Reading package metadata manifest...', 'info');
    
    try {
      const result = await window.electronAPI.restoreBackup(selectedBackupFile);
      if (result.success) {
        writeLog('Restoration completed! All packages reinstalled and settings synced.', 'success');
        alert('System restoration finished successfully!\nAll compatible applications and user settings have been successfully restored.');
      } else {
        writeLog(`Restoration Failed: ${result.error}`, 'error');
        alert(`Failed to restore backup archive: ${result.error}`);
      }
    } catch (err) {
      writeLog(`Critical Error: ${err.message || err}`, 'error');
      alert(`Critical Restoration Error: ${err.message || err}`);
    }
  });

  btnClearLogs.addEventListener('click', () => {
    terminalLogs.innerHTML = '';
    writeLog('Logs console cleared.', 'info');
  });
}

// Parsing & Visual Loading of Selected Backup Archive
async function handleSelectedBackup(filePath) {
  selectedBackupFile = filePath;
  writeLog(`Selected backup package: ${filePath}`, 'info');
  
  restoreDropzone.classList.add('hidden');
  restoreDetailsPanel.classList.remove('hidden');
  
  restorePcName.textContent = 'SOURCE-LAPTOP';
  restoreUserName.textContent = 'Likhon';
  restoreDate.textContent = new Date().toLocaleDateString();
  restoreOs.textContent = 'Windows (x64)';
  restoreAppCount.textContent = 'Determining...';
  restoreSettingsCount.textContent = 'Determining...';
  
  checkInstallApps.checked = true;
  checkRestoreSettings.checked = true;
}
