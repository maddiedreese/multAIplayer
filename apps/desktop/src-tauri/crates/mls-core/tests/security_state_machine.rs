use mls_core::{ApplicationAuthenticatedDataInput, BasicAppCredential, EngineError, MlsEngine};
use proptest::prelude::*;

const ROOM: &str = "generated-security-room";

fn engine(user: usize, generation: usize) -> MlsEngine {
    MlsEngine::new(BasicAppCredential {
        github_user_id: format!("user-{user}"),
        device_id: format!("device-{user}-{generation}"),
    })
    .unwrap()
}

fn aad(message_id: &str, sender: usize) -> ApplicationAuthenticatedDataInput {
    ApplicationAuthenticatedDataInput {
        version: 1,
        message_id: message_id.into(),
        team_id: "generated-team".into(),
        room_id: ROOM.into(),
        kind: "chaos-probe".into(),
        sender_user_id: format!("user-{sender}"),
        sender_device_id: format!("device-{sender}"),
        created_at: "2026-07-13T00:00:00.000Z".into(),
    }
}

struct Model {
    engines: Vec<MlsEngine>,
    retired: Vec<MlsEngine>,
    active: Vec<bool>,
    generations: Vec<usize>,
    host: usize,
    serial: usize,
}

impl Model {
    fn new() -> Self {
        let mut model = Self {
            engines: (0..5).map(|index| engine(index, 0)).collect(),
            retired: Vec::new(),
            active: vec![true, false, false, false, false],
            generations: vec![0; 5],
            host: 0,
            serial: 0,
        };
        model.engines[0].create_group(ROOM).unwrap();
        model.add(1);
        model.add(2);
        model.assert_epoch_exclusion();
        model
    }

    fn active_indices(&self) -> Vec<usize> {
        self.active
            .iter()
            .enumerate()
            .filter_map(|(index, active)| active.then_some(index))
            .collect()
    }

    fn add(&mut self, target: usize) {
        assert!(!self.active[target]);
        let package = self.engines[target].generate_key_package().unwrap();
        let add = self.engines[self.host].add_member(ROOM, &package).unwrap();
        self.engines[self.host]
            .publish_succeeded(ROOM, &add.commit_outbox_id)
            .unwrap();
        for index in self.active_indices() {
            if index != self.host {
                self.engines[index]
                    .process_incoming(ROOM, &add.commit)
                    .unwrap();
            }
        }
        self.engines[target]
            .join_welcome(ROOM, &add.welcome)
            .unwrap();
        self.active[target] = true;
    }

    fn remove(&mut self, target: usize) {
        assert!(self.active[target] && target != self.host);
        let leaf = self.engines[target].self_leaf(ROOM).unwrap();
        let removal = self.engines[self.host].remove_member(ROOM, leaf).unwrap();
        self.engines[self.host]
            .publish_succeeded(ROOM, &removal.outbox_id)
            .unwrap();
        for index in self.active_indices() {
            if index != self.host {
                self.engines[index]
                    .process_incoming(ROOM, &removal.message)
                    .unwrap();
            }
        }
        self.active[target] = false;
    }

    fn rejoin(&mut self, target: usize) {
        assert!(!self.active[target]);
        self.generations[target] += 1;
        let replacement = engine(target, self.generations[target]);
        let removed = std::mem::replace(&mut self.engines[target], replacement);
        self.retired.push(removed);
        self.add(target);
    }

    fn handoff(&mut self, target: usize) {
        assert!(self.active[target] && target != self.host);
        let old_host = self.host;
        let leaf = self.engines[target].self_leaf(ROOM).unwrap();
        let device = format!("device-{target}-{}", self.generations[target]);
        let handoff = self.engines[old_host]
            .transfer_host(ROOM, leaf, device)
            .unwrap();
        self.engines[old_host]
            .publish_succeeded(ROOM, &handoff.outbox_id)
            .unwrap();
        for index in self.active_indices() {
            if index != old_host {
                self.engines[index]
                    .process_incoming(ROOM, &handoff.message)
                    .unwrap();
            }
        }
        self.host = target;

        let probe = engine(99, self.serial);
        let package = probe.generate_key_package().unwrap();
        assert!(matches!(
            self.engines[old_host].add_member(ROOM, &package),
            Err(EngineError::NotHost)
        ));
    }

    fn assert_epoch_exclusion(&mut self) {
        self.serial += 1;
        let message_id = format!("generated-probe-{}", self.serial);
        let plaintext = format!("epoch-secret-{}", self.serial).into_bytes();
        let outbound = self.engines[self.host]
            .encrypt_application(ROOM, &message_id, &plaintext, aad(&message_id, self.host))
            .unwrap();
        self.engines[self.host]
            .publish_succeeded(ROOM, &outbound.outbox_id)
            .unwrap();

        for index in self.active_indices() {
            if index != self.host {
                let received = self.engines[index]
                    .process_incoming(ROOM, &outbound.message)
                    .unwrap()
                    .unwrap();
                assert_eq!(received.payload, plaintext);
            }
        }
        for removed in &mut self.retired {
            assert!(removed.process_incoming(ROOM, &outbound.message).is_err());
        }
        for index in 0..self.active.len() {
            if !self.active[index] {
                assert!(self.engines[index]
                    .process_incoming(ROOM, &outbound.message)
                    .is_err());
            }
        }

        let package = engine(98, self.serial).generate_key_package().unwrap();
        for index in self.active_indices() {
            if index != self.host {
                assert!(matches!(
                    self.engines[index].add_member(ROOM, &package),
                    Err(EngineError::NotHost)
                ));
                let host_leaf = self.engines[self.host].self_leaf(ROOM).unwrap();
                assert!(matches!(
                    self.engines[index].remove_member(ROOM, host_leaf),
                    Err(EngineError::NotHost)
                ));
                assert!(matches!(
                    self.engines[index].transfer_host(
                        ROOM,
                        host_leaf,
                        format!("device-{}-{}", self.host, self.generations[self.host]),
                    ),
                    Err(EngineError::NotHost)
                ));
            }
        }
    }

    fn apply(&mut self, action: u8) {
        let active = self.active_indices();
        let non_hosts: Vec<_> = active
            .iter()
            .copied()
            .filter(|index| *index != self.host)
            .collect();
        let inactive: Vec<_> = self
            .active
            .iter()
            .enumerate()
            .filter_map(|(index, active)| (!active).then_some(index))
            .collect();
        match action % 4 {
            0 if !non_hosts.is_empty() => {
                self.handoff(non_hosts[action as usize % non_hosts.len()])
            }
            1 if active.len() > 2 => self.remove(non_hosts[action as usize % non_hosts.len()]),
            2 if !inactive.is_empty() => {
                let target = inactive[action as usize % inactive.len()];
                if self.engines[target].current_epoch(ROOM).is_ok() {
                    self.rejoin(target);
                } else {
                    self.add(target);
                }
            }
            _ => {}
        }
        self.assert_epoch_exclusion();
    }
}

proptest! {
    #![proptest_config(ProptestConfig {
        cases: 16,
        max_shrink_iters: 512,
        .. ProptestConfig::default()
    })]

    #[test]
    fn generated_membership_and_host_transitions_fail_closed(
        actions in prop::collection::vec(any::<u8>(), 1..12)
    ) {
        let mut model = Model::new();
        for action in actions {
            model.apply(action);
        }
    }
}

#[test]
fn truncated_commit_rejections_do_not_poison_the_valid_transition() {
    let mut host = engine(0, 0);
    let mut member = engine(1, 0);
    let newcomer = engine(2, 0);
    host.create_group("truncation-room").unwrap();
    let first = host
        .add_member("truncation-room", &member.generate_key_package().unwrap())
        .unwrap();
    host.publish_succeeded("truncation-room", &first.commit_outbox_id)
        .unwrap();
    member
        .join_welcome("truncation-room", &first.welcome)
        .unwrap();
    let commit = host
        .add_member("truncation-room", &newcomer.generate_key_package().unwrap())
        .unwrap();
    host.publish_succeeded("truncation-room", &commit.commit_outbox_id)
        .unwrap();

    for length in 0..commit.commit.len() {
        assert!(member
            .process_incoming("truncation-room", &commit.commit[..length])
            .is_err());
    }
    assert!(member
        .process_incoming("truncation-room", &commit.commit)
        .is_ok());
}

#[test]
fn reordered_and_replayed_commits_fail_without_blocking_ordered_progress() {
    let mut host = engine(0, 0);
    let mut member = engine(1, 0);
    let newcomer = engine(2, 0);
    host.create_group("ordering-room").unwrap();
    let first = host
        .add_member("ordering-room", &member.generate_key_package().unwrap())
        .unwrap();
    host.publish_succeeded("ordering-room", &first.commit_outbox_id)
        .unwrap();
    member
        .join_welcome("ordering-room", &first.welcome)
        .unwrap();

    let second = host
        .add_member("ordering-room", &newcomer.generate_key_package().unwrap())
        .unwrap();
    host.publish_succeeded("ordering-room", &second.commit_outbox_id)
        .unwrap();
    let member_leaf = member.self_leaf("ordering-room").unwrap();
    let third = host
        .transfer_host("ordering-room", member_leaf, "device-1-0".into())
        .unwrap();
    host.publish_succeeded("ordering-room", &third.outbox_id)
        .unwrap();

    assert!(member
        .process_incoming("ordering-room", &third.message)
        .is_err());
    member
        .process_incoming("ordering-room", &second.commit)
        .unwrap();
    member
        .process_incoming("ordering-room", &third.message)
        .unwrap();
    assert!(member
        .process_incoming("ordering-room", &second.commit)
        .is_err());
    assert!(member
        .process_incoming("ordering-room", &third.message)
        .is_err());
}
