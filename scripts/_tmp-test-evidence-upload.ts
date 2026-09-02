import "dotenv/config";
import { unauthenticated } from "../app/shopify.server";

// 1x1 transparent PNG
const TINY_PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

async function timed<T>(label: string, fn: () => Promise<T>): Promise<T> {
  const start = Date.now();
  try {
    const result = await fn();
    console.log(`[${label}] OK in ${Date.now() - start}ms`);
    return result;
  } catch (err) {
    console.log(`[${label}] FAILED in ${Date.now() - start}ms:`, err);
    throw err;
  }
}

async function main() {
  const shop = "oveelab.myshopify.com";
  const { admin } = await unauthenticated.admin(shop);

  const buffer = Buffer.from(TINY_PNG.split(",")[1], "base64");
  const filename = `kourify-test-${Date.now()}.png`;

  const stagedJson = await timed("stagedUploadsCreate", async () => {
    const res = await admin.graphql(
      `#graphql
        mutation kourifyStagedUpload($input: [StagedUploadInput!]!) {
          stagedUploadsCreate(input: $input) {
            stagedTargets { url resourceUrl parameters { name value } }
            userErrors { field message }
          }
        }`,
      {
        variables: {
          input: [
            { resource: "FILE", filename, mimeType: "image/png", httpMethod: "POST", fileSize: String(buffer.byteLength) },
          ],
        },
      },
    );
    return res.json();
  });
  console.log("stagedUploadsCreate result:", JSON.stringify(stagedJson, null, 2));

  const target = stagedJson?.data?.stagedUploadsCreate?.stagedTargets?.[0];
  if (!target) {
    console.log("No staged target returned, aborting.");
    return;
  }

  await timed("raw file upload", async () => {
    const form = new FormData();
    for (const param of target.parameters as { name: string; value: string }[]) {
      form.append(param.name, param.value);
    }
    form.append("file", new Blob([buffer], { type: "image/png" }), filename);
    const res = await fetch(target.url, { method: "POST", body: form });
    console.log("raw upload status:", res.status, await res.text().catch(() => "<no body>"));
    return res;
  });

  const createJson = await timed("fileCreate", async () => {
    const res = await admin.graphql(
      `#graphql
        mutation kourifyFileCreate($files: [FileCreateInput!]!) {
          fileCreate(files: $files) {
            files { id ... on MediaImage { image { url } } }
            userErrors { field message }
          }
        }`,
      { variables: { files: [{ originalSource: target.resourceUrl, contentType: "IMAGE" }] } },
    );
    return res.json();
  });
  console.log("fileCreate result:", JSON.stringify(createJson, null, 2));
}

main().catch((err) => {
  console.error("FATAL", err);
  process.exit(1);
});
