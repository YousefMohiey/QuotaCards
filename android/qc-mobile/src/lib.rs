//! QuotaCards mobile shell — Phase 1.
//!
//! Same core as desktop (`config` + `server` + `ssh` from the `quotacards`
//! lib): server probe/setup, card generate + revoke, copy link.
//! The tunnel (Phase 2) needs a Kotlin VpnService + Go libbox — see
//! android/README.md. There is deliberately NO Connect button here yet:
//! shipping one that can't open a tunnel would be a lie.

use quotacards::{config::{AppConfig, Card}, server};
use std::sync::mpsc::{self, Receiver, Sender};

enum Evt {
    Status(String, bool),
    CardCreated(Card, String),
}

pub struct QcMobile {
    cfg: AppConfig,
    tx: Sender<Evt>,
    rx: Receiver<Evt>,
    status: Option<(String, bool)>,
    busy: bool,
    card_name: String,
    card_kind: String,
    card_sni: String,
}

impl QcMobile {
    fn new(_cc: &eframe::CreationContext) -> Self {
        let mut cfg = AppConfig::load();
        if cfg.private_key.is_empty() {
            if let Ok((priv_pem, pub_line)) = gen_keypair() {
                cfg.private_key = priv_pem;
                cfg.public_key = pub_line;
                cfg.save();
            }
        }
        let (tx, rx) = mpsc::channel();
        Self {
            cfg,
            tx,
            rx,
            status: None,
            busy: false,
            card_name: String::new(),
            card_kind: "Gamerz".into(),
            card_sni: "ea.com".into(),
        }
    }

    fn set_status(&mut self, ok: bool, msg: impl Into<String>) {
        self.status = Some((msg.into(), ok));
    }

    fn probe(&mut self) {
        if self.cfg.server_ip.is_empty() {
            self.set_status(false, "Enter your server IP first.");
            return;
        }
        let (host, user, port, key) = (
            self.cfg.server_ip.clone(),
            self.cfg.ssh_user.clone(),
            self.cfg.ssh_port,
            self.cfg.private_key.clone(),
        );
        let tx = self.tx.clone();
        self.busy = true;
        self.set_status(true, "Contacting server…");
        std::thread::spawn(move || {
            let rt = tokio::runtime::Builder::new_current_thread()
                .enable_all()
                .build()
                .unwrap();
            // ensure_xray installs Xray on first run, no-op after
            let res = rt.block_on(async {
                if !server::is_embed_key(&key) {
                    server::ensure_xray(&host, port, &user, &key).await?;
                }
                Ok::<_, String>(())
            });
            let ok = res.is_ok();
            let _ = tx.send(Evt::Status(
                match res {
                    Ok(_) => "Connected - server ready.".into(),
                    Err(e) => format!("Connect failed: {e}"),
                },
                ok,
            ));
        });
    }

    fn generate(&mut self) {
        if self.cfg.server_ip.is_empty() {
            self.set_status(false, "Set up your server first.");
            return;
        }
        let uuid = uuid::Uuid::new_v4().to_string();
        let sni = if self.card_sni.trim().is_empty() {
            (if self.card_kind == "Gamerz" { "ea.com" } else { "youtube.com" }).to_string()
        } else {
            self.card_sni.trim().to_string()
        };
        let name = if self.card_name.trim().is_empty() {
            self.card_kind.clone()
        } else {
            self.card_name.trim().to_string()
        };
        let card = Card {
            name: name.clone(),
            uuid: uuid.clone(),
            card_type: self.card_kind.clone(),
            sni: sni.clone(),
            wg_private: String::new(),
            wg_addr: String::new(),
        };
        let link = build_link(&uuid, &self.cfg.server_ip, &sni, &name);
        let (host, user, port, key) = (
            self.cfg.server_ip.clone(),
            self.cfg.ssh_user.clone(),
            self.cfg.ssh_port,
            self.cfg.private_key.clone(),
        );
        let tx = self.tx.clone();
        self.busy = true;
        self.set_status(true, "Creating card on server…");
        std::thread::spawn(move || {
            let rt = tokio::runtime::Builder::new_current_thread()
                .enable_all()
                .build()
                .unwrap();
            let res = rt.block_on(server::add_client(&host, port, &user, &key, &uuid));
            match res {
                Ok(_) => {
                    let _ = tx.send(Evt::CardCreated(card, link));
                }
                Err(e) => {
                    let _ = tx.send(Evt::Status(format!("Failed: {e}"), false));
                }
            }
        });
    }

    fn revoke(&mut self, uuid: String) {
        let (host, user, port, key) = (
            self.cfg.server_ip.clone(),
            self.cfg.ssh_user.clone(),
            self.cfg.ssh_port,
            self.cfg.private_key.clone(),
        );
        let tx = self.tx.clone();
        self.busy = true;
        self.cfg.cards.retain(|c| c.uuid != uuid);
        self.cfg.save();
        std::thread::spawn(move || {
            let rt = tokio::runtime::Builder::new_current_thread()
                .enable_all()
                .build()
                .unwrap();
            let res = rt.block_on(server::remove_client(&host, port, &user, &key, &uuid));
            let ok = res.is_ok();
            let _ = tx.send(Evt::Status(
                match res {
                    Ok(_) => "Card revoked.".into(),
                    Err(e) => format!("Revoke failed: {e}"),
                },
                ok,
            ));
        });
    }
}

impl eframe::App for QcMobile {
    fn ui(&mut self, ui: &mut egui::Ui, _frame: &mut eframe::Frame) {
        while let Ok(evt) = self.rx.try_recv() {
            match evt {
                Evt::Status(m, ok) => {
                    self.set_status(ok, m);
                    self.busy = false;
                }
                Evt::CardCreated(card, link) => {
                    self.cfg.cards.push(card);
                    self.cfg.save();
                    ui.ctx().copy_text(link);
                    self.set_status(true, "Card created - link copied.");
                    self.busy = false;
                }
            }
        }
        // status bar space so content clears the Android status bar
        egui::Panel::top("status_bar_space").show_inside(ui, |ui| {
            ui.set_height(28.0);
        });
        egui::CentralPanel::default().show_inside(ui, |ui| {
            egui::ScrollArea::vertical().show(ui, |ui| {
                ui.heading("QuotaCards");
                if let Some((m, ok)) = self.status.clone() {
                    ui.colored_label(if ok { egui::Color32::GREEN } else { egui::Color32::RED }, m);
                }
                ui.separator();
                ui.label("Server IP:");
                ui.text_edit_singleline(&mut self.cfg.server_ip);
                ui.horizontal(|ui| {
                    ui.label("User:");
                    ui.text_edit_singleline(&mut self.cfg.ssh_user);
                    if ui.button("Connect").clicked() && !self.busy {
                        self.cfg.save();
                        self.probe();
                    }
                });
                ui.separator();
                ui.label("New card name:");
                ui.text_edit_singleline(&mut self.card_name);
                ui.horizontal(|ui| {
                    ui.selectable_value(&mut self.card_kind, "Gamerz".to_string(), "Gamerz");
                    ui.selectable_value(&mut self.card_kind, "Streamerz".to_string(), "Streamerz");
                });
                ui.label("Domain (SNI):");
                ui.text_edit_singleline(&mut self.card_sni);
                if ui.button("Generate card").clicked() && !self.busy {
                    self.generate();
                }
                ui.separator();
                ui.label(format!("My cards ({})", self.cfg.cards.len()));
                let mut revoke: Option<String> = None;
                for c in &self.cfg.cards {
                    ui.horizontal(|ui| {
                        ui.label(c.label());
                        if ui.button("Copy").clicked() {
                            ui.ctx().copy_text(build_link(
                                &c.uuid, &self.cfg.server_ip, &c.sni, &c.name,
                            ));
                        }
                        if ui.button("Revoke").clicked() {
                            revoke = Some(c.uuid.clone());
                        }
                    });
                }
                if let Some(u) = revoke {
                    self.revoke(u);
                }
                ui.separator();
                ui.small("Tunnel connect arrives in Phase 2 (needs the system VPN service).");
            });
        });
    }
}

fn build_link(uuid: &str, host: &str, sni: &str, name: &str) -> String {
    format!("vless://{uuid}@{host}:443?type=tcp&encryption=none&security=tls&fp=random&alpn=h3%2Ch2%2Chttp%2F1.1&allowInsecure=1&sni={sni}#{name}")
}

fn gen_keypair() -> Result<(String, String), String> {
    use ssh_key::{Algorithm, LineEnding, PrivateKey};
    let mut rng = rand_core::OsRng;
    let key = PrivateKey::random(&mut rng, Algorithm::Ed25519).map_err(|e| e.to_string())?;
    let pem: String = key
        .to_openssh(LineEnding::LF)
        .map_err(|e| e.to_string())?
        .to_string();
    Ok((pem, key.public_key().to_string()))
}

#[cfg(target_os = "android")]
#[no_mangle]
fn android_main(app: winit::platform::android::activity::AndroidApp) {
    android_logger::init_once(
        android_logger::Config::default().with_max_level(log::LevelFilter::Info),
    );
    let options = eframe::NativeOptions {
        android_app: Some(app),
        ..Default::default()
    };
    eframe::run_native(
        "QuotaCards",
        options,
        Box::new(|cc| Ok(Box::new(QcMobile::new(cc)))),
    )
    .unwrap();
}
