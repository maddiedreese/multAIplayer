import {
  executableKeyPackageValidator,
  rejectUnvalidatedKeyPackages,
  type KeyPackageValidator
} from "./key-package-validator.js";

export function configuredKeyPackageValidator(nodeEnv: string): KeyPackageValidator {
  const executable = process.env.MULTAIPLAYER_MLS_VALIDATOR_PATH?.trim();
  if (executable) return executableKeyPackageValidator(executable);
  if (nodeEnv === "production") throw new Error("MULTAIPLAYER_MLS_VALIDATOR_PATH is required in production.");
  return rejectUnvalidatedKeyPackages;
}
