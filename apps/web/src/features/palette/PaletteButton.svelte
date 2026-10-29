<script lang="ts">
  import Icon from "@/components/icons/Icon.svelte";
  import { SearchIcon } from "@/components/icons/Icons";
  import Button from "@/components/ui/Button.svelte";
  import { useTranslation } from "@/i18n/i18n.svelte";
  import { OPEN_PALETTE_EVENT } from "@/features/palette/paletteEvents";

  /** Visible entry point to the global palette (Ctrl/Cmd+K), for people who don't know the shortcut. */
  const { t } = useTranslation();
  const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
  const shortcut = isMac ? "⌘K" : "Ctrl+K";
</script>

<Button
  variant="ghost"
  size="sm"
  onclick={() => window.dispatchEvent(new CustomEvent(OPEN_PALETTE_EVENT))}
  data-tooltip={t("palette.title")}
  data-tooltip-pos="bottom"
  aria-label={t("palette.title")}
  aria-keyshortcuts="Control+K Meta+K"
>
  <Icon icon={SearchIcon} size={14} />
  <kbd class="hidden rounded-sm border border-border px-1 font-sans text-micro text-text-muted md:inline">{shortcut}</kbd>
</Button>
