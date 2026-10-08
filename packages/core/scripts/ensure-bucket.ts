import { CreateBucketCommand, HeadBucketCommand, S3Client } from "@aws-sdk/client-s3";
import { env } from "@awdrent/config";

// Creates the private documents bucket if it does not exist yet. Runs in the
// one-off migrate service before the web app and worker start.

async function main() {
  const e = env();
  const s3 = new S3Client({
    endpoint: e.S3_ENDPOINT,
    region: e.S3_REGION,
    forcePathStyle: e.S3_FORCE_PATH_STYLE,
    credentials: { accessKeyId: e.S3_ACCESS_KEY_ID, secretAccessKey: e.S3_SECRET_ACCESS_KEY },
  });
  // The store may still be starting; retry for up to a minute
  for (let attempt = 1; ; attempt++) {
    try {
      await s3.send(new HeadBucketCommand({ Bucket: e.S3_BUCKET }));
      console.log(`[storage] bucket ${e.S3_BUCKET} exists`);
      return;
    } catch (err) {
      const status = (err as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
      if (status === 404) {
        await s3.send(new CreateBucketCommand({ Bucket: e.S3_BUCKET }));
        console.log(`[storage] created bucket ${e.S3_BUCKET}`);
        return;
      }
      if (attempt >= 30) throw err;
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
}

main().catch((err: unknown) => {
  console.error("[storage] could not prepare the bucket:", err);
  process.exitCode = 1;
});
