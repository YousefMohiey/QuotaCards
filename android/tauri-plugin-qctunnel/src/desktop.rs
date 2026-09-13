use serde::de::DeserializeOwned;
use tauri::{plugin::PluginApi, AppHandle, Runtime};

pub fn init<R: Runtime, C: DeserializeOwned>(
    _app: &AppHandle<R>,
    _api: PluginApi<R, C>,
) -> crate::Result<Tunnel<R>> {
    Ok(Tunnel(()))
}

/// Desktop QuotaCards uses its built-in sing-box engine, never this plugin.
pub struct Tunnel<R: Runtime>(#[allow(dead_code)] ());

impl<R: Runtime> Tunnel<R> {
    pub fn start(&self, _config: String) -> crate::Result<()> {
        Err(crate::Error::Tunnel("tunnel lives in the desktop engine".into()))
    }

    pub fn stop(&self) -> crate::Result<()> {
        Err(crate::Error::Tunnel("tunnel lives in the desktop engine".into()))
    }

    pub fn status(&self) -> crate::Result<(bool, Option<String>)> {
        Err(crate::Error::Tunnel("tunnel lives in the desktop engine".into()))
    }

    pub fn log(&self) -> crate::Result<String> {
        Err(crate::Error::Tunnel("tunnel lives in the desktop engine".into()))
    }

    pub fn traffic(&self) -> crate::Result<(u64, u64)> {
        Err(crate::Error::Tunnel("tunnel lives in the desktop engine".into()))
    }

    pub fn open_bg_settings(&self) -> crate::Result<()> {
        Err(crate::Error::Tunnel("tunnel lives in the desktop engine".into()))
    }

    pub fn bg_status(&self) -> crate::Result<bool> {
        Err(crate::Error::Tunnel("tunnel lives in the desktop engine".into()))
    }
}
