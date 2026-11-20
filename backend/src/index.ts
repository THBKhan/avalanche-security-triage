/**
 * Backend Server Entry Point
 * Starts HTTP listener with graceful shutdown handling.
 */

import { loadConfig } from "./config";
import { createApp } from "./app";

const config = loadConfig();
const app = createApp(config);

const server = app.listen(config.port, () => {
  console.log(`Backend triage server listening on port ${config.port}`);
});

function gracefulShutdown(signal: string) {
  console.log(`Received ${signal}. Closing HTTP server gracefully...`);
  server.close(() => {
    console.log("HTTP server closed. Exiting process.");
    process.exit(0);
  });

  // Force close after 5 seconds if connections hang
  setTimeout(() => {
    console.error("Could not close connections in time, forcefully shutting down");
    process.exit(1);
  }, 5000);
}

process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => gracefulShutdown("SIGINT"));
