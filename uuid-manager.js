// UUID Manager
// Handles generating and storing persistent UUIDs for voting

class UuidManager {
    constructor() {
        this.UUID_STORAGE_KEY = 'wokemaps_user_uuid';
        this.uuid = null;
    }

    // Generate a new UUID v4
    generateUUID() {
        return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
            const r = Math.random() * 16 | 0;
            const v = c == 'x' ? r : (r & 0x3 | 0x8);
            return v.toString(16);
        });
    }

    // Get or create UUID
    async getUUID() {
        if (this.uuid) {
            return this.uuid;
        }

        try {
            const result = await chrome.storage.sync.get([this.UUID_STORAGE_KEY]);

            if (result[this.UUID_STORAGE_KEY]) {
                this.uuid = result[this.UUID_STORAGE_KEY];
                log.detail('init', 'Using existing UUID');
            } else {
                this.uuid = this.generateUUID();
                await chrome.storage.sync.set({ [this.UUID_STORAGE_KEY]: this.uuid });
                log.detail('init', 'Generated new UUID');
            }

            return this.uuid;
        } catch (e) {
            log.error('init', 'Failed to get/set UUID:', e);
            // Fallback to session-only UUID
            this.uuid = this.generateUUID();
            return this.uuid;
        }
    }

    // Reset UUID (for testing or user request)
    async resetUUID() {
        try {
            this.uuid = this.generateUUID();
            await chrome.storage.sync.set({ [this.UUID_STORAGE_KEY]: this.uuid });
            log.detail('init', 'UUID reset');
            return this.uuid;
        } catch (e) {
            log.error('init', 'Failed to reset UUID:', e);
            return null;
        }
    }
}

// Export for use in other files
if (typeof window !== 'undefined') {
    window.UuidManager = UuidManager;
}
