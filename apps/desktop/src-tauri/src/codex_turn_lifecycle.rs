use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex, OnceLock};

static NEXT_TURN_LEASE_ID: AtomicU64 = AtomicU64::new(1);
static ACTIVE_TURNS: OnceLock<Mutex<HashMap<u64, ActiveTurn>>> = OnceLock::new();

struct ActiveTurn {
    room_id: String,
    cancelled: Arc<AtomicBool>,
}

/// A native turn remains registered for its entire process checkout. Room
/// shutdown marks the lease before cached-session cleanup, allowing the owner
/// thread to terminate the checked-out child instead of re-caching it.
pub(crate) struct CodexTurnLease {
    id: u64,
    cancelled: Arc<AtomicBool>,
}

impl CodexTurnLease {
    pub(crate) fn begin(room_id: &str) -> Result<Self, String> {
        let id = NEXT_TURN_LEASE_ID.fetch_add(1, Ordering::Relaxed);
        let cancelled = Arc::new(AtomicBool::new(false));
        let mut turns = active_turns()
            .lock()
            .map_err(|_| "Codex active-turn registry is unavailable".to_string())?;
        if turns
            .values()
            .any(|turn| turn.room_id == room_id && !turn.cancelled.load(Ordering::Acquire))
        {
            return Err("A Codex turn is already active for this room".to_string());
        }
        turns.insert(
            id,
            ActiveTurn {
                room_id: room_id.to_string(),
                cancelled: cancelled.clone(),
            },
        );
        Ok(Self { id, cancelled })
    }

    pub(crate) fn is_cancelled(&self) -> bool {
        self.cancelled.load(Ordering::Acquire)
    }

    pub(crate) fn cancellation_flag(&self) -> Arc<AtomicBool> {
        self.cancelled.clone()
    }

    /// Run cache reinsertion while holding the same registry lock used by room
    /// cancellation. This closes the shutdown/check-in race: shutdown either
    /// cancels first, or waits and then removes the newly cached session.
    pub(crate) fn run_if_active(&self, action: impl FnOnce()) -> bool {
        let Ok(turns) = active_turns().lock() else {
            return false;
        };
        if self.is_cancelled() || !turns.contains_key(&self.id) {
            return false;
        }
        action();
        true
    }
}

impl Drop for CodexTurnLease {
    fn drop(&mut self) {
        if let Ok(mut turns) = active_turns().lock() {
            turns.remove(&self.id);
        }
    }
}

pub(crate) fn cancel_codex_turns_for_room(room_id: &str) -> usize {
    let Ok(turns) = active_turns().lock() else {
        return 0;
    };
    let matching = turns
        .values()
        .filter(|turn| turn.room_id == room_id)
        .collect::<Vec<_>>();
    for turn in &matching {
        turn.cancelled.store(true, Ordering::Release);
    }
    matching.len()
}

fn active_turns() -> &'static Mutex<HashMap<u64, ActiveTurn>> {
    ACTIVE_TURNS.get_or_init(|| Mutex::new(HashMap::new()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn room_cancellation_marks_only_matching_checked_out_turns() {
        let room_a = CodexTurnLease::begin("lifecycle-room-a").expect("room a");
        let room_b = CodexTurnLease::begin("lifecycle-room-b").expect("room b");

        assert_eq!(cancel_codex_turns_for_room("lifecycle-room-a"), 1);
        assert!(room_a.is_cancelled());
        assert!(!room_b.is_cancelled());
    }

    #[test]
    fn dropping_a_lease_removes_it_from_shutdown_matching() {
        let lease = CodexTurnLease::begin("lifecycle-room-drop").expect("lease");
        drop(lease);
        assert_eq!(cancel_codex_turns_for_room("lifecycle-room-drop"), 0);
    }

    #[test]
    fn cancelled_lease_cannot_run_cache_reinsertion() {
        let lease = CodexTurnLease::begin("lifecycle-room-cache").expect("lease");
        assert_eq!(cancel_codex_turns_for_room("lifecycle-room-cache"), 1);
        let mut ran = false;
        assert!(!lease.run_if_active(|| ran = true));
        assert!(!ran);
    }

    #[test]
    fn a_room_has_only_one_live_turn_but_can_restart_after_cancellation() {
        let first = CodexTurnLease::begin("lifecycle-room-exclusive").expect("first lease");
        assert!(CodexTurnLease::begin("lifecycle-room-exclusive").is_err());

        assert_eq!(cancel_codex_turns_for_room("lifecycle-room-exclusive"), 1);
        let replacement =
            CodexTurnLease::begin("lifecycle-room-exclusive").expect("replacement lease");
        assert!(!replacement.is_cancelled());
        drop(first);
        drop(replacement);
    }
}
