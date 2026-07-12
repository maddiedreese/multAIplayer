use super::*;
use std::sync::atomic::{AtomicU64, Ordering};
use std::thread;

fn now() -> DateTime<Utc> {
    DateTime::parse_from_rfc3339("2026-07-09T12:00:00.000Z")
        .expect("test timestamp")
        .with_timezone(&Utc)
}

fn entry(index: usize) -> DiagnosticEntry {
    DiagnosticEntry {
        level: DiagnosticLevel::Warn,
        message: format!("event-{index}"),
        detail: None,
        created_at: now().to_rfc3339_opts(SecondsFormat::Millis, true),
    }
}

fn temp_path(name: &str) -> PathBuf {
    static NEXT: AtomicU64 = AtomicU64::new(0);
    std::env::temp_dir()
        .join(format!(
            "multaiplayer-diagnostics-{name}-{}-{}",
            std::process::id(),
            NEXT.fetch_add(1, Ordering::Relaxed)
        ))
        .join("diagnostics.jsonl")
}

#[test]
fn serde_rejects_unknown_fields_and_levels() {
    let valid = r#"{"level":"warn","message":"hello","createdAt":"2026-07-09T12:00:00Z"}"#;
    assert!(serde_json::from_str::<DiagnosticEntry>(valid).is_ok());
    assert!(
        serde_json::from_str::<DiagnosticEntry>(&valid.replace("}", ",\"payload\":{}}")).is_err()
    );
    assert!(serde_json::from_str::<DiagnosticEntry>(&valid.replace("warn", "info")).is_err());
}

#[test]
fn export_context_rejects_unknown_and_oversized_fields() {
    assert!(serde_json::from_str::<DiagnosticExportContext>(
        r#"{"language":"en-US","payload":"not allowed"}"#
    )
    .is_err());
    let context = DiagnosticExportContext {
        user_agent: Some("x".repeat(MAX_USER_AGENT_CHARS + 1)),
        ..DiagnosticExportContext::default()
    };
    assert!(validate_export_context(context).is_err());
}

#[test]
fn validation_bounds_text_and_timestamp() {
    let mut valid = entry(1);
    valid.message = "x".repeat(MAX_MESSAGE_CHARS);
    valid.detail = Some("y".repeat(MAX_DETAIL_CHARS));
    assert!(validate_and_redact(valid.clone(), now()).is_ok());
    valid.message.push('x');
    assert!(validate_and_redact(valid, now()).is_err());

    let mut oversized_detail = entry(2);
    oversized_detail.detail = Some("y".repeat(MAX_DETAIL_CHARS + 1));
    assert!(validate_and_redact(oversized_detail, now()).is_err());

    let mut invalid_date = entry(3);
    invalid_date.created_at = "today".to_string();
    assert!(validate_and_redact(invalid_date, now()).is_err());
}

#[test]
fn startup_prunes_expired_future_corrupt_and_oversized_lines() {
    let path = temp_path("prune");
    fs::create_dir_all(path.parent().expect("parent")).expect("create test dir");
    let mut old = entry(1);
    old.created_at = (now() - Duration::days(8)).to_rfc3339();
    let mut future = entry(2);
    future.created_at = (now() + Duration::minutes(6)).to_rfc3339();
    let current = entry(3);
    let content = format!(
        "{}not json\n{}\n{}\n{}\n",
        "x".repeat(MAX_ENCODED_LINE_BYTES + 1),
        serde_json::to_string(&old).expect("old"),
        serde_json::to_string(&future).expect("future"),
        serde_json::to_string(&current).expect("current")
    );
    fs::write(&path, content).expect("seed log");

    let store = DiagnosticStore::initialize(path.clone(), now()).expect("initialize");
    assert_eq!(store.entries, vec![current]);
    assert_eq!(
        read_bounded_entries(&path).expect("read canonical").len(),
        1
    );
    let _ = fs::remove_dir_all(path.parent().expect("parent"));
}

#[test]
fn record_enforces_entry_and_byte_caps_with_newest_entries() {
    let count_path = temp_path("count-cap");
    let mut count_store =
        DiagnosticStore::initialize(count_path.clone(), now()).expect("initialize count");
    for index in 0..550 {
        count_store
            .record(entry(index))
            .expect("record count entry");
    }
    assert_eq!(count_store.entries.len(), MAX_LOG_ENTRIES);
    assert_eq!(
        count_store.entries.first().expect("first").message,
        "event-50"
    );

    let byte_path = temp_path("byte-cap");
    let mut byte_store =
        DiagnosticStore::initialize(byte_path.clone(), now()).expect("initialize bytes");
    for index in 0..500 {
        let mut large = entry(index);
        large.detail = Some("z ".repeat(MAX_DETAIL_CHARS / 2));
        byte_store.record(large).expect("record large entry");
    }
    assert!(fs::metadata(&byte_path).expect("metadata").len() <= MAX_LOG_BYTES as u64);
    assert!(byte_store.entries.len() < MAX_LOG_ENTRIES);
    assert_eq!(
        byte_store.entries.last().expect("last").message,
        "event-499"
    );

    let _ = fs::remove_dir_all(count_path.parent().expect("parent"));
    let _ = fs::remove_dir_all(byte_path.parent().expect("parent"));
}

#[test]
fn concurrent_records_produce_complete_json_lines() {
    let path = temp_path("concurrent");
    let state = DiagnosticState {
        store: Arc::new(Mutex::new(
            DiagnosticStore::initialize(path.clone(), now()).expect("initialize"),
        )),
        initialization_error: None,
    };
    let threads = (0..8)
        .map(|thread_index| {
            let state = state.clone();
            thread::spawn(move || {
                for item in 0..25 {
                    state
                        .record(entry(thread_index * 25 + item), now())
                        .expect("record concurrently");
                }
            })
        })
        .collect::<Vec<_>>();
    for thread in threads {
        thread.join().expect("join");
    }
    let persisted = read_bounded_entries(&path).expect("read persisted");
    assert_eq!(persisted.len(), 200);
    assert_eq!(state.export(now()).expect("export").len(), 200);
    let _ = fs::remove_dir_all(path.parent().expect("parent"));
}

#[test]
fn capture_and_export_redact_urls_and_tokens() {
    let path = temp_path("redaction");
    let state = DiagnosticState {
        store: Arc::new(Mutex::new(
            DiagnosticStore::initialize(path.clone(), now()).expect("initialize"),
        )),
        initialization_error: None,
    };
    let mut unsafe_entry = entry(1);
    unsafe_entry.detail = Some(
        "https://user:password@relay.example.com/invites?token=secret gho_abcdefghijklmnopqrstuvwxyz1234567890"
            .to_string(),
    );
    state.record(unsafe_entry, now()).expect("record");

    // Simulate a legacy in-memory record so export's independent redaction is exercised.
    state.lock_store().expect("lock").entries[0].message =
        "legacy abcdefghijklmnopqrstuvwxyz1234567890".to_string();
    let exported = state.export(now()).expect("export");
    let serialized = serde_json::to_string(&exported).expect("serialize export");
    assert!(!serialized.contains("token=secret"));
    assert!(!serialized.contains("password"));
    assert!(!serialized.contains("gho_"));
    assert!(!serialized.contains("abcdefghijklmnopqrstuvwxyz1234567890"));
    assert!(serialized.contains("[redacted-token]"));
    let _ = fs::remove_dir_all(path.parent().expect("parent"));
}

#[test]
fn native_bundle_normalizes_context_and_never_exposes_unredacted_entries() {
    let path = temp_path("native-bundle");
    let state = DiagnosticState {
        store: Arc::new(Mutex::new(
            DiagnosticStore::initialize(path.clone(), now()).expect("initialize"),
        )),
        initialization_error: None,
    };
    state.record(entry(1), now()).expect("record");
    state.lock_store().expect("lock").entries[0].detail = Some(
        "legacy https://relay.example.com/path?secret=leaked abcdefghijklmnopqrstuvwxyz1234567890"
            .to_string(),
    );
    let context = DiagnosticExportContext {
        user_agent: Some("Browser abcdefghijklmnopqrstuvwxyz1234567890".to_string()),
        language: Some("en-US".to_string()),
        platform: Some("macOS".to_string()),
        relay_http_origin: Some(
            "https://user:password@relay.example.com/api?secret=leaked".to_string(),
        ),
        relay_ws_origin: Some("wss://relay.example.com/rooms?secret=leaked".to_string()),
    };
    let encoded = build_diagnostic_bundle(&state, context, now()).expect("build bundle");
    let bundle: serde_json::Value = serde_json::from_slice(&encoded).expect("parse bundle");

    assert_eq!(bundle["generatedAt"], "2026-07-09T12:00:00.000Z");
    assert_eq!(bundle["app"]["runtime"], "tauri");
    assert_eq!(bundle["app"]["language"], "en-US");
    assert_eq!(bundle["relay"]["httpOrigin"], "https://relay.example.com");
    assert_eq!(bundle["relay"]["wsOrigin"], "wss://relay.example.com");
    let serialized = String::from_utf8(encoded).expect("utf8 bundle");
    assert!(!serialized.contains("password"));
    assert!(!serialized.contains("secret=leaked"));
    assert!(!serialized.contains("abcdefghijklmnopqrstuvwxyz1234567890"));
    assert!(serialized.contains("[redacted-token]"));
    let _ = fs::remove_dir_all(path.parent().expect("parent"));
}

#[test]
fn bundle_writer_replaces_regular_files_and_writes_complete_json() {
    let path = temp_path("bundle-write").with_file_name("diagnostics.json");
    fs::create_dir_all(path.parent().expect("parent")).expect("create parent");
    fs::write(&path, "old contents").expect("seed export");
    let encoded = br#"{"complete":true}
"#;
    write_diagnostic_bundle(&path, encoded).expect("write bundle");
    assert_eq!(fs::read(&path).expect("read bundle"), encoded);
    let leftovers = fs::read_dir(path.parent().expect("parent"))
        .expect("read parent")
        .filter_map(Result::ok)
        .filter(|entry| entry.file_name().to_string_lossy().ends_with(".tmp"))
        .count();
    assert_eq!(leftovers, 0);
    let _ = fs::remove_dir_all(path.parent().expect("parent"));
}

#[cfg(unix)]
#[test]
fn bundle_writer_is_private_and_rejects_symlink_destinations() {
    use std::os::unix::fs::{symlink, PermissionsExt};
    let path = temp_path("bundle-symlink").with_file_name("diagnostics.json");
    let parent = path.parent().expect("parent");
    fs::create_dir_all(parent).expect("create parent");
    let outside = parent.join("outside.json");
    fs::write(&outside, "do not overwrite").expect("write outside");
    symlink(&outside, &path).expect("create symlink");
    assert!(write_diagnostic_bundle(&path, b"{}\n").is_err());
    assert_eq!(
        fs::read_to_string(&outside).expect("read outside"),
        "do not overwrite"
    );

    fs::remove_file(&path).expect("remove symlink");
    write_diagnostic_bundle(&path, b"{}\n").expect("write bundle");
    let mode = fs::metadata(&path).expect("metadata").permissions().mode() & 0o777;
    assert_eq!(mode, 0o600);
    let _ = fs::remove_dir_all(parent);
}

#[cfg(unix)]
#[test]
fn log_and_directory_permissions_are_private() {
    use std::os::unix::fs::PermissionsExt;
    let path = temp_path("permissions");
    let mut store = DiagnosticStore::initialize(path.clone(), now()).expect("initialize");
    store.record(entry(1)).expect("record");
    let file_mode = fs::metadata(&path)
        .expect("file metadata")
        .permissions()
        .mode()
        & 0o777;
    let directory_mode = fs::metadata(path.parent().expect("parent"))
        .expect("directory metadata")
        .permissions()
        .mode()
        & 0o777;
    assert_eq!(file_mode, 0o600);
    assert_eq!(directory_mode, 0o700);
    let _ = fs::remove_dir_all(path.parent().expect("parent"));
}

#[cfg(unix)]
#[test]
fn initialization_rejects_symlink_and_non_regular_targets() {
    use std::os::unix::fs::symlink;
    let symlink_path = temp_path("symlink-target");
    let parent = symlink_path.parent().expect("parent");
    fs::create_dir_all(parent).expect("create parent");
    let outside = parent.join("outside.log");
    fs::write(&outside, "do not overwrite").expect("write outside file");
    symlink(&outside, &symlink_path).expect("create symlink");
    assert!(DiagnosticStore::initialize(symlink_path.clone(), now()).is_err());
    assert_eq!(
        fs::read_to_string(&outside).expect("read outside"),
        "do not overwrite"
    );

    fs::remove_file(&symlink_path).expect("remove symlink");
    fs::create_dir(&symlink_path).expect("create directory target");
    assert!(DiagnosticStore::initialize(symlink_path.clone(), now()).is_err());
    let _ = fs::remove_dir_all(parent);
}
