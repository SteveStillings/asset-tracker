import { CapacitorBarcodeScanner, CapacitorBarcodeScannerTypeHintALLOption, CapacitorBarcodeScannerCameraDirection, CapacitorBarcodeScannerScanOrientation, CapacitorBarcodeScannerAndroidScanningLibrary } from '@capacitor/barcode-scanner';
import { Haptics, ImpactStyle, NotificationType } from '@capacitor/haptics';
import { Network } from '@capacitor/network';

// --- Configuration ---
const CONFIG = {
  API_BASE_URL: 'https://script.google.com/macros/s/.../exec',
  FETCH_TIMEOUT: 15000,
  STATUS: {
    IN: 'checked_in',
    OUT: 'checked_out',
    UNKNOWN: 'unknown'
  }
};

// --- State Management ---
const AppState = {
  currentAsset: null,
  isBusy: false,
};

// --- UI Helpers ---
const UI = {
  el: {
    barcode: document.getElementById('barcode'),
    operator: document.getElementById('operator'),
    assignee: document.getElementById('assignee'),
    note: document.getElementById('note'),
    message: document.getElementById('message'),
    statusPill: document.getElementById('statusPill'),
    currentAssetSection: document.getElementById('currentAssetSection'),
    // ... cache other elements as needed
  },

  updateText(id, text) {
    const element = document.getElementById(id);
    if (element) element.textContent = text || '—';
  },

  setMessage(text, type = '') {
    if (!this.el.message) return;
    this.el.message.textContent = text;
    this.el.message.className = `status-box ${type ? `status-${type}` : ''}`;
  },

  setLoading(isLoading) {
    AppState.isBusy = isLoading;
    document.body.classList.toggle('is-loading', isLoading);

    // Disable all buttons during load
    document.querySelectorAll('button').forEach(btn => btn.disabled = isLoading);

    if (!isLoading) refreshUIState();
  }
};

// --- Core Logic ---

/**
 * Enhanced API Wrapper
 */
async function apiRequest(method, params = {}, body = null) {
  const url = new URL(CONFIG.API_BASE_URL);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), CONFIG.FETCH_TIMEOUT);

  try {
    const response = await fetch(url.toString(), {
      method,
      signal: controller.signal,
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: body ? JSON.stringify(body) : null
    });

    if (!response.ok) throw new Error(`Server error: ${response.status}`);

    const data = await response.json();
    if (!data.success) throw new Error(data.message || 'Action failed');
    return data;
  } catch (err) {
    if (err.name === 'AbortError') throw new Error('Request timed out. Check your connection.');
    throw err;
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Unified Runner for Actions
 * Handles: Busy state, Connectivity, Haptics, and Error Catching
 */
async function runAction(fn, successMessage = null) {
  if (AppState.isBusy) return;

  const status = await Network.getStatus();
  if (!status.connected) {
    UI.setMessage('No internet connection.', 'error');
    await Haptics.notification({ type: NotificationType.Error });
    return;
  }

  UI.setLoading(true);
  try {
    await fn();
    if (successMessage) UI.setMessage(successMessage, 'success');
  } catch (err) {
    console.error("Action Error:", err);
    UI.setMessage(err.message, 'error');
    await Haptics.notification({ type: NotificationType.Error });
  } finally {
    UI.setLoading(false);
  }
}

// --- Specific Actions ---

async function lookupAsset() {
  const barcode = UI.el.barcode.value.trim().toUpperCase();
  if (!barcode) throw new Error('Please enter a barcode.');

  UI.setMessage('Searching...');
  const data = await apiRequest('GET', { action: 'getAsset', barcode });

  renderAsset(data.asset);

  if (data.found) {
    await Haptics.impact({ style: ImpactStyle.Light });
    UI.el.currentAssetSection?.scrollIntoView({ behavior: 'smooth' });
    if (data.asset.checkedOutTo && UI.el.assignee) UI.el.assignee.value = data.asset.checkedOutTo;
  } else {
    throw new Error(`Asset ${barcode} not found.`);
  }
}

async function updateAssetStatus(action) {
  const barcode = UI.el.barcode.value.trim().toUpperCase();
  const operator = UI.el.operator.value;
  const assignee = UI.el.assignee.value;

  if (!barcode || !operator) throw new Error('Barcode and Operator are required.');
  if (action === 'checkOut' && !assignee) throw new Error('Assignee is required for check-out.');

  UI.setMessage(action === 'checkIn' ? 'Checking in...' : 'Checking out...');

  const data = await apiRequest('POST', {}, {
    action,
    barcode,
    user: operator,
    note: UI.el.note.value.trim(),
    checkedOutTo: action === 'checkOut' ? assignee : undefined
  });

  renderAsset(data.asset);
  UI.el.note.value = '';
  await Haptics.notification({ type: NotificationType.Success });
}

function renderAsset(asset) {
  AppState.currentAsset = asset || null;
  const status = (asset?.status || CONFIG.STATUS.UNKNOWN).toLowerCase();

  UI.updateText('assetBarcode', asset?.barcode);
  UI.updateText('assetName', asset?.assetName);
  UI.updateText('assetCheckedOutTo', asset?.checkedOutTo);
  UI.updateText('assetLastUpdated', asset?.lastUpdated ? new Date(asset.lastUpdated).toLocaleString() : '—');

  if (UI.el.statusPill) {
    UI.el.statusPill.textContent = status.replace('_', ' ');
    UI.el.statusPill.className = `pill pill-${status.split('_')[1] || 'unknown'}`;
  }

  refreshUIState();
}

function refreshUIState() {
  const barcode = UI.el.barcode?.value.trim();
  const operator = UI.el.operator?.value;
  const status = (AppState.currentAsset?.status || '').toLowerCase();

  // Selective button enabling
  const btnIn = document.getElementById('btnCheckIn');
  const btnOut = document.getElementById('btnCheckOut');

  if (btnIn) btnIn.disabled = !barcode || !operator || status === CONFIG.STATUS.IN;
  if (btnOut) btnOut.disabled = !barcode || !operator || !UI.el.assignee?.value || status === CONFIG.STATUS.OUT;
}

// --- Initialization ---

document.addEventListener('DOMContentLoaded', () => {
  // Bind Events
  document.getElementById('btnLookup')?.addEventListener('click', () => runAction(lookupAsset));
  document.getElementById('btnCheckIn')?.addEventListener('click', () => runAction(() => updateAssetStatus('checkIn'), 'Checked in successfully'));
  document.getElementById('btnCheckOut')?.addEventListener('click', () => runAction(() => updateAssetStatus('checkOut'), 'Checked out successfully'));

  UI.el.barcode?.addEventListener('input', (e) => {
    e.target.value = e.target.value.toUpperCase();
    refreshUIState();
  });

  // Initial Data Load
  runAction(async () => {
    await Promise.all([
      fetchAndPopulate('getUsers', UI.el.assignee, 'Select assignee'),
      fetchAndPopulate('getOperators', UI.el.operator, 'Select operator')
    ]);
  }, 'System Ready');
});

// Note: fetchAndPopulate would remain similar but use UI.setMessage for errors.