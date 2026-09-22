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
  import Icon from "@/components/icons/Icon.svelte";
  import { CheckIcon, SearchIcon, TrashIcon } from "@/components/icons/Icons";
  import { applyThemePreset, type ThemePreset } from "@/utils/theme";
  import Section from "./CatalogueSection.svelte";

  const BUTTON_VARIANTS = ["default", "primary", "gradient", "glow", "outline", "ghost", "danger", "danger-ghost"] as const;
  const BUTTON_SIZES = ["lg", "md", "sm", "xs"] as const;
  const BADGE_TONES = ["admin", "muted", "warning", "success", "danger"] as const;
  const CARD_VARIANTS = ["default", "glass", "glow", "outline"] as const;
  const TABS_VARIANTS = ["pill", "line", "boxed"] as const;

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
  </div>
</div>
