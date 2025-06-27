// Options Manager
// Handles loading, saving, and merging of extension options

class OptionsManager {
    constructor() {
        this.OPTIONS_STORAGE_KEY = 'wokemaps_options';
        this.defaultOptions = null;
        this.currentOptions = null;
    }

    // Load default options from the bundled JSON file
    async loadDefaultOptions() {
        if (this.defaultOptions) {
            return this.defaultOptions;
        }

        const response = await fetch(chrome.runtime.getURL('default-options.json'));
        if (!response.ok) {
            throw new Error(`Failed to load default options: ${response.status}`);
        }
        this.defaultOptions = await response.json();
        return this.defaultOptions;
    }

    // Load stored options from Chrome storage
    async loadStoredOptions() {
        const result = await chrome.storage.sync.get([this.OPTIONS_STORAGE_KEY]);
        return result[this.OPTIONS_STORAGE_KEY] || null;
    }

    // Load and merge all options (default + stored)
    async loadOptions() {
        const defaultOptions = await this.loadDefaultOptions();
        const storedOptions = await this.loadStoredOptions();

        if (storedOptions) {
            this.currentOptions = storedOptions;
            log.info('init', "Loaded options from storage", this.currentOptions);
        } else {
            this.currentOptions = { ...defaultOptions };
            log.info('init', "Using default options", this.currentOptions);
        }

        return this.currentOptions;
    }

    // Get current options (load if not already loaded)
    async getOptions() {
        if (!this.currentOptions) {
            await this.loadOptions();
        }
        return this.currentOptions;
    }

    // Get a specific option value with dot notation (e.g., 'debug.logLevel')
    async getOption(path, defaultValue = undefined) {
        const options = await this.getOptions();

        const keys = path.split('.');
        let value = options;

        for (const key of keys) {
            if (value && typeof value === 'object' && key in value) {
                value = value[key];
            } else {
                return defaultValue;
            }
        }

        return value;
    }

    // Save options to Chrome storage
    async saveOptions(options) {
        try {
            await chrome.storage.sync.set({ [this.OPTIONS_STORAGE_KEY]: options });
            this.currentOptions = { ...options };
            return true;
        } catch (e) {
            log.error('init', 'Failed to save options:', e);
            return false;
        }
    }

    // Reset options to defaults
    async resetToDefaults() {
        try {
            await chrome.storage.sync.remove([this.OPTIONS_STORAGE_KEY]);
            const defaultOptions = await this.loadDefaultOptions();
            this.currentOptions = { ...defaultOptions };
            return true;
        } catch (e) {
            log.error('init', 'Failed to reset options:', e);
            return false;
        }
    }
}

// Export for use in other files
if (typeof window !== 'undefined') {
    window.OptionsManager = OptionsManager;
}
