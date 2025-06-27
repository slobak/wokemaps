// Map State Manager
// Tracks map position, zoom, transforms, and interaction state

class MapState2D {
    constructor(mapCanvas) {
        this.mapCanvas = mapCanvas;

        // Map position and zoom
        this.center = null;
        this.zoom = 0;

        // Transform tracking
        this.canvasTransform = { translateX: 0, translateY: 0, scale: 1 };
        this.parentTransform = { translateX: 0, translateY: 0, scale: 1 };
        this.parentIsZero = true;

        // Interaction state
        this.isPotentiallyZooming = false;
        this.zoomInteractionTimeout = null;

        // Change listeners
        this.changeListeners = new Set();

        // Mutation observer for transform changes
        this.observer = null;
    }

    /**
     * Initialize the map state tracker
     * @returns {boolean} True if initialization succeeded
     */
    initialize() {
        // Get initial state
        this.updateCanvasTransform();
        this.updateParentTransform();
        this.updatePositionFromUrl();

        // Set up observers and event listeners
        this.setupObserver();
        this.setupEventListeners();

        return true;
    }

    /**
     * Add a listener for map state changes
     * @param {Function} callback - Called when state changes
     */
    addChangeListener(callback) {
        this.changeListeners.add(callback);
    }

    /**
     * Remove a change listener
     * @param {Function} callback - Callback to remove
     */
    removeChangeListener(callback) {
        this.changeListeners.delete(callback);
    }

    /**
     * Notify all listeners of state changes
     * @param {string} changeType - Type of change that occurred
     */
    notifyListeners(changeType) {
        for (const listener of this.changeListeners) {
            try {
                listener(changeType, this);
            } catch (e) {
                log.error('state', 'Error in map state change listener:', e);
            }
        }
    }

    // Update canvas transform information
    updateCanvasTransform() {
        const canvasStyle = window.getComputedStyle(this.mapCanvas.canvas);
        const canvasTransformStr = canvasStyle.transform || canvasStyle.webkitTransform;

        if (canvasTransformStr && canvasTransformStr !== 'none') {
            const transformValues = this.parseTransform(canvasTransformStr);
            if (this.isTransformDifferent("canvas", transformValues, this.canvasTransform)) {
                this.canvasTransform = transformValues;
                this.notifyListeners('canvasTransform');
            }
        }
    }

    // Update parent transform information
    updateParentTransform() {
        const parentStyle = window.getComputedStyle(this.mapCanvas.parent);
        const parentTransformStr = parentStyle.transform || parentStyle.webkitTransform;

        let transformValues;
        if (parentTransformStr && parentTransformStr !== 'none') {
            transformValues = this.parseTransform(parentTransformStr);
        } else {
            transformValues = { translateX: 0, translateY: 0, scale: 1 };
        }

        if (this.isTransformDifferent("parent", transformValues, this.parentTransform)) {
            this.parentTransform = transformValues;

            // Check if parent transform went to zero
            const wasZero = this.parentIsZero;
            this.parentIsZero = Math.abs(this.parentTransform.translateX) < 1 && Math.abs(this.parentTransform.translateY) < 1;

            // If parent just went to zero, update position from URL
            if (!wasZero && this.parentIsZero) {
                log.detail('state', "Parent transform went to zero - updating center from URL");
                this.updatePositionFromUrl();
            }

            this.notifyListeners('parentTransform');
        }
    }

    // Check if transform values are different (for logging)
    isTransformDifferent(name, newTransform, oldTransform) {
        const different = newTransform.translateX !== oldTransform.translateX ||
            newTransform.translateY !== oldTransform.translateY ||
            newTransform.scale !== oldTransform.scale;

        if (different) {
            //log.detail('state', `${name} transform changes`, newTransform);
        }

        return different;
    }

    // Parse a transform string into component values
    parseTransform(transformStr) {
        try {
            // Handle matrix format: matrix(a, b, c, d, tx, ty)
            if (transformStr.startsWith('matrix')) {
                const matrixMatch = transformStr.match(/matrix\(([^)]+)\)/);
                if (matrixMatch && matrixMatch[1]) {
                    const values = matrixMatch[1].split(',').map(v => parseFloat(v.trim()));
                    if (values.length === 6) {
                        const translateX = values[4];
                        const translateY = values[5];
                        const scale = Math.sqrt(values[0] * values[0] + values[1] * values[1]);

                        return { translateX, translateY, scale };
                    }
                }
            }

            // Handle translate and scale separately
            let translateX = 0;
            let translateY = 0;
            let scale = 1;

            // Extract translate values
            const translateMatch = transformStr.match(/translate\(([^)]+)\)/);
            if (translateMatch && translateMatch[1]) {
                const values = translateMatch[1].split(',').map(v => parseFloat(v.trim()));
                if (values.length >= 1) translateX = values[0];
                if (values.length >= 2) translateY = values[1];
            }

            // Extract translateX/Y values
            const translateXMatch = transformStr.match(/translateX\(([^)]+)\)/);
            if (translateXMatch && translateXMatch[1]) {
                translateX = parseFloat(translateXMatch[1]);
            }

            const translateYMatch = transformStr.match(/translateY\(([^)]+)\)/);
            if (translateYMatch && translateYMatch[1]) {
                translateY = parseFloat(translateYMatch[1]);
            }

            // Extract scale value
            const scaleMatch = transformStr.match(/scale\(([^)]+)\)/);
            if (scaleMatch && scaleMatch[1]) {
                scale = parseFloat(scaleMatch[1]);
            }

            return { translateX, translateY, scale };
        } catch (e) {
            log.error('state', "Error parsing transform:", e);
            return { translateX: 0, translateY: 0, scale: 1 };
        }
    }

    // Update position information from URL
    updatePositionFromUrl() {
        // Only proceed if parent transform is zero or near zero
        if (!this.parentIsZero) {
            return;
        }

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
                const newZoom = Math.round(zoom);
                if (this.zoom !== newZoom) {
                    this.zoom = newZoom;
                    hasChanges = true;
                }
            }
        }

        if (hasChanges) {
            this.notifyListeners('position');
        }
    }

    // Handle map interactions that might result in a zoom
    handlePotentialZoomInteraction() {
        this.isPotentiallyZooming = true;
        log.detail('state', "potential zoom interaction, suspending redraw");

        if (this.zoomInteractionTimeout) {
            clearTimeout(this.zoomInteractionTimeout);
        }

        this.zoomInteractionTimeout = setTimeout(() => {
            log.detail('state', "zoom interaction timeout, redrawing");
            this.zoomInteractionTimeout = null;
            this.isPotentiallyZooming = false;
            this.updatePositionFromUrl();
            this.updateCanvasTransform();
            this.updateParentTransform();
            this.notifyListeners('zoomResolved');
        }, 1000);
    }

    // Handle URL changes
    handleUrlChanged() {
        if (this.parentIsZero) {
            log.detail('state', "onMapsUrlChanged: Parent transform is zero - updating center from URL");
            this.updatePositionFromUrl();
            if (this.zoomInteractionTimeout !== null) {
                log.detail('state', "zoom resolved, redrawing");
                clearTimeout(this.zoomInteractionTimeout);
                this.zoomInteractionTimeout = null;
                this.isPotentiallyZooming = false;
                this.updateCanvasTransform();
                this.updateParentTransform();
                this.notifyListeners('zoomResolved');
            }
        }
    }

    // Set up MutationObserver to watch for transform changes
    setupObserver() {
        this.observer = new MutationObserver((mutations) => {
            let shouldUpdateCanvasTransform = false;
            let shouldUpdateParentTransform = false;

            for (const mutation of mutations) {
                if (mutation.type === 'attributes' && mutation.attributeName === 'style') {
                    if (mutation.target === this.mapCanvas.canvas) {
                        shouldUpdateCanvasTransform = true;
                    } else if (mutation.target === this.mapCanvas.parent) {
                        shouldUpdateParentTransform = true;
                    }
                }
            }

            if (shouldUpdateCanvasTransform) {
                this.updateCanvasTransform();
            }

            if (shouldUpdateParentTransform) {
                this.updateParentTransform();
            }
        });

        // Observe the canvas for attribute changes
        this.observer.observe(this.mapCanvas.canvas, {
            attributes: true,
            attributeFilter: ['style', 'width', 'height']
        });

        // Observe the canvas parent for transform changes
        if (this.mapCanvas.parent) {
            this.observer.observe(this.mapCanvas.parent, {
                attributes: true,
                attributeFilter: ['style', 'class']
            });
        }

        log.detail('init', "MapState2D MutationObserver set up");
    }

    // Set up event listeners for map interactions
    setupEventListeners() {
        window.addEventListener('wokemaps_urlChanged', () => this.handleUrlChanged());
        window.addEventListener('wokemaps_potentialZoomInteraction', () => this.handlePotentialZoomInteraction());
        log.detail('init', 'MapState2D event listeners initialized');
    }

    // Clean up observers and listeners
    cleanup() {
        if (this.observer) {
            this.observer.disconnect();
            this.observer = null;
        }

        if (this.zoomInteractionTimeout) {
            clearTimeout(this.zoomInteractionTimeout);
            this.zoomInteractionTimeout = null;
        }

        this.changeListeners.clear();
    }

    // Check if map state is valid
    isValid() {
        return this.mapCanvas.isValid();
    }
}

// Export for use in other files
if (typeof window !== 'undefined') {
    window.MapState2D = MapState2D;
}
