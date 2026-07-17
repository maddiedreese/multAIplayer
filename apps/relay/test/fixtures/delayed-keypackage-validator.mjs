let input = "";
for await (const chunk of process.stdin) input += chunk;
const value = JSON.parse(input);
await new Promise((resolve) => setTimeout(resolve, 150));
process.stdout.write(
  JSON.stringify({
    github_user_id: value.uploader_github_user_id,
    device_id: value.uploader_device_id,
    ciphersuite: 2,
    signature_key_fingerprint: value.expected_signature_key_fingerprint,
    signature_public_key: value.expected_signature_public_key
  })
);
