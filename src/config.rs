use serde::{Deserialize, Serialize};
use std::path::PathBuf;

include!(concat!(env!("OUT_DIR"), "/embed.rs"));

/// Pre-pointed server (owner's) - used for zero-setup auto-connect when the
/// embedded device key was baked in at compile time.
pub const DEFAULT_HOST: &str = "quotacards.duckdns.org";
pub const DEFAULT_USER: &str = "ubuntu";
pub const DEFAULT_PORT: u16 = 22;

/// App config - lives in the OS config dir (works for every user, no fixed
/// paths hard-coded into the program).
#[derive(Serialize, Deserialize, Clone, Default)]
pub struct AppConfig {
    pub server_ip: String,
    pub ssh_user: String,
    pub ssh_port: u16,
    /// OpenSSH private key (PEM) - auto-generated on first run by the app.
    pub private_key: String,
    /// Public key line (shown once so the user can paste it in Oracle console).
    pub public_key: String,
    pub cards: Vec<Card>,
    /// True once the server has Xray installed & synced (avoids re-installing).
    pub synced: bool,
    /// Shared Hysteria2 password fetched from the server (game mode needs it).
    #[serde(default)]
    pub hy2_password: String,
    /// WireGuard server public key, fetched once from the server.
    #[serde(default)]
    pub wg_server_pub: String,
    /// AmneziaWG obfuscation parameters (JSON), fetched once from the server.
    #[serde(default)]
    pub awg_params: String,
    /// Tunnel scope: "all" (whole PC) or "apps" (only tun_apps processes).
    #[serde(default)]
    pub tun_mode: String,
    /// Process names routed through the tunnel in "apps" mode.
    #[serde(default)]
    pub tun_apps: Vec<String>,
    /// The app build that last re-registered every card on the server. Lets
    /// the launch refresh run once per update instead of on every open.
    #[serde(default)]
    pub healed_version: String,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct Card {
    pub name: String,
    pub uuid: String,
    pub card_type: String, // "Gamerz" | "Streamerz"
    #[serde(default)]
    pub sni: String,
    /// WireGuard client key for this card (provisioned on first WG connect).
    #[serde(default)]
    pub wg_private: String,
    /// WireGuard address for this card, e.g. "10.8.0.7/32".
    #[serde(default)]
    pub wg_addr: String,
}

impl Card {
    /// Picker label: name + domain ("Streamerz - youtube.com"), so cards
    /// are told apart by where they route, not just their kind.
    pub fn label(&self) -> String {
        if self.sni.is_empty() {
            format!("{} - {}", self.name, self.card_type)
        } else {
            format!("{} - {}", self.name, self.sni)
        }
    }
}

impl AppConfig {
    pub fn config_dir() -> PathBuf {
        let base = dirs::config_dir().unwrap_or_else(|| PathBuf::from("."));
        base.join("quotacards")
    }

    pub fn config_path() -> PathBuf {
        Self::config_dir().join("config.json")
    }

    pub fn load() -> Self {
        let p = Self::config_path();
        if let Ok(txt) = std::fs::read_to_string(&p) {
            if let Ok(c) = serde_json::from_str(&txt) {
                return c;
            }
        }
        Self::default()
    }

    pub fn save(&self) {
        if let Some(dir) = Self::config_dir().to_str() {
            let _ = std::fs::create_dir_all(dir);
        }
        let p = Self::config_path();
        if let Ok(txt) = serde_json::to_string_pretty(self) {
            let _ = std::fs::write(p, txt);
        }
    }
}