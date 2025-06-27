// Wokemaps Site Integration - Main World
// Receives UUID from isolated world and makes it available to page

(function() {
    // Listen for messages from isolated world
    window.addEventListener('message', function(event) {
        // Only accept messages from same origin
        if (event.origin !== window.location.origin) return;

        if (event.data.type === 'WOKEMAPS_EXTENSION_UUID') {
            console.log('Received UUID in main world:', event.data.uuid);

            // Set extension data in main world
            window.WokemapsExtension = {
                uuid: event.data.uuid,
                version: event.data.version,
                installed: event.data.installed
            };

            // Dispatch event to notify page
            window.dispatchEvent(new CustomEvent('wokemaps_extension_ready', {
                detail: event.data
            }));

        } else if (event.data.type === 'WOKEMAPS_EXTENSION_ERROR') {
            console.log('Extension error in main world:', event.data.error);

            // Dispatch error event
            window.dispatchEvent(new CustomEvent('wokemaps_extension_error', {
                detail: event.data
            }));
        }
    });

    console.log('Main world script ready, waiting for extension data');
})();
