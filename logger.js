// logger.js - Enhanced logging system for wokemaps extension

const WOKEMAPS_LOG_LEVELS = {
    NONE: 0,
    ERROR: 1,
    WARN: 2,
    INFO: 3,
    DEBUG: 4,
    DETAIL: 5
};

// Global logger implementation
const log = {
    // Default configuration - INFO level for all channels
    config: {
        init: WOKEMAPS_LOG_LEVELS.INFO,
        render: WOKEMAPS_LOG_LEVELS.INFO,
        state: WOKEMAPS_LOG_LEVELS.INFO
    },

    // Default to the name of this extension. The extra space is reserved for a
    // marker indicating the log is from the in-page script, in the in-page
    // instance of the logger.
    prefix: 'wokemaps ',

    // Core logging method
    _log(level, channel, ...args) {
        const channelLevel = this.config[channel] || WOKEMAPS_LOG_LEVELS.INFO;

        if (level > channelLevel) {
            return; // Skip logging if level is too low
        }

        try {
            // Handle deferred evaluation - process function arguments
            const processedArgs = args.map(arg => {
                return typeof arg === 'function' ? arg() : arg;
            });

            const prefix = `${log.prefix} [${channel}]`;
            const consoleMethod = this._getConsoleMethod(level);
            console[consoleMethod](prefix, ...processedArgs);
        } catch (error) {
            // Fallback to prevent logging from breaking the extension
            console.error(`${this.prefix} [logger] Logging error:`, error);
        }
    },

    // Map log levels to console methods
    _getConsoleMethod(level) {
        switch (level) {
            case WOKEMAPS_LOG_LEVELS.ERROR: return 'error';
            case WOKEMAPS_LOG_LEVELS.WARN: return 'warn';
            case WOKEMAPS_LOG_LEVELS.INFO: return 'info';
            case WOKEMAPS_LOG_LEVELS.DEBUG: return 'info';
            case WOKEMAPS_LOG_LEVELS.DETAIL: return 'log';
            default: return 'log';
        }
    },

    // Convenience methods for each log level
    error(channel, ...args) {
        this._log(WOKEMAPS_LOG_LEVELS.ERROR, channel, ...args);
    },

    warn(channel, ...args) {
        this._log(WOKEMAPS_LOG_LEVELS.WARN, channel, ...args);
    },

    info(channel, ...args) {
        this._log(WOKEMAPS_LOG_LEVELS.INFO, channel, ...args);
    },

    debug(channel, ...args) {
        this._log(WOKEMAPS_LOG_LEVELS.DEBUG, channel, ...args);
    },

    detail(channel, ...args) {
        this._log(WOKEMAPS_LOG_LEVELS.DETAIL, channel, ...args);
    },

    // Dynamic configuration methods
    setLevel(channel, level) {
        if (typeof level === 'number' && level >= 0 && level <= 5) {
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

    setPrefix(prefix) {
        this.prefix = prefix;
    },

    // Get current configuration (useful for debugging)
    getConfig() {
        return { ...this.config };
    },

    initialize(logLevels) {
        // For content scripts that have access to OptionsManager
        if (typeof logLevels !== 'undefined') {
            this.setLevels(logLevels);

            // Send config to in-page script
            window.postMessage({
                type: 'WOKEMAPS_LOG_CONFIG',
                config: log.getConfig()
            }, '*');
        } else {
            this.info('init', 'No log options provided, using defaults');
        }
    }
};

// Make logger globally accessible
if (typeof window !== 'undefined') {
    window.log = log;
    window.WOKEMAPS_LOG_LEVELS = WOKEMAPS_LOG_LEVELS;
}
