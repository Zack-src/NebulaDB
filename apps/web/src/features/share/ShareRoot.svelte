<script lang="ts">
  import GlobalTooltip from "@/components/overlays/GlobalTooltip.svelte";
  import { i18n } from "@/i18n/i18n.svelte";
  import SharePage from "./SharePage.svelte";

  /**
   * The root of a share link's page, in place of `app/Root.svelte`: the
   * translations and tooltips every page has, and none of the app — no
   * session, no error reporting to the authenticated API.
   */
  i18n.install();
</script>

<SharePage />
<GlobalTooltip />
