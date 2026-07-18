use multaiplayer_protocol::*;
use serde::de::DeserializeOwned;
use serde::Deserialize;

#[derive(Debug, Deserialize)]
struct FixtureDocument {
    version: u8,
    authority: String,
    cases: Vec<FixtureCase>,
}

#[derive(Debug, Deserialize)]
struct FixtureCase {
    name: String,
    schema: String,
    kind: Option<String>,
    json: String,
}

#[test]
fn typescript_golden_fixtures_round_trip_identically_in_rust() {
    let document: FixtureDocument = serde_json::from_str(include_str!(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../../../packages/protocol/fixtures/golden-v1.json"
    )))
    .expect("TypeScript fixture document is valid JSON");
    assert_eq!(document.version, 1);
    assert_eq!(document.authority, "packages/protocol Zod schemas");
    assert!(
        document.cases.len() >= 50,
        "all current wire shapes are represented"
    );

    for fixture in document.cases {
        round_trip_fixture(&fixture).unwrap_or_else(|error| panic!("{}: {error}", fixture.name));
        if let Some(kind) = &fixture.kind {
            let plaintext = serde_json::from_str(&fixture.json).expect("fixture payload is JSON");
            assert!(
                !matches!(
                    RoomEvent::parse(kind, plaintext),
                    Ok(RoomEvent::Unsupported { .. })
                ),
                "{} must be recognized as a supported room event",
                fixture.name
            );
        }
    }
}

fn round_trip_fixture(fixture: &FixtureCase) -> Result<(), ProtocolError> {
    macro_rules! schema {
        ($type:ty) => {
            round_trip::<$type>(&fixture.json)
        };
    }
    match fixture.schema.as_str() {
        "AttachmentBlobRecord" => schema!(AttachmentBlobRecord),
        "BrowserRequestPlaintextPayload" => schema!(BrowserRequestPlaintextPayload),
        "ChatDeletePlaintextPayload" => schema!(ChatDeletePlaintextPayload),
        "ChatEditPlaintextPayload" => schema!(ChatEditPlaintextPayload),
        "ChatPlaintextPayload" => schema!(ChatPlaintextPayload),
        "ChatReactionPlaintextPayload" => schema!(ChatReactionPlaintextPayload),
        "ClientRoomRecord" => schema!(ClientRoomRecord),
        "CodexActivityPlaintextPayload" => schema!(CodexActivityPlaintextPayload),
        "CodexEventPlaintextPayload" => schema!(CodexEventPlaintextPayload),
        "CodexQueuePlaintextPayload" => schema!(CodexQueuePlaintextPayload),
        "DeviceRecord" => schema!(DeviceRecord),
        "GitHubActionsEventPlaintextPayload" => schema!(GitHubActionsEventPlaintextPayload),
        "GitWorkflowEventPlaintextPayload" => schema!(GitWorkflowEventPlaintextPayload),
        "HostHandoffAcceptedPlaintextPayload" => schema!(HostHandoffAcceptedPlaintextPayload),
        "HostHandoffPlaintextPayload" => schema!(HostHandoffPlaintextPayload),
        "HostHandoffRequestPlaintextPayload" => schema!(HostHandoffRequestPlaintextPayload),
        "InviteJoinRequestRecord" => schema!(InviteJoinRequestRecord),
        "InviteRecord" => schema!(InviteRecord),
        "InviteResponseRecord" => schema!(InviteResponseRecord),
        "KeyPackageRecord" => schema!(KeyPackageRecord),
        "KeyPackageUpload" => schema!(KeyPackageUpload),
        "LocalPreviewPlaintextPayload" => schema!(LocalPreviewPlaintextPayload),
        "MlsRelayMessage" => schema!(MlsRelayMessage),
        "PresenceMessage" => schema!(PresenceMessage),
        "RelayClientMessage" => schema!(RelayClientMessage),
        "RelayHttpErrorResponse" => schema!(RelayHttpErrorResponse),
        "RelayServerMessage" => schema!(RelayServerMessage),
        "RequestStatusPlaintextPayload" => schema!(RequestStatusPlaintextPayload),
        "RoomConfigPlaintextPayload" => schema!(RoomConfigPlaintextPayload),
        "RoomRecord" => schema!(RoomRecord),
        "RoomSettingsPlaintextPayload" => schema!(RoomSettingsPlaintextPayload),
        "TeamMemberRecord" => schema!(TeamMemberRecord),
        "TeamRecord" => schema!(TeamRecord),
        "TerminalRequestPlaintextPayload" => schema!(TerminalRequestPlaintextPayload),
        "TerminalResultPlaintextPayload" => schema!(TerminalResultPlaintextPayload),
        "WorkspaceFileSaveRequestPlaintextPayload" => {
            schema!(WorkspaceFileSaveRequestPlaintextPayload)
        }
        unknown => panic!("fixture references unknown schema {unknown}"),
    }
}

fn round_trip<T>(json: &str) -> Result<(), ProtocolError>
where
    T: DeserializeOwned + serde::Serialize + Validate,
{
    let parsed: T = from_json(json)?;
    assert_eq!(to_json(&parsed)?, json);
    Ok(())
}
