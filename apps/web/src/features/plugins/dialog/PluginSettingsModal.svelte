<script lang="ts">
  import { untrack } from "svelte";
  import Modal from "@/components/overlays/Modal.svelte";
  import Button from "@/components/ui/Button.svelte";
  import { INPUT_CLASS, SELECT_CLASS } from "@/components/ui/inputStyles";
  import { pluginRegistry } from "@/features/plugins/registry";
  import type { PluginSettingDef, PluginSettingValue, PluginSettings } from "@/features/plugins/types";
  import { useTranslation } from "@/i18n/i18n.svelte";

  let {
    pluginId,
    pluginName,
    settings,
    onClose,
  }: {
    pluginId: string;
    pluginName: string;
    settings: PluginSettingDef[];
    onClose: () => void;
  } = $props();

  const { t } = useTranslation();
  // Seeded once from the registry; edits stay local until "Save".
  let currentValues = $state.raw<PluginSettings>(pluginRegistry.getSettings(untrack(() => pluginId)));

  function handleChange(key: string, val: PluginSettingValue) {
    currentValues = { ...currentValues, [key]: val };
  }

  function handleSave() {
    pluginRegistry.setSettings(pluginId, currentValues);
    onClose();
  }
</script>

<Modal title={`${t("common.settings")} : ${pluginName}`} {onClose}>
  <div class="flex flex-col gap-4 py-2">
    {#each settings as s (s.key)}
      {@const val = currentValues[s.key] ?? s.default}
      <div class="flex flex-col gap-1.5">
        <div class="flex items-center justify-between">
          <!-- svelte-ignore a11y_label_has_associated_control -->
          <label class="text-xs font-semibold text-text">{s.label}</label>
          {#if s.description}<span class="text-[11px] text-text-muted">{s.description}</span>{/if}
        </div>

        {#if s.type === "boolean"}
          <label class="flex cursor-pointer items-center gap-2 text-xs text-text-secondary">
            <input
              type="checkbox"
              class="h-4 w-4 rounded accent-primary cursor-pointer"
              checked={Boolean(val)}
              onchange={(e) => handleChange(s.key, e.currentTarget.checked)}
            />
            <span>{val ? t("plugins.enabled") : t("plugins.disabled")}</span>
          </label>
        {/if}

        {#if s.type === "string"}
          <input
            type="text"
            class={INPUT_CLASS}
            value={String(val ?? "")}
            oninput={(e) => handleChange(s.key, e.currentTarget.value)}
          />
        {/if}

        {#if s.type === "number"}
          <input
            type="number"
            class={INPUT_CLASS}
            value={Number(val ?? 0)}
            oninput={(e) => handleChange(s.key, Number(e.currentTarget.value))}
          />
        {/if}

        {#if s.type === "select" && s.options}
          <select class={SELECT_CLASS} value={String(val ?? "")} onchange={(e) => handleChange(s.key, e.currentTarget.value)}>
            {#each s.options as opt (opt)}
              <option value={opt}>{opt}</option>
            {/each}
          </select>
        {/if}
      </div>
    {/each}

    <div class="mt-4 flex items-center justify-end gap-2 border-t border-border pt-3">
      <Button variant="ghost" onclick={onClose}>
        {t("common.cancel")}
      </Button>
      <Button variant="primary" onclick={handleSave}>
        {t("common.save")}
      </Button>
    </div>
  </div>
</Modal>
