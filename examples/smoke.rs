//! Integration smoke test: runs the real server ops against the seeded config.
//! cargo run --example smoke
use quotacards::{config::AppConfig, server};

#[tokio::main(flavor = "current_thread")]
async fn main() {
    let cfg = AppConfig::load();
    println!("server: {}", cfg.server_ip);
    println!("user: {}", cfg.ssh_user);
    println!("key len: {}", cfg.private_key.len());
    println!("synced: {}", cfg.synced);

    let u = uuid::Uuid::new_v4().to_string();
    println!("test add {}", &u);
    match server::add_client(&cfg.server_ip, cfg.ssh_port, &cfg.ssh_user, &cfg.private_key, &u).await {
        Ok(o) => println!("ADD OK: {o}"),
        Err(e) => { println!("ADD FAIL: {e}"); return; }
    }
    match server::list_clients(&cfg.server_ip, cfg.ssh_port, &cfg.ssh_user, &cfg.private_key).await {
        Ok(list) => println!("SERVER CLIENTS ({}): {:?}", list.len(), list),
        Err(e) => println!("LIST FAIL: {e}"),
    }
    match server::remove_client(&cfg.server_ip, cfg.ssh_port, &cfg.ssh_user, &cfg.private_key, &u).await {
        Ok(o) => println!("REMOVE OK: {o}"),
        Err(e) => println!("REMOVE FAIL: {e}"),
    }
    println!("DONE");
}