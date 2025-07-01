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
                    window.removeEventListener('message', handleMessage);

                    log.debug('init', `Received canvas info`, event.data);

                    const contextType = event.data.contextType;
                    this.canvasId = event.data.canvasId;
                    if (contextType === 'webgl' || contextType === 'webgl2') {
                        this.detectedMode = 'webgl';
                        log.info('init', `Detected WebGL mode (${contextType})`);
                        resolve('webgl');
                    } else if (contextType === '2d') {
                        this.detectedMode = '2d';
                        log.info('init', `Detected 2D mode`);
                        resolve('2d');
                    } else {
                        log.warn('init', `Unknown context type: ${contextType}, defaulting to 2D`);
                        this.detectedMode = '2d';
                        resolve('2d');
                    }
                }
            };

            window.addEventListener('message', handleMessage);

            // Request canvas info from page script (in case it's already detected)
            log.debug('init', 'Requesting canvas detection from page script');
            window.postMessage({
                type: 'WOKEMAPS_REQUEST_CANVAS_INFO'
            }, '*');
        });

        return this.modeDetectionPromise;
    }

    /**
     * Create the appropriate MapCanvas instance
     * @returns {Promise<MapCanvas|MapCanvasWebGL>}
     */
    async createMapCanvas() {
        const mode = await this.detectMode();
        return new MapCanvas(this.canvasId, mode);
    }

    /**
     * Create the appropriate MapState2D instance
     * @param {MapCanvas|MapCanvasWebGL} mapCanvas
     * @returns {MapState2D|MapStateWebGL}
     */
    createMapState(mapCanvas) {
        if (this.detectedMode === 'webgl') {
            return new MapStateWebGL(mapCanvas);
        } else {
            return new MapState2D(mapCanvas);
        }
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
        const overlayEngine = new OverlayEngine(mapCanvas, mapState, labelRenderer, allLabels, options.debug);

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
