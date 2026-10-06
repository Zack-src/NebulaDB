<script lang="ts">
  let { name }: { name: string } = $props();
</script>

<span class="account-avatar" aria-hidden="true">{name.charAt(0).toUpperCase()}</span>

<style>
  .account-avatar {
    flex: none;
    width: 28px;
    height: 28px;
    display: grid;
    place-items: center;
    border-radius: 50%;
    background: var(--color-primary-light);
    color: var(--color-primary-text);
    font-size: 11px;
    font-weight: 600;
  }
</style>
