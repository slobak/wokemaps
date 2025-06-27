// Map State Manager - WebGL Implementation
// Tracks map position, zoom, and tile movement offset instead of transforms

class MapStateWebGL {
    constructor(mapCanvas) {
        this.mapCanvas = mapCanvas;

        // Map position and zoom from URL
        this.center = null;
        this.zoom = 0;

        // Movement tracking (replaces transform tracking)
        this.movementOffset = { x: 0, y: 0 };
        this.hasValidMovement = false;

        // Interaction state
        this.isPotentiallyZooming = false;
        this.zoomInteractionTimeout = null;

        // Change listeners
        this.changeListeners = new Set();

        // Setup message listener for tile movement data from page script
        this.setupMovementListener();
    }

    /**
     * Initialize the map state tracker
     */
    initialize() {
        // Get initial position from URL
        this.updatePositionFromUrl();

        // Set up event listeners
        this.setupEventListeners();

        return true;
    }

    /**
     * Setup listener for tile movement messages from page script
     */
    setupMovementListener() {
        window.addEventListener('message', (event) => {
            if (event.origin !== window.location.origin) return;

            if (event.data.type === 'WOKEMAPS_TILE_MOVEMENT') {
                //xcxc do this in-page. register with the page the ID of element to style.
                this.handleTileMovement(event.data.movement);
            } else if (event.data.type === 'WOKEMAPS_BASELINE_RESET') {
                this.handleBaselineReset();
            }
        });
    }

    /**
     * Handle tile movement data from page script
     */
    handleTileMovement(movement) {
        if (!movement) return;

        const oldMovement = { ...this.movementOffset };
        this.movementOffset = { x: movement.x || 0, y: movement.y || 0 };
        this.hasValidMovement = true;

        // Check if movement changed significantly
        const deltaX = Math.abs(this.movementOffset.x - oldMovement.x);
        const deltaY = Math.abs(this.movementOffset.y - oldMovement.y);

        if (deltaX > 1 || deltaY > 1) {
            this.notifyListeners('movement');
        }
    }

    /**
     * Handle baseline reset from page script
     */
    handleBaselineReset() {
        log.detail('state','Baseline reset detected - clearing movement offset');
        this.movementOffset = { x: 0, y: 0 };
        this.hasValidMovement = false;
        this.mapCanvas.clearMovementTransform();
        this.updatePositionFromUrl();
        this.notifyListeners('baseline');
    }

    /**
     * Add a listener for map state changes
     */
    addChangeListener(callback) {
        this.changeListeners.add(callback);
    }

    /**
     * Remove a change listener
     */
    removeChangeListener(callback) {
        this.changeListeners.delete(callback);
    }

    /**
     * Notify all listeners of state changes
     */
    notifyListeners(changeType) {
        for (const listener of this.changeListeners) {
            try {
                listener(changeType, this);
            } catch (e) {
                log.error('state','Error in map state change listener:', e);
            }
        }
    }

    /**
     * Update position information from URL
     */
    updatePositionFromUrl() {
        const url = window.location.href;
        let hasChanges = false;

        // Extract center coordinates
        const centerMatch = url.match(/@([-\d.]+),([-\d.]+)/);
        if (centerMatch && centerMatch.length >= 3) {
            const lat = parseFloat(centerMatch[1]);
            const lng = parseFloat(centerMatch[2]);

            if (!isNaN(lat) && !isNaN(lng)) {
                const newCenter = { lat, lng };
                if (!this.center || this.center.lat !== lat || this.center.lng !== lng) {
                    this.center = newCenter;
                    hasChanges = true;
                }
            }
        }

        // Extract zoom level
        const zoomMatch = url.match(/@[-\d.]+,[-\d.]+,(\d+\.?\d*)z/);
        if (zoomMatch && zoomMatch.length >= 2) {
            const zoom = parseFloat(zoomMatch[1]);
            if (!isNaN(zoom)) {
                if (this.zoom !== zoom) {
                    this.zoom = zoom;
                    hasChanges = true;
                }
            }
        }

        if (hasChanges) {
            log.detail('state', `Position updated from URL: lat:${this.center?.lat}, lng:${this.center?.lng}, zoom:${this.zoom}`);
            this.notifyListeners('position');
        }
    }

    /**
     * Handle map interactions that might result in a zoom
     */
    handlePotentialZoomInteraction() {
        this.isPotentiallyZooming = true;
        log.detail('state',"Potential zoom interaction - hiding overlay");

        // Hide overlay during potential zoom
        this.mapCanvas.hideOverlay();

        if (this.zoomInteractionTimeout) {
            clearTimeout(this.zoomInteractionTimeout);
        }

        this.zoomInteractionTimeout = setTimeout(() => {
            log.detail('state',"Zoom interaction resolved - showing overlay");
            this.zoomInteractionTimeout = null;
            this.isPotentiallyZooming = false;
            this.updatePositionFromUrl();
            this.mapCanvas.showOverlay();
            this.notifyListeners('zoomResolved');
        }, 1000);
    }

    /**
     * Handle URL changes
     */
    handleUrlChanged() {
        this.updatePositionFromUrl();

        if (this.zoomInteractionTimeout !== null) {
            log.detail('state',"URL change during zoom interaction - resolving");
            clearTimeout(this.zoomInteractionTimeout);
            this.zoomInteractionTimeout = null;
            this.isPotentiallyZooming = false;
            this.mapCanvas.showOverlay();
            this.notifyListeners('zoomResolved');
        }
    }

    /**
     * Set up event listeners for map interactions
     */
    setupEventListeners() {
        window.addEventListener('wokemaps_urlChanged', () => this.handleUrlChanged());
        window.addEventListener('wokemaps_potentialZoomInteraction', () => this.handlePotentialZoomInteraction());
        log.detail('init','WebGL MapState2D event listeners initialized');
    }

    /**
     * Get the current combined transform for positioning calculations
     * This combines the URL-based position with the movement offset
     */
    getCombinedTransform() {
        return {
            urlCenter: this.center,
            zoom: this.zoom,
            movementOffset: { ...this.movementOffset },
            hasValidMovement: this.hasValidMovement
        };
    }

    /**
     * Clean up timers and listeners
     */
    cleanup() {
        if (this.zoomInteractionTimeout) {
            clearTimeout(this.zoomInteractionTimeout);
            this.zoomInteractionTimeout = null;
        }

        this.changeListeners.clear();
    }

    /**
     * Check if map state is valid
     */
    isValid() {
        return this.mapCanvas.isValid();
    }

    // Compatibility properties for existing code
    get canvasTransform() {
        // For WebGL mode, we don't use canvas transform
        return { translateX: 0, translateY: 0, scale: 1 };
    }

    get parentTransform() {
        // Movement offset replaces parent transform
        return {
            translateX: this.movementOffset.x,
            translateY: this.movementOffset.y,
            scale: 1
        };
    }

    get parentIsZero() {
        // In WebGL mode, movement offset being zero indicates "baseline"
        return !this.hasValidMovement || (Math.abs(this.movementOffset.x) < 1 && Math.abs(this.movementOffset.y) < 1);
    }
}

// Export for use in other files
if (typeof window !== 'undefined') {
    window.MapStateWebGL = MapStateWebGL;
}
