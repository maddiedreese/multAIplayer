import {
  defaultCodexModel,
  defaultCodexReasoningEffort,
  defaultCodexSandboxLevel,
  defaultCodexSpeed,
  type RoomRecord
} from "@multaiplayer/protocol";
import {
  catalogModelOptions,
  catalogReasoningOptionsForModel,
  catalogSpeedOptionsForModel,
  resolveCodexRunSettings
} from "./codexCatalogResolver";
import type { CodexProbe } from "./localBackend";

export function buildRoomInspectorModelProjection(
  room: RoomRecord,
  codexProbe: CodexProbe | null,
  customModelDraft?: string
) {
  const selectedModel = room.codexModel ?? defaultCodexModel;
  const resolved = resolveCodexRunSettings(room, codexProbe);
  return {
    selectedModel,
    selectedReasoningEffort: room.codexReasoningEffort ?? defaultCodexReasoningEffort,
    selectedSpeed: room.codexSpeed ?? defaultCodexSpeed,
    selectedSandboxLevel: room.codexSandboxLevel ?? defaultCodexSandboxLevel,
    customModel: customModelDraft ?? selectedModel,
    modelOptions: catalogModelOptions(codexProbe),
    reasoningOptions: catalogReasoningOptionsForModel(codexProbe, resolved.model),
    speedOptions: catalogSpeedOptionsForModel(codexProbe, resolved.model)
  };
}
