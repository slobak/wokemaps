
function randomElementId() {
    return Math.random().toString(36).substr(2, 9);
}

function versionCompare(v1, v2) {
    const v1parts = v1.split(".").map((c) => parseInt(c, 10));
    const v2parts = v2.split(".").map((c) => parseInt(c, 10));
    while (v1parts.length > 0 && v2parts.length > 0) {
        const c1 = v1parts.shift();
        const c2 = v2parts.shift();
        if (c1 > c2) {
            return 1;
        } else if (c1 < c2) {
            return -1;
        }
    }
    if (v1parts) {
        return 1;
    } else if (v2parts) {
        return -1;
    }
    return 0;
}

/**
 * Runs a function with exponential backoff retry logic
 * @param {Function} fn - The function to execute (should return true for success, false for retry)
 * @param {number} initialWaitMs - Initial wait time in milliseconds
 * @param {number} maxWaitMs - Maximum wait time between retries (caps the exponential growth)
 * @param {Function} [onRetry] - Optional callback called before each retry (receives current wait time)
 * @returns {Promise<boolean>} - Resolves to true when function eventually succeeds (never rejects)
 */
function retryWithExponentialBackoff(fn, initialWaitMs, maxWaitMs, onRetry = null) {
    return new Promise((resolve) => {
        let currentWait = initialWaitMs;

        function attempt() {
            const result = fn();

            if (result) {
                resolve(result);
                return;
            }

            if (onRetry) {
                onRetry(currentWait);
            }

            setTimeout(() => {
                // Double the wait time, but cap it at maxWaitMs
                currentWait = Math.min(currentWait * 2, maxWaitMs);
                attempt();
            }, currentWait);
        }

        attempt();
    });
}

// Alternative version that supports async functions
async function retryWithExponentialBackoffAsync(asyncFn, initialWaitMs, maxWaitMs, onRetry = null) {
    let currentWait = initialWaitMs;

    while (true) {
        try {
            const result = await asyncFn();
            if (result) {
                return result;
            }
        } catch (error) {
            // Treat exceptions as failure and continue retrying
            log.warn('init', 'Function threw error, retrying:', error);
        }

        if (onRetry) {
            onRetry(currentWait);
        }

        await new Promise(resolve => setTimeout(resolve, currentWait));
        // Double the wait time, but cap it at maxWaitMs
        currentWait = Math.min(currentWait * 2, maxWaitMs);
    }
}
