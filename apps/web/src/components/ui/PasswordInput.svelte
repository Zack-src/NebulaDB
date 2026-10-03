<script lang="ts">
  import Icon from "@/components/icons/Icon.svelte";
  import { EyeIcon, EyeOffIcon } from "@/components/icons/Icons";
  import Input, { type InputProps } from "@/components/ui/Input.svelte";
  import { useTranslation } from "@/i18n/i18n.svelte";

  /**
   * A password field with a show / hide toggle. Revealing is per field and is
   * forgotten when the field unmounts — it never becomes a stored preference.
   *
   * The toggle is a real button but sits out of the tab order: between a
   * password and the submit button it would be one more stop on the path every
   * keyboard user takes at each login.
   */
  let { value = $bindable(), ref = $bindable(null), ...rest }: Omit<InputProps, "type" | "trailing"> = $props();

  const { t } = useTranslation();
  let revealed = $state(false);
</script>

<Input bind:value bind:ref type={revealed ? "text" : "password"} autocomplete="current-password" {...rest}>
  {#snippet trailing()}
    <button
      type="button"
      tabindex={-1}
      class="-mr-1 flex h-6 w-6 items-center justify-center rounded-sm text-text-muted hover:bg-surface-hover hover:text-text"
      aria-pressed={revealed}
      aria-label={t(revealed ? "ui.password.hide" : "ui.password.show")}
      data-tooltip={t(revealed ? "ui.password.hide" : "ui.password.show")}
      onclick={() => (revealed = !revealed)}
    >
      <Icon icon={revealed ? EyeOffIcon : EyeIcon} size={14} />
    </button>
  {/snippet}
</Input>
