<script lang="ts">
  import { useTranslation } from "@/i18n/i18n.svelte";
  import Button from "@/components/ui/Button.svelte";
  import Badge from "@/components/ui/Badge.svelte";
  import ErrorText from "@/components/ui/ErrorText.svelte";
  import Hint from "@/components/ui/Hint.svelte";
  import Card from "@/components/ui/Card.svelte";
  import CardBody from "@/components/ui/CardBody.svelte";
  import CardHeader from "@/components/ui/CardHeader.svelte";
  import Field from "@/components/ui/Field.svelte";
  import Input from "@/components/ui/Input.svelte";
  import List from "@/components/ui/List.svelte";
  import ListRow from "@/components/ui/ListRow.svelte";
  import ListMain from "@/components/ui/ListMain.svelte";
  import EmptyState from "@/components/ui/EmptyState.svelte";
  import Skeleton from "@/components/ui/Skeleton.svelte";
  import SkeletonCard from "@/components/ui/SkeletonCard.svelte";
  import SkeletonCardGrid from "@/components/ui/SkeletonCardGrid.svelte";
  import Tabs, { type TabItem } from "@/components/ui/Tabs.svelte";
  import BrandMark from "@/components/ui/BrandMark.svelte";
  import Checkbox from "@/components/ui/Checkbox.svelte";
  import DataGrid from "@/components/ui/DataGrid.svelte";
  import type { GridSort } from "@/components/ui/dataGrid";
  import Menu from "@/components/ui/Menu.svelte";
  import MenuItem from "@/components/ui/MenuItem.svelte";
  import NumberInput from "@/components/ui/NumberInput.svelte";
  import PasswordInput from "@/components/ui/PasswordInput.svelte";
  import Popover from "@/components/ui/Popover.svelte";
  import RadioGroup from "@/components/ui/RadioGroup.svelte";
  import SegmentedControl from "@/components/ui/SegmentedControl.svelte";
  import Select, { type SelectOption } from "@/components/ui/Select.svelte";
  import Switch from "@/components/ui/Switch.svelte";
  import TextArea from "@/components/ui/TextArea.svelte";
  import { toast } from "@/components/ui/toast.svelte";
  import ConfirmDialog from "@/components/overlays/ConfirmDialog.svelte";
  import Icon from "@/components/icons/Icon.svelte";
  import {
    CheckIcon,
    CopyIcon,
    DatabaseIcon,
    PencilIcon,
    SearchIcon,
    TableIcon,
    TrashIcon,
  } from "@/components/icons/Icons";
  import { applyThemePreset, type ThemePreset } from "@/utils/theme";
  import Section from "./CatalogueSection.svelte";

  const ENGINE_OPTIONS: SelectOption<string>[] = [
    { value: "postgres", label: "PostgreSQL", icon: DatabaseIcon },
    { value: "mysql", label: "MySQL / MariaDB", icon: DatabaseIcon },
    { value: "mssql", label: "SQL Server", icon: DatabaseIcon },
    { value: "oracle", label: "Oracle", icon: DatabaseIcon, disabled: true },
    { value: "sqlite", label: "SQLite", icon: DatabaseIcon, hint: "Fichier local" },
  ];

  const TYPE_OPTIONS: SelectOption<string>[] = [
    ...["smallint", "integer", "bigint", "numeric", "real"].map((value) => ({ value, label: value, group: "Nombres" })),
    ...["char", "varchar", "text", "uuid"].map((value) => ({ value, label: value, group: "Texte" })),
    ...["date", "time", "timestamp", "interval"].map((value) => ({ value, label: value, group: "Dates" })),
    ...["boolean", "json", "jsonb", "bytea"].map((value) => ({ value, label: value, group: "Autres" })),
  ];

  const LOCK_LEVELS = [
    { value: "structure", label: "Structure", hint: "Seuls les admins modifient colonnes et types." },
    { value: "full", label: "Complet", hint: "Structure, données initiales et suppression." },
    { value: "none", label: "Aucun", disabled: true },
  ];

  const DENSITIES = [
    { value: "comfortable", label: "Confortable" },
    { value: "compact", label: "Compacte" },
    { value: "dense", label: "Dense", disabled: true },
  ];

  const SYNC_DELAYS = [
    { value: 400, label: "0,4 s" },
    { value: 1000, label: "1 s" },
    { value: 0, label: "Ctrl+S" },
  ];

  const BUTTON_VARIANTS = ["default", "primary", "gradient", "glow", "outline", "ghost", "danger", "danger-ghost"] as const;
  const BUTTON_SIZES = ["lg", "md", "sm", "xs"] as const;
  const BADGE_TONES = ["admin", "muted", "warning", "success", "danger"] as const;
  const CARD_VARIANTS = ["default", "glass", "glow", "outline"] as const;
  const TABS_VARIANTS = ["pill", "line", "boxed"] as const;

  /**
   * 10 000 rows × 20 columns, the same on every load: what `DataGrid` has to
   * stay smooth with. NULLs, numbers kept as text, and text longer than its
   * column are all in there on purpose.
   */
  const GRID_ROW_COUNT = 10_000;
  const GRID_COUNTRIES = ["France", "Belgique", "Suisse", "Canada", "Sénégal", "Maroc"];
  const GRID_STATUSES = ["payée", "en attente", "expédiée", "annulée"];
  const GRID_COLUMNS = [
    "id",
    "client",
    "pays",
    "statut",
    "montant",
    "quantite",
    "remise",
    "cree_le",
    "note",
    "expedie",
    ...Array.from({ length: 10 }, (_, index) => `mesure_${index + 1}`),
  ];
  const pad = (value: number, length: number) => String(value).padStart(length, "0");
  const GRID_ROWS: unknown[][] = Array.from({ length: GRID_ROW_COUNT }, (_, index) => {
    const id = index + 1;
    const mixed = (id * 7919) % 10_007;
    return [
      id,
      `Client ${pad(mixed, 5)}`,
      GRID_COUNTRIES[mixed % GRID_COUNTRIES.length],
      GRID_STATUSES[mixed % GRID_STATUSES.length],
      (mixed / 7).toFixed(2),
      (mixed % 40) + 1,
      id % 3 === 0 ? null : (mixed % 9) * 5,
      `2026-${pad((mixed % 12) + 1, 2)}-${pad((mixed % 28) + 1, 2)} 08:${pad(mixed % 60, 2)}`,
      id % 5 === 0 ? null : `Commande n° ${id} — à livrer avant la fin du mois, sans signature, laisser au gardien si absent.`,
      mixed % 2 === 0,
      ...Array.from({ length: 10 }, (_, column) => ((mixed * (column + 3)) % 1000) / 10),
    ];
  });

  const DEMO_TABS: TabItem[] = [
    { id: "one", label: "Général" },
    { id: "two", label: "Sécurité", badge: 2 },
    { id: "three", label: "Avancé" },
  ];

  /**
   * A visual gallery of every `components/ui/` primitive — one screen, every
   * variant, both themes reachable from the same toggle at the top.
   *
   * Deliberately not Storybook: this app already has an established pattern
   * for exactly this need (`features/editor/bench`'s `/#bench` route — a real,
   * lazy-loaded page mounted outside auth) rather than a second build
   * toolchain and dev server bolted on for one page. Keeping it in-repo, in the
   * same stack as everything else, is the same call `#bench` made — see
   * `docs/todo.md`'s "Component catalogue" item for why this exists.
   *
   * Routed at `/#components` from `main.ts`, same shape as `/#bench`.
   */
  const { t } = useTranslation();
  let theme = $state<ThemePreset>("obsidian");
  let tab = $state<string>("one");
  let inputValue = $state("");

  let engine = $state("postgres");
  let columnType = $state<string | undefined>(undefined);
  let alerts = $state(true);
  let lockLevel = $state("structure");
  let snapToGrid = $state(true);
  let density = $state("comfortable");
  let syncDelay = $state(400);
  let timeout = $state<number | null>(5);
  let password = $state("");
  let note = $state("");
  let showGrid = $state(true);
  let lastMenuAction = $state("—");
  let popoverOpen = $state(false);
  let popoverAnchor: HTMLButtonElement | null = $state(null);
  let confirming = $state<"plain" | "danger" | null>(null);
  let gridSort = $state<GridSort | null>(null);
  let gridWidths = $state<number[] | undefined>(undefined);
  const gridState = $derived(
    `${gridSort ? `${GRID_COLUMNS[gridSort.column]} ${gridSort.direction}` : "—"} · ${gridWidths ? gridWidths.slice(0, 4).join(" / ") : "auto"}`,
  );

  function setPreset(preset: ThemePreset) {
    theme = preset;
    applyThemePreset(preset);
  }
</script>

<div class="min-h-screen bg-bg-canvas px-6 py-8 text-text">
  <div class="mx-auto flex max-w-4xl flex-col gap-8">
    <header class="flex items-center justify-between gap-4 border-b border-border pb-6">
      <div class="flex items-center gap-3">
        <BrandMark />
        <div>
          <h1 class="text-base font-bold text-text">{t("componentCatalogue.title")}</h1>
          <p class="text-[12.5px] text-text-muted">{t("componentCatalogue.subtitle")}</p>
        </div>
      </div>
      <div class="flex gap-1.5">
        <Button variant={theme === "obsidian" ? "primary" : "outline"} size="sm" onclick={() => setPreset("obsidian")}>
          {t("componentCatalogue.themeDark")}
        </Button>
        <Button variant={theme === "light" ? "primary" : "outline"} size="sm" onclick={() => setPreset("light")}>
          {t("componentCatalogue.themeLight")}
        </Button>
      </div>
    </header>

    <Section title="Button" description="8 variantes × 4 tailles, plus l'état désactivé et actif.">
      <div class="flex flex-col gap-2.5">
        {#each BUTTON_VARIANTS as variant (variant)}
          <div class="flex flex-wrap items-center gap-3">
            <span class="w-24 shrink-0 text-[11.5px] text-text-muted">{variant}</span>
            {#each BUTTON_SIZES as size (size)}
              <Button {variant} {size}>{size}</Button>
            {/each}
            <Button {variant} size="sm" active>{t("componentCatalogue.active")}</Button>
            <Button {variant} size="sm" disabled>{t("componentCatalogue.disabled")}</Button>
            <Button {variant} size="icon-sm" data-tooltip="Supprimer">
              <Icon icon={TrashIcon} size={14} />
            </Button>
          </div>
        {/each}
      </div>
    </Section>

    <Section title="Badge">
      <div class="flex flex-wrap items-center gap-3">
        {#each BADGE_TONES as tone (tone)}
          <Badge {tone}>{tone}</Badge>
        {/each}
      </div>
    </Section>

    <Section title="Card" description="4 variantes ; `interactive` ajoute le hover-lift.">
      <div class="grid grid-cols-2 gap-4">
        {#each CARD_VARIANTS as variant (variant)}
          <Card {variant} interactive={variant === "default"}>
            <CardHeader>
              <span class="text-[12.5px] font-semibold text-text">{variant}</span>
            </CardHeader>
            <CardBody>
              <p class="text-[12.5px] text-text-muted">
                {variant === "default" ? "interactive (survolez-moi)" : "contenu de démonstration"}
              </p>
            </CardBody>
          </Card>
        {/each}
      </div>
    </Section>

    <Section title="Alert">
      <div class="flex flex-col gap-2">
        <Hint>{t("componentCatalogue.hintExample")}</Hint>
        <ErrorText>{t("componentCatalogue.errorExample")}</ErrorText>
      </div>
    </Section>

    <Section title="Field / Input" description="Trois tailles, icône optionnelle, état invalide.">
      <div class="grid max-w-sm grid-cols-1 gap-3">
        <Field label="Nom du projet" hint="Visible par toute l'équipe." bind:value={inputValue} />
        <Field label="Avec erreur" error="Ce champ est requis." />
        <Input inputSize="sm" placeholder="Rechercher…">
          {#snippet icon()}<Icon icon={SearchIcon} size={13} />{/snippet}
        </Input>
        <Input inputSize="xs" placeholder="xs, avec adornment">
          {#snippet trailing()}<Icon icon={CheckIcon} size={12} />{/snippet}
        </Input>
      </div>
    </Section>

    <Section title="List">
      <div class="max-w-sm">
        <List>
          <ListRow>
            <ListMain>{t("componentCatalogue.listRowExample")}</ListMain>
            <Badge tone="success">{t("componentCatalogue.listRowStatus")}</Badge>
          </ListRow>
          <ListRow>
            <ListMain as="button" onclick={() => {}}>{t("componentCatalogue.listRowClickable")}</ListMain>
          </ListRow>
        </List>
      </div>
      <div class="mt-3 max-w-sm">
        <EmptyState>{t("componentCatalogue.emptyState")}</EmptyState>
      </div>
    </Section>

    <Section title="Skeleton" description="Placeholders de chargement — jamais dérivés d'un tableau vide.">
      <div class="flex flex-col gap-3">
        <Skeleton class="h-4 w-48" />
        <SkeletonCard />
      </div>
      <div class="mt-2">
        <SkeletonCardGrid count={3} />
      </div>
    </Section>

    <Section
      title="Tabs"
      description="Trois formes : pill (filtre autonome), line (en-tête de page), boxed (switch encarté)."
    >
      <div class="flex flex-col gap-4">
        {#each TABS_VARIANTS as variant (variant)}
          <Tabs tabs={DEMO_TABS} activeTab={tab} onChange={(next) => (tab = next)} {variant} />
        {/each}
      </div>
    </Section>

    <Section
      title="Select"
      description="Remplace <select>. Icônes, indices, options désactivées ; champ de recherche et groupes au-delà de 8 options. Clavier : flèches, Début / Fin, Entrée, Échap, saisie d'une lettre."
    >
      <div class="grid max-w-xl grid-cols-2 gap-3">
        <Select bind:value={engine} options={ENGINE_OPTIONS} aria-label="Moteur" class="w-full" />
        <Select
          bind:value={columnType}
          options={TYPE_OPTIONS}
          placeholder="Type de colonne"
          aria-label="Type de colonne"
          class="w-full"
        />
        <Select bind:value={engine} options={ENGINE_OPTIONS} size="sm" aria-label="Moteur (sm)" class="w-full" />
        <Select bind:value={engine} options={ENGINE_OPTIONS} size="xs" aria-label="Moteur (xs)" class="w-full" />
        <Select value="postgres" options={ENGINE_OPTIONS} disabled aria-label="Moteur (désactivé)" class="w-full" />
        <Select
          bind:value={columnType}
          options={TYPE_OPTIONS}
          invalid
          placeholder="Invalide"
          aria-label="Type (invalide)"
          class="w-full"
        />
      </div>
      <p class="text-label text-text-muted">{t("componentCatalogue.lastValue", { value: `${engine} · ${columnType ?? "—"}` })}</p>
    </Section>

    <Section
      title="Menu"
      description="N'importe quel bouton comme déclencheur. Entrées avec icône, raccourci, état coché, danger, désactivé."
    >
      <div class="flex items-center gap-4">
        <Menu aria-label="Actions">
          {#snippet trigger(props)}
            <Button {...props} variant="outline" size="sm">{t("componentCatalogue.menuTrigger")}</Button>
          {/snippet}
          <MenuItem icon={PencilIcon} shortcut="F2" onSelect={() => (lastMenuAction = "rename")}>{t("common.rename")}</MenuItem>
          <MenuItem icon={CopyIcon} shortcut="Ctrl+D" onSelect={() => (lastMenuAction = "copy")}>{t("common.copy")}</MenuItem>
          <MenuItem checked={showGrid} keepOpen onSelect={() => (showGrid = !showGrid)}>
            {t("componentCatalogue.menuShowGrid")}
          </MenuItem>
          <MenuItem icon={TableIcon} disabled onSelect={() => {}}>{t("componentCatalogue.menuLocked")}</MenuItem>
          <MenuItem icon={TrashIcon} danger onSelect={() => (lastMenuAction = "delete")}>{t("common.delete")}</MenuItem>
        </Menu>
        <span class="text-label text-text-muted">{t("componentCatalogue.lastValue", { value: lastMenuAction })}</span>
      </div>
    </Section>

    <Section title="Checkbox / RadioGroup" description="Cases dessinées sur de vrais <input> masqués : libellé, clavier et lecteur d'écran natifs.">
      <div class="grid max-w-xl grid-cols-2 gap-6">
        <div class="flex flex-col gap-2">
          <Checkbox bind:checked={alerts} hint="Un message par détection, pas par table.">
            {t("componentCatalogue.checkboxLabel")}
          </Checkbox>
          <Checkbox indeterminate>{t("componentCatalogue.checkboxIndeterminate")}</Checkbox>
          <Checkbox invalid>{t("componentCatalogue.errorExample")}</Checkbox>
          <Checkbox checked disabled>{t("componentCatalogue.checkboxDisabled")}</Checkbox>
        </div>
        <RadioGroup bind:value={lockLevel} options={LOCK_LEVELS} aria-label="Niveau de verrou" />
      </div>
    </Section>

    <Section title="Switch / SegmentedControl" description="Réglages à effet immédiat. Le segment est un groupe radio : une tabulation, flèches pour changer.">
      <div class="flex flex-col gap-3">
        <div class="flex items-center gap-4">
          <Switch bind:checked={snapToGrid} aria-label="Aimanter à la grille" />
          <Switch bind:checked={snapToGrid} size="sm" aria-label="Aimanter à la grille (sm)" />
          <Switch checked disabled aria-label="Désactivé" />
        </div>
        <div class="flex flex-wrap items-center gap-4">
          <SegmentedControl bind:value={density} options={DENSITIES} aria-label="Densité" />
          <SegmentedControl bind:value={syncDelay} options={SYNC_DELAYS} size="sm" aria-label="Délai de synchronisation" />
          <SegmentedControl bind:value={syncDelay} options={SYNC_DELAYS} size="xs" aria-label="Délai (xs)" />
        </div>
      </div>
    </Section>

    <Section title="NumberInput / PasswordInput / TextArea" description="Pas-à-pas et unité, afficher / masquer, hauteur automatique.">
      <div class="grid max-w-xl grid-cols-2 gap-3">
        <NumberInput bind:value={timeout} min={1} max={60} unit="s" aria-label="Délai maximal" class="w-full" />
        <NumberInput value={0.5} step={0.1} min={0} max={1} inputSize="sm" aria-label="Opacité" class="w-full" />
        <PasswordInput bind:value={password} placeholder="Mot de passe" aria-label="Mot de passe" wrapperClassName="w-full" />
        <NumberInput value={3} disabled aria-label="Désactivé" class="w-full" />
        <TextArea bind:value={note} autoGrow rows={2} maxRows={6} placeholder="Note (grandit avec le contenu)" class="col-span-2 w-full" />
        <TextArea variant="code" rows={3} value={"Table users {\n  id bigint [pk]\n}"} aria-label="DBML" class="col-span-2 w-full" />
      </div>
    </Section>

    <Section title="Popover" description="Le moteur de positionnement de Menu et Select, utilisable seul.">
      <div>
        <Button bind:ref={popoverAnchor} variant="outline" size="sm" onclick={() => (popoverOpen = !popoverOpen)}>
          {t("componentCatalogue.popoverOpen")}
        </Button>
        <Popover open={popoverOpen} anchor={popoverAnchor} onClose={() => (popoverOpen = false)} class="w-64 p-3">
          <p class="m-0 text-body-sm text-text-secondary">{t("componentCatalogue.popoverBody")}</p>
        </Popover>
      </div>
    </Section>

    <Section
      title="DataGrid"
      description="10 000 lignes × 20 colonnes, seules celles à l'écran sont dans le DOM. Clic sur un en-tête : tri croissant, décroissant, aucun (NULL toujours en dernier). Bord droit d'un en-tête : glisser, flèches au clavier, double-clic ou Entrée pour ajuster."
    >
      <DataGrid
        columns={GRID_COLUMNS}
        rows={GRID_ROWS}
        bind:sort={gridSort}
        bind:widths={gridWidths}
        maxHeight={360}
        aria-label="Commandes"
        emptyLabel="Aucune ligne."
      />
      <p class="text-label text-text-muted">{t("componentCatalogue.lastValue", { value: gridState })}</p>
      <div class="max-w-md">
        <DataGrid columns={["id", "nom"]} rows={[]} aria-label="Résultat vide" emptyLabel="Aucune ligne." />
      </div>
    </Section>

    <Section title="Toast" description="Pile en haut à droite ; se met en pause au survol ; une action possible (« Annuler »).">
      <div class="flex flex-wrap gap-2">
        <Button size="sm" onclick={() => toast.info(t("componentCatalogue.toastInfoMessage"))}>
          {t("componentCatalogue.toastInfo")}
        </Button>
        <Button
          size="sm"
          onclick={() =>
            toast.success(t("componentCatalogue.toastUndoMessage"), {
              action: { label: t("common.cancel"), run: () => toast.info(t("componentCatalogue.toastUndone")) },
            })}
        >
          {t("componentCatalogue.toastUndo")}
        </Button>
        <Button size="sm" variant="danger" onclick={() => toast.error(t("componentCatalogue.toastErrorMessage"))}>
          {t("componentCatalogue.toastError")}
        </Button>
      </div>
    </Section>

    <Section title="ConfirmDialog" description="Trois niveaux de danger ; « retapez le nom » pour l'irréversible.">
      <div class="flex flex-wrap gap-2">
        <Button size="sm" onclick={() => (confirming = "plain")}>{t("componentCatalogue.confirmPlain")}</Button>
        <Button size="sm" variant="danger" onclick={() => (confirming = "danger")}>
          {t("componentCatalogue.confirmDanger")}
        </Button>
      </div>
    </Section>
  </div>
</div>

{#if confirming === "plain"}
  <ConfirmDialog
    title={t("componentCatalogue.confirmPlainTitle")}
    message={t("componentCatalogue.confirmPlainMessage")}
    onConfirm={() => (confirming = null)}
    onCancel={() => (confirming = null)}
  />
{:else if confirming === "danger"}
  <ConfirmDialog
    title={t("componentCatalogue.confirmDangerTitle")}
    message={t("componentCatalogue.confirmDangerMessage")}
    danger="danger"
    requireText="orders"
    confirmLabel={t("common.delete")}
    onConfirm={() => (confirming = null)}
    onCancel={() => (confirming = null)}
  />
{/if}
