// Woke Maps Popup Configuration Panel

document.addEventListener('DOMContentLoaded', async function() {
    const OPTIONS_STORAGE_KEY = 'wokemaps_options';
    const CONFIG_CACHE_KEY = 'wokemaps_config_cache';
    const CONFIG_CACHE_EXPIRY_KEY = 'wokemaps_config_expiry';
    const ANNOUNCEMENT_DISMISSAL_KEY = 'wokemaps_announcement_dismissals';

    let currentOptions = {};

    // Load default options
    async function loadDefaultOptions() {
        try {
            const response = await fetch(chrome.runtime.getURL('default-options.json'));
            if (!response.ok) {
                throw new Error(`Failed to load default options: ${response.status}`);
            }
            return await response.json();
        } catch (e) {
            console.error('Failed to load default options:', e);
            return {
                debug: {
                    enableRemoteLabels: true,
                    highlightGrid: false,
                    logLevel: 0,
                    showDebugUi: false
                }
            };
        }
    }

    // Load current options from Chrome storage
    async function loadCurrentOptions() {
        try {
            const result = await chrome.storage.sync.get([OPTIONS_STORAGE_KEY]);
            if (result[OPTIONS_STORAGE_KEY]) {
                return result[OPTIONS_STORAGE_KEY];
            }
        } catch (e) {
            console.warn('Failed to load stored options:', e);
        }

        // Fall back to default options
        return await loadDefaultOptions();
    }

    // Save options to Chrome storage
    async function saveOptions(options) {
        try {
            await chrome.storage.sync.set({ [OPTIONS_STORAGE_KEY]: options });
            return true;
        } catch (e) {
            console.error('Failed to save options:', e);
            return false;
        }
    }

    // Show status message
    function showStatus(message, type = 'success') {
        const statusEl = document.getElementById('status');
        statusEl.textContent = message;
        statusEl.className = `status ${type}`;
        statusEl.style.display = 'block';

        setTimeout(() => {
            statusEl.style.display = 'none';
        }, 3000);
    }

    // Initialize the popup
    async function initialize() {
        const defaultOptions = await loadDefaultOptions();
        currentOptions = await loadCurrentOptions();

        const showDebugUi = defaultOptions.debug?.showDebugUi || false;

        if (showDebugUi) {
            document.getElementById('simple-view').style.display = 'none';
            document.getElementById('debug-view').style.display = 'block';
            setupDebugView();
        } else {
            document.getElementById('simple-view').style.display = 'block';
            document.getElementById('debug-view').style.display = 'none';
        }
    }

    // Setup debug view with current values
    function setupDebugView() {
        const debugOptions = currentOptions.debug || {};

        // Set current values
        document.getElementById('enableRemoteConfig').checked = debugOptions.enableRemoteConfig !== false;
        document.getElementById('enableRemoteConfigCache').checked = debugOptions.enableRemoteConfigCache !== false;
        document.getElementById('highlightGrid').checked = debugOptions.highlightGrid || false;
        document.getElementById('logLevel').value = debugOptions.logLevel || 0;

        // Add event listeners for automatic saving
        document.getElementById('enableRemoteConfig').addEventListener('change', function() {
            currentOptions.debug = currentOptions.debug || {};
            currentOptions.debug.enableRemoteConfig = this.checked;
            if (saveOptions(currentOptions)) {
                showStatus('Remote config setting saved');
            } else {
                showStatus('Failed to save setting', 'error');
            }
        });

        document.getElementById('enableRemoteConfigCache').addEventListener('change', function() {
            currentOptions.debug = currentOptions.debug || {};
            currentOptions.debug.enableRemoteConfigCache = this.checked;
            if (saveOptions(currentOptions)) {
                showStatus('Remote config cache setting saved');
            } else {
                showStatus('Failed to save setting', 'error');
            }
        });

        document.getElementById('highlightGrid').addEventListener('change', function() {
            currentOptions.debug = currentOptions.debug || {};
            currentOptions.debug.highlightGrid = this.checked;
            if (saveOptions(currentOptions)) {
                showStatus('Grid highlight setting saved');
            } else {
                showStatus('Failed to save setting', 'error');
            }
        });

        document.getElementById('logLevel').addEventListener('change', function() {
            const value = parseInt(this.value);
            if (value >= 0 && value <= 3) {
                currentOptions.debug = currentOptions.debug || {};
                currentOptions.debug.logLevel = value;
                if (saveOptions(currentOptions)) {
                    showStatus('Log level saved');
                } else {
                    showStatus('Failed to save setting', 'error');
                }
            }
        });

        // Add event listeners for action buttons
        document.getElementById('resetOptions').addEventListener('click', async function() {
            try {
                const defaultOptions = await loadDefaultOptions();
                currentOptions = { ...defaultOptions };

                await chrome.storage.sync.remove([OPTIONS_STORAGE_KEY]);

                // Update UI with reset values
                const debugOptions = currentOptions.debug || {};
                document.getElementById('enableRemoteConfig').checked = debugOptions.enableRemoteConfig !== false;
                document.getElementById('enableRemoteConfigCache').checked = debugOptions.enableRemoteConfigCache !== false;
                document.getElementById('highlightGrid').checked = debugOptions.highlightGrid || false;
                document.getElementById('logLevel').value = debugOptions.logLevel || 0;

                showStatus('Options reset to defaults');
            } catch (e) {
                console.error('Error resetting options:', e);
                showStatus('Failed to reset options', 'error');
            }
        });

        document.getElementById('clearConfigCache').addEventListener('click', async function() {
            try {
                chrome.storage.local.remove([CONFIG_CACHE_KEY, CONFIG_CACHE_EXPIRY_KEY]);
                showStatus('Config cache cleared');
            } catch (e) {
                console.error('Error clearing config cache:', e);
                showStatus('Failed to clear config cache', 'error');
            }
        });

        document.getElementById('clearAnnouncementState').addEventListener('click', async function() {
            try {
                chrome.storage.sync.remove([ANNOUNCEMENT_DISMISSAL_KEY]);
                showStatus('Announcement state cleared');
            } catch (e) {
                console.error('Error clearing announcement state:', e);
                showStatus('Failed to clear announcement state', 'error');
            }
        });
    }

    // Start initialization
    await initialize();
});