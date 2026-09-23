import type { ProjectTemplateId } from "@athanordb/dbml-engine";
import type { TranslationKey } from "@/i18n/translate";

/** Locale keys for each starter template — spelled out so every key stays checked against the dictionary. */
export const TEMPLATE_COPY: Record<ProjectTemplateId, { name: TranslationKey; description: TranslationKey }> = {
  blog: { name: "projects.templates.blog.name", description: "projects.templates.blog.description" },
  ecommerce: { name: "projects.templates.ecommerce.name", description: "projects.templates.ecommerce.description" },
  saas: { name: "projects.templates.saas.name", description: "projects.templates.saas.description" },
  auth: { name: "projects.templates.auth.name", description: "projects.templates.auth.description" },
};
