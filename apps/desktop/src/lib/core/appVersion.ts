import desktopPackage from "../../../package.json";

const viteEnv = (
  import.meta as ImportMeta & {
    env?: Record<string, string | undefined>;
  }
).env;

export const appVersion = desktopPackage.version;
export const defaultUpdateManifestUrl = "https://multaiplayer.com/releases/latest.json";
export const updateManifestUrl = viteEnv?.VITE_UPDATE_MANIFEST_URL ?? defaultUpdateManifestUrl;
