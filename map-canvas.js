// Map Canvas Manager - Updated with Context Type Detection
// Handles finding and managing the Google Maps rendering canvas

class MapCanvas {
    constructor() {
        this.canvas = null;
        this.context = null;
        this.parent = null;
        this.contextType = null;
        this.canvasId = null;
        this.tileSize = 256;
        this.transformMultiplier = 1;
        this.isSupported = false;

        this.detectDisplayType();
        this.setupCanvasDetection();
    }

    /**
     * Setup canvas detection by listening for messages from page script
     */
    setupCanvasDetection() {
        window.addEventListener('message', (event) => {
            if (event.origin !== window.location.origin) return;

            if (event.data.type === 'WOKEMAPS_MAP_CANVAS_DETECTED') {
                this.handleCanvasDetected(event.data);
            }
        });
    }

    /**
     * Handle canvas detection message from page script
     */
    handleCanvasDetected(data) {
        console.log('wokemaps: Canvas detected:', data);

        this.canvasId = data.canvasId;
        this.contextType = data.contextType;
        this.isSupported = data.supported;

        if (!this.isSupported) {
            if (data.contextType === 'webgl' || data.contextType === 'webgl2') {
                console.error('wokemaps: WebGL mode detected but not yet supported. Labels will not be displayed.');
                console.error('wokemaps: The extension currently only supports 2D canvas rendering mode.');
            } else {
                console.error('wokemaps: Unsupported canvas context type:', data.contextType);
            }
            return;
        }

        // Try to initialize with the detected canvas
        this.tryInitializeWithDetectedCanvas();
    }

    /**
     * Try to initialize using the canvas detected by the page script
     */
    tryInitializeWithDetectedCanvas() {
        if (!this.canvasId || !this.isSupported) {
            return false;
        }

        // Find the canvas by our ID attribute
        const canvas = document.querySelector(`[data-wokemaps-canvas-id="${this.canvasId}"]`);
        if (!canvas) {
            console.warn('wokemaps: Could not find detected canvas in DOM');
            return false;
        }

        // Verify it's still the map canvas
        const mapCanvasAttr = canvas.getAttribute('data-wokemaps-map-canvas');
        if (mapCanvasAttr !== this.contextType) {
            console.warn('wokemaps: Canvas context type mismatch');
            return false;
        }

        this.canvas = canvas;
        this.context = this.canvas.getContext('2d', { willReadFrequently: true });
        this.parent = this.canvas.parentElement;

        if (!this.context) {
            console.error('wokemaps: Could not get 2D context from detected canvas');
            return false;
        }

        console.log(`wokemaps: Successfully initialized with detected ${this.contextType} canvas: ${this.canvas.width}x${this.canvas.height}`);
        return true;
    }

    /**
     * Attempts to find and initialize the Google Maps canvas.
     * @returns {boolean} True if canvas was found and initialized successfully, false otherwise
     */
    tryInitialize() {
        // First try to use detected canvas if available
        if (this.tryInitializeWithDetectedCanvas()) {
            return true;
        }

        // If no supported canvas detected yet, fall back to old method
        if (!this.isSupported) {
            console.log('wokemaps: No supported canvas detected yet, trying fallback method...');
            const mapRenderingCanvas = this.findMapRenderingCanvasFallback();
            if (mapRenderingCanvas) {
                this.canvas = mapRenderingCanvas;
                this.context = this.canvas.getContext('2d', { willReadFrequently: true });
                this.parent = this.canvas.parentElement;
                this.contextType = '2d';
                this.isSupported = true;

                console.log(`wokemaps: Fallback initialization successful: ${this.canvas.width}x${this.canvas.height}`);
                return true;
            }
        }

        return false;
    }

    // Detect display type (retina vs standard) and set parameters
    detectDisplayType() {
        const devicePixelRatio = window.devicePixelRatio || 1;

        if (devicePixelRatio > 1.5) {
            this.tileSize = 512;
            this.transformMultiplier = 2;
            console.log(`wokemaps: Detected retina display (pixel ratio: ${devicePixelRatio})`);
        } else {
            this.tileSize = 256;
            this.transformMultiplier = 1;
            console.log(`wokemaps: Detected standard display (pixel ratio: ${devicePixelRatio})`);
        }
    }

    // Fallback method - find the map rendering canvas using old approach
    findMapRenderingCanvasFallback() {
        const canvases = document.querySelectorAll('canvas');
        let mapRenderingCanvas = null;
        let maxArea = 0;

        console.log(`wokemaps: Fallback search found ${canvases.length} canvas elements`);

        for (let canvas of canvases) {
            const width = canvas.width;
            const height = canvas.height;
            const area = width * height;

            // Only accept 2D canvases where both dimensions are multiples of 256 (tile-based rendering)
            if (width > 0 && height > 0 &&
                width % 256 === 0 && height % 256 === 0 &&
                area > maxArea && area > 100000) { // Minimum size check
                try {
                    const ctx = canvas.getContext('2d');
                    if (ctx) {
                        mapRenderingCanvas = canvas;
                        maxArea = area;
                        console.log(`wokemaps: Fallback selected tile-based canvas: ${width}x${height}`);
                    }
                } catch (e) {
                    console.log("wokemaps: Error accessing canvas:", e);
                }
            }
        }
        return mapRenderingCanvas;
    }

    // Get parent div dimensions properly
    getParentDimensions() {
        if (!this.parent) {
            console.error("wokemaps: No canvas parent found");
            return { width: 0, height: 0 };
        }

        // Method 1: Try getBoundingClientRect first
        const rect = this.parent.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) {
            return { width: Math.round(rect.width), height: Math.round(rect.height) };
        }

        // Method 2: Try offsetWidth/Height
        if (this.parent.offsetWidth > 0 && this.parent.offsetHeight > 0) {
            return { width: this.parent.offsetWidth, height: this.parent.offsetHeight };
        }

        // Method 3: Try clientWidth/Height
        if (this.parent.clientWidth > 0 && this.parent.clientHeight > 0) {
            return { width: this.parent.clientWidth, height: this.parent.clientHeight };
        }

        // Method 4: Get computed style
        const computedStyle = window.getComputedStyle(this.parent);
        const width = parseInt(computedStyle.width, 10);
        const height = parseInt(computedStyle.height, 10);

        if (!isNaN(width) && !isNaN(height) && width > 0 && height > 0) {
            return { width, height };
        }

        // If all else fails, check the grandparent
        const grandParent = this.parent.parentElement;
        if (grandParent) {
            const grandRect = grandParent.getBoundingClientRect();
            if (grandRect.width > 0 && grandRect.height > 0) {
                return { width: Math.round(grandRect.width), height: Math.round(grandRect.height) };
            }
        }

        console.error("wokemaps: Could not determine parent dimensions");
        return { width: 0, height: 0 };
    }

    // Check if the canvas is still valid and supported
    isValid() {
        return this.canvas &&
            document.body.contains(this.canvas) &&
            this.isSupported &&
            this.contextType === '2d';
    }

    // Get canvas dimensions
    getDimensions() {
        if (!this.canvas) return { width: 0, height: 0 };
        return { width: this.canvas.width, height: this.canvas.height };
    }

    // Get canvas center point
    getCenter() {
        const dimensions = this.getDimensions();
        return {
            x: dimensions.width / 2,
            y: dimensions.height / 2
        };
    }

    // Get context type info
    getContextInfo() {
        return {
            type: this.contextType,
            supported: this.isSupported,
            canvasId: this.canvasId
        };
    }
}

// Export for use in other files
if (typeof window !== 'undefined') {
    window.MapCanvas = MapCanvas;
}
