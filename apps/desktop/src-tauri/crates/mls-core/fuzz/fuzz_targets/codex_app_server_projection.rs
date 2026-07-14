#![no_main]

use codex_activity_projection::project_codex_activity;
use libfuzzer_sys::fuzz_target;
use serde_json::Value;
use std::collections::HashMap;

const METHODS: [&str; 4] = [
    "item/started",
    "item/updated",
    "item/completed",
    "unsupported/notification",
];

fuzz_target!(|data: &[u8]| {
    let Some((&selector, json)) = data.split_first() else {
        return;
    };
    let Ok(notification) = serde_json::from_slice::<Value>(json) else {
        return;
    };
    let mut started_by_item = HashMap::new();
    if let Some(projected) = project_codex_activity(
        METHODS[usize::from(selector) % METHODS.len()],
        &notification,
        "room-fuzzer",
        "turn-fuzzer",
        &mut started_by_item,
        selector & 1 == 1,
    ) {
        // Every accepted projection must remain serializable at the native IPC boundary.
        let _ = serde_json::to_vec(&projected).expect("projected activity must serialize");
    }
});
