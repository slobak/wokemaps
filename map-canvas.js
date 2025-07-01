// Map Canvas Manager - WebGL Implementation
// Handles finding the WebGL canvas and creating/managing an overlay 2D canvas

class MapCanvas {
    constructor(canvasId, canvasType) {
        this.mapCanvas = null;
        this.overlayCanvas = null;
        this.overlayContext = null;
        this.parent = null;
        this.canvasType = canvasType;
        this.canvasId = canvasId;
        this.tileSize = canvasType === '2d' ? 256 : 512;
        this.resizeObserver = null;
        this.changeListeners = new Set();

        if (window.devicePixelRatio > 1.5) {
            log.info('init',`Detected retina display (pixel ratio: ${devicePixelRatio})`);
        } else {
            log.info('init', `Detected standard display (pixel ratio: ${devicePixelRatio})`);
        }
    }

    /**
     * Try to initialize using the canvas detected by the page script
     */
    tryInitializeWithDetectedCanvas() {
        if (!this.canvasId) {
            return false;
        }

        // Find the canvas by our ID attribute
        const canvas = document.querySelector(`[data-wokemaps-canvas-id="${this.canvasId}"]`);
        if (!canvas) {
            log.warn('init','Could not find detected canvas in DOM');
            return false;
        }

        // Verify it's still the map canvas
        const mapCanvasAttr = canvas.getAttribute('data-wokemaps-map-canvas');
        if (mapCanvasAttr !== this.canvasType) {
            log.warn('init','Canvas context type mismatch');
            return false;
        }

        this.mapCanvas = canvas;
        this.parent = this.mapCanvas.parentElement;

        // Create overlay canvas
        if (!this.createOverlayCanvas()) {
            log.error('init','Failed to create overlay canvas');
            return false;
        }

        log.info('init', `Canvas initialized: ${this.mapCanvas.width}x${this.mapCanvas.height}`);
        return true;
    }

    /**
     * Add a listener for canvas changes
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

    /**
     * Create the overlay 2D canvas that will contain our labels
     */
    createOverlayCanvas() {
        if (!this.mapCanvas || !this.parent) {
            log.error('init', 'Cannot create overlay canvas - no map canvas or parent');
            return false;
        }

        // Create the overlay canvas
        this.overlayCanvas = document.createElement('canvas');
        this.overlayCanvas.style.cssText = `
            position: absolute;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            pointer-events: none;
            z-index: 1000;
        `;
        this.overlayCanvas.setAttribute('data-wokemaps-overlay', 'true');
        this.overlayCanvas.id = 'wokemaps_overlay_canvas_' + randomElementId();

        // Get 2D context
        this.overlayContext = this.overlayCanvas.getContext('2d');
        if (!this.overlayContext) {
            log.error('init', 'Failed to get 2D context for overlay canvas');
            return false;
        }

        // Insert overlay canvas as sibling
        this.parent.insertBefore(this.overlayCanvas, this.mapCanvas);

        // Initial size sync
        this.syncOverlaySize();

        // Setup size monitoring
        this.setupSizeMonitoring();

        // Register with the in-page script
        window.postMessage({
            type: 'WOKEMAPS_REGISTER_WEBGL_OVERLAY_CANVAS',
            canvasId: this.overlayCanvas.id
        }, '*');

        log.debug('init','Overlay canvas created and positioned');
        return true;
    }

    /**
     * Sync overlay canvas size with WebGL canvas
     */
    syncOverlaySize() {
        if (!this.mapCanvas || !this.overlayCanvas) return;

        // TODO: 2d canvas style changes happen all the time / on tile loads - maybe compare to known
        // values and don't resize unless needed?

        const canvasRect = this.mapCanvas.getBoundingClientRect();
        const canvasComputedStyle = window.getComputedStyle(this.mapCanvas);

        // Set canvas dimensions to match display size
        this.overlayCanvas.width = Math.round(canvasRect.width * window.devicePixelRatio);
        this.overlayCanvas.height = Math.round(canvasRect.height * window.devicePixelRatio);

        // Set CSS size to match WebGL canvas
        this.overlayCanvas.style.width = canvasComputedStyle.width;
        this.overlayCanvas.style.height = canvasComputedStyle.height;

        // Scale context for device pixel ratio
        const scale = window.devicePixelRatio;
        this.overlayContext.scale(scale, scale);

        log.debug('state',`Overlay canvas resized to ${this.overlayCanvas.width}x${this.overlayCanvas.height} (display: ${canvasRect.width}x${canvasRect.height})`);
        this.notifyListeners('canvasResize');
    }

    setOverlayTranslate(x, y) {
        if (!this.overlayCanvas) return;
        this.overlayCanvas.style.transform = `translate(${x}px, ${y}px)`;
    }

    /**
     * Setup monitoring for size changes
     */
    setupSizeMonitoring() {
        if (!this.mapCanvas) return;

        // Use ResizeObserver to monitor WebGL canvas size changes
        this.resizeObserver = new ResizeObserver(() => {
            this.syncOverlaySize();
        });

        this.resizeObserver.observe(this.mapCanvas);

        // Also monitor style attribute changes
        const observer = new MutationObserver((mutations) => {
            for (const mutation of mutations) {
                if (mutation.type === 'attributes' &&
                    (mutation.attributeName === 'style' ||
                        mutation.attributeName === 'width' ||
                        mutation.attributeName === 'height')) {
                    this.syncOverlaySize();
                    break;
                }
            }
        });

        observer.observe(this.mapCanvas, {
            attributes: true,
            attributeFilter: ['style', 'width', 'height']
        });

        log.debug('init','Size monitoring setup for overlay canvas');
    }

    /**
     * Show the overlay canvas
     */
    showOverlay() {
        if (this.overlayCanvas) {
            this.overlayCanvas.style.visibility = 'visible';
        }
    }

    /**
     * Hide the overlay canvas (during zoom/pan interactions)
     */
    hideOverlay() {
        if (this.overlayCanvas) {
            this.overlayCanvas.style.visibility = 'hidden';
        }
    }

    /**
     * Clear any movement transforms
     */
    clearMovementTransform() {
        if (this.overlayCanvas) {
            this.overlayCanvas.style.transform = '';
        }
    }

    /**
     * Attempts to find and initialize the WebGL canvas
     */
    tryInitialize() {
        return this.tryInitializeWithDetectedCanvas();
    }

    // Check if the canvas is still valid and supported
    isValid() {
        return this.mapCanvas &&
            document.body.contains(this.mapCanvas) &&
            this.overlayCanvas &&
            document.body.contains(this.overlayCanvas);
    }

    // Get overlay canvas dimensions
    getDimensions() {
        if (!this.overlayCanvas) return { width: 0, height: 0 };
        return { width: this.overlayCanvas.width, height: this.overlayCanvas.height };
    }

    // Get overlay canvas center point
    getCenter() {
        if (!this.overlayCanvas) return { x: 0, y: 0 };

        const rect = this.overlayCanvas.getBoundingClientRect();
        return {
            x: rect.width / 2,
            y: rect.height / 2
        };
    }

    // Get the overlay context (this is what other components will draw to)
    get context() {
        return this.overlayContext;
    }

    // Get the actual canvas element (overlay for drawing)
    get canvas() {
        return this.overlayCanvas;
    }

    // Get parent div dimensions properly
    getParentDimensions() {
        if (!this.parent) {
            log.warn('state', "No canvas parent found");
            return { width: 0, height: 0 };
        }

        // Method 1: Try getBoundingClientRect first
        const rect = this.parent.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) {
            log.detail('state', `Parent dimensions from getBoundingClientRect: ${rect.width}×${rect.height}`);
            return { width: Math.round(rect.width), height: Math.round(rect.height) };
        }

        // Method 2: Try offsetWidth/Height
        if (this.parent.offsetWidth > 0 && this.parent.offsetHeight > 0) {
            log.detail('state', `Parent dimensions from offset: ${this.parent.offsetWidth}×${this.parent.offsetHeight}`);
            return { width: this.parent.offsetWidth, height: this.parent.offsetHeight };
        }

        // Method 3: Try clientWidth/Height
        if (this.parent.clientWidth > 0 && this.parent.clientHeight > 0) {
            log.detail('state', `Parent dimensions from client: ${this.parent.clientWidth}×${this.parent.clientHeight}`);
            return { width: this.parent.clientWidth, height: this.parent.clientHeight };
        }

        // Method 4: Get computed style
        const computedStyle = window.getComputedStyle(this.parent);
        const width = parseInt(computedStyle.width, 10);
        const height = parseInt(computedStyle.height, 10);

        if (!isNaN(width) && !isNaN(height) && width > 0 && height > 0) {
            log.detail('state', `Parent dimensions from computed style: ${width}×${height}`);
            return { width, height };
        }

        // If all else fails, check the grandparent (sometimes the map container is nested)
        const grandParent = this.parent.parentElement;
        if (grandParent) {
            const grandRect = grandParent.getBoundingClientRect();
            if (grandRect.width > 0 && grandRect.height > 0) {
                return { width: Math.round(grandRect.width), height: Math.round(grandRect.height) };
            }
        }

        log.warn('state', "Could not determine parent dimensions");
        return { width: 0, height: 0 };
    }

    // Cleanup
    cleanup() {
        if (this.resizeObserver) {
            this.resizeObserver.disconnect();
            this.resizeObserver = null;
        }

        if (this.overlayCanvas && this.overlayCanvas.parentNode) {
            this.overlayCanvas.parentNode.removeChild(this.overlayCanvas);
        }
    }

    /**
     * Applies a 2D Context transform to convert canvas coordinates
     * @param {number} x - X coordinate
     * @param {number} y - Y coordinate
     * @param {Object} transform - Transform matrix {a, b, c, d, e, f}
     * @returns {Object} Transformed coordinates {x, y}
     */
    static applyContextTransform(x, y, transform) {
        const { a, b, c, d, e, f } = transform;
        return {
            x: a * x + c * y + e,
            y: b * x + d * y + f
        };
    }
}

// Export for use in other files
if (typeof window !== 'undefined') {
    window.MapCanvas = MapCanvas;
}
