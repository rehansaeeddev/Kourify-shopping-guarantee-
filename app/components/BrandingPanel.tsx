import { useEffect, useState } from "react";

import { Card } from "./Card";
import { useToast } from "./Toast";
import {
  useSaveBranding,
  useSaveBrandLogo,
  type MerchantSettings,
} from "../lib/queries";

/** Where the introduction can sit, named as a merchant sees it. */
const POSITIONS = [
  { value: "start", label: "Beside the form, on the left" },
  { value: "end", label: "Beside the form, on the right" },
  { value: "above", label: "Above the form" },
  { value: "below", label: "Below the form" },
  { value: "hidden", label: "Don't show it" },
] as const;

/**
 * The two members of s-drop-zone this reads.
 *
 * Both are documented and both are there at runtime -- `files` is a read-only
 * getter and `value` a setter that refuses anything but "" or null -- but the
 * published v1.0 types declare neither, the same gap as `size` on s-heading.
 * Named here rather than cast away at the call site so what is being assumed
 * is written down.
 */
type DropZoneFiles = { files?: File[]; value: string };

/** What the server accepts, said once so the hint and the check agree. */
const MAX_BYTES = 5 * 1024 * 1024;
const ACCEPT = "image/png,image/jpeg,image/gif,image/webp";

/**
 * Reads a file the merchant picked into the data URL the endpoint takes.
 *
 * The server does the real checking -- type, leading bytes, size -- and this
 * only catches the one a browser can answer instantly, so someone who picks a
 * 30 MB photo is told before it is read rather than after it is uploaded.
 */
function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onerror = () => reject(new Error("That file could not be read."));
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.readAsDataURL(file);
  });
}

/**
 * What the merchant can change about the storefront claim page.
 *
 * Two colours rather than a stylesheet. The page is on the merchant's own
 * domain and carries a form shoppers type an order number and an email into,
 * and CSS on a page like that is not decoration -- an attribute selector and
 * a background-image url read a field out a character at a time, with no
 * script involved. So the app owns the stylesheet and the merchant owns the
 * colours, and everything else the page draws is derived from those two.
 */
export function BrandingPanel({ settings }: { settings: MerchantSettings }) {
  const { showToast } = useToast();
  const branding = useSaveBranding();
  const logo = useSaveBrandLogo();

  /*
   * Held locally so typing does not save on every keystroke, and seeded again
   * whenever the server's copy changes -- otherwise a refused colour would
   * stay in the box looking accepted.
   */
  const [name, setName] = useState(settings.brandName ?? "");
  const [color, setColor] = useState(settings.brandColor ?? "");
  const [surface, setSurface] = useState(settings.brandSurface ?? "");

  useEffect(() => {
    setName(settings.brandName ?? "");
    setColor(settings.brandColor ?? "");
    setSurface(settings.brandSurface ?? "");
  }, [settings.brandName, settings.brandColor, settings.brandSurface]);

  const busy = branding.isPending || logo.isPending;

  const save = (patch: Record<string, string | boolean>, message: string) =>
    branding.mutate(patch, {
      onSuccess: () => showToast(message),
      // The server sends its refusals as one sentence, so this is the one
      // that names the field the merchant got wrong.
      onError: (cause: Error) => showToast(cause.message, { isError: true }),
    });

  const pickLogo = async (file: File | undefined) => {
    if (!file) return;

    if (file.size > MAX_BYTES) {
      showToast("That image is over 5 MB. Pick a smaller one.", {
        isError: true,
      });

      return;
    }

    try {
      const dataUrl = await readAsDataUrl(file);

      logo.mutate(dataUrl, {
        onSuccess: () => showToast("Logo updated"),
        onError: (cause: Error) => showToast(cause.message, { isError: true }),
      });
    } catch (cause) {
      showToast((cause as Error).message, { isError: true });
    }
  };

  /*
   | The claim page itself, on the shop's own domain through the app proxy.
   |
   | There is no preview here on purpose. A sketch of the page would have to
   | paint the merchant's two colours as inline styles, and this app has no
   | admin CSS of its own -- every surface is a Polaris component styling
   | itself. Reintroducing a stylesheet to approximate a page that is one
   | click away is a poor trade, and an approximation is not what anyone
   | checks against anyway.
   */
  const claimPage = `https://${settings.shop}/apps/kourify/claims`;

  return (
    <Card heading="Claim page branding" boxed>
      <s-paragraph color="subdued">
        How the storefront claim page looks to your customers. Leave anything
        blank to keep the page&apos;s own design.
      </s-paragraph>

      <s-text-field
        label="Shop name"
        name="brandName"
        value={name}
        details="Shown beside the logo. Leave blank to use the name set for each language under Languages."
        disabled={busy}
        onInput={(event) => setName(event.currentTarget.value ?? "")}
        onBlur={() => {
          if (name.trim() === (settings.brandName ?? "")) return;

          save(
            { brandName: name.trim() },
            name.trim() === "" ? "Shop name cleared" : "Shop name saved",
          );
        }}
      />

      <s-stack direction="block" gap="small-300">
        {settings.brandLogoUrl ? (
          <s-stack direction="inline" gap="base" alignItems="center">
            <s-thumbnail src={settings.brandLogoUrl} alt="" size="small" />
            <s-button
              variant="tertiary"
              tone="critical"
              disabled={busy}
              onClick={() =>
                logo.mutate("", {
                  onSuccess: () => showToast("Logo removed"),
                  onError: (cause: Error) =>
                    showToast(cause.message, { isError: true }),
                })
              }
            >
              Remove logo
            </s-button>
          </s-stack>
        ) : null}

        {/* s-drop-zone hands the File back on its change event -- it has a
          read-only `files` array for exactly this. An earlier attempt hid a
          plain <input type="file"> in here and clicked it from a button;
          Polaris slots its children into shadow DOM and the input never
          rendered, so the ref stayed null and the click went nowhere. It
          failed without a sound, which is the worst way for an upload to
          fail. */}
        <s-drop-zone
          label={settings.brandLogoUrl ? "Replace logo" : "Logo"}
          name="logo"
          accept={ACCEPT}
          disabled={busy}
          onChange={(event) => {
            const zone = event.currentTarget as unknown as DropZoneFiles;
            const picked = zone.files?.[0];

            // Cleared so picking the same file twice still fires a change.
            // The setter refuses anything but "" or null, by design.
            zone.value = "";

            void pickLogo(picked);
          }}
          onDropRejected={() =>
            showToast("That file type is not an image Shopify accepts.", {
              isError: true,
            })
          }
        />
        <s-text color="subdued">
          PNG, JPG, GIF or WebP, up to 5 MB. Stored on your Shopify files.
        </s-text>
      </s-stack>

      <s-grid
        gridTemplateColumns="@container (inline-size <= 560px) 1fr, 1fr 1fr"
        gap="base"
      >
        <s-color-field
          label="Brand colour"
          name="brandColor"
          value={color}
          details="Buttons, progress and highlights. Everything else is shaded from it."
          disabled={busy}
          onChange={(event) => {
            const next = event.currentTarget.value ?? "";

            setColor(next);
            save(
              { brandColor: next },
              next === "" ? "Brand colour cleared" : "Brand colour saved",
            );
          }}
        />
        <s-color-field
          label="Page background"
          name="brandSurface"
          value={surface}
          details="The colour behind the card."
          disabled={busy}
          onChange={(event) => {
            const next = event.currentTarget.value ?? "";

            setSurface(next);
            save(
              { brandSurface: next },
              next === "" ? "Background cleared" : "Background saved",
            );
          }}
        />
      </s-grid>

      {/* Where it sits, and whether the promises come with it. Alignment
        was a third choice here and is gone: left and centre read fine, but
        right put the copy against the edge the page clips at narrow widths,
        and three ways to align a block of marketing text was not worth the
        surface it added. */}
      <s-select
        label="Introduction"
        name="claimStoryPosition"
        value={settings.claimStoryPosition}
        details="Where the logo, heading and text sit."
        disabled={busy}
        onChange={(event) => {
          const next = event.currentTarget.value ?? "";

          save(
            { claimStoryPosition: next },
            `Introduction ${
              POSITIONS.find((o) => o.value === next)?.label.toLowerCase() ??
              next
            }`,
          );
        }}
      >
        {POSITIONS.map((option) => (
          <s-option key={option.value} value={option.value}>
            {option.label}
          </s-option>
        ))}
      </s-select>

      {settings.claimStoryPosition !== "hidden" ? (
        <>
          <s-checkbox
            label="Show the three promises"
            name="claimShowPromises"
            details="Secure verification, human review, clear communication."
            checked={settings.claimShowPromises}
            disabled={busy}
            onChange={(event) => {
              const on = event.currentTarget.checked ?? false;

              save(
                { claimShowPromises: on },
                on ? "Promises shown" : "Promises hidden",
              );
            }}
          />
        </>
      ) : null}

      <s-paragraph color="subdued">
        <s-link href={claimPage} target="_blank">
          Open the claim page
        </s-link>{" "}
        to see it as a customer does.
      </s-paragraph>
    </Card>
  );
}
