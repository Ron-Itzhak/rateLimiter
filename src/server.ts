import { createApp } from "./app";
import { loadConfig } from "./config";
import { RateLimiter } from "./engine/limiter";

export function startServer(port = 3000, host = "127.0.0.1") {
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new RangeError("Invalid port");
  const limiter = new RateLimiter(loadConfig());
  const server = createApp(limiter).listen(port, host);
  const timer = setInterval(() => limiter.sweep(100), 1000);
  timer.unref();
  server.on("close", () => clearInterval(timer));
  server.on("error", () => clearInterval(timer));
  const stop = () =>
    new Promise<void>((resolve, reject) => {
      clearInterval(timer);
      server.close((error) => (error ? reject(error) : resolve()));
    });
  return { server, stop };
}

if (require.main === module) {
  const { server, stop } = startServer(
    Number(process.env.PORT ?? 3000),
    process.env.HOST ?? "127.0.0.1",
  );
  server.on("listening", () => {
    const address = server.address();
    if (address && typeof address !== "string")
      console.log(`Server listening on ${address.address}:${address.port}`);
  });
  server.on("error", (error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
  let stopping = false;
  const shutdown = () => {
    if (stopping) return;
    stopping = true;
    void stop().catch((error) => {
      console.error(error.message);
      process.exitCode = 1;
    });
  };
  process.once("SIGTERM", shutdown);
  process.once("SIGINT", shutdown);
}
