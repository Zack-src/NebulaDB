/**
 * String casing utilities for schema transformation, generators, and naming standardization.
 */

export function toSnakeCase(str: string): string {
  return String(str || "")
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/[\s-]+/g, "_")
    .replace(/_{2,}/g, "_")
    .replace(/^_+|_+$/g, "")
    .toLowerCase();
}

export function toCamelCase(str: string): string {
  const snake = toSnakeCase(str);
  return snake.replace(/_([a-z0-9])/g, (_, char) => char.toUpperCase());
}

export function toPascalCase(str: string): string {
  const camel = toCamelCase(str);
  return camel.charAt(0).toUpperCase() + camel.slice(1);
}

export function toKebabCase(str: string): string {
  return toSnakeCase(str).replace(/_/g, "-");
}

export function toTitleCase(str: string): string {
  return String(str || "")
    .replace(/[\s-_]+/g, " ")
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase());
}
