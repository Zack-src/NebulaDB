<script lang="ts">
  import type { DatabaseEngine } from "@nebuladb/shared";
  import Input from "@/components/ui/Input.svelte";
  import { useTranslation } from "@/i18n/i18n.svelte";
  import RoleDescription from "./RoleDescription.svelte";

  /**
   * An in-page list of roles to pick from, each with its explanation — the
   * name alone says little ("dbcreator", "pg_signal_backend"). Filterable;
   * picking one only reports it, the caller decides what it does.
   */
  let {
    engine,
    roles,
    systemRoles,
    disabled = false,
    onPick,
  }: {
    engine: DatabaseEngine;
    roles: string[];
    /** The subset of `roles` that is built in. */
    systemRoles: ReadonlySet<string>;
    disabled?: boolean;
    onPick: (role: string) => void;
  } = $props();

  const { t } = useTranslation();
  let filter = $state("");
  const shown = $derived(roles.filter((role) => role.toLowerCase().includes(filter.trim().toLowerCase())));
</script>

<div class="space-y-1.5 rounded-md border border-border bg-surface-raised p-2">
  <Input inputSize="sm" class="w-full" bind:value={filter} placeholder={t("dbadmin.users.roleSearch")} autocomplete="off" />
  <div class="max-h-64 space-y-1 overflow-y-auto">
    {#each shown as role (role)}
      <button
        type="button"
        {disabled}
        class="flex w-full flex-col items-start gap-0.5 rounded-sm border border-transparent px-2 py-1.5 text-left transition-colors hover:border-border hover:bg-surface-hover disabled:opacity-40"
        onclick={() => onPick(role)}
      >
        <span class="font-mono text-xs font-semibold">{role}</span>
        <RoleDescription {engine} {role} system={systemRoles.has(role)} />
      </button>
    {/each}
    {#if shown.length === 0}
      <p class="py-3 text-center text-xs text-text-muted">{t("dbadmin.users.roleListEmpty")}</p>
    {/if}
  </div>
</div>
