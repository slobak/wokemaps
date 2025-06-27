// Woke Maps
// Tries to respond to Google Maps rendering at certain locations, and overwrites with
// labels more desirable to the user.

log.info('init', "Extension initializing");

(async function() {

  // Initialize options manager
  const optionsManager = new OptionsManager();
  const options = await optionsManager.getOptions();
  const debugOptions = options.debug || {};

  // Initialize logging
  await log.initialize(debugOptions.logLevels);

  // Initialize UUID to make unique ID available if we need it
  const uuidManager = new UuidManager();
  uuidManager.getUUID().then(uuid => {
    log.info('init', 'UUID initialized for maps context:', uuid);
  }).catch(e => {
    log.error('init', 'Failed to initialize UUID:', e);
  });

  // Load app data
  const appDataManager = new AppDataManager(optionsManager);
  const allLabels = await appDataManager.getLabels();

  const announcements = (await optionsManager.getOption('enableAnnouncements', true)) ?
      (await appDataManager.getAnnouncements()) : [];
  const announcementManager = new AnnouncementManager(announcements);

  // Initialize label renderer
  const labelRenderer = new LabelRenderer(null); // Will be set after canvas detection
  await labelRenderer.initialize(allLabels);

  // Use factory to create appropriate components based on detected mode
  const canvasFactory = new CanvasFactory();

  log.info('init', 'Waiting for canvas detection...');
  const components = await canvasFactory.createComponents(labelRenderer, options, allLabels);

  log.info('init', `Initialized in ${components.mode} mode`);

  // Update label renderer with the detected canvas
  labelRenderer.mapCanvas = components.mapCanvas;

  // Initialize components with retry
  retryWithExponentialBackoff(
      () => {
        return components.mapCanvas.tryInitialize()
      },
      100,
      30000).then(() => {
    log.info('init', 'Canvas initialized, starting map state and overlay engine');
    components.mapState.initialize();
    components.overlayEngine.initialize();
  });
})();
