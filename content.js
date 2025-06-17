// Woke Maps
// Tries to respond to Google Maps rendering at certain locations, and overwrites with
// labels more desirable to the user.

console.log("wokemaps: extension initializing");

(async function() {

  // Initialize options manager
  const optionsManager = new OptionsManager();
  const options = await optionsManager.getOptions();
  const debugOptions = options.debug || {};

  // Enhanced logging function
  function log(level, ...args) {
    if (level <= (debugOptions.logLevel || 0)) {
      console.log("wokemaps:", ...args);
    }
  }

  // Load app data
  const appDataManager = new AppDataManager(optionsManager);
  const allLabels = await appDataManager.getLabels();

  const announcements = (await optionsManager.getOption('enableAnnouncements', true)) ?
      (await appDataManager.getAnnouncements()) : [];
  const announcementManager = new AnnouncementManager(announcements);

  const mapCanvas = new MapCanvas();
  const mapState = new MapState(mapCanvas);
  const labelRenderer = new LabelRenderer(mapCanvas);
  await labelRenderer.initialize(allLabels);

  const overlayEngine = new OverlayEngine(mapCanvas, mapState, labelRenderer, options, allLabels);

  // Initialize immediately
  function initialize() {
    // Try to initialize the map canvas
    if (!mapCanvas.tryInitialize()) {
      console.log("No tile-based canvas found, retrying in 500ms");
      setTimeout(initialize, 500);
      return;
    }
    mapState.initialize();
    overlayEngine.initialize();
  }

  // Start the init process
  initialize();
})();
