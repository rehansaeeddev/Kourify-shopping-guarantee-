type AdminGraphqlClient = {
  graphql: (query: string, options?: { variables?: Record<string, unknown> }) => Promise<Response>;
};

const MAX_EVIDENCE_BYTES = 5 * 1024 * 1024; // 5MB

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
      },
    );
    const stagedJson = await stagedResponse.json();
    const target = stagedJson?.data?.stagedUploadsCreate?.stagedTargets?.[0];
    if (!target) return null;

    const form = new FormData();
    for (const param of target.parameters as { name: string; value: string }[]) {
      form.append(param.name, param.value);
    }
    form.append("file", new Blob([buffer], { type: mimeType }), filename);

    const uploadResponse = await fetch(target.url, { method: "POST", body: form });
    if (!uploadResponse.ok) return null;

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
      },
    );
    const createJson = await createResponse.json();
    const file = createJson?.data?.fileCreate?.files?.[0];
    return file?.image?.url ?? null;
  } catch {
    return null;
  }
}
