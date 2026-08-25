export { classifyRepository } from "./classify.js";
export const TAXONOMY_VERSION = "taxonomy-v1";
export type {
  RepositoryClassification,
  RepositoryClassificationInput,
  RepositoryType,
  TaxonomyCoverage,
} from "./classify.js";
export { detectModifiers } from "./modifiers.js";
export type { ModifierInput, RepositoryModifier } from "./modifiers.js";
