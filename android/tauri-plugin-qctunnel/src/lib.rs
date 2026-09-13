//! sing-box VPN tunnel for QuotaCards (Android only).
//!
//! Mobile: drives the Kotlin VpnService (`TunnelPlugin`) through
//! `run_mobile_plugin`. Desktop: QuotaCards uses its built-in engine there,
//! so every call here is an error by design.

use tauri::{
    plugin::{Builder, TauriPlugin},
    Manager, Runtime,
};

#[cfg(mobile)]
mod mobile;
#[cfg(desktop)]
mod desktop;

mod commands;
mod error;

pub use error::{Error, Result};

#[cfg(mobile)]
pub use mobile::Tunnel;
#[cfg(desktop)]
pub use desktop::Tunnel;

/// Extensions to access the tunnel from any Tauri manager.
pub trait TunnelExt<R: Runtime> {
    fn tunnel(&self) -> &Tunnel<R>;
}

impl<R: Runtime, T: Manager<R>> crate::TunnelExt<R> for T {
    fn tunnel(&self) -> &Tunnel<R> {
        self.state::<Tunnel<R>>().inner()
    }
}

/// Initializes the plugin.
pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("qctunnel")
        .invoke_handler(tauri::generate_handler![
            commands::start,
            commands::stop,
            commands::status,
            commands::log
        ])
        .setup(|app, api| {
            #[cfg(mobile)]
            let tunnel = mobile::init(app, api)?;
            #[cfg(desktop)]
            let tunnel = desktop::init(app, api)?;
            app.manage(tunnel);
            Ok(())
        })
        .build()
}
