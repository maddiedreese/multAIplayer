include!("src/registered_commands.rs");

macro_rules! command_names {
    (
        infallible: [$($infallible:ident),+ $(,)?],
        fallible: [$($fallible:ident),+ $(,)?],
    ) => {
        &[$(stringify!($infallible)),+, $(stringify!($fallible)),+]
    };
}

fn main() {
    let commands = with_registered_commands!(command_names);
    let attributes = tauri_build::Attributes::new()
        .app_manifest(tauri_build::AppManifest::new().commands(commands));
    tauri_build::try_build(attributes).expect("failed to build Tauri application manifest");
}
