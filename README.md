# #wokemaps

A Chrome extension that overlays custom labels on Google Maps, replacing or supplementing existing labels at specific locations with alternative text in a handwritten style.

Visit [wokemaps.org](http://wokemaps.org/) for more information.

## What It Does

The extension renders custom text labels directly onto Google Maps at precisely configured coordinates. Each label is defined with:
- Specific lat/lng coordinates to match existing map features
- Min/max zoom levels that determine visibility ranges
- Custom text, positioning offsets, and styling options

Labels use the "Permanent Marker" font to create a handwritten appearance that stands out from Google's standard typography. Current labels include alternative names for geographic features like "Gulf of Mexico," "Denali," and location-specific annotations.

## Installation

### Development Mode
1. Clone this repository
2. Open Chrome and go to `chrome://extensions/`
3. Enable "Developer mode"
4. Click "Load unpacked" and select the extension directory
5. Navigate to Google Maps to see the labels in action

### Permissions
- `storage`: Saves user preferences and caches remote configuration
- `*://*.google.com/maps/*`: Injects content scripts into Google Maps

## Configuration

The extension uses a hybrid configuration system:

**Remote Config**: Labels are loaded from a remote file, an S3 object, and cached in `local` storage (duration set by `DATA_CACHE_DURATION`, should be several hours).

**Local Fallback**: `app-data-v1.json` provides backup data if remote fetch fails.

**Label Configuration Format**:
```json
{
  "lat": 25.334537,        // Latitude coordinate for label placement
  "lng": -90.054921,       // Longitude coordinate for label placement
  "text": "Gulf of Mexico", // Display text (supports \n for multiple lines)
  "zoomStart": 4,            // Minimum zoom level to show label
  "zoomLimit": 16,           // Maximum zoom level to show label
  "scale": 1.4,            // Font size multiplier (default: 1.0)
  "xOffset": 0,            // Horizontal pixel offset from lat/lng position
  "yOffset": 0             // Vertical pixel offset from lat/lng position
}
```

**Debug Options**: Click the extension icon to access debug controls (enable by setting `debug.showDebugUi: true` in options).

## Usage

Labels appear automatically when viewing Google Maps. They:
- Render only within their configured zoom ranges
- Position themselves relative to their lat/lng coordinates
- Overlay existing map content without interfering with interactions
- Update dynamically as you pan and zoom

## Development

### Architecture
- **AnnouncementManager**: Handles dismissible notification bar
- **AppDataManager**: Loads and caches label configuration
- **LabelRenderer**: Pre-renders labels to offscreen canvas
- **MapCanvas**: Manages Google Maps canvas detection and access
- **MapState2D**: Tracks map position, zoom, and transform state
- **OverlayEngine**: Coordinates tile detection and label overlay rendering

### Adding Labels
Edit `app-data-v1.json` to add new labels. Use Google Maps to find coordinates, then experiment with zoom ranges and offsets to properly align with existing features.

### Key Files
```
manifest.json          # Extension configuration
content-for-google-maps.js        # Main initialization
app-data-v1.json      # Label definitions
content-in-google-maps.js    # Page-context hooks for canvas interception
```

## How It Works

Google Maps does not expose the Maps JavaScript API for the main web interface, so traditional approaches using markers or overlays are not available. Instead, we must detect when Google is drawing content in the map area. Google primarily renders two types of images: tiles (map imagery) and labels. Either can overlap and overwrite the labels we draw, so we must listen for both.

The extension intercepts Google Maps' canvas rendering pipeline by:

1. **Canvas Detection**: Identifies the main tile-rendering canvas (256px or 512px tiles)
2. **Draw Event Interception**: Overrides `CanvasRenderingContext2D.drawImage()` to detect tile redraws
3. **Tile Sequence Tracking**: Groups tile draws into rendering sequences and detects map changes
4. **Label Pre-rendering**: Renders all labels to an offscreen canvas during initialization
5. **Overlap Calculation**: For each tile redraw, calculates which labels intersect the tile area
6. **Selective Overlay**: Draws only the intersecting portions of labels onto the map canvas

### Rendering Strategy: Smoothness vs. Correctness

The extension faces a tradeoff between visual smoothness and positioning accuracy. Rendering immediately after an overlapping image prevents flicker, but requires accurate transform state to position labels correctly. Google sometimes redraws tiles without updating accessible state (DOM elements, URL), creating potential misalignment.

The solution uses conditional timing:
- **Immediate rendering**: When transform state is current and reliable
- **Delayed rendering**: When the tileset shifts (panning), zoom level changes, or navigation occurs via search

This approach minimizes visual artifacts while maintaining label accuracy across different interaction patterns.
