<script lang="ts">
  import { UploadIcon, DownloadIcon, CheckCircleIcon, PlusIcon } from "@/components/icons/Icons";
  import Icon from "@/components/icons/Icon.svelte";
  import Button from "@/components/ui/Button.svelte";
  import ErrorText from "@/components/ui/ErrorText.svelte";
  import { SELECT_CLASS, TEXTAREA_CODE_CLASS } from "@/components/ui/inputStyles";
  import { PLUGIN_BOILERPLATES } from "@/features/plugins/communityTemplates";
  import type { PluginManifest, Contribution } from "@/features/plugins/types";
  import { useTranslation } from "@/i18n/i18n.svelte";
  import { triggerDownload } from "@/utils/download";

  let {
    code,
    busy,
    error,
    validationSuccess,
    onChangeCode,
    onTestCode,
    onSavePlugin,
  }: {
    code: string;
    busy: boolean;
    error: string | null;
    validationSuccess: { manifest: PluginManifest; contributions: Contribution[] } | null;
    onChangeCode: (newCode: string) => void;
    onTestCode: () => void;
    onSavePlugin: () => void;
  } = $props();

  const { t } = useTranslation();
  let fileInput: HTMLInputElement | undefined = $state();
</script>

<div class="flex flex-col gap-3">
  <div class="flex flex-wrap items-center justify-between gap-2">
    <div class="flex items-center gap-2">
      <span class="text-xs font-semibold text-text">{t("plugins.starterTemplate")}</span>
      <select
        class={`${SELECT_CLASS} max-w-[280px] text-xs`}
        onchange={(e) => {
          const found = PLUGIN_BOILERPLATES.find((b) => b.id === e.currentTarget.value);
          if (found) onChangeCode(found.code);
        }}
      >
        {#each PLUGIN_BOILERPLATES as b (b.id)}
          <option value={b.id}>{b.label}</option>
        {/each}
      </select>
    </div>

    <div class="flex items-center gap-2">
      <input
        bind:this={fileInput}
        type="file"
        accept=".js,.txt"
        class="hidden"
        onchange={async (e) => {
          const file = e.currentTarget.files?.[0];
          e.currentTarget.value = "";
          if (file) onChangeCode(await file.text());
        }}
      />
      <Button size="sm" onclick={() => fileInput?.click()}>
        <Icon icon={UploadIcon} size={13} />
        {t("plugins.chooseFile")}
      </Button>
      <Button
        size="sm"
        variant="ghost"
        onclick={() => {
          const blob = new Blob([code], { type: "text/javascript" });
          triggerDownload(URL.createObjectURL(blob), "my-plugin.js", true);
        }}
      >
        <Icon icon={DownloadIcon} size={13} />
        {t("plugins.exportJs")}
      </Button>
    </div>
  </div>

  <textarea
    class={`${TEXTAREA_CODE_CLASS} h-72 w-full font-mono text-xs leading-relaxed`}
    value={code}
    oninput={(e) => onChangeCode(e.currentTarget.value)}
    placeholder={"athanor.plugin({ id: 'me.custom', name: 'Mon Plugin' });\\n..."}
  ></textarea>

  <!-- Validation & Actions Footer -->
  <div class="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border bg-surface-raised p-3">
    <div class="flex items-center gap-2">
      <Button variant="ghost" size="sm" onclick={onTestCode} disabled={busy || !code.trim()}>
        <Icon icon={CheckCircleIcon} size={13} />
        {t("plugins.testAndValidate")}
      </Button>
    </div>

    <div class="flex items-center gap-2">
      <Button variant="primary" size="sm" onclick={onSavePlugin} disabled={busy || !code.trim()}>
        <Icon icon={PlusIcon} size={13} />
        {t("plugins.saveAndInstall")}
      </Button>
    </div>
  </div>

  {#if validationSuccess}
    <div class="rounded-xl border border-success/30 bg-success-light/30 p-3 text-xs text-text">
      <div class="flex items-center gap-2 font-bold text-success">
        <Icon icon={CheckCircleIcon} size={14} />
        {t("plugins.validationSuccess")}
      </div>
      <div class="mt-1 flex flex-wrap gap-2 text-text-secondary">
        <span>{t("plugins.idLabel")} <strong>{validationSuccess.manifest.id}</strong></span>
        <span>{t("plugins.nameLabel")} <strong>{validationSuccess.manifest.name}</strong></span>
        <span>{t("plugins.contributionsLabel")} <strong>{validationSuccess.contributions.length}</strong></span>
      </div>
    </div>
  {/if}

  {#if error}<ErrorText>{error}</ErrorText>{/if}
</div>
