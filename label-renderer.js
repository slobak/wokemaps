// Label Renderer
// Handles pre-rendering labels to offscreen canvas and font management

class LabelRenderer {
    constructor(mapCanvas) {
        this.mapCanvas = mapCanvas;
        this.labelsCanvas = null;
        this.labelsContext = null;
        this.preRenderedLabels = [];
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

        // Then initialize the canvas with labels
        this.initializeLabelsCanvas(labels);
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
            console.log("Custom font loaded successfully");
        } catch (err) {
            console.warn("Failed to load custom font, will use fallback:", err);
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
            text: label.text,
            color: label.color || "#000066",
            scale: label.scale || 1.0,
            rotation: label.rotation || -1.5,
            background: label.backgroundType === 'rect' ? '#ffffffb3' : '#00000000',
            xOffset: label.xOffset || 0,
            yOffset: label.yOffset || 0
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
        const fontSize = 24 * labelProps.scale;

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
     * Initialize the offscreen labels canvas and pre-render all labels
     * @param {Array} labels - Array of label configurations
     */
    initializeLabelsCanvas(labels = []) {
        // Create a large offscreen canvas for pre-rendered labels
        this.labelsCanvas = document.createElement('canvas');
        this.labelsCanvas.width = 512;
        this.labelsCanvas.height = Math.max(2048, labels.length * 100);
        this.labelsContext = this.labelsCanvas.getContext('2d');

        // Clear previous labels
        this.preRenderedLabels = [];
        this.labelsContext.clearRect(0, 0, this.labelsCanvas.width, this.labelsCanvas.height);

        let currentY = 50;
        const spacing = 10;

        // Pre-render each label
        labels.forEach((label, index) => {
            const renderedLabel = this.preRenderLabel(label, currentY, index);
            if (renderedLabel) {
                this.preRenderedLabels.push({
                    ...label,
                    ...renderedLabel,
                    index
                });
                currentY += renderedLabel.height + spacing;
            }
        });

        console.log(`Pre-rendered ${this.preRenderedLabels.length} labels`);
    }

    /**
     * Pre-render a single label to the offscreen canvas
     * @param {Object} label - Label configuration
     * @param {number} startY - Y position to start rendering
     * @param {number} index - Label index for debugging
     * @returns {Object|null} Rendered label info or null if failed
     */
    preRenderLabel(label, startY, index) {
        const labelProps = this.getLabelProperties(label);
        const centerX = this.labelsCanvas.width / 2;
        const centerY = startY + 100; // Estimate center, will be adjusted

        // Draw the label and get its dimensions
        const dimensions = this.drawLabelAtPosition(
            this.labelsContext,
            centerX,
            centerY,
            labelProps
        );

        // Check if we have enough space
        if (startY + dimensions.height > this.labelsCanvas.height) {
            console.warn(`Not enough space for label: ${label.text}`);
            return null;
        }

        // Adjust the actual center Y position
        const actualCenterY = startY + dimensions.height / 2;

        // Clear and redraw at the correct position
        this.labelsContext.clearRect(
            centerX - dimensions.width / 2 - 10,
            centerY - dimensions.height / 2 - 10,
            dimensions.width + 20,
            dimensions.height + 20
        );

        this.drawLabelAtPosition(
            this.labelsContext,
            centerX,
            actualCenterY,
            labelProps
        );

        return {
            canvasX: centerX - dimensions.width / 2,
            canvasY: actualCenterY - dimensions.height / 2,
            width: dimensions.width,
            height: dimensions.height
        };
    }

    /**
     * Draw a label directly to the map canvas (fallback method)
     * @param {Object} label - Label configuration
     * @param {Object} mapState - Current map state {center, zoom}
     * @param {Object} canvasTransform - Current canvas transform {translateX, translateY, scale}
     */
    drawLabelToCanvas(label, mapState, canvasTransform) {
        if (!this.mapCanvas.context || !mapState.center) return;

        const labelProps = this.getLabelProperties(label);

        // Calculate the pixel position using the Mercator projection
        const labelPixel = this.googleMapsLatLngToPoint(label.lat, label.lng, mapState.zoom);
        const centerPixel = this.googleMapsLatLngToPoint(mapState.center.lat, mapState.center.lng, mapState.zoom);

        if (!labelPixel || !centerPixel) return;

        // Calculate base offset from center (world coordinates)
        const worldOffsetX = labelPixel.x - centerPixel.x;
        const worldOffsetY = labelPixel.y - centerPixel.y;

        // Calculate canvas center and position
        const canvasCenter = this.mapCanvas.getCenter();
        const parentDimensions = this.mapCanvas.getParentDimensions();

        // Calculate the tile alignment offset based on parent size
        const tileAlignmentX = -this.mapCanvas.tileSize + (parentDimensions.width % (this.mapCanvas.tileSize / 2));
        const tileAlignmentY = -this.mapCanvas.tileSize + (parentDimensions.height % (this.mapCanvas.tileSize / 2));

        // Apply canvas transform (this was missing!)
        const x = canvasCenter.x + worldOffsetX + labelProps.xOffset - (canvasTransform.translateX * this.mapCanvas.transformMultiplier) + tileAlignmentX;
        const y = canvasCenter.y + worldOffsetY + labelProps.yOffset - (canvasTransform.translateY * this.mapCanvas.transformMultiplier) + tileAlignmentY;

        // Check if on screen (with margin)
        const canvasDimensions = this.mapCanvas.getDimensions();
        if (x < -100 || x > canvasDimensions.width + 100 || y < -100 || y > canvasDimensions.height + 100) {
            return;
        }

        // Draw the label
        this.drawLabelAtPosition(this.mapCanvas.context, x, y, labelProps);
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
            const scale = Math.pow(2, zoom);
            const worldSize = scale * this.mapCanvas.tileSize;

            // Convert to pixel coordinates
            const pixelX = Math.floor(normX * worldSize);
            const pixelY = Math.floor(normY * worldSize);

            return { x: pixelX, y: pixelY };
        } catch (e) {
            console.error("Error in googleMapsLatLngToPoint:", e);
            return null;
        }
    }

    /**
     * Get the pre-rendered labels array
     * @returns {Array} Array of pre-rendered label objects
     */
    getPreRenderedLabels() {
        return this.preRenderedLabels;
    }

    /**
     * Check if labels canvas is initialized
     * @returns {boolean} True if initialized
     */
    isInitialized() {
        return this.labelsCanvas !== null;
    }
}

// Export for use in other files
if (typeof window !== 'undefined') {
    window.LabelRenderer = LabelRenderer;
}
