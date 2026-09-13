use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};
use tauri::{
    plugin::{PluginApi, PluginHandle},
    AppHandle, Runtime,
};

#[cfg(target_os = "android")]
const PLUGIN_IDENTIFIER: &str = "com.quotacards.tunnel";

pub fn init<R: Runtime, C: DeserializeOwned>(
    _app: &AppHandle<R>,
    api: PluginApi<R, C>,
) -> crate::Result<Tunnel<R>> {
    #[cfg(target_os = "android")]
    let handle = api.register_android_plugin(PLUGIN_IDENTIFIER, "TunnelPlugin")?;
    #[cfg(target_os = "ios")]
    let handle = api.register_ios_plugin(tauri::ios_plugin_binding!(init_plugin_qctunnel))?;
    Ok(Tunnel(handle))
}

/// Access to the tunnel APIs.
pub struct Tunnel<R: Runtime>(PluginHandle<R>);

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct StartPayload {
    config: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    apps: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    appsMode: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StatusPayload {
    running: bool,
    error: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LogPayload {
    #[serde(default)]
    lines: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct TrafficPayload {
    #[serde(default)]
    rx: u64,
    #[serde(default)]
    tx: u64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AppsPayload {
    #[serde(default)]
    apps: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct BgPayload {
    #[serde(default)]
    exempt: bool,
}

impl<R: Runtime> Tunnel<R> {
    pub fn start(&self, config: String, apps: Option<String>, apps_mode: Option<String>) -> crate::Result<()> {
        self.0
            .run_mobile_plugin("start", StartPayload { config, apps, appsMode: apps_mode })
            .map_err(Into::into)
    }

    pub fn stop(&self) -> crate::Result<()> {
        self.0.run_mobile_plugin("stop", ()).map_err(Into::into)
    }

    pub fn status(&self) -> crate::Result<(bool, Option<String>)> {
        let s: StatusPayload = self
            .0
            .run_mobile_plugin("status", ())
            .map_err(crate::Error::from)?;
        Ok((s.running, s.error))
    }

    pub fn log(&self) -> crate::Result<String> {
        let l: LogPayload = self
            .0
            .run_mobile_plugin("log", ())
            .map_err(crate::Error::from)?;
        Ok(l.lines)
    }

    /// Session traffic in bytes since connect (rx, tx).
    pub fn traffic(&self) -> crate::Result<(u64, u64)> {
        let t: TrafficPayload = self
            .0
            .run_mobile_plugin("traffic", ())
            .map_err(crate::Error::from)?;
        Ok((t.rx, t.tx))
    }

    /// Launchable apps as a JSON string, for the per-app picker.
    pub fn apps(&self) -> crate::Result<String> {
        let a: AppsPayload = self
            .0
            .run_mobile_plugin("apps", ())
            .map_err(crate::Error::from)?;
        Ok(a.apps)
    }

    /// System VPN screen (Always-on + Block connections live there).
    pub fn open_vpn_settings(&self) -> crate::Result<()> {
        self.0
            .run_mobile_plugin("openVpnSettings", ())
            .map_err(Into::into)
    }

    /// Battery-exemption screen (stops swipe-away kills on strict phones).
    pub fn open_bg_settings(&self) -> crate::Result<()> {
        self.0
            .run_mobile_plugin("openBgSettings", ())
            .map_err(Into::into)
    }

    /// Battery exemption state: true once background running is allowed.
    pub fn bg_status(&self) -> crate::Result<bool> {
        let b: BgPayload = self
            .0
            .run_mobile_plugin("bgStatus", ())
            .map_err(crate::Error::from)?;
        Ok(b.exempt)
    }
}
