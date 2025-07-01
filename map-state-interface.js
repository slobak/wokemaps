// MapState Interface Definition
// Defines the contract that all MapState implementations must follow

/**
 * Interface for MapState implementations
 * This serves as documentation and can be used for runtime type checking
 */
class MapStateInterface {
    /**
     * Initialize the map state tracker
     * @returns {boolean} True if initialization succeeded
     */
    initialize() {
        throw new Error('MapState.initialize() must be implemented');
    }

    /**
     * Convert lat/lng to canvas pixel coordinates
     * @param {number} lat - Latitude
     * @param {number} lng - Longitude
     * @returns {Object|null} Canvas coordinates {x, y} or null if error
     */
    mapLatLngToCanvas(lat, lng) {
        throw new Error('MapState.mapLatLngToCanvas() must be implemented');
    }

    /**
     * Update position information from URL
     */
    updatePositionFromUrl() {
        throw new Error('MapState.updatePositionFromUrl() must be implemented');
    }

    /**
     * Add a listener for map state changes
     * @param {Function} callback - Called when state changes with (changeType, mapState)
     */
    addChangeListener(callback) {
        throw new Error('MapState.addChangeListener() must be implemented');
    }

    /**
     * Remove a change listener
     * @param {Function} callback - Callback to remove
     */
    removeChangeListener(callback) {
        throw new Error('MapState.removeChangeListener() must be implemented');
    }

    /**
     * Handle URL changes
     */
    handleUrlChanged() {
        throw new Error('MapState.handleUrlChanged() must be implemented');
    }

    /**
     * Handle potential zoom interactions
     */
    handlePotentialZoomInteraction() {
        throw new Error('MapState.handlePotentialZoomInteraction() must be implemented');
    }

    /**
     * Clean up observers and listeners
     */
    cleanup() {
        throw new Error('MapState.cleanup() must be implemented');
    }

    /**
     * Check if map state is valid
     * @returns {boolean} True if state is valid
     */
    isValid() {
        throw new Error('MapState.isValid() must be implemented');
    }

    // Required properties
    get center() {
        throw new Error('MapState.center property must be implemented');
    }

    get zoom() {
        throw new Error('MapState.zoom property must be implemented');
    }

    get isPotentiallyZooming() {
        throw new Error('MapState.isPotentiallyZooming property must be implemented');
    }

    get viewMode() {
        throw new Error('MapState.mode property must be implemented')
    }
}

/**
 * Utility function to validate that an object implements the MapState interface
 * @param {Object} mapState - Object to validate
 * @returns {boolean} True if object implements the interface
 */
function validateMapStateInterface(mapState) {
    const requiredMethods = [
        'initialize', 'mapLatLngToCanvas', 'updatePositionFromUrl',
        'addChangeListener', 'removeChangeListener', 'handleUrlChanged',
        'handlePotentialZoomInteraction', 'cleanup', 'isValid'
    ];

    const requiredProperties = ['center', 'zoom', 'isPotentiallyZooming'];

    // Check methods
    for (const method of requiredMethods) {
        if (typeof mapState[method] !== 'function') {
            console.error(`MapState missing required method: ${method}`);
            return false;
        }
    }

    // Check properties (they can be getters)
    for (const prop of requiredProperties) {
        if (!(prop in mapState)) {
            console.error(`MapState missing required property: ${prop}`);
            return false;
        }
    }

    return true;
}

// Export for use in other files
if (typeof window !== 'undefined') {
    window.MapStateInterface = MapStateInterface;
    window.validateMapStateInterface = validateMapStateInterface;
}