import { useState } from "react";
import { useTranslation } from "@/i18n/useTranslation";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { ErrorText, Hint } from "@/components/ui/Alert";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { Field } from "@/components/ui/Field";
import { Input } from "@/components/ui/Input";
import { List, ListRow, ListMain, EmptyState } from "@/components/ui/List";
import { Skeleton, SkeletonCard, SkeletonCardGrid } from "@/components/ui/Skeleton";
import { Tabs, type TabItem } from "@/components/ui/Tabs";
import { BrandMark } from "@/components/ui/BrandMark";
import { CheckIcon, SearchIcon, TrashIcon } from "@/components/icons/Icons";
import { applyThemePreset, type ThemePreset } from "@/utils/theme";

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

function Section(props: { title: string; description?: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-3 border-b border-border pb-8">
      <div>
        <h2 className="text-sm font-bold text-text">{props.title}</h2>
        {props.description && <p className="mt-0.5 text-[12.5px] text-text-muted">{props.description}</p>}
      </div>
      {props.children}
    </section>
  );
}

function Row(props: { children: React.ReactNode }) {
  return <div className="flex flex-wrap items-center gap-3">{props.children}</div>;
}

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
 * Routed at `/#components` from `main.tsx`, same shape as `/#bench`.
 */
export default function ComponentCatalogue() {
  const { t } = useTranslation();
  const [theme, setTheme] = useState<ThemePreset>("obsidian");
  const [tab, setTab] = useState<string>("one");
  const [inputValue, setInputValue] = useState("");

  const setPreset = (preset: ThemePreset) => {
    setTheme(preset);
    applyThemePreset(preset);
  };

  return (
    <div className="min-h-screen bg-bg-canvas px-6 py-8 text-text">
      <div className="mx-auto flex max-w-4xl flex-col gap-8">
        <header className="flex items-center justify-between gap-4 border-b border-border pb-6">
          <div className="flex items-center gap-3">
            <BrandMark />
            <div>
              <h1 className="text-base font-bold text-text">{t("componentCatalogue.title")}</h1>
              <p className="text-[12.5px] text-text-muted">{t("componentCatalogue.subtitle")}</p>
            </div>
          </div>
          <div className="flex gap-1.5">
            <Button variant={theme === "obsidian" ? "primary" : "outline"} size="sm" onClick={() => setPreset("obsidian")}>
              {t("componentCatalogue.themeDark")}
            </Button>
            <Button variant={theme === "light" ? "primary" : "outline"} size="sm" onClick={() => setPreset("light")}>
              {t("componentCatalogue.themeLight")}
            </Button>
          </div>
        </header>

        <Section title="Button" description="8 variantes × 4 tailles, plus l'état désactivé et actif.">
          <div className="flex flex-col gap-2.5">
            {BUTTON_VARIANTS.map((variant) => (
              <Row key={variant}>
                <span className="w-24 shrink-0 text-[11.5px] text-text-muted">{variant}</span>
                {BUTTON_SIZES.map((size) => (
                  <Button key={size} variant={variant} size={size}>
                    {size}
                  </Button>
                ))}
                <Button variant={variant} size="sm" active>
                  {t("componentCatalogue.active")}
                </Button>
                <Button variant={variant} size="sm" disabled>
                  {t("componentCatalogue.disabled")}
                </Button>
                <Button variant={variant} size="icon-sm" data-tooltip="Supprimer">
                  <TrashIcon size={14} />
                </Button>
              </Row>
            ))}
          </div>
        </Section>

        <Section title="Badge">
          <Row>
            {BADGE_TONES.map((tone) => (
              <Badge key={tone} tone={tone}>
                {tone}
              </Badge>
            ))}
          </Row>
        </Section>

        <Section title="Card" description="4 variantes ; `interactive` ajoute le hover-lift.">
          <div className="grid grid-cols-2 gap-4">
            {CARD_VARIANTS.map((variant) => (
              <Card key={variant} variant={variant} interactive={variant === "default"}>
                <CardHeader>
                  <span className="text-[12.5px] font-semibold text-text">{variant}</span>
                </CardHeader>
                <CardBody>
                  <p className="text-[12.5px] text-text-muted">
                    {variant === "default" ? "interactive (survolez-moi)" : "contenu de démonstration"}
                  </p>
                </CardBody>
              </Card>
            ))}
          </div>
        </Section>

        <Section title="Alert">
          <div className="flex flex-col gap-2">
            <Hint>{t("componentCatalogue.hintExample")}</Hint>
            <ErrorText>{t("componentCatalogue.errorExample")}</ErrorText>
          </div>
        </Section>

        <Section title="Field / Input" description="Trois tailles, icône optionnelle, état invalide.">
          <div className="grid max-w-sm grid-cols-1 gap-3">
            <Field label="Nom du projet" hint="Visible par toute l'équipe." value={inputValue} onChange={(e) => setInputValue(e.target.value)} />
            <Field label="Avec erreur" error="Ce champ est requis." />
            <Input inputSize="sm" icon={<SearchIcon size={13} />} placeholder="Rechercher…" />
            <Input inputSize="xs" trailing={<CheckIcon size={12} />} placeholder="xs, avec adornment" />
          </div>
        </Section>

        <Section title="List">
          <div className="max-w-sm">
            <List>
              <ListRow>
                <ListMain>{t("componentCatalogue.listRowExample")}</ListMain>
                <Badge tone="success">{t("componentCatalogue.listRowStatus")}</Badge>
              </ListRow>
              <ListRow>
                <ListMain as="button" onClick={() => {}}>
                  {t("componentCatalogue.listRowClickable")}
                </ListMain>
              </ListRow>
            </List>
          </div>
          <div className="mt-3 max-w-sm">
            <EmptyState>{t("componentCatalogue.emptyState")}</EmptyState>
          </div>
        </Section>

        <Section title="Skeleton" description="Placeholders de chargement — jamais dérivés d'un tableau vide.">
          <div className="flex flex-col gap-3">
            <Skeleton className="h-4 w-48" />
            <SkeletonCard />
          </div>
          <div className="mt-2">
            <SkeletonCardGrid count={3} />
          </div>
        </Section>

        <Section title="Tabs" description="Trois formes : pill (filtre autonome), line (en-tête de page), boxed (switch encarté).">
          <div className="flex flex-col gap-4">
            {TABS_VARIANTS.map((variant) => (
              <Tabs key={variant} tabs={DEMO_TABS} activeTab={tab} onChange={setTab} variant={variant} />
            ))}
          </div>
        </Section>
      </div>
    </div>
  );
}
