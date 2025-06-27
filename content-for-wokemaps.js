// Wokemaps Voting Integration - Isolated World
// Gets UUID from extension APIs and sends to main world

(async function() {
    try {
        const uuidManager = new UuidManager();
        const uuid = await uuidManager.getUUID();
        const version = chrome.runtime.getManifest().version;

        console.log('Extension UUID ready in isolated world:', uuid);

        // Send UUID to main world via postMessage
        window.postMessage({
            type: 'WOKEMAPS_EXTENSION_UUID',
            uuid: uuid,
            version: version,
            installed: true
        }, '*');

    } catch (e) {
        console.error('Failed to get UUID in isolated world:', e);

        // Send error to main world
        window.postMessage({
            type: 'WOKEMAPS_EXTENSION_ERROR',
            error: 'Failed to get UUID'
        }, '*');
    }
})();
