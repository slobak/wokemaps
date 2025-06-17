# Woke Map - Chrome Extension

This Chrome extension adds custom labels like "Gulf of Mexico" to Google Maps at specific coordinates where the original label is expected to show. It uses a handwritten-style font to make the label stand out.

## How It Works

Rather than trying to intercept or modify Google Maps' pre-rendered labels (which come as PNG sprites), this extension tries to detect when tiles are re-rendered in the canvas, and then directly render on top of them.

The detection is not easy, and the extension tries a few different methods, still a work in progress.

## Installation Instructions

### Development Mode Installation

1. Download or clone this repository to your local machine
2. Open Chrome and navigate to `chrome://extensions/`
3. Enable "Developer mode" using the toggle in the top-right corner
4. Click "Load unpacked" and select the directory containing this extension
5. The extension should now be installed and active when you visit Google Maps

### File Structure

```
woke-map/
├── manifest.json     # Extension configuration
├── content-main.js        # Script that creates the custom overlay
├── labels.json         # Contains just the data for labels to overlay
├── README.md         # This documentation file
└── images/           # Extension icons
    ├── icon16.png
    ├── icon48.png
    └── icon128.png
```

## Usage

1. After installation, navigate to Google Maps (maps.google.com)
2. The extension will automatically add, e.g. the "Gulf of Mexico" label to the map
3. Try different zoom levels to see how the labels appear and disappear, and whether they match up with the originals.
