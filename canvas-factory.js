// Canvas Factory
// Creates appropriate canvas, state, and overlay engine instances based on detected mode

class CanvasFactory {
    constructor() {
        this.detectedMode = null;
        this.canvasId = null;
        this.modeDetectionPromise = null;
    }

    /**
     * Detect the canvas mode by waiting for detection messages
     * @returns {Promise<string>} The detected mode ('2d' or 'webgl')
     */
    async detectMode() {
        if (this.modeDetectionPromise) {
            return this.modeDetectionPromise;
        }

        this.modeDetectionPromise = new Promise((resolve) => {
            // Set up message listener first
            const handleMessage = (event) => {
                if (event.origin !== window.location.origin) return;

                if (event.data.type === 'WOKEMAPS_MAP_CANVAS_DETECTED') {
                    clearTimeout(timeout);
                    window.removeEventListener('message', handleMessage);

                    const contextType = event.data.contextType;
                    this.canvasId = event.data.canvasId;
                    if (contextType === 'webgl' || contextType === 'webgl2') {
                        this.detectedMode = 'webgl';
                        console.log(`wokemaps: Detected WebGL mode (${contextType})`);
                        resolve('webgl');
                    } else if (contextType === '2d') {
                        this.detectedMode = '2d';
                        console.log('wokemaps: Detected 2D mode');
                        resolve('2d');
                    } else {
                        console.warn(`wokemaps: Unknown context type: ${contextType}, defaulting to 2D`);
                        this.detectedMode = '2d';
                        resolve('2d');
                    }
                }
            };

            window.addEventListener('message', handleMessage);

            // Request canvas info from page script (in case it's already detected)
            console.log('wokemaps: Requesting canvas detection from page script');
            window.postMessage({
                type: 'WOKEMAPS_REQUEST_CANVAS_INFO'
            }, '*');

            // Set timeout after setting up listener and making request
            const timeout = setTimeout(() => {
                window.removeEventListener('message', handleMessage);
                console.log('wokemaps: Mode detection timeout, defaulting to 2D');
                this.detectedMode = '2d';
                resolve('2d');
            }, 5000);
        });

        return this.modeDetectionPromise;
    }

    /**
     * Create the appropriate MapCanvas instance
     * @returns {Promise<MapCanvas|MapCanvasWebGL>}
     */
    async createMapCanvas() {
        const mode = await this.detectMode();

        if (mode === 'webgl') {
            return new MapCanvasWebGL(this.canvasId);
        } else {
            return new MapCanvas(this.canvasId);
        }
    }

    /**
     * Create the appropriate MapState instance
     * @param {MapCanvas|MapCanvasWebGL} mapCanvas
     * @returns {MapState|MapStateWebGL}
     */
    createMapState(mapCanvas) {
        console.log(`wokemaps: Creating MapState for mode: ${this.detectedMode}`);

        if (this.detectedMode === 'webgl') {
            console.log('wokemaps: Instantiating MapStateWebGL');
            return new MapStateWebGL(mapCanvas);
        } else {
            console.log('wokemaps: Instantiating MapState (2D)');
            return new MapState(mapCanvas);
        }
    }

    /**
     * Create the appropriate OverlayEngine instance
     * @param {MapCanvas|MapCanvasWebGL} mapCanvas
     * @param {MapState|MapStateWebGL} mapState
     * @param {LabelRenderer} labelRenderer
     * @param {Object} options
     * @param {Array} allLabels
     * @returns {OverlayEngine|OverlayEngineWebGL}
     */
    createOverlayEngine(mapCanvas, mapState, labelRenderer, options, allLabels) {
        if (this.detectedMode === 'webgl') {
            return new OverlayEngineWebGL(mapCanvas, mapState, labelRenderer, options, allLabels);
        } else {
            return new OverlayEngine(mapCanvas, mapState, labelRenderer, options, allLabels);
        }
    }

    /**
     * Get the detected mode (null if not yet detected)
     * @returns {string|null}
     */
    getDetectedMode() {
        return this.detectedMode;
    }

    /**
     * Create a complete set of components for the detected mode
     * @param {LabelRenderer} labelRenderer
     * @param {Object} options
     * @param {Array} allLabels
     * @returns {Promise<Object>} Object containing mapCanvas, mapState, and overlayEngine
     */
    async createComponents(labelRenderer, options, allLabels) {
        const mapCanvas = await this.createMapCanvas();
        const mapState = this.createMapState(mapCanvas);
        const overlayEngine = this.createOverlayEngine(mapCanvas, mapState, labelRenderer, options, allLabels);

        return {
            mapCanvas,
            mapState,
            overlayEngine,
            mode: this.detectedMode
        };
    }
}

// Export for use in other files
if (typeof window !== 'undefined') {
    window.CanvasFactory = CanvasFactory;
}
