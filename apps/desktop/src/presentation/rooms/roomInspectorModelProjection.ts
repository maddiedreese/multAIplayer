import {
  defaultCodexModel,
  defaultCodexReasoningEffort,
  defaultCodexSandboxLevel,
  defaultCodexSpeed,
  type ClientRoomRecord
} from "@multaiplayer/protocol";
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
  const selectedModel = room.codexModel ?? defaultCodexModel;
  const resolved = resolveCodexRunSettings(room, codexProbe);
  return {
    selectedModel,
    selectedReasoningEffort: room.codexReasoningEffort ?? defaultCodexReasoningEffort,
    rawReasoningEnabled: room.codexRawReasoningEnabled ?? false,
    selectedSpeed: room.codexSpeed ?? defaultCodexSpeed,
    selectedSandboxLevel: room.codexSandboxLevel ?? defaultCodexSandboxLevel,
    customModel: customModelDraft ?? selectedModel,
    modelOptions: catalogModelOptions(codexProbe),
    reasoningOptions: catalogReasoningOptionsForModel(codexProbe, resolved.model),
    speedOptions: catalogSpeedOptionsForModel(codexProbe, resolved.model)
  };
}
