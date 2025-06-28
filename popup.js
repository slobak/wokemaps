// Woke Maps Popup Configuration Panel

document.addEventListener('DOMContentLoaded', async function() {
    const CONFIG_CACHE_KEY = 'wokemaps_config_cache';
    const CONFIG_CACHE_EXPIRY_KEY = 'wokemaps_config_expiry';
    const ANNOUNCEMENT_DISMISSAL_KEY = 'wokemaps_announcement_dismissals';

    const optionsManager = new OptionsManager();

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
        const options = await optionsManager.getOptions();
        const debugOptions = options.debug || {};
        const showDebugUi = debugOptions.showDebugUi || false;

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
    async function setupDebugView() {
        const options = await optionsManager.getOptions();
        const debugOptions = options.debug || {};

        // Set current values for existing debug options
        document.getElementById('enableRemoteConfig').checked = debugOptions.enableRemoteConfig !== false;
        document.getElementById('enableRemoteConfigCache').checked = debugOptions.enableRemoteConfigCache !== false;
        document.getElementById('highlightGrid').checked = debugOptions.highlightGrid || false;

        // Set current values for log levels
        const logLevels = debugOptions.logLevels || {};
        document.getElementById('initLogLevel').value = logLevels.init || 3;
        document.getElementById('renderLogLevel').value = logLevels.render || 3;
        document.getElementById('stateLogLevel').value = logLevels.state || 3;
        document.getElementById('uiLogLevel').value = logLevels.ui || 3;

        // Add event listeners for automatic saving
        document.getElementById('enableRemoteConfig').addEventListener('change', async function() {
            const currentOptions = await optionsManager.getOptions();
            currentOptions.debug = currentOptions.debug || {};
            currentOptions.debug.enableRemoteConfig = this.checked;

            if (await optionsManager.saveOptions(currentOptions)) {
                showStatus('Remote config setting saved');
            } else {
                showStatus('Failed to save setting', 'error');
            }
        });

        document.getElementById('enableRemoteConfigCache').addEventListener('change', async function() {
            const currentOptions = await optionsManager.getOptions();
            currentOptions.debug = currentOptions.debug || {};
            currentOptions.debug.enableRemoteConfigCache = this.checked;

            if (await optionsManager.saveOptions(currentOptions)) {
                showStatus('Remote config cache setting saved');
            } else {
                showStatus('Failed to save setting', 'error');
            }
        });

        document.getElementById('highlightGrid').addEventListener('change', async function() {
            const currentOptions = await optionsManager.getOptions();
            currentOptions.debug = currentOptions.debug || {};
            currentOptions.debug.highlightGrid = this.checked;

            if (await optionsManager.saveOptions(currentOptions)) {
                showStatus('Grid highlight setting saved');
            } else {
                showStatus('Failed to save setting', 'error');
            }
        });

        // Add event listeners for log level changes
        const logLevelIds = ['initLogLevel', 'renderLogLevel', 'stateLogLevel', 'uiLogLevel'];
        const logLevelChannels = ['init', 'render', 'state', 'ui'];

        logLevelIds.forEach((id, index) => {
            document.getElementById(id).addEventListener('change', async function() {
                const value = parseInt(this.value);
                const channel = logLevelChannels[index];

                if (value >= 0 && value <= 4) {
                    const currentOptions = await optionsManager.getOptions();
                    currentOptions.debug = currentOptions.debug || {};
                    currentOptions.debug.logLevels = currentOptions.debug.logLevels || {};
                    currentOptions.debug.logLevels[channel] = value;

                    if (await optionsManager.saveOptions(currentOptions)) {
                        showStatus(`${channel} log level saved`);
                    } else {
                        showStatus('Failed to save setting', 'error');
                    }
                }
            });
        });

        // Add event listeners for action buttons
        document.getElementById('resetOptions').addEventListener('click', async function() {
            try {
                await optionsManager.resetToDefaults();

                // Update UI with reset values
                const options = await optionsManager.getOptions();
                const debugOptions = options.debug || {};

                document.getElementById('enableRemoteConfig').checked = debugOptions.enableRemoteConfig !== false;
                document.getElementById('enableRemoteConfigCache').checked = debugOptions.enableRemoteConfigCache !== false;
                document.getElementById('highlightGrid').checked = debugOptions.highlightGrid || false;

                // Reset log levels to defaults
                const logLevels = debugOptions.logLevels || {};
                document.getElementById('initLogLevel').value = logLevels.init || 3;
                document.getElementById('renderLogLevel').value = logLevels.render || 3;
                document.getElementById('stateLogLevel').value = logLevels.state || 3;
                document.getElementById('uiLogLevel').value = logLevels.ui || 3;

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
