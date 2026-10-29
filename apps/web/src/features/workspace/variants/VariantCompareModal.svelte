<script lang="ts">
  import Modal from "@/components/overlays/Modal.svelte";
  import ErrorText from "@/components/ui/ErrorText.svelte";
  import Select from "@/components/ui/Select.svelte";
  import { useAsyncResource } from "@/hooks/asyncResource.svelte";
  import { useTranslation } from "@/i18n/i18n.svelte";
  import { compareProjects } from "@/services/variantsApi";
  import ProjectDiffList from "./ProjectDiffList.svelte";

  /**
   * One version against another — the original against a client, or two
   * clients against each other. `versions` is everything that can be picked
   * on either side; the comparison is redone whenever a side changes.
   */
  let {
    versions,
    initialLeft,
    initialRight,
    onClose,
  }: {
    versions: { id: string; name: string }[];
    initialLeft: string;
    initialRight: string;
    onClose: () => void;
  } = $props();

  const { t } = useTranslation();
  // svelte-ignore state_referenced_locally
  let left = $state(initialLeft);
  // svelte-ignore state_referenced_locally
  let right = $state(initialRight);
  const options = $derived(versions.map((version) => ({ value: version.id, label: version.name })));
  const nameOf = (id: string) => versions.find((version) => version.id === id)?.name ?? id;

  const diff = useAsyncResource(async () => {
    const [from, to] = [left, right];
    return from === to ? null : await compareProjects(from, to);
  });
</script>

<Modal title={t("variants.compare.title")} {onClose} wide>
  <div class="space-y-4" data-testid="variant-compare">
    <div class="grid grid-cols-2 gap-3">
      <div>
        <div id="compare-left" class="mb-1 text-xs font-medium text-text-muted">{t("variants.compare.left")}</div>
        <Select class="w-full" aria-labelledby="compare-left" value={left} {options} onChange={(value) => (left = value)} />
      </div>
      <div>
        <div id="compare-right" class="mb-1 text-xs font-medium text-text-muted">{t("variants.compare.right")}</div>
        <Select class="w-full" aria-labelledby="compare-right" value={right} {options} onChange={(value) => (right = value)} />
      </div>
    </div>
    {#if left === right}
      <p class="m-0 text-xs text-text-muted">{t("variants.compare.pickTwo")}</p>
    {:else if diff.error}
      <ErrorText>{diff.error}</ErrorText>
    {:else if diff.loading || !diff.data}
      <p class="m-0 text-xs text-text-muted">{t("common.loading")}</p>
    {:else}
      <ProjectDiffList diff={diff.data} left={nameOf(left)} right={nameOf(right)} />
    {/if}
  </div>
</Modal>
