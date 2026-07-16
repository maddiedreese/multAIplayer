import {
  codexModelOptions,
  codexReasoningEffortOptions,
  codexSpeedOptions,
  defaultCodexModel,
  defaultCodexReasoningEffort,
  defaultCodexSpeed,
  type CodexCatalogSelectionPolicy,
  type CodexReasoningEffort,
  type CodexSpeed,
  type ClientRoomRecord
} from "@multaiplayer/protocol";
import type { CodexModelOption, CodexProbe } from "../platform/localBackend";

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

interface CatalogResolutionContext {
  catalog: CodexModelOption[];
  model: string;
  modelEntry: CodexModelOption | undefined;
  warnings: string[];
}

type RoomCodexIntent = Pick<
  ClientRoomRecord,
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
  const modelPolicy = room.codexModelPolicy;
  const reasoningEffortPolicy = room.codexReasoningEffortPolicy;
  const serviceTierPolicy = room.codexServiceTierPolicy;
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

  const context = { catalog, model, modelEntry, warnings };
  const reasoningEffort = resolveReasoningEffort(room, reasoningEffortPolicy, context);
  const serviceTier = resolveServiceTier(room, serviceTierPolicy, context);
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

function resolveReasoningEffort(
  room: RoomCodexIntent,
  policy: CodexCatalogSelectionPolicy,
  { model, modelEntry, warnings }: CatalogResolutionContext
): CodexReasoningEffort {
  const requested = normalizeReasoning(room.codexReasoningEffort) ?? defaultCodexReasoningEffort;
  const supported =
    modelEntry?.supportedReasoningEfforts
      .map(normalizeReasoning)
      .filter((effort): effort is CodexReasoningEffort => Boolean(effort)) ?? [];
  const catalogDefault = normalizeReasoning(modelEntry?.defaultReasoningEffort);
  const selected = policy === "auto" ? (catalogDefault ?? requested) : requested;
  if (!supported.length || supported.includes(selected)) return selected;
  const fallback = catalogDefault && supported.includes(catalogDefault) ? catalogDefault : (supported[0] ?? requested);
  warnings.push(`Reasoning effort ${selected} is not supported by ${model}; using ${fallback}.`);
  return fallback;
}

function resolveServiceTier(
  room: RoomCodexIntent,
  policy: CodexCatalogSelectionPolicy,
  { model, modelEntry, warnings }: CatalogResolutionContext
): string {
  const requestedSpeed = normalizeSpeed(room.codexSpeed) ?? defaultCodexSpeed;
  const requested = requestedSpeed === "fast" ? "fast" : "default";
  const supported = modelEntry?.serviceTiers.filter(Boolean) ?? [];
  const catalogDefault = modelEntry?.defaultServiceTier;
  const selected =
    policy === "auto"
      ? catalogDefault || (supported.includes("default") ? "default" : supported[0]) || requested
      : requested;
  if (!supported.length || supported.includes(selected)) return selected;
  const fallback =
    catalogDefault && supported.includes(catalogDefault)
      ? catalogDefault
      : supported.includes("default")
        ? "default"
        : (supported[0] ?? requested);
  warnings.push(`Service tier ${selected} is not supported by ${model}; using ${fallback}.`);
  return fallback;
}

export function catalogModelOptions(probe: Pick<CodexProbe, "available" | "models"> | null) {
  if (!probe?.available || !probe.models.length) return codexModelOptions;
  const hostModels = probe.models
    .filter((model) => !model.hidden)
    .map((model) => ({
      id: model.model || model.id,
      label: model.label || model.model || model.id,
      description: model.description
    }));
  const hostModelIds = new Set(hostModels.map((model) => model.id));

  return [...codexModelOptions.filter((model) => !hostModelIds.has(model.id)), ...hostModels];
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
