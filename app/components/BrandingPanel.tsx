import { useEffect, useState } from "react";

import { Card } from "./Card";
import { useToast } from "./Toast";
import {
  useSaveBranding,
  useSaveBrandLogo,
  useSaveClaimText,
  useClaimPreview,
  type MerchantSettings,
} from "../lib/queries";

/** Where the logo and shop name can sit, named as a merchant sees them. */
const BRAND_POSITIONS = [
  { value: "with-intro", label: "With the intro", shape: "with-intro" },
  { value: "top", label: "Across the top", shape: "top" },
  { value: "hidden", label: "Hidden", shape: "none" },
] as const;

/**
 * The two blocks the merchant writes, and the caps the server enforces.
 *
 * Repeated here so the box stops at the same place the server would refuse,
 * rather than letting someone write past it and then be told.
 */
const OWN_TEXT = [
  {
    slot: "form",
    heading: "Above the form",
    details:
      "Shown at the top of the claim form, where every customer sees it.",
  },
  {
    slot: "intro",
    heading: "With the introduction",
    details: "Shown under the introduction text, beside the form.",
  },
] as const;

const TITLE_MAX = 80;
const BODY_MAX = 600;

/** Where the introduction can sit, named as a merchant sees it. */
const POSITIONS = [
  { value: "start", label: "Left", shape: "start" },
  { value: "end", label: "Right", shape: "end" },
  { value: "above", label: "Above", shape: "above" },
  { value: "below", label: "Below", shape: "below" },
  { value: "hidden", label: "Hidden", shape: "hidden" },
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
 * A small drawing of one arrangement.
 *
 * Every fill is currentColor at an opacity, so the tile carries no colour of
 * its own and follows whatever Polaris has set around it -- which is what
 * lets these exist in an admin that owns no CSS. The solid block is the
 * introduction, the faint one the form.
 */
function Diagram({ shape }: { shape: string }) {
  const solid = { fill: "currentColor", fillOpacity: 0.85 };
  const faint = { fill: "currentColor", fillOpacity: 0.22 };

  return (
    <svg
      viewBox="0 0 56 34"
      width="56"
      height="34"
      aria-hidden="true"
      focusable="false"
    >
      <rect
        x="0"
        y="0"
        width="56"
        height="34"
        rx="4"
        fill="currentColor"
        fillOpacity={0.07}
      />
      {shape === "start" ? (
        <>
          <rect x="5" y="5" width="16" height="24" rx="2" {...solid} />
          <rect x="24" y="5" width="27" height="24" rx="2" {...faint} />
        </>
      ) : null}
      {shape === "end" ? (
        <>
          <rect x="5" y="5" width="27" height="24" rx="2" {...faint} />
          <rect x="35" y="5" width="16" height="24" rx="2" {...solid} />
        </>
      ) : null}
      {shape === "above" ? (
        <>
          <rect x="5" y="5" width="46" height="8" rx="2" {...solid} />
          <rect x="5" y="16" width="46" height="13" rx="2" {...faint} />
        </>
      ) : null}
      {shape === "below" ? (
        <>
          <rect x="5" y="5" width="46" height="13" rx="2" {...faint} />
          <rect x="5" y="21" width="46" height="8" rx="2" {...solid} />
        </>
      ) : null}
      {shape === "hidden" ? (
        <rect x="5" y="5" width="46" height="24" rx="2" {...faint} />
      ) : null}
      {shape === "with-intro" ? (
        <>
          <rect x="5" y="5" width="16" height="6" rx="2" {...solid} />
          <rect x="5" y="14" width="16" height="15" rx="2" {...faint} />
          <rect x="24" y="5" width="27" height="24" rx="2" {...faint} />
        </>
      ) : null}
      {shape === "top" ? (
        <>
          <rect x="17" y="4" width="22" height="6" rx="3" {...solid} />
          <rect x="5" y="13" width="16" height="16" rx="2" {...faint} />
          <rect x="24" y="13" width="27" height="16" rx="2" {...faint} />
        </>
      ) : null}
      {shape === "none" ? (
        <>
          <rect x="5" y="5" width="16" height="24" rx="2" {...faint} />
          <rect x="24" y="5" width="27" height="24" rx="2" {...faint} />
        </>
      ) : null}
    </svg>
  );
}

/**
 * A row of arrangements, each drawn as the shape it makes.
 *
 * These were two selects. Five arrangements described one at a time in
 * words, with the page they describe in another tab -- choosing meant
 * reading, guessing, saving and going to look. Drawn, they are all there at
 * once and the preview beside them settles it.
 */
function LayoutTiles({
  label,
  options,
  value,
  disabled,
  onPick,
}: {
  label: string;
  options: readonly { value: string; label: string; shape: string }[];
  value: string;
  disabled: boolean;
  onPick: (next: string) => void;
}) {
  return (
    <s-stack direction="block" gap="small-300">
      <s-text type="strong">{label}</s-text>
      <s-grid
        gridTemplateColumns={`repeat(${options.length}, minmax(0, 1fr))`}
        gap="small-300"
      >
        {options.map((option) => {
          const on = option.value === value;

          return (
            <s-clickable
              key={option.value}
              padding="small-200"
              borderWidth="base"
              borderColor={on ? "strong" : "base"}
              borderRadius="base"
              background={on ? "strong" : "transparent"}
              disabled={disabled}
              accessibilityLabel={`${label}: ${option.label}`}
              onClick={() => onPick(option.value)}
            >
              <s-stack direction="block" gap="small-400" alignItems="center">
                <Diagram shape={option.shape} />
                <s-text color={on ? undefined : "subdued"}>
                  {option.label}
                </s-text>
              </s-stack>
            </s-clickable>
          );
        })}
      </s-grid>
    </s-stack>
  );
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
export function BrandingPanel({
  settings,
  text,
}: {
  settings: MerchantSettings;
  text: Record<string, string>;
}) {
  const { showToast } = useToast();
  const branding = useSaveBranding();
  const logo = useSaveBrandLogo();
  const claimText = useSaveClaimText();
  const preview = useClaimPreview();

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

  /*
   * The merchant's own blocks, held locally for the same reason the fields
   * above are: typing should not save on every keystroke.
   *
   * Seeded once, unlike the fields above, and deliberately. Those are single
   * controls whose value the server may refuse and correct; these are four
   * boxes a merchant tabs between. Re-seeding on every refetch meant the save
   * that fires when you leave the heading landed while you were already
   * typing the body -- and replaced what you had typed with the empty string
   * the server still had. The panel unmounts when the tab changes, so a
   * remount picks up whatever was saved.
   */
  const [own, setOwn] = useState<Record<string, string>>(text);

  const busy = branding.isPending || logo.isPending || claimText.isPending;

  const saveText = (key: string, value: string) => {
    if (value.trim() === (text[key] ?? "")) return;

    claimText.mutate(
      { [key]: value },
      {
        onSuccess: () =>
          showToast(value.trim() === "" ? "Text removed" : "Text saved"),
        onError: (cause: Error) => showToast(cause.message, { isError: true }),
      },
    );
  };

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

  /** The file the merchant uploaded, named as they would recognise it. */
  const logoName = settings.brandLogoUrl
    ? decodeURIComponent(
        (settings.brandLogoUrl.split("?")[0].split("/").pop() ?? "").trim(),
      )
    : "";

  return (
    <s-grid
      // The comma separates the query from the fallback, so a minmax() in
      // here splits the value and the whole thing stops parsing -- which is
      // why the preview sat under the settings on a column twice this wide.
      gridTemplateColumns="@container (inline-size <= 640px) 1fr, 1fr 380px"
      gap="base"
    >
      <s-stack direction="block" gap="base">
        {/* A card per question, rather than one card with rules across it.
          A merchant scanning the page should be able to tell what each group
          is for without reading a field label first -- "Colours" answers that
          from the heading, "Identity" as a line of small text inside a longer
          card did not. Leave anything blank and that part keeps the page's
          own design. */}
        <Card heading="Shop name and logo" boxed>
          <s-paragraph color="subdued">
            Who the page says it belongs to.
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

          {/*
            One logo, one control. The drop zone only exists while there is no
            logo; once there is one, what shows is that logo and the way to
            take it off. It used to sit there afterwards saying "Replace logo",
            which read as somewhere to add another -- and the page only ever
            shows one. Changing it is remove, then upload: two steps, but never
            a question about how many there are.

            Bounded now. The thumbnail and the button used to sit loose on the
            page with nothing holding them, which is what made this the most
            unfinished-looking part of the panel.
          */}
          {settings.brandLogoUrl ? (
            <s-stack direction="block" gap="small-300">
              <s-text type="strong">Logo</s-text>
              <s-box
                padding="base"
                borderWidth="base"
                borderColor="base"
                borderRadius="base"
                background="subdued"
              >
                <s-stack direction="inline" gap="base" alignItems="center">
                  <s-thumbnail src={settings.brandLogoUrl} alt="" size="base" />
                  <s-box>
                    <s-stack direction="block" gap="none">
                      <s-text type="strong">{logoName}</s-text>
                      <s-text color="subdued">On your Shopify files</s-text>
                    </s-stack>
                  </s-box>
                  <s-button
                    variant="secondary"
                    tone="critical"
                    loading={logo.isPending}
                    disabled={busy}
                    onClick={() =>
                      logo.mutate("", {
                        onSuccess: () => showToast("Logo removed"),
                        onError: (cause: Error) =>
                          showToast(cause.message, { isError: true }),
                      })
                    }
                  >
                    Remove
                  </s-button>
                </s-stack>
              </s-box>
              <s-text color="subdued">
                Remove this one to upload a different logo.
              </s-text>
            </s-stack>
          ) : (
            <s-stack direction="block" gap="small-300">
              <s-drop-zone
                label="Logo"
                name="logo"
                accept={ACCEPT}
                disabled={busy}
                onChange={(event) => {
                  const zone = event.currentTarget as unknown as DropZoneFiles;
                  const picked = zone.files?.[0];

                  // Cleared so picking the same file twice still fires a
                  // change. The setter refuses anything but "" or null.
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
          )}
        </Card>

        <Card heading="Colours" boxed>
          <s-paragraph color="subdued">
            Two colours. Every other shade on the page is worked out from them.
          </s-paragraph>

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
        </Card>

        <Card heading="Layout" boxed>
          <s-paragraph color="subdued">
            Where each part of the page sits. Pick a tile and watch the preview.
          </s-paragraph>

          {/* Its own control because it is its own choice. The logo and name
            used to travel with the introduction, so a merchant who wanted
            their name across the top had to send the heading and paragraph up
            there too. "With the introduction" is not offered while there is
            no introduction to sit with -- the server settles that pair as
            well, so the page can never end up with the name nowhere. */}
          {/* Its own control because it is its own choice. The logo and name
            used to travel with the introduction, so a merchant who wanted
            their name across the top had to send the heading and paragraph up
            there too. "With the intro" is not offered while there is no
            introduction to sit with -- the server settles that pair as well,
            so the page can never end up with the name nowhere. */}
          <LayoutTiles
            label="Shop name and logo"
            value={settings.claimBrandPosition}
            disabled={busy}
            options={
              settings.claimStoryPosition === "hidden"
                ? BRAND_POSITIONS.filter((o) => o.value !== "with-intro")
                : BRAND_POSITIONS
            }
            onPick={(next) =>
              save(
                { claimBrandPosition: next },
                `Shop name ${
                  BRAND_POSITIONS.find(
                    (o) => o.value === next,
                  )?.label.toLowerCase() ?? next
                }`,
              )
            }
          />

          <LayoutTiles
            label="Introduction"
            value={settings.claimStoryPosition}
            disabled={busy}
            options={POSITIONS}
            onPick={(next) =>
              save(
                { claimStoryPosition: next },
                `Introduction ${
                  POSITIONS.find(
                    (o) => o.value === next,
                  )?.label.toLowerCase() ?? next
                }`,
              )
            }
          />

          {settings.claimStoryPosition !== "hidden" ? (
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
          ) : null}
        </Card>

        <Card heading="Your own text" boxed>
          <s-paragraph color="subdued">
            Anything you want customers to read before they file a claim — how
            long it takes, what you cover, what to have ready. Leave a block
            empty and the page does not draw it.
          </s-paragraph>

          {/* The introduction's block lives inside the introduction, so hiding
            one hides the other. Offering the fields anyway would let a
            merchant write something the page has already been told not to
            draw -- the same dead pair as "sit with the introduction" and "no
            introduction", handled the same way rather than left to be found
            on the storefront. */}
          {settings.claimStoryPosition === "hidden" ? (
            <s-text color="subdued">
              A second block sits with the introduction. It is available once
              the introduction is shown.
            </s-text>
          ) : null}

          {OWN_TEXT.filter(
            (block) =>
              block.slot !== "intro" ||
              settings.claimStoryPosition !== "hidden",
          ).map((block) => {
            const titleKey = `custom.${block.slot}.title`;
            const bodyKey = `custom.${block.slot}.body`;

            return (
              <s-box
                key={block.slot}
                padding="base"
                borderWidth="base"
                borderColor="base"
                borderRadius="base"
              >
                <s-stack direction="block" gap="small-300">
                  <s-text type="strong">{block.heading}</s-text>
                  <s-text-field
                    label="Heading"
                    name={titleKey}
                    value={own[titleKey] ?? ""}
                    maxLength={TITLE_MAX}
                    details={block.details}
                    onInput={(event) => {
                      // Read now, not inside the updater: React defers that
                      // function, and the DOM has reset currentTarget to null
                      // by the time it runs. Every other handler here reads
                      // the value straight out of the event, which is why only
                      // these two threw.
                      const next = event.currentTarget.value ?? "";

                      setOwn((current) => ({ ...current, [titleKey]: next }));
                    }}
                    onBlur={() => saveText(titleKey, own[titleKey] ?? "")}
                  />
                  <s-text-area
                    label="Text"
                    name={bodyKey}
                    rows={3}
                    value={own[bodyKey] ?? ""}
                    maxLength={BODY_MAX}
                    onInput={(event) => {
                      const next = event.currentTarget.value ?? "";

                      setOwn((current) => ({ ...current, [bodyKey]: next }));
                    }}
                    onBlur={() => saveText(bodyKey, own[bodyKey] ?? "")}
                  />
                </s-stack>
              </s-box>
            );
          })}

          {/* Plain text on purpose, and the merchant should know why their
            formatting did not survive: this page is on their own domain and a
            shopper types an order number and an email into it. */}
          <s-text color="subdued">
            Plain text only. Saved in your default language — translate it under
            Languages.
          </s-text>
        </Card>
      </s-stack>

      {/*
        The claim page itself, not a drawing of it.
        
        There used to be no preview here, and the reason given was that
        sketching the page would mean painting two arbitrary merchant hex
        values as inline styles in the admin. That holds for a sketch. This is
        the page, rendered by the view the storefront serves, so it carries
        its own stylesheet and its own colours and cannot drift from the real
        thing -- the same reason the trust badge preview mirrors the extension.

        Sandboxed with no allow-scripts: the server render is already the state
        worth showing, and the sandbox stops the page fetching anything. Kept
        in a frame rather than the admin's DOM because it brings `body {}` and
        `button {}` rules that would restyle the admin around it.
      */}
      <Card heading="Preview" boxed>
        {preview.isPending ? (
          <s-text color="subdued">Building the page…</s-text>
        ) : preview.data ? (
          <div className="app-claim-preview">
            <iframe
              className="app-claim-preview__frame"
              srcDoc={preview.data.html}
              sandbox=""
              title="The claim page as customers see it"
              loading="lazy"
            />
          </div>
        ) : (
          <s-text color="subdued">
            The preview could not be built. The claim page itself is unaffected.
          </s-text>
        )}

        <s-paragraph color="subdued">
          <s-link href={claimPage} target="_blank">
            Open the claim page
          </s-link>{" "}
          to see it at full size.
        </s-paragraph>
      </Card>
    </s-grid>
  );
}
