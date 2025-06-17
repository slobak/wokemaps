// Map Canvas Manager
// Handles finding and managing the Google Maps rendering canvas

class MapCanvas {
    constructor() {
        this.canvas = null;
        this.context = null;
        this.parent = null;
        this.tileSize = 256;
        this.transformMultiplier = 1;

        this.detectDisplayType();
    }

    /**
     * Attempts to find and initialize the Google Maps canvas.
     * @returns {boolean} True if canvas was found and initialized successfully, false otherwise
     */
    tryInitialize() {
        const mapRenderingCanvas = this.findMapRenderingCanvas();
        if (!mapRenderingCanvas) {
            return false;
        }

        this.canvas = mapRenderingCanvas;
        this.context = this.canvas.getContext('2d', { willReadFrequently: true });
        this.parent = this.canvas.parentElement;

        console.log(`Using canvas: ${this.canvas.width}x${this.canvas.height}`);
        console.log(`Display type: Tile size ${this.tileSize}px, Transform multiplier ${this.transformMultiplier}x`);

        return true;
    }

    // Detect display type (retina vs standard) and set parameters
    detectDisplayType() {
        const devicePixelRatio = window.devicePixelRatio || 1;

        if (devicePixelRatio > 1.5) {
            this.tileSize = 512;
            this.transformMultiplier = 2;
            console.log(`Detected retina display (pixel ratio: ${devicePixelRatio})`);
        } else {
            this.tileSize = 256;
            this.transformMultiplier = 1;
            console.log(`Detected standard display (pixel ratio: ${devicePixelRatio})`);
        }
    }

    // Find the map rendering canvas that's tile-based
    findMapRenderingCanvas() {
        const canvases = document.querySelectorAll('canvas');
        let mapRenderingCanvas = null;
        let maxArea = 0;

        console.log(`Found ${canvases.length} canvas elements`);

        for (let canvas of canvases) {
            const width = canvas.width;
            const height = canvas.height;
            const area = width * height;

            console.log(`Canvas: ${width}x${height}, area: ${area}, tile-based: ${width % 256 === 0 && height % 256 === 0}`);

            // ONLY accept canvases where both dimensions are multiples of 256 (tile-based rendering)
            // and it's large enough to be the main map
            if (width > 0 && height > 0 &&
                width % 256 === 0 && height % 256 === 0 &&
                area > maxArea && area > 100000) { // Minimum size check
                try {
                    const ctx = canvas.getContext('2d');
                    if (ctx) {
                        mapRenderingCanvas = canvas;
                        maxArea = area;
                        console.log(`Selected tile-based canvas: ${width}x${height}`);
                    }
                } catch (e) {
                    console.log("Error accessing canvas:", e);
                }
            }
        }
        return mapRenderingCanvas;
    }

    // Get parent div dimensions properly
    getParentDimensions() {
        if (!this.parent) {
            console.error("No canvas parent found");
            return { width: 0, height: 0 };
        }

        // Method 1: Try getBoundingClientRect first
        const rect = this.parent.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) {
            console.log(`Parent dimensions from getBoundingClientRect: ${rect.width}×${rect.height}`);
            return { width: Math.round(rect.width), height: Math.round(rect.height) };
        }

        // Method 2: Try offsetWidth/Height
        if (this.parent.offsetWidth > 0 && this.parent.offsetHeight > 0) {
            console.log(`Parent dimensions from offset: ${this.parent.offsetWidth}×${this.parent.offsetHeight}`);
            return { width: this.parent.offsetWidth, height: this.parent.offsetHeight };
        }

        // Method 3: Try clientWidth/Height
        if (this.parent.clientWidth > 0 && this.parent.clientHeight > 0) {
            console.log(`Parent dimensions from client: ${this.parent.clientWidth}×${this.parent.clientHeight}`);
            return { width: this.parent.clientWidth, height: this.parent.clientHeight };
        }

        // Method 4: Get computed style
        const computedStyle = window.getComputedStyle(this.parent);
        const width = parseInt(computedStyle.width, 10);
        const height = parseInt(computedStyle.height, 10);

        if (!isNaN(width) && !isNaN(height) && width > 0 && height > 0) {
            console.log(`Parent dimensions from computed style: ${width}×${height}`);
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

        console.error("Could not determine parent dimensions");
        return { width: 0, height: 0 };
    }

    // Check if the canvas is still valid (hasn't been removed from DOM)
    isValid() {
        return this.canvas && document.body.contains(this.canvas);
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

    // Initialize and find the canvas
    initialize() {
        const mapRenderingCanvas = this.findMapRenderingCanvas();
        if (!mapRenderingCanvas) {
            return false;
        }

        this.canvas = mapRenderingCanvas;
        this.context = this.canvas.getContext('2d', { willReadFrequently: true });
        this.parent = this.canvas.parentElement;

        console.log(`Using canvas: ${this.canvas.width}x${this.canvas.height}`);
        console.log(`Display type: Tile size ${this.tileSize}px, Transform multiplier ${this.transformMultiplier}x`);

        return true;
    }
}

// Export for use in other files
if (typeof window !== 'undefined') {
    window.MapCanvas = MapCanvas;
}
