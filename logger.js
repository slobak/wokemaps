// logger.js - Enhanced logging system for wokemaps extension

const LOG_LEVELS = {
    NONE: 0,
    ERROR: 1,
    WARN: 2,
    INFO: 3,
    DETAIL: 4
};

// Global logger implementation
const log = {
    // Default configuration - INFO level for all channels
    config: {
        init: LOG_LEVELS.INFO,
        render: LOG_LEVELS.INFO,
        state: LOG_LEVELS.INFO
    },

    // Core logging method
    _log(level, channel, ...args) {
        const channelLevel = this.config[channel] || LOG_LEVELS.INFO;

        if (level > channelLevel) {
            return; // Skip logging if level is too low
        }

        try {
            // Handle deferred evaluation - process function arguments
            const processedArgs = args.map(arg => {
                return typeof arg === 'function' ? arg() : arg;
            });

            const prefix = `wokemaps: [${channel}]`;
            const consoleMethod = this._getConsoleMethod(level);
            console[consoleMethod](prefix, ...processedArgs);
        } catch (error) {
            // Fallback to prevent logging from breaking the extension
            console.error('wokemaps: [logger] Logging error:', error);
        }
    },

    // Map log levels to console methods
    _getConsoleMethod(level) {
        switch (level) {
            case LOG_LEVELS.ERROR: return 'error';
            case LOG_LEVELS.WARN: return 'warn';
            case LOG_LEVELS.INFO: return 'info';
            case LOG_LEVELS.DETAIL: return 'log';
            default: return 'log';
        }
    },

    // Convenience methods for each log level
    error(channel, ...args) {
        this._log(LOG_LEVELS.ERROR, channel, ...args);
    },

    warn(channel, ...args) {
        this._log(LOG_LEVELS.WARN, channel, ...args);
    },

    info(channel, ...args) {
        this._log(LOG_LEVELS.INFO, channel, ...args);
    },

    detail(channel, ...args) {
        this._log(LOG_LEVELS.DETAIL, channel, ...args);
    },

    // Dynamic configuration methods
    setLevel(channel, level) {
        if (typeof level === 'number' && level >= 0 && level <= 4) {
            this.config[channel] = level;
            this.detail('init', `Log level for '${channel}' set to ${level}`);
        } else {
            this.error('init', `Invalid log level: ${level}`);
        }
    },

    setLevels(configObject) {
        if (typeof configObject === 'object' && configObject !== null) {
            Object.assign(this.config, configObject);
            this.detail('init', 'Log levels updated:', this.config);
        } else {
            this.error('init', 'Invalid log configuration object');
        }
    },

    // Get current configuration (useful for debugging)
    getConfig() {
        return { ...this.config };
    },

    // Initialize logger with options from OptionsManager
    async initialize(optionsManager) {
        try {
            if (!optionsManager) {
                this.warn('init', 'No options manager provided, using defaults');
                return;
            }

            // Load log levels from options (supporting both old and new format)
            const logLevels = await optionsManager.getOption('debug.logLevels');
            if (logLevels && typeof logLevels === 'object') {
                this.setLevels(logLevels);
            } else {
                // Fallback to old single logLevel setting
                const legacyLogLevel = await optionsManager.getOption('debug.logLevel', LOG_LEVELS.INFO);
                if (typeof legacyLogLevel === 'number') {
                    this.setLevels({
                        init: legacyLogLevel,
                        render: legacyLogLevel,
                        state: legacyLogLevel
                    });
                }
            }

            this.info('init', 'Logger initialized with config:', this.getConfig());
        } catch (error) {
            this.error('init', 'Failed to initialize logger:', error);
        }
    }
};

// === Cross-Script Communication ===

// Send log configuration to in-page script (for content scripts)
function sendLogConfigToPage() {
    window.postMessage({
        type: 'WOKEMAPS_LOG_CONFIG',
        config: log.getConfig()
    }, '*');
}

// Listen for log configuration from content script (for in-page scripts)
function setupInPageLogger() {
    window.addEventListener('message', (event) => {
        if (event.origin !== window.location.origin) return;

        if (event.data.type === 'WOKEMAPS_LOG_CONFIG') {
            log.setLevels(event.data.config);
            log.info('init', 'In-page logger configuration updated');
        }
    });
}

// === Integration Helpers ===

// For content scripts that have access to OptionsManager
async function initializeLoggerWithOptions() {
    if (typeof OptionsManager !== 'undefined') {
        const optionsManager = new OptionsManager();
        await log.initialize(optionsManager);

        // Send config to in-page script
        sendLogConfigToPage();
    } else {
        log.warn('init', 'OptionsManager not available, using default log levels');
    }
}

// For in-page scripts
function initializeInPageLogger() {
    setupInPageLogger();
    log.info('init', 'In-page logger ready, waiting for configuration');
}

// Make logger globally accessible
if (typeof window !== 'undefined') {
    window.log = log;
    window.LOG_LEVELS = LOG_LEVELS;
    window.initializeLoggerWithOptions = initializeLoggerWithOptions;
    window.initializeInPageLogger = initializeInPageLogger;
}

// === Usage Examples ===
/*
// In content scripts:
await initializeLoggerWithOptions();
log.info('init', 'Extension starting up');
log.detail('render', () => `Complex state: ${JSON.stringify(state)}`);

// In in-page scripts:
initializeInPageLogger();
log.info('init', 'Page script loaded');

// Dynamic updates:
log.setLevel('render', LOG_LEVELS.DETAIL);
*/
