const deniedLicensePattern = /\b(AGPL|GPL|LGPL|SSPL|BUSL|Elastic)\b/i;

export function isDeniedLicenseExpression(license) {
  return license.split(/\s+OR\s+/i).every((alternative) => deniedLicensePattern.test(alternative));
}
