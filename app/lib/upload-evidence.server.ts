type AdminGraphqlClient = {
  graphql: (
    query: string,
    options?: { variables?: Record<string, unknown>; signal?: AbortSignal },
  ) => Promise<Response>;
};

const MAX_EVIDENCE_BYTES = 5 * 1024 * 1024; // 5MB
const UPLOAD_TIMEOUT_MS = 10_000;
const FILE_READY_POLL_ATTEMPTS = 5;
const FILE_READY_POLL_DELAY_MS = 1_000;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * fileCreate returns before Shopify finishes processing the image, so
 * `image.url` on the immediate response is null. Poll the file by id until
 * processing completes or we give up.
 */
async function pollFileUrl(admin: AdminGraphqlClient, fileId: string): Promise<string | null> {
  for (let attempt = 0; attempt < FILE_READY_POLL_ATTEMPTS; attempt++) {
    await sleep(FILE_READY_POLL_DELAY_MS);
    const response = await admin.graphql(
      `#graphql
        query kourifyFileStatus($id: ID!) {
          node(id: $id) {
            ... on MediaImage {
              fileStatus
              image {
                url
              }
            }
          }
        }`,
      { variables: { id: fileId }, signal: AbortSignal.timeout(UPLOAD_TIMEOUT_MS) },
    );
    const json = await response.json();
    const node = json?.data?.node;
    if (node?.image?.url) return node.image.url;
    if (node?.fileStatus === "FAILED") {
      console.error("[uploadEvidenceImage] file processing failed", JSON.stringify(node));
      return null;
    }
  }
  console.error("[uploadEvidenceImage] file never finished processing", fileId);
  return null;
}

/**
 * Uploads a base64 data-URL image to Shopify's own file storage (staged
 * upload -> fileCreate) and returns the resulting CDN URL, or null if
 * anything in the flow fails. This has not been exercised against a live
 * store yet — verify the mutation shapes against your API version before
 * relying on it in production.
 */
export async function uploadEvidenceImage(
  admin: AdminGraphqlClient,
  base64DataUrl: string,
): Promise<string | null> {
  try {
    const match = /^data:(image\/[a-zA-Z+]+);base64,(.+)$/.exec(base64DataUrl);
    if (!match) return null;

    const mimeType = match[1];
    const buffer = Buffer.from(match[2], "base64");
    if (buffer.byteLength > MAX_EVIDENCE_BYTES) return null;
    const extension = mimeType.split("/")[1] || "jpg";
    const filename = `kourify-claim-evidence-${Date.now()}.${extension}`;

    const stagedResponse = await admin.graphql(
      `#graphql
        mutation kourifyStagedUpload($input: [StagedUploadInput!]!) {
          stagedUploadsCreate(input: $input) {
            stagedTargets {
              url
              resourceUrl
              parameters {
                name
                value
              }
            }
            userErrors {
              field
              message
            }
          }
        }`,
      {
        variables: {
          input: [
            {
              resource: "FILE",
              filename,
              mimeType,
              httpMethod: "POST",
              fileSize: String(buffer.byteLength),
            },
          ],
        },
        signal: AbortSignal.timeout(UPLOAD_TIMEOUT_MS),
      },
    );
    const stagedJson = await stagedResponse.json();
    const stagedErrors = stagedJson?.data?.stagedUploadsCreate?.userErrors;
    const target = stagedJson?.data?.stagedUploadsCreate?.stagedTargets?.[0];
    if (!target) {
      console.error(
        "[uploadEvidenceImage] stagedUploadsCreate failed",
        JSON.stringify({ errors: stagedJson?.errors, userErrors: stagedErrors }),
      );
      return null;
    }

    const form = new FormData();
    for (const param of target.parameters as { name: string; value: string }[]) {
      form.append(param.name, param.value);
    }
    form.append("file", new Blob([buffer], { type: mimeType }), filename);

    const uploadResponse = await fetch(target.url, {
      method: "POST",
      body: form,
      signal: AbortSignal.timeout(UPLOAD_TIMEOUT_MS),
    });
    if (!uploadResponse.ok) {
      console.error(
        "[uploadEvidenceImage] binary upload to staged target failed",
        uploadResponse.status,
        await uploadResponse.text().catch(() => ""),
      );
      return null;
    }

    const createResponse = await admin.graphql(
      `#graphql
        mutation kourifyFileCreate($files: [FileCreateInput!]!) {
          fileCreate(files: $files) {
            files {
              id
              ... on MediaImage {
                image {
                  url
                }
              }
            }
            userErrors {
              field
              message
            }
          }
        }`,
      {
        variables: {
          files: [{ originalSource: target.resourceUrl, contentType: "IMAGE" }],
        },
        signal: AbortSignal.timeout(UPLOAD_TIMEOUT_MS),
      },
    );
    const createJson = await createResponse.json();
    const createErrors = createJson?.data?.fileCreate?.userErrors;
    const file = createJson?.data?.fileCreate?.files?.[0];
    if (!file?.id) {
      console.error(
        "[uploadEvidenceImage] fileCreate failed",
        JSON.stringify({ errors: createJson?.errors, userErrors: createErrors, file }),
      );
      return null;
    }
    if (file.image?.url) return file.image.url;
    return await pollFileUrl(admin, file.id);
  } catch (error) {
    console.error("[uploadEvidenceImage] threw", error);
    return null;
  }
}
