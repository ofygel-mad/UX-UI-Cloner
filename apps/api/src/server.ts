import { pathToFileURL } from "node:url";
import { startApiServer } from "./app.js";

async function main(): Promise<void> {
  try {
    const handle = await startApiServer();
    handle.app.log.info(`API running on ${handle.baseUrl}`);
  } catch (error) {
    console.error(error);
    process.exit(1);
  }
}

const isDirectRun =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirectRun) {
  await main();
}
