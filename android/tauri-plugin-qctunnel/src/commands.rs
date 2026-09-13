use tauri::{command, AppHandle, Runtime};

use crate::{TunnelExt, Result};

#[command]
pub(crate) async fn start<R: Runtime>(
    app: AppHandle<R>,
    config: String,
) -> Result<()> {
    app.tunnel().start(config, None, None)
}

#[command]
pub(crate) async fn stop<R: Runtime>(app: AppHandle<R>) -> Result<()> {
    app.tunnel().stop()
}

#[command]
pub(crate) async fn status<R: Runtime>(app: AppHandle<R>) -> Result<(bool, Option<String>)> {
    app.tunnel().status()
}

#[command]
pub(crate) async fn log<R: Runtime>(app: AppHandle<R>) -> Result<String> {
    app.tunnel().log()
}
