// A production image must fail closed on deployment-policy violations even
// outside Railway. Validate before constructing the listener.
await import("./predeploy-check.js");
await import("./index.js");
