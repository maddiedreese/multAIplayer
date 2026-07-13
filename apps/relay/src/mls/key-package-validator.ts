import type { KeyPackageUpload } from "@multaiplayer/protocol";
import { execFile } from "node:child_process";

export interface ValidatedKeyPackage {
  credentialIdentity: string;
  userId: string;
  deviceId: string;
  ciphersuite: number;
  signaturePublicKey: string;
  signatureKeyFingerprint: string;
}

/** Implemented by the Rust MLS boundary; the TypeScript relay does not parse MLS. */
export interface KeyPackageValidator {
  validate(
    upload: KeyPackageUpload,
    uploader: { userId: string; deviceId: string; signaturePublicKey: string; signatureKeyFingerprint: string }
  ): Promise<ValidatedKeyPackage | null>;
}

export const rejectUnvalidatedKeyPackages: KeyPackageValidator = {
  async validate() {
    return null;
  }
};

export function executableKeyPackageValidator(path: string): KeyPackageValidator {
  return {
    validate(upload, uploader) {
      return new Promise((resolve) => {
        const child = execFile(
          path.endsWith(".mjs") ? process.execPath : path,
          path.endsWith(".mjs") ? [path] : [],
          { timeout: 2_000, maxBuffer: 16_384 },
          (error, stdout) => {
            if (error || Buffer.byteLength(stdout, "utf8") > 16_384) return resolve(null);
            try {
              const value = JSON.parse(stdout) as Record<string, unknown>;
              if (
                typeof value.github_user_id !== "string" ||
                typeof value.device_id !== "string" ||
                typeof value.ciphersuite !== "number" ||
                typeof value.signature_key_fingerprint !== "string" ||
                typeof value.signature_public_key !== "string"
              )
                return resolve(null);
              resolve({
                credentialIdentity: JSON.stringify({
                  github_user_id: value.github_user_id,
                  device_id: value.device_id
                }),
                userId: value.github_user_id,
                deviceId: value.device_id,
                ciphersuite: value.ciphersuite,
                signaturePublicKey: value.signature_public_key,
                signatureKeyFingerprint: value.signature_key_fingerprint
              });
            } catch {
              resolve(null);
            }
          }
        );
        child.stdin?.end(
          JSON.stringify({
            key_package: upload.keyPackage,
            uploader_github_user_id: uploader.userId,
            uploader_device_id: uploader.deviceId,
            ...(path.endsWith(".mjs")
              ? {
                  expected_signature_public_key: uploader.signaturePublicKey,
                  expected_signature_key_fingerprint: uploader.signatureKeyFingerprint
                }
              : {})
          })
        );
      });
    }
  };
}
