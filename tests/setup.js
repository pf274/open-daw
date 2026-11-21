// Tests never touch the network: sample downloads fail fast, exercising the offline fallbacks.
// (Tests that need fetch pass their own fetchImpl or mock the loader.)
globalThis.fetch = () => Promise.reject(new Error('network disabled in tests'));
