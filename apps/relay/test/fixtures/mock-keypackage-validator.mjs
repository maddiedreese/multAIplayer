let input = "";
for await (const chunk of process.stdin) input += chunk;
const value = JSON.parse(input);
const mismatchedIdentity = value.key_package === "AQ==";
process.stdout.write(
  JSON.stringify({
    github_user_id: value.uploader_github_user_id,
    device_id: value.uploader_device_id,
    ciphersuite: 2,
    signature_key_fingerprint: mismatchedIdentity
      ? `sha256:${"0000:".repeat(15)}0000`
      : value.expected_signature_key_fingerprint,
    signature_public_key: mismatchedIdentity ? "AQ==" : value.expected_signature_public_key
  })
);
