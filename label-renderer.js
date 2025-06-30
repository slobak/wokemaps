// Label Renderer
// Handles pre-rendering labels to offscreen canvas and font management

class LabelRenderer {
    constructor(mapCanvas) {
        this.mapCanvas = mapCanvas;
        this.fontLoaded = false;
    }

    /**
     * Initialize the label renderer by loading font and setting up canvas
     * @param {Array} labels - Array of label configurations to pre-render
     * @returns {Promise<boolean>} True if initialization succeeded
     */
    async initialize(labels = []) {
        // Load custom font first
        await this.loadCustomFont();
    }

    /**
     * Load custom handwritten font
     * @returns {Promise<void>} Resolves when font is loaded
     */
    async loadCustomFont() {
        try {
            const fontFace = new FontFace('Permanent Marker', 'url(https://fonts.gstatic.com/s/permanentmarker/v16/Fh4uPib9Iyv2ucM6pGQMWimMp004La2Cf5b6jlg.woff2)');
            const font = await fontFace.load();
            document.fonts.add(font);
            this.fontLoaded = true;
            log.debug('init', "Custom font loaded successfully");
        } catch (err) {
            log.warn('init', "Failed to load custom font, will use fallback:", err);
            this.fontLoaded = false;
            // Don't throw - fallback font will be used
        }
    }

    /**
     * Get label display properties with defaults applied
     * @param {Object} label - The label configuration
     * @returns {Object} Label properties with defaults
     */
    getLabelProperties(label) {
        return {
            ...label,
            color: label.color || "#000066",
            scale: label.scale || 1.0,
            rotation: label.rotation || -1.5,
            background: label.backgroundType === 'rect' ? '#ffffffb3' : '#00000000',
            offset: label.offset || [0, 0],
        };
    }

    /**
     * Draw a label at the specified position and return its dimensions
     * @param {CanvasRenderingContext2D} context - The canvas context to draw on
     * @param {number} x - X coordinate
     * @param {number} y - Y coordinate
     * @param {Object} labelProps - Label properties from getLabelProperties()
     * @returns {Object} Label dimensions {width, height}
     */
    drawLabelAtPosition(context, x, y, labelProps) {
        context.save();
        const fontSize = 12 * labelProps.scale;

        // Set font
        if (this.fontLoaded) {
            context.font = `bold ${fontSize}px "Permanent Marker", Arial, sans-serif`;
        } else {
            context.font = `bold ${fontSize}px Arial, sans-serif`;
        }

        context.textAlign = 'center';
        context.textBaseline = 'middle';

        // Measure text
        const lines = labelProps.text.split('\n');
        const textWidth = lines.reduce(
            (accumulator, line) => Math.max(accumulator, context.measureText(line).width),
            0
        );
        const lineHeight = fontSize + 6;
        const textHeight = lineHeight * lines.length;
        const padding = 8;

        const totalWidth = textWidth + padding * 2;
        const totalHeight = textHeight + padding * 2;

        // Draw background
        context.fillStyle = labelProps.background;
        context.fillRect(
            x - totalWidth / 2,
            y - totalHeight / 2,
            totalWidth,
            totalHeight
        );

        // Draw text with rotation
        context.translate(x, y);
        context.rotate(labelProps.rotation * Math.PI / 180);

        context.fillStyle = labelProps.color;
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            context.fillText(line, 0, (i - (lines.length - 1) / 2.0) * lineHeight);
        }

        context.restore();
        return { width: totalWidth, height: totalHeight };
    }

    /**
     * Accurate Google Maps style projection with tile size parameter
     * @param {number} lat - Latitude
     * @param {number} lng - Longitude
     * @param {number} zoom - Zoom level
     * @returns {Object|null} Pixel coordinates {x, y} or null if error
     */
    googleMapsLatLngToPoint(lat, lng, zoom) {
        try {
            // First, we need the normalized coordinates between 0 and 1
            const normX = (lng + 180) / 360;

            // Convert latitude to radians for sin calculation
            const latRad = lat * Math.PI / 180;

            // Apply the Mercator projection formula
            const mercN = Math.log(Math.tan((Math.PI / 4) + (latRad / 2)));
            const normY = 0.5 - mercN / (2 * Math.PI);

            // Scale by the world size at this zoom level
            const scale = Math.pow(2, zoom - 1);
            const worldSize = scale * this.mapCanvas.tileSize;

            // Convert to pixel coordinates
            const pixelX = Math.floor(normX * worldSize);
            const pixelY = Math.floor(normY * worldSize);

            return { x: pixelX, y: pixelY };
        } catch (e) {
            log.error('render', "Error in googleMapsLatLngToPoint:", e);
            return null;
        }
    }
}

// Export for use in other files
if (typeof window !== 'undefined') {
    window.LabelRenderer = LabelRenderer;
}
