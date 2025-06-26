// Map Canvas Manager - WebGL Implementation
// Handles finding the WebGL canvas and creating/managing an overlay 2D canvas

class MapCanvasWebGL {
    constructor(canvasId) {
        this.webglCanvas = null;
        this.overlayCanvas = null;
        this.overlayContext = null;
        this.parent = null;
        this.contextType = 'webgl';
        this.canvasId = canvasId;
        this.tileSize = 512; // WebGL typically uses 512px tiles
        this.transformMultiplier = 1;  // don't scale translations
        this.resizeObserver = null;

        this.detectDisplayType();
    }

    /**
     * Try to initialize using the canvas detected by the page script
     */
    tryInitializeWithDetectedCanvas() {
        if (!this.canvasId) {
            return false;
        }

        // Find the WebGL canvas by our ID attribute
        const canvas = document.querySelector(`[data-wokemaps-canvas-id="${this.canvasId}"]`);
        if (!canvas) {
            console.warn('wokemaps: Could not find detected WebGL canvas in DOM');
            return false;
        }

        // Verify it's still the map canvas
        const mapCanvasAttr = canvas.getAttribute('data-wokemaps-map-canvas');
        if (mapCanvasAttr !== this.contextType) {
            console.warn('wokemaps: Canvas context type mismatch');
            return false;
        }

        this.webglCanvas = canvas;
        this.parent = this.webglCanvas.parentElement;

        // Create overlay canvas
        if (!this.createOverlayCanvas()) {
            console.error('wokemaps: Failed to create overlay canvas');
            return false;
        }

        console.log(`wokemaps: WebGL mode initialized: ${this.webglCanvas.width}x${this.webglCanvas.height}`);
        return true;
    }

    /**
     * Create the overlay 2D canvas that will contain our labels
     */
    createOverlayCanvas() {
        if (!this.webglCanvas || !this.parent) {
            console.error('wokemaps: Cannot create overlay canvas - no WebGL canvas or parent');
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

        // Get 2D context
        this.overlayContext = this.overlayCanvas.getContext('2d', { willReadFrequently: true });
        if (!this.overlayContext) {
            console.error('wokemaps: Failed to get 2D context for overlay canvas');
            return false;
        }

        // Insert overlay canvas as sibling
        this.parent.appendChild(this.overlayCanvas);

        // Initial size sync
        this.syncOverlaySize();

        // Setup size monitoring
        this.setupSizeMonitoring();

        console.log('wokemaps: Overlay canvas created and positioned');
        return true;
    }

    /**
     * Sync overlay canvas size with WebGL canvas
     */
    syncOverlaySize() {
        if (!this.webglCanvas || !this.overlayCanvas) return;

        const webglRect = this.webglCanvas.getBoundingClientRect();
        const webglComputedStyle = window.getComputedStyle(this.webglCanvas);

        // Set canvas dimensions to match display size
        this.overlayCanvas.width = Math.round(webglRect.width * window.devicePixelRatio);
        this.overlayCanvas.height = Math.round(webglRect.height * window.devicePixelRatio);

        // Set CSS size to match WebGL canvas
        this.overlayCanvas.style.width = webglComputedStyle.width;
        this.overlayCanvas.style.height = webglComputedStyle.height;

        // Scale context for device pixel ratio
        const scale = window.devicePixelRatio;
        this.overlayContext.scale(scale, scale);

        console.log(`wokemaps: Overlay canvas resized to ${this.overlayCanvas.width}x${this.overlayCanvas.height} (display: ${webglRect.width}x${webglRect.height})`);
    }

    /**
     * Setup monitoring for size changes
     */
    setupSizeMonitoring() {
        if (!this.webglCanvas) return;

        // Use ResizeObserver to monitor WebGL canvas size changes
        this.resizeObserver = new ResizeObserver(() => {
            this.syncOverlaySize();
        });

        this.resizeObserver.observe(this.webglCanvas);

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

        observer.observe(this.webglCanvas, {
            attributes: true,
            attributeFilter: ['style', 'width', 'height']
        });

        console.log('wokemaps: Size monitoring setup for overlay canvas');
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
     * Apply movement transform to overlay canvas
     */
    applyMovementTransform(movementX, movementY) {
        if (!this.overlayCanvas) return;

        //xcxc do in-page and may reduce lag

        // Apply CSS transform to move overlay with tile movement.
        // Translation we want is negated in Y direction just because of how GL
        // coordinates work (+ is NE) vs. 2D canvas (+ is SE).
        // Un-scale.
        const transform = `translate(${movementX / 2.0}px, ${-movementY / 2.0}px)`;
        this.overlayCanvas.style.transform = transform;
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

    // Detect display type (retina vs standard) and set parameters
    detectDisplayType() {
        const devicePixelRatio = window.devicePixelRatio || 1;

        if (devicePixelRatio > 1.5) {
            this.tileSize = 512;
            console.log(`wokemaps: Detected retina display (pixel ratio: ${devicePixelRatio})`);
        } else {
            this.tileSize = 512; // WebGL typically uses 512 even on standard displays
            console.log(`wokemaps: Detected standard display (pixel ratio: ${devicePixelRatio})`);
        }
    }

    // Get parent div dimensions properly
    getParentDimensions() {
        if (!this.parent) {
            console.error("wokemaps: No WebGL canvas parent found");
            return { width: 0, height: 0 };
        }

        const rect = this.parent.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) {
            return { width: Math.round(rect.width), height: Math.round(rect.height) };
        }

        console.error("wokemaps: Could not determine parent dimensions");
        return { width: 0, height: 0 };
    }

    // Check if the canvas is still valid and supported
    isValid() {
        return this.webglCanvas &&
            document.body.contains(this.webglCanvas) &&
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

    // Get context info
    getContextInfo() {
        return {
            type: this.contextType,
            supported: true,
            canvasId: this.canvasId,
            mode: 'webgl'
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
}

// Export for use in other files
if (typeof window !== 'undefined') {
    window.MapCanvasWebGL = MapCanvasWebGL;
}
