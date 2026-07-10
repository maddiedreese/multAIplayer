import {
  codexModelOptions,
  codexReasoningEffortOptions,
  codexSpeedOptions,
  defaultCodexModel,
  defaultCodexReasoningEffort,
  defaultCodexSpeed,
  legacyCodexCatalogSelectionPolicy,
  type CodexCatalogSelectionPolicy,
  type CodexReasoningEffort,
  type CodexSpeed,
  type RoomRecord
} from "@multaiplayer/protocol";
import type { CodexModelOption, CodexProbe } from "./localBackend";

export interface ResolvedCodexRunSettings {
  model: string;
  reasoningEffort: CodexReasoningEffort;
  speed: CodexSpeed;
  serviceTier: string;
  modelPolicy: CodexCatalogSelectionPolicy;
  reasoningEffortPolicy: CodexCatalogSelectionPolicy;
  serviceTierPolicy: CodexCatalogSelectionPolicy;
  warnings: string[];
}

type RoomCodexIntent = Pick<
  RoomRecord,
  | "codexModel"
  | "codexModelPolicy"
  | "codexReasoningEffort"
  | "codexReasoningEffortPolicy"
  | "codexSpeed"
  | "codexServiceTierPolicy"
>;

/** Resolves shared room intent against only the active host's local app-server catalog. */
export function resolveCodexRunSettings(
  room: RoomCodexIntent,
  probe: Pick<CodexProbe, "available" | "models"> | null
): ResolvedCodexRunSettings {
  const modelPolicy = room.codexModelPolicy ?? legacyCodexCatalogSelectionPolicy;
  const reasoningEffortPolicy = room.codexReasoningEffortPolicy ?? legacyCodexCatalogSelectionPolicy;
  const serviceTierPolicy = room.codexServiceTierPolicy ?? legacyCodexCatalogSelectionPolicy;
  const catalog = probe?.available ? probe.models : [];
  const visibleModels = catalog.filter((candidate) => !candidate.hidden);
  const catalogDefault = visibleModels.find((candidate) => candidate.isDefault) ?? visibleModels[0];
  const pinnedModel = room.codexModel || defaultCodexModel;
  const model = modelPolicy === "auto" && catalogDefault ? catalogDefault.model || catalogDefault.id : pinnedModel;
  const modelEntry = findCatalogModel(catalog, model);
  const warnings: string[] = [];

  if (modelPolicy === "auto" && !catalogDefault) {
    warnings.push("The local Codex model catalog was unavailable; using the room fallback model.");
  }

  const requestedReasoning = normalizeReasoning(room.codexReasoningEffort) ?? defaultCodexReasoningEffort;
  const supportedReasoning =
    modelEntry?.supportedReasoningEfforts
      .map(normalizeReasoning)
      .filter((effort): effort is CodexReasoningEffort => Boolean(effort)) ?? [];
  const catalogReasoning = normalizeReasoning(modelEntry?.defaultReasoningEffort);
  let reasoningEffort =
    reasoningEffortPolicy === "auto" ? (catalogReasoning ?? requestedReasoning) : requestedReasoning;
  if (supportedReasoning.length && !supportedReasoning.includes(reasoningEffort)) {
    const fallback =
      catalogReasoning && supportedReasoning.includes(catalogReasoning) ? catalogReasoning : supportedReasoning[0];
    warnings.push(`Reasoning effort ${reasoningEffort} is not supported by ${model}; using ${fallback}.`);
    reasoningEffort = fallback;
  }

  const requestedSpeed = normalizeSpeed(room.codexSpeed) ?? defaultCodexSpeed;
  const requestedTier = requestedSpeed === "fast" ? "fast" : "default";
  const supportedTiers = modelEntry?.serviceTiers.filter(Boolean) ?? [];
  let serviceTier =
    serviceTierPolicy === "auto"
      ? modelEntry?.defaultServiceTier ||
        (supportedTiers.includes("default") ? "default" : supportedTiers[0]) ||
        requestedTier
      : requestedTier;
  if (supportedTiers.length && !supportedTiers.includes(serviceTier)) {
    const fallback =
      modelEntry?.defaultServiceTier && supportedTiers.includes(modelEntry.defaultServiceTier)
        ? modelEntry.defaultServiceTier
        : supportedTiers.includes("default")
          ? "default"
          : supportedTiers[0];
    warnings.push(`Service tier ${serviceTier} is not supported by ${model}; using ${fallback}.`);
    serviceTier = fallback;
  }
  const speed: CodexSpeed = serviceTier === "fast" ? "fast" : "standard";

  return {
    model,
    reasoningEffort,
    speed,
    serviceTier,
    modelPolicy,
    reasoningEffortPolicy,
    serviceTierPolicy,
    warnings
  };
}

export function catalogModelOptions(probe: Pick<CodexProbe, "available" | "models"> | null) {
  if (!probe?.available || !probe.models.length) return codexModelOptions;
  return probe.models
    .filter((model) => !model.hidden)
    .map((model) => ({
      id: model.model || model.id,
      label: model.label || model.model || model.id,
      description: model.description
    }));
}

export function catalogReasoningOptionsForModel(probe: Pick<CodexProbe, "available" | "models"> | null, model: string) {
  const supported = findCatalogModel(probe?.models ?? [], model)?.supportedReasoningEfforts ?? [];
  if (!supported.length) return codexReasoningEffortOptions;
  return codexReasoningEffortOptions.filter((option) => supported.includes(option.id));
}

export function catalogSpeedOptionsForModel(probe: Pick<CodexProbe, "available" | "models"> | null, model: string) {
  const tiers = findCatalogModel(probe?.models ?? [], model)?.serviceTiers ?? [];
  if (!tiers.length) return codexSpeedOptions;
  return codexSpeedOptions.filter((option) => tiers.includes(option.serviceTier));
}

function findCatalogModel(models: CodexModelOption[], model: string): CodexModelOption | undefined {
  return models.find((candidate) => candidate.model === model || candidate.id === model);
}

function normalizeReasoning(value: unknown): CodexReasoningEffort | null {
  return typeof value === "string" && codexReasoningEffortOptions.some((option) => option.id === value)
    ? (value as CodexReasoningEffort)
    : null;
}

function normalizeSpeed(value: unknown): CodexSpeed | null {
  return typeof value === "string" && codexSpeedOptions.some((option) => option.id === value)
    ? (value as CodexSpeed)
    : null;
}
