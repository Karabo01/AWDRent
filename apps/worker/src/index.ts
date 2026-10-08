import { env } from "@awdrent/config";

const config = env();
console.log(`[worker] starting (env=${config.NODE_ENV})`);
