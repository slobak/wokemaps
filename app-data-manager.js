// App Data Manager
// Handles loading, caching, and validation of application data

class AppDataManager {
    constructor(optionsManager) {
        this.optionsManager = optionsManager;
        this.DATA_VERSION = 1;
        this.DATA_CACHE_KEY = 'wokemaps_app_data_cache';
        this.DATA_CACHE_EXPIRY_KEY = 'wokemaps_app_data_expiry';
        this.DATA_CACHE_DURATION = 3 * 60 * 60 * 1000; // 3 hours in milliseconds
        this.appData = null;
    }

    // Validate that app data has the expected structure
    validateAppData(data) {
        if (!(data instanceof Object)) {
            throw new Error("App data is not a dictionary");
        }

        if (!data.labels || !(data.labels instanceof Array)) {
            throw new Error("No array `labels` found in app data");
        }
    }

    // Load cached app data from Chrome storage
    async loadCachedAppData() {
        const cacheSettings = await chrome.storage.local.get([this.DATA_CACHE_KEY, this.DATA_CACHE_EXPIRY_KEY]);
        const cachedData = cacheSettings[this.DATA_CACHE_KEY];
        const cacheExpiry = cacheSettings[this.DATA_CACHE_EXPIRY_KEY];

        const now = Date.now();

        if (cachedData && cacheExpiry && now < parseInt(cacheExpiry)) {
            log.info('init', "Using cached app data");
            return JSON.parse(cachedData);
        }

        return null;
    }

    // Load app data from remote source
    async loadRemoteAppData() {
        try {
            log.debug('init', "Fetching fresh app data from remote source");
            const response = await fetch(`https://wokemaps-public.s3.us-east-2.amazonaws.com/app-data-v${this.DATA_VERSION}.json`, {
                method: 'GET',
                cache: 'no-cache',
                headers: {
                    'Accept': 'application/json',
                },
                signal: AbortSignal.timeout(5000) // 5 second timeout
            });

            if (!response.ok) {
                throw new Error(`Remote fetch failed with status: ${response.status}`);
            }

            const remoteData = await response.json();
            this.validateAppData(remoteData);

            // Cache the successful response
            chrome.storage.local.set({
                [this.DATA_CACHE_KEY]: JSON.stringify(remoteData),
                [this.DATA_CACHE_EXPIRY_KEY]: (Date.now() + this.DATA_CACHE_DURATION).toString()
            });

            log.info('init', `Successfully loaded and cached ${remoteData.labels.length} labels from remote app data`);
            return remoteData;
        } catch (error) {
            log.warn('init', `Failed to load remote app data: ${error.message}`);
            return null;
        }
    }

    // Load app data from local bundled file
    async loadBuiltinAppData() {
        try {
            const localUrl = chrome.runtime.getURL(`app-data-v${this.DATA_VERSION}.json`);
            const localResponse = await fetch(localUrl);

            if (!localResponse.ok) {
                throw new Error(`Local resource fetch failed with status: ${localResponse.status}`);
            }

            const localData = await localResponse.json();
            this.validateAppData(localData);

            log.info('init', `Successfully loaded ${localData.labels.length} labels from local app data`);
            return localData;
        } catch (localError) {
            log.error('init', `Failed to load local app data: ${localError.message}`);
            log.error('init', "No app data available, extension may not work properly");
            return { labels: [], announcements: [] }; // Return empty structure if everything fails
        }
    }

    // Main method to load app data using the configured strategy
    async loadAppData() {
        if (this.appData) {
            return this.appData;
        }

        log.debug('init', "Loading app data");

        const useRemote = await this.optionsManager.getOption('debug.enableRemoteConfig', true);
        const useCache = await this.optionsManager.getOption('debug.enableRemoteConfigCache', true);

        if (useRemote) {
            if (useCache) {
                const cachedData = await this.loadCachedAppData();
                if (cachedData) {
                    this.appData = cachedData;
                    return this.appData;
                }
            }

            const remoteData = await this.loadRemoteAppData();
            if (remoteData) {
                this.appData = remoteData;
                return this.appData;
            }
        }

        // Fall back to builtin app data
        this.appData = await this.loadBuiltinAppData();
        return this.appData;
    }

    // Get just the labels array
    async getLabels() {
        const data = await this.loadAppData();
        return data.labels || [];
    }

    // Get just the announcements array
    async getAnnouncements() {
        const data = await this.loadAppData();
        return data.announcements || [];
    }
}

// Export for use in other files
if (typeof window !== 'undefined') {
    window.AppDataManager = AppDataManager;
}
