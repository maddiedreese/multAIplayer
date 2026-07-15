use std::{env, fs, process::ExitCode};

fn main() -> ExitCode {
    let mut arguments = env::args_os().skip(1);
    let Some(manifest_path) = arguments.next() else {
        eprintln!("expected manifest path and updater archive path");
        return ExitCode::FAILURE;
    };
    let Some(archive_path) = arguments.next() else {
        eprintln!("expected manifest path and updater archive path");
        return ExitCode::FAILURE;
    };
    if arguments.next().is_some() {
        eprintln!("expected exactly two paths");
        return ExitCode::FAILURE;
    }
    let result = fs::read_to_string(manifest_path)
        .map_err(|_| ())
        .and_then(|manifest| {
            fs::read(archive_path).map_err(|_| ()).and_then(|archive| {
                multaiplayer_lib::updater_auth::verify_published_manifest(&manifest, &archive)
                    .map_err(|_| ())
            })
        });
    if result.is_err() {
        eprintln!("updater manifest or archive signature verification failed");
        return ExitCode::FAILURE;
    }
    println!("Verified authenticated updater metadata and updater archive signature.");
    ExitCode::SUCCESS
}
