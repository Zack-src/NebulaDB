<script lang="ts">
  import Modal from "@/components/overlays/Modal.svelte";
  import DeploymentPanel from "./DeploymentPanel.svelte";
  import { useTranslation } from "@/i18n/i18n.svelte";
  let {
    projectId,
    initialConnectionId,
    onClose,
  }: { projectId: string; initialConnectionId?: string | null; onClose: () => void } = $props();
  const { t } = useTranslation();
</script>

<Modal title={t("deployment.checkDifferencesTitle")} {onClose} wide>
  <DeploymentPanel {projectId} {initialConnectionId} readOnly />
</Modal>
