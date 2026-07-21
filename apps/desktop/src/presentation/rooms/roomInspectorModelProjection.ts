import { defaultCodexSandboxLevel, type ClientRoomRecord } from "@multaiplayer/protocol";
import {
  catalogModelOptions,
  catalogReasoningOptionsForModel,
  catalogSpeedOptionsForModel,
  resolveCodexRunSettings
} from "../../lib/codex/codexCatalogResolver";
import type { CodexProbe } from "../../lib/platform/localBackend";

export function buildRoomInspectorModelProjection(
  room: ClientRoomRecord,
  codexProbe: CodexProbe | null,
  customModelDraft?: string
) {
  const resolved = resolveCodexRunSettings(room, codexProbe);
  const selectedModel = resolved.model;
  return {
    selectedModel,
    selectedReasoningEffort: resolved.reasoningEffort,
    rawReasoningEnabled: room.codexRawReasoningEnabled ?? false,
    selectedSpeed: resolved.speed,
    selectedSandboxLevel: room.codexSandboxLevel ?? defaultCodexSandboxLevel,
    customModel: customModelDraft ?? selectedModel,
    modelOptions: catalogModelOptions(codexProbe),
    reasoningOptions: catalogReasoningOptionsForModel(codexProbe, resolved.model),
    speedOptions: catalogSpeedOptionsForModel(codexProbe, resolved.model)
  };
}
