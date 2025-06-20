(function() {

    // Override the drawImage prototype
    const originalDrawImage = CanvasRenderingContext2D.prototype.drawImage;
    CanvasRenderingContext2D.prototype.drawImage = function(...args) {
        // Call the original drawImage function first
        originalDrawImage.apply(this, args);

        // Send a custom event that the content script can listen for
        const transform = this.getTransform();
        let dx, dy, dw, dh;
        if (args.length === 3) {
            // drawImage(image, dx, dy)
            dx = args[1];
            dy = args[2];
            dw = args[0].width;
            dh = args[0].height;
        } else if (args.length === 5) {
            // drawImage(image, dx, dy, dw, dh)
            dx = args[1];
            dy = args[2];
            dw = args[3];
            dh = args[4];
        } else if (args.length === 9) {
            // drawImage(image, sx, sy, sw, sh, dx, dy, dw, dh)
            dx = args[5];
            dy = args[6];
            dw = args[7];
            dh = args[8];
        }

        window.dispatchEvent(new CustomEvent('wokemaps_canvasDrawImageCalled', {
            detail: {
                timestamp: Date.now(),
                extent: { dx, dy, dw, dh },
                transform: {
                    a: transform.a,
                    b: transform.b,
                    c: transform.c,
                    d: transform.d,
                    e: transform.e,
                    f: transform.f
                },
                canvas: {
                    // TODO: unused?
                    width: this.canvas.width,
                    height: this.canvas.height
                }
            }
        }));
    };

    const originalPushState = history.pushState;
    history.pushState = function(...args) {
        originalPushState.apply(history, args);
        window.dispatchEvent(new CustomEvent('wokemaps_urlChanged', {
            detail: {
                url: window.location.href
            }
        }));
    };

    const originalReplaceState = history.replaceState;
    history.replaceState = function(...args) {
        originalReplaceState.apply(history, args);
        window.dispatchEvent(new CustomEvent('wokemaps_urlChanged', {
            detail: {
                url: window.location.href
            }
        }));
    };


    function handleMouseUp(e) {
        const target = e.target;
        const zoomInButton = document.getElementById('widget-zoom-in');
        const zoomOutButton = document.getElementById('widget-zoom-out');
        if (target === zoomInButton || zoomInButton.contains(target)  ||
            target === zoomOutButton || zoomOutButton.contains(target)) {
            handlePotentialZoomInteraction(e);
        }
    }

    function handleKeyDown(e) {
        const key = e.key; // Get the name of the pressed key
        if (key === '-' || key === '+' || key === '=') {
            handlePotentialZoomInteraction(e);
        }
    }

    function handlePotentialZoomInteraction() {
        window.dispatchEvent(new CustomEvent('wokemaps_potentialZoomInteraction', {}));
    }

    window.addEventListener('mouseup', handleMouseUp, { capture: true, passive: true });
    window.addEventListener('wheel', handlePotentialZoomInteraction, { capture: true, passive: true });
    window.addEventListener('keydown', handleKeyDown, { capture: true, passive: true });


    console.log('wokemaps: page hooks initialized');
})();